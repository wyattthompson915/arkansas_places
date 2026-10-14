"""Convert the Census place boundary shapefile into a small GeoJSON file.

Run:  pip install pyshp && python etl/convert_boundaries.py

Reads  data/raw/census/boundaries/cb_2023_05_place_500k.shp
Writes data/raw/ar_places.geojson   (incorporated cities and towns only)

The output is committed, so the app itself does not need pyshp.
"""
import json
from pathlib import Path

import shapefile  # pyshp

RAW = Path(__file__).resolve().parent.parent / "data" / "raw"
SRC = RAW / "census" / "boundaries" / "cb_2023_05_place_500k"
SQM_TO_SQMI = 3.861e-7
INCORPORATED = {"25": "city", "43": "town"}      # LSAD codes; 57 = unincorporated CDP


def main():
    reader = shapefile.Reader(str(SRC))
    features = []
    for sr in reader.iterShapeRecords():
        rec = sr.record.as_dict()
        if rec["LSAD"] not in INCORPORATED:
            continue
        geom = sr.shape.__geo_interface__
        polys = [geom["coordinates"]] if geom["type"] == "Polygon" else geom["coordinates"]
        # 4 decimal places is about 10 metres: plenty for a web map and a third of the size.
        polys = [[[[round(x, 4), round(y, 4)] for x, y in ring] for ring in poly] for poly in polys]
        west, south, east, north = sr.shape.bbox
        features.append({
            "type": "Feature", "id": rec["GEOID"],
            "properties": {"name": rec["NAME"], "land_sqmi": round(rec["ALAND"] * SQM_TO_SQMI, 2),
                           "lat": round((south + north) / 2, 4), "lon": round((west + east) / 2, 4)},
            "geometry": {"type": "MultiPolygon", "coordinates": polys},
        })
    out = RAW / "ar_places.geojson"
    out.write_text(json.dumps({"type": "FeatureCollection", "features": features}, separators=(",", ":")))
    print(f"{len(features)} places -> {out} ({out.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main()
