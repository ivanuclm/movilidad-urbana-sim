import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { MapView } from "./components/MapView";
import "./App.css";

type Profile = "driving" | "cycling" | "foot";

type UiMode = Profile | "transit";


type Point = { lat: number; lon: number };

type TransitLegSegment = {
  mode: string;         // "WALK" | "BUS" | ...
  distance_m: number;
  duration_s: number;
  geometry: Point[];
};

type TransitSegment = {
  mode: string;
  distance_m: number;
  duration_s: number;
  geometry: Point[];

  route_id?: string | null;
  route_short_name?: string | null;
  route_long_name?: string | null;
  agency_name?: string | null;
  from_stop_name?: string | null;
  to_stop_name?: string | null;
  departure?: string | null;
  arrival?: string | null;
};

type TransitResult = {
  distance_m: number;
  duration_s: number;
  geometry: Point[];         // ruta completa
  segments: TransitSegment[];
  itinerary_index: number;
  total_itineraries: number;
};

type TransitRouteResponse = {
  origin: Point;
  destination: Point;
  result: TransitResult;
};

type TransitRouteRef = {
  id: string;
  short_name?: string;
  long_name?: string;
};

type GtfsStop = {
  id: string;
  code?: string;
  name?: string;
  desc?: string;
  lat: number;
  lon: number;
  routes?: TransitRouteRef[];
};

interface RouteResult {
  profile: Profile;
  distance_m: number;
  duration_s: number;
  geometry: Point[];
}

interface RouteResponse {
  origin: Point;
  destination: Point;
  results: RouteResult[];
}

type TransitRouteDetails = {
  route: {
    id: string;
    short_name?: string;
    long_name?: string;
    desc?: string;
    type?: number;
    agency_id?: string;
    color?: string | null;
    text_color?: string | null;
  };
  // aquí los stops vienen SIN info de rutas, pero nos vale
  stops: (GtfsStop & { sequence: number })[];
  shape?: Point[];
};

type TransitRouteListItem = {
  id: string;
  short_name?: string;
  long_name?: string;
  desc?: string;
  type?: number;
  agency_id?: string;
  color?: string | null;
  text_color?: string | null;
};

type TransitDirectionSchedule = {
  direction_id?: number | null;
  headsign?: string | null;
  trip_count: number;
  first_departure?: string | null;
  last_departure?: string | null;
  departures: string[];
};

type TransitRouteSchedule = {
  route_id: string;
  date: string;
  directions: TransitDirectionSchedule[];
};

