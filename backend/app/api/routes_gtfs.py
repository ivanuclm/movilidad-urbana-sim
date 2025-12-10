# backend/app/api/routes_gtfs.py

from __future__ import annotations

from typing import List, Optional

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from app.services import gtfs_loader


router = APIRouter(prefix="/api/gtfs", tags=["gtfs"])


# -----------------------
# Modelos para la API
# -----------------------
class StopRoute(BaseModel):
    id: str
    short_name: Optional[str] = None
    long_name: Optional[str] = None


class GtfsStop(BaseModel):
    id: str
    name: str
    desc: Optional[str] = None
    lat: float
    lon: float
    code: Optional[str] = None
    wheelchair_boarding: Optional[int] = None
    routes: List[StopRoute] = []


class GtfsRoute(BaseModel):
    id: str
    short_name: Optional[str] = None
    long_name: Optional[str] = None
    desc: Optional[str] = None
    type: Optional[int] = None
    agency_id: Optional[str] = None
    color: Optional[str] = None
    text_color: Optional[str] = None


class RouteStop(GtfsStop):
    sequence: int


class Point(BaseModel):
    lat: float
    lon: float


class RouteDetails(BaseModel):
    route: GtfsRoute
    stops: List[RouteStop]
    shape: Optional[List[Point]] = None


# -----------------------
# Endpoints
# -----------------------

@router.get("/stops", response_model=List[GtfsStop])
def get_stops(
    limit: int = Query(500, ge=1, le=5000),
    min_lat: Optional[float] = Query(None),
    max_lat: Optional[float] = Query(None),
    min_lon: Optional[float] = Query(None),
    max_lon: Optional[float] = Query(None),
):
    """
    Lista de paradas GTFS.

    - Si no se pasa bounding-box, devuelve hasta `limit` paradas.
    - Si se pasa min_lat/max_lat/min_lon/max_lon, filtra por esa zona.
    """
    bbox = None
    if None not in (min_lat, max_lat, min_lon, max_lon):
        bbox = (min_lat, max_lat, min_lon, max_lon)

    stops_raw = gtfs_loader.list_stops(limit=limit, bbox=bbox)

    return [
        GtfsStop(
            id=s["stop_id"],
            name=s["name"],
            desc=s["desc"],
            lat=s["lat"],
            lon=s["lon"],
            code=s.get("code"),
            wheelchair_boarding=s.get("wheelchair_boarding"),
            routes=[
                StopRoute(
                    id=sr["route_id"],
                    short_name=sr.get("short_name"),
                    long_name=sr.get("long_name"),
                )
                for sr in (s.get("routes") or [])
            ],
        )
        for s in stops_raw
    ]


@router.get("/routes", response_model=List[GtfsRoute])
def get_routes():
    """
    Lista de rutas/líneas disponibles en el GTFS.

    Ideal para poblar un combo/select en el frontend para el modo
    "Transporte público".
    """
    routes_raw = gtfs_loader.list_routes()
    return [
        GtfsRoute(
            id=r["route_id"],
            short_name=r.get("short_name"),
            long_name=r.get("long_name"),
            desc=r.get("desc"),
            type=r.get("type"),
            agency_id=r.get("agency_id"),
            color=r.get("color"),
            text_color=r.get("text_color"),
        )
        for r in routes_raw
    ]


@router.get("/routes/{route_id}", response_model=RouteDetails)
def get_route_details(route_id: str):
    """
    Detalle de una ruta:
    - Metadatos de la ruta
    - Paradas ordenadas (de un viaje representativo)
    - Geometría aproximada (shape) si existe
    """
    try:
        route_raw, stops_raw, geometry_raw = gtfs_loader.get_route_with_stops(route_id)
    except KeyError:
        raise HTTPException(status_code=404, detail="Route not found")

    route = GtfsRoute(
        id=route_raw["route_id"],
        short_name=route_raw.get("short_name"),
        long_name=route_raw.get("long_name"),
        desc=route_raw.get("desc"),
        type=route_raw.get("type"),
        agency_id=route_raw.get("agency_id"),
        color=route_raw.get("color"),
        text_color=route_raw.get("text_color"),
    )

    stops = [
        RouteStop(
            id=s["stop_id"],
            name=s["name"],
            desc=s["desc"],
            lat=s["lat"],
            lon=s["lon"],
            sequence=s["sequence"],
        )
        for s in stops_raw
    ]

    shape = None
    if geometry_raw:
        shape = [Point(lat=p["lat"], lon=p["lon"]) for p in geometry_raw]

    return RouteDetails(route=route, stops=stops, shape=shape)
