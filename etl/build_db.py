"""Build data/arkansas.duckdb from the files in data/raw/.

Run:  python etl/build_db.py

Tables
  places        one row per county or municipality
  population    geoid, year, population            (long)
  demographics  one row per place                  (shares are 0-100)
  elections     county_fips, year, dem, gop, total (presidential)
Views
  place_summary one row per place with the numbers the table and map need
"""
import csv
import json
from collections import defaultdict
from pathlib import Path

import duckdb

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw"
CENSUS = RAW / "census"
DB = ROOT / "data" / "arkansas.duckdb"
KM2_TO_SQMI = 0.386102
EST_YEARS = [2020, 2021, 2022, 2023, 2024]
CHANGE_BASE_YEAR = 2020          # "population change" is measured from here for every place

SCHEMA = """
CREATE TABLE places (
    geoid        VARCHAR PRIMARY KEY,   -- 5-digit county FIPS or 7-digit place FIPS
    name         VARCHAR NOT NULL,
    kind         VARCHAR NOT NULL,      -- 'county' | 'city' | 'town'
    county_fips  VARCHAR NOT NULL,      -- a county's own FIPS; for a municipality, the county holding most of its people
    county_name  VARCHAR NOT NULL,
    other_counties VARCHAR,             -- other counties a municipality extends into, if any
    lat DOUBLE, lon DOUBLE, land_sqmi DOUBLE
);
CREATE TABLE population (geoid VARCHAR, year INTEGER, population INTEGER, PRIMARY KEY (geoid, year));
CREATE TABLE demographics (
    geoid VARCHAR PRIMARY KEY,
    -- ACS 2019-2023 (table DP05). Race groups are non-Hispanic, so the five shares add to 100.
    pct_white DOUBLE, pct_black DOUBLE, pct_hispanic DOUBLE, pct_asian DOUBLE, pct_other DOUBLE,
    median_age DOUBLE, pct_under18 DOUBLE, pct_65plus DOUBLE,
    -- ACS 2019-2023, tables DP03 (income, poverty) and DP02 (education)
    median_household_income INTEGER, per_capita_income INTEGER, poverty_rate DOUBLE, pct_bachelors DOUBLE
);
CREATE TABLE elections (county_fips VARCHAR, year INTEGER, dem INTEGER, gop INTEGER, total INTEGER,
                        PRIMARY KEY (county_fips, year));
CREATE TABLE sources (topic VARCHAR, covers VARCHAR, source VARCHAR, url VARCHAR);
"""

SUMMARY_VIEW = f"""
CREATE VIEW place_summary AS
WITH pop AS (
    SELECT geoid,
           arg_max(population, year) AS population, max(year) AS pop_year,
           max(population) FILTER (year = {CHANGE_BASE_YEAR}) AS base_population
    FROM population GROUP BY geoid
), latest AS (
    SELECT county_fips, max(year) AS election_year,
           arg_max(100.0 * (gop - dem) / total, year) AS gop_margin,
           arg_max(100.0 * gop / total, year) AS gop_pct,
           arg_max(100.0 * dem / total, year) AS dem_pct
    FROM elections GROUP BY county_fips
)
SELECT p.*, pop.population, pop.pop_year, pop.base_population, {CHANGE_BASE_YEAR} AS base_year,
       round(100.0 * (pop.population - pop.base_population) / nullif(pop.base_population, 0), 1) AS pop_change_pct,
       round(pop.population / nullif(p.land_sqmi, 0), 1) AS density,
       d.* EXCLUDE (geoid),
       l.election_year, round(l.gop_margin, 1) AS gop_margin,
       round(l.gop_pct, 1) AS gop_pct, round(l.dem_pct, 1) AS dem_pct
FROM places p
LEFT JOIN pop USING (geoid)
LEFT JOIN demographics d USING (geoid)
LEFT JOIN latest l USING (county_fips);
"""


def to_num(text):
    """'16,773' -> 16773.0 ; Census placeholders like '-' or '(X)' -> None."""
    try:
        return float(str(text).replace(",", ""))
    except ValueError:
        return None


def demo_row(total, white, black, hisp, asian, median_age, under18, over65):
    """Turn DP05 counts into the percentage columns (None where nobody lives there)."""
    if not total:
        return [None] * 5 + [median_age, None, None]
    share = lambda n: round(100 * n / total, 1)
    other = max(0.0, total - white - black - hisp - asian)
    return [share(white), share(black), share(hisp), share(asian), share(other),
            median_age, share(under18), share(over65)]


