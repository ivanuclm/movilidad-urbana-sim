# backend/app/services/gtfs_loader.py

from __future__ import annotations

import csv
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, List, Optional, Tuple


# Ajusta esta ruta si tu GTFS está en otra carpeta.
# Asumo: backend/data/gtfs/ con los .txt sueltos (agency, routes, stops, trips, stop_times, shapes, calendar_dates)
DEFAULT_GTFS_DIR = (
    Path(__file__).resolve().parents[2] / "data" / "gtfs" / "GTFS_Urbano_Toledo"
)


@dataclass
class GtfsData:
    stops: Dict[str, dict]
    routes: Dict[str, dict]
    trips_by_route: Dict[str, List[dict]]
    stop_times_by_trip: Dict[str, List[dict]]
    shapes_by_id: Dict[str, List[Tuple[float, float, int]]]


def _read_csv(path: Path) -> List[dict]:
    if not path.exists():
        raise FileNotFoundError(f"GTFS file not found: {path}")
    with path.open("r", encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f)
        return list(reader)


def load_gtfs_data(gtfs_dir: Optional[Path] = None) -> GtfsData:
    """
    Carga el GTFS estático en memoria.

    Pensado para feeds tipo Toledo:
    - stops.txt: stop_id, stop_name, stop_desc, stop_lat, stop_lon, wheelchair_boarding
      (no hay stop_code, así que lo tratamos como opcional)
    - shapes.txt: shape_id, shape_pt_lat, shape_pt_lon, shape_pt_sequence
      (sin shape_dist_traveled, que es opcional en GTFS)
    """
    base = gtfs_dir or DEFAULT_GTFS_DIR

    stops_raw = _read_csv(base / "stops.txt")
    routes_raw = _read_csv(base / "routes.txt")
    trips_raw = _read_csv(base / "trips.txt")
    stop_times_raw = _read_csv(base / "stop_times.txt")
    shapes_raw = _read_csv(base / "shapes.txt")

    # Stops por stop_id
    stops: Dict[str, dict] = {}
    for row in stops_raw:
        stop_id = row["stop_id"]
        # Normalizamos nombres de campos que vamos a usar en la API
        stops[stop_id] = {
            "stop_id": stop_id,
            "name": row.get("stop_name"),
            "desc": row.get("stop_desc") or None,
            "lat": float(row["stop_lat"]),
            "lon": float(row["stop_lon"]),
            # Algunos GTFS traen stop_code, el de Toledo no
            "code": row.get("stop_code") or stop_id,
            "wheelchair_boarding": (
                int(row["wheelchair_boarding"])
                if row.get("wheelchair_boarding") not in (None, "", " ")
                else None
            ),
        }

    # Rutas por route_id
    routes: Dict[str, dict] = {}
    for row in routes_raw:
        route_id = row["route_id"]
        routes[route_id] = {
            "route_id": route_id,
            "short_name": row.get("route_short_name") or None,
            "long_name": row.get("route_long_name") or None,
            "desc": row.get("route_desc") or None,
            "type": int(row["route_type"]) if row.get("route_type") else None,
            "agency_id": row.get("agency_id") or None,
            "color": row.get("route_color") or None,
            "text_color": row.get("route_text_color") or None,
        }

    # Trips agrupados por route_id
    trips_by_route: Dict[str, List[dict]] = {}
    for row in trips_raw:
        route_id = row["route_id"]
        trips_by_route.setdefault(route_id, []).append(
            {
                "trip_id": row["trip_id"],
                "route_id": route_id,
                "service_id": row.get("service_id") or None,
                "headsign": row.get("trip_headsign") or None,
                "direction_id": int(row["direction_id"])
                if row.get("direction_id") not in (None, "", " ")
                else None,
                "shape_id": row.get("shape_id") or None,
            }
        )

    # Stop times agrupados por trip_id
    stop_times_by_trip: Dict[str, List[dict]] = {}
    for row in stop_times_raw:
        trip_id = row["trip_id"]
        seq = int(row["stop_sequence"])
        stop_times_by_trip.setdefault(trip_id, []).append(
            {
                "trip_id": trip_id,
                "arrival_time": row.get("arrival_time") or None,
                "departure_time": row.get("departure_time") or None,
                "stop_id": row["stop_id"],
                "sequence": seq,
                "pickup_type": int(row["pickup_type"])
                if row.get("pickup_type") not in (None, "", " ")
                else 0,
                "drop_off_type": int(row["drop_off_type"])
                if row.get("drop_off_type") not in (None, "", " ")
                else 0,
            }
        )

    # Ordenamos stop_times por secuencia
    for trip_id, lst in stop_times_by_trip.items():
        lst.sort(key=lambda x: x["sequence"])

    # Shapes agrupados por shape_id
    shapes_by_id: Dict[str, List[Tuple[float, float, int]]] = {}
    for row in shapes_raw:
        shape_id = row["shape_id"]
        lat = float(row["shape_pt_lat"])
        lon = float(row["shape_pt_lon"])
        seq = int(row["shape_pt_sequence"])
        shapes_by_id.setdefault(shape_id, []).append((lat, lon, seq))

    # Ordenamos los puntos de cada shape por sequence
    for shape_id, pts in shapes_by_id.items():
        pts.sort(key=lambda p: p[2])

    return GtfsData(
        stops=stops,
        routes=routes,
        trips_by_route=trips_by_route,
        stop_times_by_trip=stop_times_by_trip,
        shapes_by_id=shapes_by_id,
    )


