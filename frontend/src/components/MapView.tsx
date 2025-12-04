import { MapContainer, TileLayer, Marker, useMapEvents, Polyline } from "react-leaflet";
import { useState } from "react";
import L from "leaflet";

const defaultCenter: [number, number] = [38.986, -3.927];

const markerIcon = L.icon({
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
  iconSize: [25, 41],
  iconAnchor: [12, 41],
});

type Point = { lat: number; lon: number };

interface MapViewProps {
  origin: Point;
  destination: Point;
  setOrigin: (p: Point) => void;
  setDestination: (p: Point) => void;
  routeGeometry: Point[];           // <- NUEVO
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
}: MapViewProps) {
  const polylinePositions = routeGeometry.map(
    (p) => [p.lat, p.lon] as [number, number]
  );

  return (
    <MapContainer
      center={defaultCenter}
      zoom={13}
      className="map-container"   // <- usamos clase CSS
    >
      <TileLayer
        attribution='&copy; OpenStreetMap contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />

      <ClickHandler setOrigin={setOrigin} setDestination={setDestination} />

      <Marker position={[origin.lat, origin.lon]} icon={markerIcon} />
      <Marker position={[destination.lat, destination.lon]} icon={markerIcon} />

      {polylinePositions.length > 0 && <Polyline positions={polylinePositions} />}
    </MapContainer>
  );
}