# ---------- counties ----------
def load_counties(con):
    counties = json.loads((RAW / "ar_counties.json").read_text())
    shapes = {f["id"]: f["properties"] for f in
              json.loads((RAW / "ar_counties.geojson").read_text())["features"]}
    for c in counties:
        fips = c["fips"]
        name = shapes[fips]["name"] + " County"
        con.execute("INSERT INTO places VALUES (?,?,?,?,?,?,?,?,?)",
                    [fips, name, "county", fips, name, None, c["latitude (deg)"], c["longitude (deg)"],
                     round(c["land_area (km^2)"] * KM2_TO_SQMI, 1)])
        con.executemany("INSERT INTO population VALUES (?,?,?)",
                        [[fips, int(y), int(n)] for y, n in c["population"].items()])
    return len(counties)


def load_county_demographics(con):
    """dp05_counties.csv is the 'transposed' download: one row per measure, four columns per county."""
    with open(CENSUS / "dp05_counties.csv", encoding="utf-8-sig", newline="") as f:
        table = list(csv.reader(f))
    header, body = table[0], table[1:]
    labels = [r[0].strip() for r in body]

    def row_of(section, label):
        """Index of the first `label` row that comes after the `section` heading row."""
        return labels.index(label, labels.index(section))

    want = {
        "total": row_of("SEX AND AGE", "Total population"),
        "median_age": row_of("SEX AND AGE", "Median age (years)"),
        "under18": row_of("SEX AND AGE", "Under 18 years"),
        "over65": row_of("SEX AND AGE", "65 years and over"),
        "hisp": row_of("HISPANIC OR LATINO AND RACE", "Hispanic or Latino (of any race)"),
        "white": row_of("HISPANIC OR LATINO AND RACE", "White alone"),
        "black": row_of("HISPANIC OR LATINO AND RACE", "Black or African American alone"),
        "asian": row_of("HISPANIC OR LATINO AND RACE", "Asian alone"),
    }
    ids = dict(con.execute("SELECT name, geoid FROM places WHERE kind = 'county'").fetchall())
    n = 0
    for col, head in enumerate(header):
        if not head.endswith("!!Estimate"):
            continue
        name = head.split(",")[0]                       # "St. Francis County"
        v = {k: to_num(body[i][col]) for k, i in want.items()}
        con.execute("INSERT INTO demographics VALUES (?,?,?,?,?,?,?,?,?,NULL,NULL,NULL,NULL)",
                    [ids[name]] + demo_row(v["total"], v["white"], v["black"], v["hisp"], v["asian"],
                                           v["median_age"], v["under18"], v["over65"]))
        n += 1
    return n


# ---------- population estimates (counties 2020-24, every city and town) ----------
def load_estimates(con):
    with open(CENSUS / "sub-est2024_5.csv", encoding="latin-1", newline="") as f:
        rows = list(csv.DictReader(f))
    county_names = dict(con.execute("SELECT geoid, name FROM places WHERE kind = 'county'").fetchall())
    years = lambda r: [int(r[f"POPESTIMATE{y}"]) for y in EST_YEARS]

    # A place can straddle county lines: SUMLEV 157 rows give each county's share of it.
    parts = defaultdict(list)
    for r in rows:
        if r["SUMLEV"] == "157":
            parts[r["PLACE"]].append((int(r["POPESTIMATE2024"]), r["STATE"] + r["COUNTY"]))

    n = 0
    for r in rows:
        if r["SUMLEV"] == "050":
            geoid = r["STATE"] + r["COUNTY"]
        elif r["SUMLEV"] == "162":
            geoid = r["STATE"] + r["PLACE"]
            name, _, kind = r["NAME"].rpartition(" ")   # "Heber Springs city" -> name, kind
            ranked = [fips for _, fips in sorted(parts[r["PLACE"]], reverse=True)]
            home, others = ranked[0], ranked[1:]
            con.execute("INSERT INTO places VALUES (?,?,?,?,?,?,?,?,?)",
                        [geoid, name, kind, home, county_names[home],
                         ", ".join(county_names[c] for c in others) or None, None, None, None])
            n += 1
        else:
            continue
        con.executemany("INSERT INTO population VALUES (?,?,?)",
                        [[geoid, y, p] for y, p in zip(EST_YEARS, years(r))])
    return n


