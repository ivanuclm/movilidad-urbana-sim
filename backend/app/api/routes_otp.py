# backend/app/api/routes_otp.py

from __future__ import annotations

from datetime import datetime
from typing import List

import httpx
import polyline
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

router = APIRouter(prefix="/api/otp", tags=["otp"])

OTP_PLAN_URL = "http://localhost:8080/otp/routers/default/plan"


class Point(BaseModel):
    lat: float
    lon: float


class OtpRouteRequest(BaseModel):
    origin: Point
    destination: Point


class TransitSegment(BaseModel):
    mode: str              # WALK, BUS, etc
    distance_m: float
    duration_s: float
    geometry: List[Point]


class TransitResult(BaseModel):
    distance_m: float
    duration_s: float
    geometry: List[Point]
    segments: List[TransitSegment]


class TransitRouteResponse(BaseModel):
    origin: Point
    destination: Point
    result: TransitResult


def _build_otp_params(origin: Point, destination: Point) -> dict:
    now = datetime.now()
    return {
        "fromPlace": f"{origin.lat},{origin.lon}",
        "toPlace": f"{destination.lat},{destination.lon}",
        "mode": "TRANSIT,WALK",
        "date": now.strftime("%Y-%m-%d"),
        "time": now.strftime("%H:%M"),
        "numItineraries": 5,
        "maxWalkDistance": 2000,
        "walkReluctance": 3.0,
        "locale": "es",
    }


def _pick_itinerary_with_transit(itineraries: list[dict]) -> dict:
    def has_transit(it: dict) -> bool:
        for leg in it.get("legs", []):
            if leg.get("transitLeg"):
                return True
            mode = (leg.get("mode") or "").upper()
            if mode not in ("WALK", "BICYCLE", "CAR"):
                return True
        return False

    for it in itineraries:
        if has_transit(it):
            return it

    return itineraries[0]


def _decode_leg_geometry(leg: dict) -> List[Point]:
    geom = leg.get("legGeometry")
    if not geom or not geom.get("points"):
        return []
    coords = polyline.decode(geom["points"])  # [(lat, lon), ...]
    return [Point(lat=lat, lon=lon) for (lat, lon) in coords]


@router.post("/routes", response_model=TransitRouteResponse)
async def get_otp_route(req: OtpRouteRequest) -> TransitRouteResponse:
    params = _build_otp_params(req.origin, req.destination)

    async with httpx.AsyncClient() as client:
        resp = await client.get(OTP_PLAN_URL, params=params, timeout=20.0)

    if resp.status_code != 200:
        raise HTTPException(
            status_code=502,
            detail=f"Error al llamar a OTP: {resp.status_code}",
        )

    data = resp.json()
    plan = data.get("plan") or {}
    itineraries: list[dict] = plan.get("itineraries") or []

    if not itineraries:
        raise HTTPException(status_code=404, detail="OTP no ha encontrado rutas")

    chosen = _pick_itinerary_with_transit(itineraries)
    legs = chosen.get("legs", []) or []

    segments: List[TransitSegment] = []
    full_geometry: List[Point] = []

    for leg in legs:
        pts = _decode_leg_geometry(leg)
        if not pts:
            continue

        mode = (leg.get("mode") or "").upper()
        distance_m = float(leg.get("distance") or 0.0)
        duration_s = float(leg.get("duration") or 0.0)

        segments.append(
            TransitSegment(
                mode=mode,
                distance_m=distance_m,
                duration_s=duration_s,
                geometry=pts,
            )
        )
        full_geometry.extend(pts)

    # fallback por si por algún motivo no hay segmentos con geometría
    if not segments:
        distance_m = float(sum(float(leg.get("distance") or 0.0) for leg in legs))
        duration_s = float(chosen.get("duration") or 0.0)
    else:
        distance_m = sum(seg.distance_m for seg in segments)
        duration_s = sum(seg.duration_s for seg in segments)

    return TransitRouteResponse(
        origin=req.origin,
        destination=req.destination,
        result=TransitResult(
            distance_m=distance_m,
            duration_s=duration_s,
            geometry=full_geometry,
            segments=segments,
        ),
    )
