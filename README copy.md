# Arkansas Places

A small database and web app for Arkansas counties and municipalities:
population, population change, demographics and presidential voting history.

## Run it

    pip install -r requirements.txt
    uvicorn app.main:app --reload

Open http://127.0.0.1:8000. Interactive API docs are at /docs.

## Deploy to Render (free)

1. Push this folder to a GitHub repository (include `data/arkansas.duckdb` and `data/raw/`).
2. On render.com: New > Web Service, connect the repository.
3. Settings: Language **Python 3**, Build Command `pip install -r requirements.txt`,
   Start Command `uvicorn app.main:app --host 0.0.0.0 --port $PORT`, Instance Type **Free**.
   (`render.yaml` holds the same settings if you use New > Blueprint instead.)

The free instance sleeps after 15 minutes without visitors and takes about a minute to wake.
Every push to the repository redeploys the site.

## How it fits together

    etl/fetch_raw.py   downloads the public source files, keeps Arkansas rows -> data/raw/
    etl/convert_boundaries.py  turns the Census city boundary shapefile into data/raw/ar_places.geojson
                       (only needed if you replace the shapefile; requires `pip install pyshp`)
    etl/build_db.py    loads data/raw/ (incl. the Census downloads in data/raw/census/) into data/arkansas.duckdb
    app/main.py        FastAPI: reads the DuckDB file and serves JSON plus the static site
    static/            index.html, style.css, charts.js (SVG line chart + map), app.js (views)

To rebuild the database: `python etl/build_db.py`.

## Database

| Table | Contents |
|---|---|
| `places` | one row per county or municipality (`kind` = county, city or town) |
| `population` | `geoid, year, population` |
| `demographics` | race and ethnicity, age, income, poverty, education (percentages 0-100) |
| `elections` | county presidential results: `county_fips, year, dem, gop, total` |
| `place_summary` (view) | one row per place with everything the table and map need |

## API

| Endpoint | Returns |
|---|---|
| `GET /api/places?q=&kind=&county=&sort=&order=` | filtered, sorted list |
| `GET /api/places/{geoid}` | one place with its population series and election results |
| `GET /api/compare?ids=05143,05119` | up to three places in full |
| `GET /api/map?layer=counties` | county outlines (GeoJSON) with summary numbers attached |
| `GET /api/map?layer=places` | city and town outlines with summary numbers attached |
| `GET /api/map/county/{fips}` | one county's outline plus the cities and towns in it |
| `GET /api/meta` | data sources and row counts |

## Data notes

- **Population, 2020-2024**: Census Bureau Vintage 2024 estimates for all 75 counties and
  all 500 incorporated cities and towns (`data/raw/census/sub-est2024_5.csv`).
  "Change" everywhere means 2020 to 2024.
- **Population, 2010-2019**: counties only, from the JsonOfCounties compilation. These come
  from the older estimate series, so expect a small step between 2019 and 2020.
- **Race, ethnicity and age**: American Community Survey 2019-2023, table DP05
  (`dp05_places.csv`, `dp05_counties.csv`). These are survey averages with real sampling
  error, which is large for the smallest towns. Race groups are non-Hispanic so the five
  shares add to 100. One town (Victoria) has no surveyed residents and shows blanks.
- **Income, poverty, education**: ACS 2019-2023, tables DP03 and DP02, for counties and
  municipalities (`dp03_*.csv`, `dp02_*.csv`). Income is median household income and
  per-capita income in 2023 dollars; education is adults 25 and over. The Census Bureau
  withholds median household income for 32 very small towns, which show a dash.
- **Presidential results, 2008-2024**: tonmcg county-level dataset. Its 2012 and 2016
  Arkansas totals run about 1% below the certified statewide counts.
- Election results are only published by county, so a city or town shows the results of the
  county where most of its residents live. 19 municipalities cross a county line.
- **City and town boundaries and land area**: Census cartographic boundary file
  `cb_2023_05_place_500k`. County outlines come from a coarser file, so on the county
  mini-maps a city edge can sit slightly outside the county line.
- Unincorporated communities (Census "CDPs") are left out.
