import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { MapView } from "./components/MapView";

type Point = { lat: number; lon: number };

interface RouteResult {
  profile: "driving" | "cycling" | "foot";
  distance_m: number;
  duration_s: number;
  geometry: Point[];
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

function App() {
  const [origin, setOrigin] = useState<Point>({ lat: 38.986, lon: -3.927 });
  const [destination, setDestination] = useState<Point>({ lat: 38.99, lon: -3.92 });

  const { mutate, data, isPending, error } = useMutation<RouteResponse, Error>({
    mutationFn: () => fetchRoutes(origin, destination),
  });

  return (
    <div style={{ padding: "1rem", maxWidth: "900px", margin: "0 auto" }}>
      <h1>Simulador de movilidad urbana (PoC)</h1>
      <p style={{ marginBottom: "0.5rem" }}>
        Haz clic en el mapa para colocar origen y destino (alternando). Luego pulsa en "Calcular rutas".
      </p>

      <MapView
        origin={origin}
        destination={destination}
        setOrigin={setOrigin}
        setDestination={setDestination}
        routeGeometry={data?.results.find((r) => r.profile === "driving")?.geometry}
      />

      <button
        onClick={() => mutate()}
        disabled={isPending}
        style={{ marginTop: "1rem", padding: "0.5rem 1rem" }}
      >
        {isPending ? "Calculando..." : "Calcular rutas OSRM"}
      </button>

      {error && (
        <p style={{ color: "red", marginTop: "0.5rem" }}>
          Error: {(error as Error).message}
        </p>
      )}

      {data && (
        <table
          style={{
            marginTop: "1rem",
            borderCollapse: "collapse",
            width: "100%",
            textAlign: "left",
          }}
        >
          <thead>
            <tr>
              <th style={{ borderBottom: "1px solid #ccc", padding: "0.5rem" }}>Modo</th>
              <th style={{ borderBottom: "1px solid #ccc", padding: "0.5rem" }}>Distancia (km)</th>
              <th style={{ borderBottom: "1px solid #ccc", padding: "0.5rem" }}>Duración (min)</th>
            </tr>
          </thead>
          <tbody>
            {data.results.map((r) => (
              <tr key={r.profile}>
                <td style={{ borderBottom: "1px solid #eee", padding: "0.5rem" }}>{r.profile}</td>
                <td style={{ borderBottom: "1px solid #eee", padding: "0.5rem" }}>
                  {(r.distance_m / 1000).toFixed(2)}
                </td>
                <td style={{ borderBottom: "1px solid #eee", padding: "0.5rem" }}>
                  {(r.duration_s / 60).toFixed(1)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

export default App;
