// Line of sight: which places are hidden behind buildings, seen from where the listener stands.
// Pure geometry (no I/O), unit-tested in test/web/visibility.test.js.
//
// A place counts as hidden when the straight line from the listener to it crosses a building
// outline, other than the building the place stands in. The first few metres (the listener may
// stand under an arcade or against a wall) and the last stretch before the place (its own
// frontage, steps, a courtyard wall) are not checked.

/** @typedef {[number, number][]} Ring lat/lon pairs, an outer building outline */
/** @typedef {{ id: string, lat: number, lon: number }} Place */

const M_PER_DEG = 111320;
/** Don't check the first metres from the listener. */
const SKIP_START_M = 3;
/** Don't check the last metres before the place. */
const SKIP_END_M = 15;
/** Closer than this, a place is always in view. */
const ALWAYS_VISIBLE_M = 20;

function project(origin, lat, lon) {
  return [(lon - origin.lon) * M_PER_DEG * Math.cos((origin.lat * Math.PI) / 180), (lat - origin.lat) * M_PER_DEG];
}

function contains(pts, x, y) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i];
    const [xj, yj] = pts[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Do segments ab and cd cross? */
function crosses(ax, ay, bx, by, cx, cy, dx, dy) {
  const d1 = (dx - cx) * (ay - cy) - (dy - cy) * (ax - cx);
  const d2 = (dx - cx) * (by - cy) - (dy - cy) * (bx - cx);
  const d3 = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
  const d4 = (bx - ax) * (dy - ay) - (by - ay) * (dx - ax);
  return d1 * d2 < 0 && d3 * d4 < 0;
}

/**
 * The ids of places whose line of sight from `from` is blocked by a building.
 * @param {{lat: number, lon: number}} from
 * @param {Place[]} places
 * @param {Ring[]} buildings
 * @param {number} maxDistance places further than this are left alone (not marked hidden)
 * @returns {Set<string>}
 */
export function hiddenPlaces(from, places, buildings, maxDistance = 600) {
  const hidden = new Set();
  if (!buildings.length) return hidden;

  // Buildings near enough to matter, projected to metres around the listener.
  const reach = maxDistance + 50;
  const shapes = [];
  for (const ring of buildings) {
    const pts = ring.map(([lat, lon]) => project(from, lat, lon));
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const [x, y] of pts) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    if (maxX < -reach || minX > reach || maxY < -reach || minY > reach) continue;
    if (contains(pts, 0, 0)) continue; // the listener is inside it (arcade, passage)
    shapes.push({ pts, minX, minY, maxX, maxY });
  }

  for (const place of places) {
    const [px, py] = project(from, place.lat, place.lon);
    const d = Math.hypot(px, py);
    if (d <= ALWAYS_VISIBLE_M || d > maxDistance) continue;
    const ux = px / d;
    const uy = py / d;
    const ax = ux * SKIP_START_M;
    const ay = uy * SKIP_START_M;
    const end = Math.max(SKIP_START_M, d - SKIP_END_M);
    const bx = ux * end;
    const by = uy * end;
    const sMinX = Math.min(ax, bx), sMaxX = Math.max(ax, bx), sMinY = Math.min(ay, by), sMaxY = Math.max(ay, by);
    for (const s of shapes) {
      if (s.maxX < sMinX || s.minX > sMaxX || s.maxY < sMinY || s.minY > sMaxY) continue;
      if (contains(s.pts, px, py)) continue; // the place's own building
      let blocked = false;
      for (let i = 0, j = s.pts.length - 1; i < s.pts.length; j = i++) {
        if (crosses(ax, ay, bx, by, s.pts[j][0], s.pts[j][1], s.pts[i][0], s.pts[i][1])) {
          blocked = true;
          break;
        }
      }
      if (blocked) {
        hidden.add(place.id);
        break;
      }
    }
  }
  return hidden;
}
