# app/api/routes_gtfs.py
from fastapi import APIRouter, HTTPException, Query
from app.services.gtfs_loader import load_gtfs_stops

router = APIRouter(prefix="/api/gtfs", tags=["gtfs"])


@router.get("/stops")
def get_gtfs_stops(limit: int = Query(500, ge=1, le=500000)):
    """
    Devuelve hasta `limit` paradas del GTFS cargado.
    Ahora mismo no filtramos por zona, solo recortamos por cantidad.
    """
    try:
        stops = load_gtfs_stops()
    except FileNotFoundError as e:
        raise HTTPException(status_code=500, detail=str(e))

    return stops[:limit]
