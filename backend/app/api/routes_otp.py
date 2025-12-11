# backend/app/api/routes_otp.py

from __future__ import annotations

import os
from datetime import datetime
from typing import List

import requests
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

router = APIRouter(prefix="/api/otp", tags=["otp"])

OTP_BASE_URL = os.getenv("OTP_BASE_URL", "http://localhost:8080/otp")


class Point(BaseModel):
    lat: float
    lon: float


class TransitRouteRequest(BaseModel):
    origin: Point
    destination: Point


class TransitRouteResult(BaseModel):
    distance_m: float
    duration_s: float
    geometry: List[Point]


class TransitRouteResponse(BaseModel):
    origin: Point
    destination: Point
    result: TransitRouteResult


def _decode_polyline(encoded: str) -> List[Point]:
    import polyline as _polyline

    coords = _polyline.decode(encoded, precision=5)
    return [Point(lat=lat, lon=lon) for lat, lon in coords]


@router.post("/routes", response_model=TransitRouteResponse)
def plan_transit_route(req: TransitRouteRequest):
    # Fecha y hora actual para OTP, formato tipo "19-12-2025" y "2:39am"
    now = datetime.now()
    date_str = now.strftime("%d-%m-%Y")
    time_str = now.strftime("%I:%M%p").lstrip("0").lower()

    params = {
        "fromPlace": f"{req.origin.lat},{req.origin.lon}",
        "toPlace": f"{req.destination.lat},{req.destination.lon}",
        "mode": "TRANSIT,WALK",
        "date": date_str,
        "time": time_str,
        "numItineraries": 3,
    }

    try:
        resp = requests.get(
            f"{OTP_BASE_URL}/routers/default/plan",
            params=params,
            timeout=20,
        )
    except requests.RequestException as e:
        raise HTTPException(status_code=502, detail=f"Error llamando a OTP: {e}")

    if resp.status_code != 200:
        raise HTTPException(
            status_code=resp.status_code,
            detail=f"OTP devolvió estado {resp.status_code}",
        )

    data = resp.json()
    plan = data.get("plan")
    if not plan:
        raise HTTPException(status_code=502, detail="Respuesta de OTP sin campo 'plan'")

    itineraries = plan.get("itineraries") or []
    if not itineraries:
        raise HTTPException(
            status_code=404,
            detail="OTP no ha encontrado ningún itinerario de transporte público",
        )

    # Nos quedamos con el itinerario de menor duración total
    best = min(itineraries, key=lambda it: it.get("duration", 0) or 0)

    duration_s = float(best.get("duration", 0) or 0)
    legs = best.get("legs") or []

    total_distance = 0.0
    full_geometry: List[Point] = []

    for leg in legs:
        # Distancia de este tramo
        d = float(leg.get("distance", 0.0) or 0.0)
        total_distance += d

        # Geometría codificada de cada tramo
        geom = leg.get("legGeometry")
        if geom and geom.get("points"):
            pts = _decode_polyline(geom["points"])
            if full_geometry and pts:
                last = full_geometry[-1]
                first = pts[0]
                if last.lat == first.lat and last.lon == first.lon:
                    pts = pts[1:]
            full_geometry.extend(pts)

    return TransitRouteResponse(
        origin=req.origin,
        destination=req.destination,
        result=TransitRouteResult(
            distance_m=total_distance,
            duration_s=duration_s,
            geometry=full_geometry,
        ),
    )
