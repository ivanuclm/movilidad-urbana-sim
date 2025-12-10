# app/services/gtfs_loader.py
from __future__ import annotations

from functools import lru_cache
from pathlib import Path
import csv
import io
import zipfile
from typing import List, Dict

BASE_DIR = Path(__file__).resolve().parents[2]
GTFS_ZIP = BASE_DIR / "data" / "gtfs" / "GTFS_RedAutobusesUrbanos_Madrid_CRTM.zip"  # ajusta nombre si hace falta


@lru_cache(maxsize=1)
def load_gtfs_stops() -> List[Dict]:
    """
    Lee stops.txt desde el ZIP GTFS y devuelve una lista de paradas
    con id, nombre y coordenadas.
    """
    if not GTFS_ZIP.exists():
        raise FileNotFoundError(f"No se encuentra el GTFS en {GTFS_ZIP}")

    stops: List[Dict] = []

    with zipfile.ZipFile(GTFS_ZIP, "r") as zf:
        # El archivo de paradas se llama stops.txt en este feed
        with zf.open("stops.txt", "r") as f:
            text_file = io.TextIOWrapper(f, encoding="utf-8")
            reader = csv.DictReader(text_file)
            for row in reader:
                try:
                    lat = float(row["stop_lat"])
                    lon = float(row["stop_lon"])
                except (KeyError, ValueError):
                    # Si alguna fila viene mal, la saltamos
                    continue

                stops.append(
                    {
                        "id": row.get("stop_id"),
                        "code": row.get("stop_code"),
                        "name": row.get("stop_name"),
                        "desc": row.get("stop_desc"),
                        "lat": lat,
                        "lon": lon,
                    }
                )

    return stops
