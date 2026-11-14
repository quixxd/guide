export type LatLon = { lat: number; lon: number };

export type Side = "ahead" | "left" | "right" | "behind" | "around";

const EARTH_RADIUS_M = 6371000;
const toRad = (deg: number) => (deg * Math.PI) / 180;
const toDeg = (rad: number) => (rad * 180) / Math.PI;

export function distanceM(a: LatLon, b: LatLon): number {
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Initial compass bearing from a to b, 0..360 degrees. */
export function bearingDeg(a: LatLon, b: LatLon): number {
  const y = Math.sin(toRad(b.lon - a.lon)) * Math.cos(toRad(b.lat));
  const x =
    Math.cos(toRad(a.lat)) * Math.sin(toRad(b.lat)) -
    Math.sin(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.cos(toRad(b.lon - a.lon));
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

/** Signed difference target - reference, normalised to -180..180 (negative = to the left). */
export function angleDiff(target: number, reference: number): number {
  return ((((target - reference) % 360) + 540) % 360) - 180;
}

export type Relative = {
  distance: number;
  bearing: number;
  /** Angle relative to the direction of travel, or null when the heading is unknown. */
  relAngle: number | null;
  side: Side;
};

export function relativePosition(from: LatLon, heading: number | null, to: LatLon): Relative {
  const distance = distanceM(from, to);
  const bearing = bearingDeg(from, to);
  if (heading === null) return { distance, bearing, relAngle: null, side: "around" };
  const relAngle = angleDiff(bearing, heading);
  const abs = Math.abs(relAngle);
  const side: Side = abs <= 30 ? "ahead" : abs >= 150 ? "behind" : relAngle < 0 ? "left" : "right";
  return { distance, bearing, relAngle, side };
}

const COMPASS = ["north", "north-east", "east", "south-east", "south", "south-west", "west", "north-west"];

export function compassName(bearing: number): string {
  return COMPASS[Math.round(bearing / 45) % 8];
}

export function describeDistance(m: number): string {
  if (m < 40) return "right here";
  if (m < 1000) return `about ${Math.max(50, Math.round(m / 50) * 50)} metres`;
  const km = m / 1000;
  return `about ${km < 10 ? km.toFixed(1).replace(/\.0$/, "") : Math.round(km)} km`;
}

export function describeDuration(sec: number): string {
  if (sec < 50) return `${Math.max(10, Math.round(sec / 10) * 10)} seconds`;
  const min = Math.round(sec / 60);
  return min === 1 ? "a minute" : `${min} minutes`;
}

export function describeSide(rel: Relative): string {
  switch (rel.side) {
    case "ahead":
      return "straight ahead";
    case "left":
      return "on your left";
    case "right":
      return "on your right";
    case "behind":
      return "behind you";
    case "around":
      return `to the ${compassName(rel.bearing)}`;
  }
}