# Cargamos una única vez al arrancar el backend
GTFS_DATA = load_gtfs_data()


# -----------------------
# Funciones de consulta
# -----------------------

def list_stops(
    limit: Optional[int] = None,
    bbox: Optional[Tuple[float, float, float, float]] = None,
) -> List[dict]:
    """
    Devuelve una lista de paradas, opcionalmente filtradas por bounding-box:
    bbox = (min_lat, max_lat, min_lon, max_lon)
    """
    stops = list(GTFS_DATA.stops.values())

    if bbox is not None:
        min_lat, max_lat, min_lon, max_lon = bbox
        stops = [
            s
            for s in stops
            if (min_lat <= s["lat"] <= max_lat)
            and (min_lon <= s["lon"] <= max_lon)
        ]

    if limit is not None:
        stops = stops[:limit]

    return stops


def list_routes() -> List[dict]:
    """Devuelve todas las rutas del GTFS."""
    return list(GTFS_DATA.routes.values())


def get_route_with_stops(route_id: str) -> Tuple[dict, List[dict], Optional[List[dict]]]:
    """
    Devuelve:
    - info de la ruta (routes.txt)
    - lista de paradas ordenadas para un viaje representativo
    - geometría aproximada de la línea (shape) si existe

    Estrategia:
    - Cogemos el primer trip de ese route_id.
    - Ordenamos sus stop_times por stop_sequence.
    - Obtenemos las paradas de stops.txt.
    - Si el trip tiene shape_id y existe en shapes.txt, devolvemos la polyline.
    """
    route = GTFS_DATA.routes.get(route_id)
    if not route:
        raise KeyError(f"Route not found: {route_id}")

    trips = GTFS_DATA.trips_by_route.get(route_id) or []
    if not trips:
        # Ruta sin trips (poco probable pero puede pasar)
        return route, [], None

    # Por simplicidad, usamos el primer trip (ya lo refinaremos si hace falta)
    trip = trips[0]
    trip_id = trip["trip_id"]
    shape_id = trip.get("shape_id")

    stop_times = GTFS_DATA.stop_times_by_trip.get(trip_id) or []

    route_stops: List[dict] = []
    for st in stop_times:
        stop = GTFS_DATA.stops.get(st["stop_id"])
        if not stop:
            continue
        route_stops.append(
            {
                "stop_id": stop["stop_id"],
                "name": stop["name"],
                "desc": stop["desc"],
                "lat": stop["lat"],
                "lon": stop["lon"],
                "sequence": st["sequence"],
            }
        )

    geometry: Optional[List[dict]] = None
    if shape_id and shape_id in GTFS_DATA.shapes_by_id:
        pts = GTFS_DATA.shapes_by_id[shape_id]
        geometry = [{"lat": lat, "lon": lon} for (lat, lon, _seq) in pts]

    return route, route_stops, geometry
