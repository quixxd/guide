import { cached, fetchJson } from "../http.ts";
import type { LatLon } from "../geo.ts";

export type SimMode = "walk" | "bus" | "drive";

export type Route = {
  /** [lat, lon] pairs along the route. */
  coords: [number, number][];
  /** Seconds to travel each coordinate pair (length = coords.length - 1). */
  durations: number[];
  distance: number;
  duration: number;
};

type OsrmResponse = {
  code: string;
  routes?: {
    distance: number;
    duration: number;
    geometry: { coordinates: [number, number][] };
    legs: { annotation?: { duration?: number[] } }[];
  }[];
};

// Public FOSSGIS OSRM servers (foot and car profiles). Fine for light prototype use.
const BASE: Record<SimMode, string> = {
  walk: "https://routing.openstreetmap.de/routed-foot",
  bus: "https://routing.openstreetmap.de/routed-car",
  drive: "https://routing.openstreetmap.de/routed-car",
};

export function route(points: LatLon[], mode: SimMode): Promise<Route> {
  const path = points.map((p) => `${p.lon.toFixed(6)},${p.lat.toFixed(6)}`).join(";");
  return cached(`route:${mode}:${path}`, 24 * 3600 * 1000, async () => {
    const url = `${BASE[mode]}/route/v1/driving/${path}?overview=full&geometries=geojson&annotations=duration`;
    const data = await fetchJson<OsrmResponse>(url);
    const r = data.routes?.[0];
    if (data.code !== "Ok" || !r) throw new Error(`No route found (${data.code})`);
    return {
      coords: r.geometry.coordinates.map(([lon, lat]) => [lat, lon] as [number, number]),
      durations: r.legs.flatMap((leg) => leg.annotation?.duration ?? []),
      distance: r.distance,
      duration: r.duration,
    };
  });
}
