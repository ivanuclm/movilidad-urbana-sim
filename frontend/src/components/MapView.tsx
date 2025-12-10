import {
  MapContainer,
  TileLayer,
  Marker,
  useMapEvents,
  Polyline,
  CircleMarker,
  Tooltip,
} from "react-leaflet";
import { useState } from "react";
import L from "leaflet";

const defaultCenter: [number, number] = [39.86251, -4.02726]; // Centro en Toledo

// Icono clásico de Leaflet (no lo usamos ya para origen/destino, pero lo dejo por si lo quieres reaprovechar)
const markerIcon = L.icon({
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
  iconSize: [25, 41],
  iconAnchor: [12, 41],
});

// Icono estilo "pin" verde con ▶ (origen)
const originIcon = L.divIcon({
  className: "osm-marker",
  html: `
    <svg viewBox="0 0 25 40" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <filter id="marker-shadow" x="-50%" y="-10%" width="200%" height="200%">
          <feDropShadow dx="0" dy="1" stdDeviation="1.5" flood-opacity="0.4" />
        </filter>
      </defs>
      <g filter="url(#marker-shadow)">
        <path
          d="M12.5 1C7.5 1 3.5 4.9 3.5 9.9C3.5 15.8 12.5 25 12.5 25C12.5 25 21.5 15.8 21.5 9.9C21.5 4.9 17.5 1 12.5 1Z"
          fill="#16a34a"
        />
        <circle cx="12.5" cy="9.9" r="5.2" fill="white" />
        <polygon points="11,6.3 11,13.5 16,9.9" fill="#16a34a" />
      </g>
    </svg>
  `,
  iconSize: [37.5, 50],
  iconAnchor: [18.75, 40],
});

// Icono estilo "pin" rojo con ■ (destino)
const destinationIcon = L.divIcon({
  className: "osm-marker",
  html: `
    <svg viewBox="0 0 25 40" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <filter id="marker-shadow" x="-50%" y="-10%" width="200%" height="200%">
          <feDropShadow dx="0" dy="1" stdDeviation="1.5" flood-opacity="0.4" />
        </filter>
      </defs>
      <g filter="url(#marker-shadow)">
        <path
          d="M12.5 1C7.5 1 3.5 4.9 3.5 9.9C3.5 15.8 12.5 25 12.5 25C12.5 25 21.5 15.8 21.5 9.9C21.5 4.9 17.5 1 12.5 1Z"
          fill="#dc2626"
        />
        <circle cx="12.5" cy="9.9" r="5.2" fill="white" />
        <rect x="9.6" y="6.9" width="6" height="6" fill="#dc2626" rx="1" />
      </g>
    </svg>
  `,
  iconSize: [37.5, 50],
  iconAnchor: [18.75, 40],
});

type Point = { lat: number; lon: number };

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

interface MapViewProps {
  origin: Point;
  destination: Point;
  setOrigin: (p: Point) => void;
  setDestination: (p: Point) => void;
  routeGeometry: Point[];          // Ruta OSRM seleccionada
  gtfsStops?: GtfsStop[];          // Todas las paradas GTFS
  transitShape?: Point[];          // Shape de la ruta GTFS seleccionada
  transitRouteStops?: GtfsStop[];  // Paradas de la ruta GTFS seleccionada
  onSelectTransitRoute?: (routeId: string) => void;
}

function ClickHandler({
  setOrigin,
  setDestination,
}: {
  setOrigin: (p: Point) => void;
  setDestination: (p: Point) => void;
}) {
  const [placingOrigin, setPlacingOrigin] = useState(true);

  useMapEvents({
    click(e) {
      const p = { lat: e.latlng.lat, lon: e.latlng.lng };
      if (placingOrigin) {
        setOrigin(p);
      } else {
        setDestination(p);
      }
      setPlacingOrigin(!placingOrigin);
    },
  });

  return null;
}

export function MapView({
  origin,
  destination,
  setOrigin,
  setDestination,
  routeGeometry,
  gtfsStops,
  transitShape,
  transitRouteStops,
  onSelectTransitRoute,
}: MapViewProps) {
  const osrmPolylinePositions = routeGeometry.map(
    (p) => [p.lat, p.lon] as [number, number]
  );

  const transitPolylinePositions = (transitShape ?? []).map(
    (p) => [p.lat, p.lon] as [number, number]
  );

  return (
    <MapContainer center={defaultCenter} zoom={13} className="map-container">
      <TileLayer
        attribution='&copy; OpenStreetMap contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />

      <ClickHandler setOrigin={setOrigin} setDestination={setDestination} />

      {/* Marcadores de origen y destino */}
      <Marker position={[origin.lat, origin.lon]} icon={originIcon} />
      <Marker position={[destination.lat, destination.lon]} icon={destinationIcon} />

      {/* Ruta OSRM seleccionada */}
      {osrmPolylinePositions.length > 0 && (
        <Polyline positions={osrmPolylinePositions} />
      )}

      {/* Ruta de transporte público seleccionada (GTFS) */}
      {transitPolylinePositions.length > 0 && (
        <Polyline
          positions={transitPolylinePositions}
          pathOptions={{ color: "#f97316", weight: 4 }} // naranja
        />
      )}

      {/* Todas las paradas GTFS como puntos pequeños */}
      {gtfsStops &&
        gtfsStops.map((s) => (
          <CircleMarker
            key={s.id}
            center={[s.lat, s.lon]}
            radius={3}
            pathOptions={{ color: "#2563eb" }} // azul
          >
            <Tooltip>
              <div>
                <strong>{s.name}</strong>
                {s.code && <div>Código: {s.code}</div>}

                {s.routes && s.routes.length > 0 && (
                  <div style={{ marginTop: 4 }}>
                    <div
                      style={{
                        fontWeight: 500,
                        marginBottom: 2,
                        fontSize: "0.8rem",
                      }}
                    >
                      Líneas:
                    </div>
                    <div
                      style={{
                        display: "flex",
                        flexWrap: "wrap",
                        gap: "0.25rem",
                      }}
                    >
                      {s.routes.map((r) => (
                        <button
                          key={r.id}
                          type="button"
                          className="tooltip-chip"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            onSelectTransitRoute?.(r.id);
                          }}
                        >
                          {r.short_name || r.long_name || r.id}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </Tooltip>
          </CircleMarker>
        ))}

      {/* Paradas de la ruta GTFS seleccionada, destacadas */}
      {transitRouteStops &&
        transitRouteStops.map((s) => (
          <CircleMarker
            key={`route-${s.id}`}
            center={[s.lat, s.lon]}
            radius={5}
            pathOptions={{ color: "#f97316", weight: 2 }}
          />
        ))}
    </MapContainer>
  );
}
