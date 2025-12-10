import httpx
from typing import Literal


Profile = Literal["driving", "cycling", "foot"]

# OSRM_BASE_URL = "https://router.project-osrm.org"
OSRM_BASE_URLS = {
    # "driving": "https://routing.openstreetmap.de/routed-car",
    # "cycling": "https://routing.openstreetmap.de/routed-bike",
    # "foot": "https://routing.openstreetmap.de/routed-foot",
    "driving": "http://127.0.0.1:5000", # Usamos instancia local de OSRM con perfil car.lua
    "cycling": "http://127.0.0.1:5001", # bike.lua
    "foot":    "http://127.0.0.1:5002", # foot.lua
}



async def get_route(profile: Profile, lon1: float, lat1: float, lon2: float, lat2: float):
    # url = (
    #     f"{OSRM_BASE_URL}/route/v1/{profile}/"
    #     f"{lon1},{lat1};{lon2},{lat2}"
    #     "?overview=false&alternatives=false&annotations=duration,distance"
    # )

    base = OSRM_BASE_URLS[profile]
    # Nota: en routing.openstreetmap.de el segundo segmento sigue siendo "driving"
    url = (
        f"{base}/route/v1/driving/"
        f"{lon1},{lat1};{lon2},{lat2}"
        "?overview=full&"
        "geometries=geojson&"
        # "alternatives=false&"
        "annotations=duration,distance"
    )
    
    async with httpx.AsyncClient(timeout=10.0) as client:
        resp = await client.get(url)
        resp.raise_for_status()
        data = resp.json()

    route = data["routes"][0]

    coords = route["geometry"]["coordinates"]  # lista de [lon, lat]
    path = [{"lat": lat, "lon": lon} for lon, lat in coords]  # la convertimos para Leaflet

    return {
        "profile": profile,
        "distance_m": route["distance"],
        "duration_s": route["duration"],
        "geometry": path,
    }
