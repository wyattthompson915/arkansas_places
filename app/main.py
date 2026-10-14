"""Arkansas Places API.  Run from the project root:

    uvicorn app.main:app --reload

Then open http://127.0.0.1:8000
"""
import json
from pathlib import Path

import duckdb
from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

ROOT = Path(__file__).resolve().parent.parent
DB_PATH = ROOT / "data" / "arkansas.duckdb"
if not DB_PATH.exists():
    raise SystemExit("data/arkansas.duckdb not found. Run: python etl/build_db.py")

con = duckdb.connect(str(DB_PATH), read_only=True)
GEOJSON = json.loads((ROOT / "data" / "raw" / "ar_counties.geojson").read_text())
PLACE_SHAPES = json.loads((ROOT / "data" / "raw" / "ar_places.geojson").read_text())

app = FastAPI(title="Arkansas Places")

# Columns the table can be sorted by (whitelist: sort is interpolated into SQL).
SORTABLE = {"name", "kind", "county_name", "population", "pop_change_pct", "density", "pct_white",
            "pct_black", "pct_hispanic", "pct_65plus", "median_age", "pct_under18",
            "median_household_income", "per_capita_income", "poverty_rate", "pct_bachelors",
            "gop_margin"}


def rows(sql, params=()):
    """Run a query on a per-request cursor and return a list of dicts."""
    cur = con.cursor()
    cur.execute(sql, list(params))
    cols = [d[0] for d in cur.description]
    return [dict(zip(cols, r)) for r in cur.fetchall()]


@app.get("/api/places")
def list_places(q: str = "", kind: str = "", county: str = "",
                sort: str = "population", order: str = "desc"):
    """Every place, one row each. Filter by name, kind or county; sort by any column."""
    if sort not in SORTABLE:
        raise HTTPException(400, f"cannot sort by {sort}")
    direction = "ASC" if order == "asc" else "DESC"
    where, params = ["1=1"], []
    if q:
        where.append("name ILIKE ?")
        params.append(f"%{q}%")
    if kind == "municipality":
        where.append("kind IN ('city', 'town')")
    elif kind:
        where.append("kind = ?")
        params.append(kind)
    if county:
        where.append("county_fips = ?")
        params.append(county)
    return rows(f"SELECT * FROM place_summary WHERE {' AND '.join(where)} "
                f"ORDER BY {sort} {direction} NULLS LAST, name", params)


def place_detail(geoid: str):
    found = rows("SELECT * FROM place_summary WHERE geoid = ?", [geoid])
    if not found:
        raise HTTPException(404, f"no place with geoid {geoid}")
    place = found[0]
    place["population_series"] = rows(
        "SELECT year, population FROM population WHERE geoid = ? ORDER BY year", [geoid])
    # Results are only published by county, so a municipality shows its county's.
    place["elections"] = rows(
        "SELECT year, dem, gop, total, round(100.0 * dem / total, 1) AS dem_pct, "
        "round(100.0 * gop / total, 1) AS gop_pct, round(100.0 * (gop - dem) / total, 1) AS gop_margin "
        "FROM elections WHERE county_fips = ? ORDER BY year", [place["county_fips"]])
    place["municipalities"] = rows(
        "SELECT geoid, name, kind, population FROM place_summary "
        "WHERE county_fips = ? AND kind <> 'county' ORDER BY population DESC NULLS LAST",
        [geoid]) if place["kind"] == "county" else []
    return place


@app.get("/api/places/{geoid}")
def get_place(geoid: str):
    return place_detail(geoid)


@app.get("/api/compare")
def compare(ids: str = Query(..., description="comma-separated geoids, up to 3")):
    return [place_detail(g) for g in ids.split(",")[:3] if g]


# ACS measures averaged across counties, weighted by population. Shares and per-capita income
# come out close to the published state figure; the two medians are only approximations.
# TODO: replace with the state-level ACS 2019-2023 DP02/DP03/DP05 rows once downloaded.
WEIGHTED = ["pct_white", "pct_black", "pct_hispanic", "pct_asian", "pct_other", "median_age",
            "pct_under18", "pct_65plus", "median_household_income", "per_capita_income",
            "poverty_rate", "pct_bachelors"]
STATE_APPROX = ["median_age", "median_household_income"]


@app.get("/api/state")
def state():
    """Statewide figures built from the 75 county rows."""
    weighted = ", ".join(f"round(sum({c} * population::DOUBLE) FILTER ({c} IS NOT NULL) / "
                         f"sum(population) FILTER ({c} IS NOT NULL), 1) AS {c}" for c in WEIGHTED)
    s = rows(f"""
        SELECT 'Arkansas' AS name, 'state' AS kind, sum(population) AS population, max(pop_year) AS pop_year,
               sum(base_population) AS base_population, max(base_year) AS base_year,
               round(100.0 * (sum(population) - sum(base_population)) / sum(base_population), 1) AS pop_change_pct,
               sum(land_sqmi) AS land_sqmi, round(sum(population) / sum(land_sqmi), 1) AS density, {weighted}
        FROM place_summary WHERE kind = 'county'""")[0]
    # Every county has every year, so the sums are true state totals.
    s["population_series"] = rows(
        "SELECT year, sum(population) AS population FROM population JOIN places USING (geoid) "
        "WHERE kind = 'county' GROUP BY year HAVING count(*) = 75 ORDER BY year")
    s["elections"] = rows(
        "SELECT year, sum(dem) AS dem, sum(gop) AS gop, sum(total) AS total, "
        "round(100.0 * sum(dem) / sum(total), 1) AS dem_pct, round(100.0 * sum(gop) / sum(total), 1) AS gop_pct, "
        "round(100.0 * (sum(gop) - sum(dem)) / sum(total), 1) AS gop_margin "
        "FROM elections GROUP BY year ORDER BY year")
    s["gop_margin"] = s["elections"][-1]["gop_margin"] if s["elections"] else None
    s["approx"] = STATE_APPROX
    return s


def with_stats(features, where, params=()):
    """Attach each shape's place_summary row as its GeoJSON properties."""
    stats = {r["geoid"]: r for r in rows(f"SELECT * FROM place_summary WHERE {where}", params)}
    return [{**f, "properties": stats[f["id"]]} for f in features if f["id"] in stats]


@app.get("/api/map")
def state_map(layer: str = "counties"):
    """Outlines with summary numbers attached. layer = counties | places."""
    if layer == "places":
        features = with_stats(PLACE_SHAPES["features"], "kind <> 'county'")
    else:
        features = with_stats(GEOJSON["features"], "kind = 'county'")
    return {"type": "FeatureCollection", "features": features}


@app.get("/api/map/county/{fips}")
def county_map(fips: str):
    """One county's outline plus every city and town that lies at least partly inside it."""
    county = with_stats(GEOJSON["features"], "geoid = ?", [fips])
    if not county:
        raise HTTPException(404, f"no county with FIPS {fips}")
    name = county[0]["properties"]["name"]
    places = with_stats(PLACE_SHAPES["features"],
                        "kind <> 'county' AND (county_fips = ? OR list_contains(string_split(other_counties, ', '), ?))",
                        [fips, name])
    return {"county": county[0], "places": places}


@app.get("/api/meta")
def meta():
    return {"sources": rows("SELECT * FROM sources"),
            "counts": rows("SELECT kind, count(*) AS n FROM places GROUP BY kind ORDER BY kind")}


@app.get("/")
def index():
    return FileResponse(ROOT / "static" / "index.html")


app.mount("/", StaticFiles(directory=ROOT / "static"), name="static")