async function fetchRoutes(
  origin: Point,
  destination: Point
): Promise<RouteResponse> {
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

async function fetchTransitRoute(
  origin: Point,
  destination: Point,
  itineraryIndex?: number | null
): Promise<TransitResult> {
  const payload: any = { origin, destination };
  if (typeof itineraryIndex === "number") {
    payload.itinerary_index = itineraryIndex;
  }

  const res = await fetch("http://127.0.0.1:8000/api/otp/routes", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    throw new Error(`Error llamando a la API OTP: ${res.status}`);
  }

  const data: TransitRouteResponse = await res.json();
  return data.result;
}


const PROFILE_LABELS: Record<Profile, string> = {
  driving: "Coche",
  cycling: "Bici",
  foot: "A pie",
};

function App() {
  const [origin, setOrigin] = useState<Point>({ lat: 39.87029, lon: -4.03434 });
  const [destination, setDestination] = useState<Point>({
    lat: 39.85968,
    lon: -4.00525,
  });
  // const [selectedProfile, setSelectedProfile] = useState<Profile>("driving");
  const [selectedMode, setSelectedMode] = useState<UiMode>("driving");
  const [transitItineraryIndex, setTransitItineraryIndex] = useState(0);

  const [showGtfsStops, setShowGtfsStops] = useState(true);
  const [selectedTransitRouteId, setSelectedTransitRouteId] = useState<
    string | null
  >(null);

  // fecha por defecto = hoy (YYYY-MM-DD)
  const todayStr = new Date().toISOString().slice(0, 10);
  const [scheduleDate, setScheduleDate] = useState<string>(todayStr);

  // ---------------- OSRM ----------------

  // const { mutate, data, isPending, error } = useMutation<RouteResponse, Error>({
  //   mutationFn: () => fetchRoutes(origin, destination),
  // });

  const osrmMutation = useMutation<RouteResponse, Error>({
    mutationFn: () => fetchRoutes(origin, destination),
  });

  const transitMutation = useMutation<TransitResult, Error, number | null>({
    mutationFn: (idxOverride) => fetchTransitRoute(origin, destination, idxOverride ?? transitItineraryIndex),
  });

  const isCalculating =
    osrmMutation.isPending || transitMutation.isPending;
  // const selectedRoute =
  //   data?.results.find((r) => r.profile === selectedProfile) ?? null;

  // const selectedRoute =
  // osrmMutation.data?.results.find((r) => r.profile === selectedProfile) ?? null;

  const selectedRoute =
  selectedMode !== "transit"
    ? osrmMutation.data?.results.find(
        (r) => r.profile === selectedMode
      ) ?? null
    : null;

  const transitResult = transitMutation.data ?? null;
  const totalItineraries = transitResult?.total_itineraries ?? 0;
  const mainTransitSegment = transitResult?.segments.find(
    (s) => s.mode !== "WALK"
  );

  const transitLineLabel = mainTransitSegment
    ? mainTransitSegment.route_short_name ||
      mainTransitSegment.route_long_name ||
      mainTransitSegment.route_id
    : null;


  const displayedGeometry: Point[] =
  selectedMode === "transit"
    ? transitMutation.data?.geometry ?? []
    : selectedRoute?.geometry ?? [];


  // ------------- GTFS: paradas -------------

  const gtfsStopsQuery = useQuery<GtfsStop[]>({
    queryKey: ["gtfs-stops"],
    queryFn: async () => {
      const res = await fetch(
        "http://127.0.0.1:8000/api/gtfs/stops?limit=5000"
      );
      if (!res.ok) throw new Error("Error cargando paradas GTFS");
      return res.json();
    },
  });

  // ------------- GTFS: lista de rutas -------------

  const gtfsRoutesQuery = useQuery<TransitRouteListItem[]>({
    queryKey: ["gtfs-routes"],
    queryFn: async () => {
      const res = await fetch("http://127.0.0.1:8000/api/gtfs/routes");
      if (!res.ok) throw new Error("Error cargando rutas GTFS");
      return res.json();
    },
  });

  // ------------- GTFS: detalles de la ruta seleccionada -------------

  const transitRouteDetailsQuery = useQuery<TransitRouteDetails>({
    queryKey: ["gtfs-route-details", selectedTransitRouteId],
    enabled: !!selectedTransitRouteId,
    queryFn: async () => {
      const res = await fetch(
        `http://127.0.0.1:8000/api/gtfs/routes/${selectedTransitRouteId}`
      );
      if (!res.ok) throw new Error("Error cargando detalles de ruta GTFS");
      return res.json();
    },
  });

  const transitShape = transitRouteDetailsQuery.data?.shape ?? [];
  const transitRouteStops = transitRouteDetailsQuery.data?.stops ?? [];

  // ------------- GTFS: horarios de la ruta seleccionada -------------

  const transitScheduleQuery = useQuery<TransitRouteSchedule>({
    queryKey: ["gtfs-route-schedule", selectedTransitRouteId, scheduleDate],
    enabled: !!selectedTransitRouteId,
    queryFn: async () => {
      const params = new URLSearchParams();
      if (scheduleDate) {
        params.set("date", scheduleDate);
      }
      const res = await fetch(
        `http://127.0.0.1:8000/api/gtfs/routes/${selectedTransitRouteId}/schedule?${params.toString()}`
      );
      if (!res.ok) throw new Error("Error cargando horarios GTFS");
      return res.json();
    },
  });

  const stripSeconds = (t?: string | null) =>
    t && t.length >= 5 ? t.slice(0, 5) : t ?? "";

  return (
    <div className="app-root">
      <header className="app-header">
        <h1 className="app-header-title">Simulador de movilidad urbana</h1>
        <p className="app-header-subtitle">
          Haz clic en el mapa para colocar origen y destino (alternando). Luego
          pulsa en<strong> "Calcular rutas"</strong>.
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
            // routeGeometry={selectedRoute?.geometry ?? []}
            routeGeometry={displayedGeometry}
            gtfsStops={
              showGtfsStops && gtfsStopsQuery.data ? gtfsStopsQuery.data : []
            }
            transitShape={transitShape}
            transitRouteStops={transitRouteStops}
            onSelectTransitRoute={(routeId) => {
              setSelectedTransitRouteId(routeId);
            }}
            transitSegments={transitResult?.segments ?? []}
          />
        </section>

        {/* Columna derecha: panel */}
        <section className="card panel-card">
          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.4rem",
              marginBottom: "0.5rem",
            }}
          >
            <input
              type="checkbox"
              checked={showGtfsStops}
              onChange={(e) => setShowGtfsStops(e.target.checked)}
            />
            Mostrar paradas de transporte público (GTFS Toledo)
          </label>

          {/* Selector de ruta GTFS */}
          <div style={{ marginBottom: "0.75rem" }}>
            <label
              htmlFor="gtfs-route-select"
              style={{ display: "block", marginBottom: "0.25rem" }}
            >
              Línea de transporte público:
            </label>
            <select
              id="gtfs-route-select"
              value={selectedTransitRouteId ?? ""}
              onChange={(e) =>
                setSelectedTransitRouteId(
                  e.target.value === "" ? null : e.target.value
                )
              }
              style={{ width: "100%", padding: "0.35rem" }}
            >
              <option value="">(ninguna seleccionada)</option>
              {gtfsRoutesQuery.data?.map((r) => {
                const label = r.short_name || r.long_name || r.id;
                return (
                  <option key={r.id} value={r.id}>
                    {label}
                  </option>
                );
              })}
            </select>
            {gtfsRoutesQuery.isLoading && (
              <p style={{ fontSize: "0.8rem", color: "#6b7280" }}>
                Cargando líneas…
              </p>
            )}
            {gtfsRoutesQuery.error && (
              <p className="error-text">Error cargando rutas GTFS.</p>
            )}
          </div>

          <h2 className="section-title">Rutas OSRM</h2>

          <div className="mode-toolbar">
            {(["driving", "cycling", "foot"] as Profile[]).map((p) => (
              <button
                key={p}
                type="button"
                className={
                  "mode-button" +
                  (selectedMode === p ? " mode-button--active" : "")
                }
                onClick={() => setSelectedMode(p)}
                disabled={isCalculating}
              >
                {PROFILE_LABELS[p]}
              </button>
            ))}

            <button
              type="button"
              className={
                "mode-button" +
                (selectedMode === "transit" ? " mode-button--active" : "")
              }
              onClick={() => setSelectedMode("transit")}
              disabled={isCalculating || !transitMutation.data}
            >
              Transporte público
            </button>
          </div>


          <button
            onClick={() => {
              osrmMutation.mutate();
              // transitMutation.mutate();
              setTransitItineraryIndex(0);
              transitMutation.mutate(0);
            }}
            disabled={isCalculating}
            className="primary-button"
          >
            {isCalculating ? "Calculando..." : "Calcular rutas"}
          </button>


          {osrmMutation.error && (
            <p className="error-text">
              Error OSRM rutas coche/bici/a pie: {(osrmMutation.error as Error).message}
            </p>
          )}
          {transitMutation.error && (
            <p className="error-text">
              Error OTP transporte público: {(transitMutation.error as Error).message}
            </p>
          )}

            <table className="routes-table">
              <thead>
                <tr>
                  <th>Modo</th>
                  <th>Distancia (km)</th>
                  <th>Duración (min)</th>
                </tr>
              </thead>
              <tbody>
                {osrmMutation.data?.results.map((r) => (
                  <tr
                    key={r.profile}
                    className={selectedMode === r.profile ? "row-active" : undefined}
                  >
                    <td>{PROFILE_LABELS[r.profile]}</td>
                    <td>{(r.distance_m / 1000).toFixed(2)}</td>
                    <td>{(r.duration_s / 60).toFixed(1)}</td>
                  </tr>
                ))}

                {transitMutation.data && (
                  <tr
                    className={selectedMode === "transit" ? "row-active" : undefined}
                  >
                    <td>
                      Transporte público
                      {transitLineLabel && (
                        <div style={{ fontSize: "0.75rem", color: "#4b5563" }}>
                          Línea {transitLineLabel}
                          {mainTransitSegment?.from_stop_name &&
                            mainTransitSegment?.to_stop_name && (
                              <>
                                {" · "}
                                {mainTransitSegment.from_stop_name} →{" "}
                                {mainTransitSegment.to_stop_name}
                              </>
                            )}
                        </div>
                      )}
                    </td>
                    <td>{(transitMutation.data.distance_m / 1000).toFixed(2)}</td>
                    <td>{(transitMutation.data.duration_s / 60).toFixed(1)}</td>
                  </tr>
                )}
              </tbody>
            </table>

            {transitResult && (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "0.5rem",
                  marginTop: "0.5rem",
                  fontSize: "0.85rem",
                }}
              >
                <button
                  type="button"
                  onClick={() => {
                    if (transitItineraryIndex <= 0) return;
                    const next = transitItineraryIndex - 1;
                    setTransitItineraryIndex(next);
                    transitMutation.mutate(next);
                  }}
                  disabled={transitItineraryIndex <= 0 || transitMutation.isPending}
                >
                  ◀ Anterior
                </button>

                <span>
                  Itinerario {transitItineraryIndex + 1} de {totalItineraries || "?"}
                </span>

                <button
                  type="button"
                  onClick={() => {
                    if (!totalItineraries) return;
                    if (transitItineraryIndex >= totalItineraries - 1) return;
                    const next = transitItineraryIndex + 1;
                    setTransitItineraryIndex(next);
                    transitMutation.mutate(next);
                  }}
                  disabled={
                    !totalItineraries ||
                    transitItineraryIndex >= totalItineraries - 1 ||
                    transitMutation.isPending
                  }
                >
                  Siguiente ▶
                </button>
              </div>
            )}

            {selectedMode === "transit" && transitResult && (
            <div
              style={{
                marginTop: "0.75rem",
                paddingTop: "0.5rem",
                borderTop: "1px solid #e5e7eb",
                fontSize: "0.85rem",
              }}
            >
              <h3 style={{ marginBottom: "0.25rem", fontSize: "0.9rem" }}>
                Detalle del itinerario en transporte público
              </h3>
              <ol style={{ paddingLeft: "1.25rem" }}>
                {transitResult.segments.map((seg, idx) => {
                  const distKm = seg.distance_m / 1000;
                  const durMin = seg.duration_s / 60;
                  const isWalk = seg.mode === "WALK";

                  if (isWalk) {
                    return (
                      <li key={idx} style={{ marginBottom: "0.25rem" }}>
                        Caminar {distKm.toFixed(2)} km ({durMin.toFixed(1)} min)
                        {seg.to_stop_name && (
                          <>
                            {" "}
                            hasta <strong>{seg.to_stop_name}</strong>
                          </>
                        )}
                      </li>
                    );
                  }

                  const label =
                    seg.route_short_name ||
                    seg.route_long_name ||
                    seg.route_id ||
                    seg.mode;

                  return (
                    <li key={idx} style={{ marginBottom: "0.25rem" }}>
                      {seg.departure && <span>{seg.departure} · </span>}
                      <strong>Línea {label}</strong>
                      {seg.agency_name && <> ({seg.agency_name})</>}
                      {seg.from_stop_name && seg.to_stop_name && (
                        <>
                          {" "}
                          de <strong>{seg.from_stop_name}</strong> a{" "}
                          <strong>{seg.to_stop_name}</strong>
                        </>
                      )}
                      {" · "}
                      {distKm.toFixed(2)} km ({durMin.toFixed(1)} min)
                      {seg.arrival && <> · llegada {seg.arrival}</>}
                    </li>
                  );
                })}
              </ol>
            </div>
          )}



          {/* Bloque de transporte público GTFS */}
          {selectedTransitRouteId && (
            <div className="transit-summary">
              <h3>Transporte público (GTFS)</h3>

              {transitRouteDetailsQuery.data && (
                <p>
                  Ruta:{" "}
                  <strong>
                    {transitRouteDetailsQuery.data.route.short_name ||
                      transitRouteDetailsQuery.data.route.long_name ||
                      transitRouteDetailsQuery.data.route.id}
                  </strong>{" "}
                  ({transitRouteStops.length} paradas)
                </p>
              )}

              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "0.5rem",
                  margin: "0.5rem 0",
                }}
              >
                <label
                  htmlFor="schedule-date"
                  style={{ fontSize: "0.85rem", color: "#4b5563" }}
                >
                  Fecha:
                </label>
                <input
                  id="schedule-date"
                  type="date"
                  value={scheduleDate}
                  onChange={(e) => setScheduleDate(e.target.value)}
                />
              </div>

              {transitScheduleQuery.isLoading && <p>Cargando horarios…</p>}
              {transitScheduleQuery.error && (
                <p className="error-text">
                  Error cargando horarios de la ruta seleccionada.
                </p>
              )}

              {transitScheduleQuery.data && (
                <>
                  {transitScheduleQuery.data.directions.length === 0 ? (
                    <p style={{ fontSize: "0.85rem", color: "#4b5563" }}>
                      No hay servicios programados para esta fecha.
                    </p>
                  ) : (
                    <div style={{ marginTop: "0.5rem" }}>
                      {transitScheduleQuery.data.directions.map((dir, idx) => {
                        const sample = dir.departures.slice(0, 10);
                        const remaining =
                          dir.departures.length - sample.length;

                        return (
                          <div
                            key={dir.direction_id ?? idx}
                            style={{
                              marginBottom: "0.5rem",
                              padding: "0.4rem 0.6rem",
                              borderRadius: "0.4rem",
                              background: "#f9fafb",
                            }}
                          >
                            <div
                              style={{
                                fontWeight: 600,
                                marginBottom: "0.25rem",
                              }}
                            >
                              Sentido{" "}
                              {dir.headsign ||
                                (dir.direction_id !== undefined &&
                                  dir.direction_id !== null &&
                                  `(${dir.direction_id})`) ||
                                ""}
                            </div>
                            <div
                              style={{
                                fontSize: "0.8rem",
                                color: "#4b5563",
                                marginBottom: "0.25rem",
                              }}
                            >
                              Viajes: {dir.trip_count}. Primera salida:{" "}
                              {stripSeconds(dir.first_departure)}. Última
                              salida: {stripSeconds(dir.last_departure)}.
                            </div>
                            <div
                              style={{
                                fontSize: "0.8rem",
                                color: "#374151",
                              }}
                            >
                              Salidas:{" "}
                              {sample
                                .map((t) => stripSeconds(t))
                                .join(" · ")}
                              {remaining > 0 && ` … (+${remaining} más)`}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </>
              )}

              {transitRouteDetailsQuery.data && (
                <p style={{ fontSize: "0.8rem", color: "#6b7280" }}>
                  Puedes seleccionar otra ruta desde el mapa (clic en una
                  parada) o desde el desplegable superior.
                </p>
              )}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}

export default App;
