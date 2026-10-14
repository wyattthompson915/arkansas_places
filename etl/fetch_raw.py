"""Download the public source files and keep only the Arkansas rows.

Run once:  python etl/fetch_raw.py
Writes small Arkansas-only extracts into data/raw/ (these are committed, so
you only need to re-run this if you want to refresh from the sources).
"""
import csv, io, json, urllib.request
from pathlib import Path

RAW = Path(__file__).resolve().parent.parent / "data" / "raw"
GH = "https://raw.githubusercontent.com"
SOURCES = {
    "counties": f"{GH}/evangambit/JsonOfCounties/master/counties.json",
    "pres_08_16": f"{GH}/tonmcg/US_County_Level_Election_Results_08-24/master/US_County_Level_Presidential_Results_08-16.csv",
    "pres_2020": f"{GH}/tonmcg/US_County_Level_Election_Results_08-24/master/2020_US_County_Level_Presidential_Results.csv",
    "pres_2024": f"{GH}/tonmcg/US_County_Level_Election_Results_08-24/master/2024_US_County_Level_Presidential_Results.csv",
    "geojson": f"{GH}/plotly/datasets/master/geojson-counties-fips.json",
}
STATE_FIPS = "05"


def get(url, encoding="utf-8"):
    print("fetching", url)
    with urllib.request.urlopen(url, timeout=120) as r:
        return r.read().decode(encoding)


def main():
    RAW.mkdir(parents=True, exist_ok=True)

    counties = [c for c in json.loads(get(SOURCES["counties"])) if c["state"] == "AR"]
    keep = ["name", "fips", "land_area (km^2)", "longitude (deg)", "latitude (deg)", "race", "age",
            "male", "female", "population", "avg_income", "edu", "poverty-rate", "bls", "life-expectancy"]
    counties = [{k: c.get(k) for k in keep} for c in counties]
    (RAW / "ar_counties.json").write_text(json.dumps(counties, indent=1))

    rows = []  # long format: fips, year, dem, gop, total
    for r in csv.DictReader(io.StringIO(get(SOURCES["pres_08_16"]))):
        if r["fips_code"].startswith(STATE_FIPS):
            for y in ("2008", "2012", "2016"):
                rows.append([r["fips_code"], y, r[f"dem_{y}"], r[f"gop_{y}"], r[f"total_{y}"]])
    for y in ("2020", "2024"):
        for r in csv.DictReader(io.StringIO(get(SOURCES[f"pres_{y}"]))):
            if r["county_fips"].startswith(STATE_FIPS):
                rows.append([r["county_fips"], y, r["votes_dem"], r["votes_gop"], r["total_votes"]])
    with open(RAW / "ar_president.csv", "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["county_fips", "year", "dem", "gop", "total"])
        w.writerows(sorted(rows))

    gj = json.loads(get(SOURCES["geojson"], "latin-1"))
    feats = []
    for ft in gj["features"]:
        p = ft["properties"]
        if p["STATE"] == STATE_FIPS:
            feats.append({"type": "Feature", "id": p["STATE"] + p["COUNTY"],
                          "properties": {"name": p["NAME"], "land_sqmi": p["CENSUSAREA"]},
                          "geometry": ft["geometry"]})
    (RAW / "ar_counties.geojson").write_text(json.dumps({"type": "FeatureCollection", "features": feats}))
    print(f"{len(counties)} counties, {len(rows)} election rows, {len(feats)} shapes")


if __name__ == "__main__":
    main()