def load_place_demographics(con):
    """dp05_places.csv is the standard download: one row per place, DP05_xxxxE columns, labels in row 2."""
    known = {r[0] for r in con.execute("SELECT geoid FROM places WHERE kind <> 'county'").fetchall()}
    with open(CENSUS / "dp05_places.csv", encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f)
        next(reader)                                    # second header row (plain-English labels)
        n = 0
        for r in reader:
            geoid = r["GEO_ID"].split("US")[1]
            if geoid not in known:                      # unincorporated communities (CDPs)
                continue
            g = lambda code: to_num(r[f"DP05_{code}E"])
            con.execute("INSERT INTO demographics VALUES (?,?,?,?,?,?,?,?,?,NULL,NULL,NULL,NULL)",
                        [geoid] + demo_row(g("0001"), g("0082"), g("0083"), g("0076"), g("0085"),
                                           g("0018"), g("0019"), g("0024")))
            n += 1
    return n


def load_economics(con):
    """DP03 (income, poverty) and DP02 (education), for places and counties. Same layout as dp05_places."""
    known = {r[0] for r in con.execute("SELECT geoid FROM demographics").fetchall()}
    columns = {
        "dp03": {"median_household_income": "DP03_0062E", "per_capita_income": "DP03_0088E",
                 "poverty_rate": "DP03_0128PE"},
        "dp02": {"pct_bachelors": "DP02_0068PE"},
    }
    for table, cols in columns.items():
        for level in ("places", "counties"):
            with open(CENSUS / f"{table}_{level}.csv", encoding="utf-8-sig", newline="") as f:
                reader = csv.DictReader(f)
                next(reader)
                for r in reader:
                    geoid = r["GEO_ID"].split("US")[1]
                    if geoid in known:
                        sets = ", ".join(f"{c} = ?" for c in cols)
                        con.execute(f"UPDATE demographics SET {sets} WHERE geoid = ?",
                                    [to_num(r[code]) for code in cols.values()] + [geoid])


def load_place_geography(con):
    """Land area and a centre point for each municipality, from the boundary file."""
    shapes = json.loads((RAW / "ar_places.geojson").read_text())["features"]
    for f in shapes:
        p = f["properties"]
        con.execute("UPDATE places SET land_sqmi = ?, lat = ?, lon = ? WHERE geoid = ?",
                    [p["land_sqmi"], p["lat"], p["lon"], f["id"]])
    return len(shapes)


def main():
    DB.unlink(missing_ok=True)
    con = duckdb.connect(str(DB))
    con.execute(SCHEMA)
    n_counties = load_counties(con)
    n_county_demo = load_county_demographics(con)
    n_places = load_estimates(con)
    n_place_demo = load_place_demographics(con)
    load_economics(con)
    n_shapes = load_place_geography(con)
    con.execute(f"INSERT INTO elections SELECT * FROM read_csv('{RAW / 'ar_president.csv'}', "
                "types={'county_fips': 'VARCHAR'})")
    gh, cb = "https://github.com/", "https://www.census.gov/"
    con.executemany("INSERT INTO sources VALUES (?,?,?,?)", [
        ["Population, 2020-2024", "counties, cities and towns; July 1 estimates",
         "Census Bureau, Vintage 2024 subcounty population estimates", cb + "programs-surveys/popest.html"],
        ["Population, 2010-2019", "counties only; July 1 estimates",
         "JsonOfCounties (Census Bureau estimates)", gh + "evangambit/JsonOfCounties"],
        ["Race, ethnicity and age", "counties, cities and towns; 2019-2023 average",
         "Census Bureau, American Community Survey 5-year, table DP05", "https://data.census.gov/table/ACSDP5Y2023.DP05"],
        ["Income and poverty", "counties, cities and towns; 2019-2023 average, 2023 dollars",
         "Census Bureau, American Community Survey 5-year, table DP03", "https://data.census.gov/table/ACSDP5Y2023.DP03"],
        ["Education", "counties, cities and towns; adults 25 and over, 2019-2023 average",
         "Census Bureau, American Community Survey 5-year, table DP02", "https://data.census.gov/table/ACSDP5Y2023.DP02"],
        ["City and town boundaries", "2023 outlines and land area",
         "Census Bureau cartographic boundary file cb_2023_05_place_500k", cb + "geographies/mapping-files/time-series/geo/cartographic-boundary.html"],
        ["Presidential results", "2008-2024, county level", "tonmcg county-level results",
         gh + "tonmcg/US_County_Level_Election_Results_08-24"],
        ["County boundaries", "generalised outlines", "plotly datasets (Census cartographic boundaries)",
         gh + "plotly/datasets"],
    ])
    con.execute(SUMMARY_VIEW)
    print(f"{n_counties} counties ({n_county_demo} with DP05), {n_places} municipalities "
          f"({n_place_demo} with DP05, {n_shapes} with boundaries)")
    print(con.sql("SELECT kind, count(*) n, sum(population) pop FROM place_summary GROUP BY kind ORDER BY kind"))
    con.close()


if __name__ == "__main__":
    main()
