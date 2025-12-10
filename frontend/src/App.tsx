import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { MapView } from "./components/MapView";
import "./App.css";

type Profile = "driving" | "cycling" | "foot";

type Point = { lat: number; lon: number };

type GtfsStop = {
  id: string;
  code?: string;
  name?: string;
  desc?: string;
  lat: number;
  lon: number;
};


interface RouteResult {
  profile: Profile;
  distance_m: number;
  duration_s: number;
  geometry: Point[];       // <- NUEVO
}

interface RouteResponse {
  origin: Point;
  destination: Point;
  results: RouteResult[];
}

async function fetchRoutes(origin: Point, destination: Point): Promise<RouteResponse> {
  const res = await fetch("http://127.0.0.1:8000/api/osrm/routes", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      origin,
      destination,
      profiles: ["driving", "cycling", "foot"],
    }),
  });

  if (!res.ok) {
    throw new Error(`Error llamando a la API: ${res.status}`);
  }
  return res.json();
}

const PROFILE_LABELS: Record<Profile, string> = {
  driving: "Coche",
  cycling: "Bici",
  foot: "A pie",
};

function App() {
  const [origin, setOrigin] = useState<Point>({ lat: 39.87029, lon: -4.03434 });
  const [destination, setDestination] = useState<Point>({ lat: 39.85968, lon: -4.00525 });
  const [selectedProfile, setSelectedProfile] = useState<Profile>("driving");
  const [showGtfsStops, setShowGtfsStops] = useState(true);

  const { mutate, data, isPending, error } = useMutation<RouteResponse, Error>({
    mutationFn: () => fetchRoutes(origin, destination),
  });

  const gtfsStopsQuery = useQuery<GtfsStop[]>({
    queryKey: ["gtfs-stops"],
    queryFn: async () => {
      const res = await fetch("http://127.0.0.1:8000/api/gtfs/stops?limit=5000");
      if (!res.ok) throw new Error("Error cargando paradas GTFS");
      return res.json();
    },
  });
  const selectedRoute =
    data?.results.find((r) => r.profile === selectedProfile) ?? null;

  return (
    <div className="app-root">
      <header className="app-header">
        <h1 className="app-header-title">Simulador de movilidad urbana</h1>
        <p className="app-header-subtitle">
          Haz clic en el mapa para colocar origen y destino (alternando). Luego pulsa en
          <strong> "Calcular rutas"</strong>.
        </p>
      </header>

      <main className="app-main">
        {/* Columna izquierda: mapa */}
        <section className="card map-card">
          <h2 className="section-title">Mapa de rutas</h2>
          <MapView
            origin={origin}
            destination={destination}
            setOrigin={setOrigin}
            setDestination={setDestination}
            routeGeometry={selectedRoute?.geometry ?? []}
            gtfsStops={
              showGtfsStops && gtfsStopsQuery.data ? gtfsStopsQuery.data : []
            }
          />
        </section>

        {/* Columna derecha: panel de modos y tabla */}
        <section className="card panel-card">
          <label style={{ display: "flex", alignItems: "center", gap: "0.4rem", marginBottom: "0.5rem" }}>
            <input
              type="checkbox"
              checked={showGtfsStops}
              onChange={(e) => setShowGtfsStops(e.target.checked)}
            />
            Mostrar paradas de transporte público (GTFS CRTM)
          </label>

          <h2 className="section-title">Rutas OSRM</h2>

          <div className="mode-toolbar">
            {(["driving", "cycling", "foot"] as Profile[]).map((p) => (
              <button
                key={p}
                type="button"
                className={
                  "mode-button" +
                  (p === selectedProfile ? " mode-button--active" : "")
                }
                onClick={() => setSelectedProfile(p)}
                disabled={isPending}
              >
                {PROFILE_LABELS[p]}
              </button>
            ))}
          </div>

          <button
            onClick={() => mutate()}
            disabled={isPending}
            className="primary-button"
          >
            {isPending ? "Calculando..." : "Calcular rutas OSRM"}
          </button>

          {error && (
            <p className="error-text">Error: {(error as Error).message}</p>
          )}

          {data && (
            <table className="routes-table">
              <thead>
                <tr>
                  <th>Modo</th>
                  <th>Distancia (km)</th>
                  <th>Duración (min)</th>
                </tr>
              </thead>
              <tbody>
                {data.results.map((r) => (
                  <tr
                    key={r.profile}
                    className={
                      r.profile === selectedProfile ? "row-active" : undefined
                    }
                  >
                    <td>{PROFILE_LABELS[r.profile]}</td>
                    <td>{(r.distance_m / 1000).toFixed(2)}</td>
                    <td>{(r.duration_s / 60).toFixed(1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </main>
    </div>
  );
}

export default App;
