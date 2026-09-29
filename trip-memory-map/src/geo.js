/* Small spherical-geometry toolkit. Coordinates are [lon, lat]. */

const R = 6371.0088; // km
const rad = (d) => (d * Math.PI) / 180;
const deg = (r) => (r * 180) / Math.PI;

export function haversine(a, b) {
  const dLat = rad(b[1] - a[1]);
  const dLon = rad(b[0] - a[0]);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

export function bearing(a, b) {
  const y = Math.sin(rad(b[0] - a[0])) * Math.cos(rad(b[1]));
  const x = Math.cos(rad(a[1])) * Math.sin(rad(b[1])) - Math.sin(rad(a[1])) * Math.cos(rad(b[1])) * Math.cos(rad(b[0] - a[0]));
  return (deg(Math.atan2(y, x)) + 360) % 360;
}

/** Great-circle interpolation. */
export function interpolateGC(a, b, f) {
  const φ1 = rad(a[1]); const λ1 = rad(a[0]);
  const φ2 = rad(b[1]); const λ2 = rad(b[0]);
  const d = haversine(a, b) / R;
  if (d < 1e-9) return [a[0], a[1]];
  const A = Math.sin((1 - f) * d) / Math.sin(d);
  const B = Math.sin(f * d) / Math.sin(d);
  const x = A * Math.cos(φ1) * Math.cos(λ1) + B * Math.cos(φ2) * Math.cos(λ2);
  const y = A * Math.cos(φ1) * Math.sin(λ1) + B * Math.cos(φ2) * Math.sin(λ2);
  const z = A * Math.sin(φ1) + B * Math.sin(φ2);
  return [deg(Math.atan2(y, x)), deg(Math.atan2(z, Math.hypot(x, y)))];
}

/** Straight (rhumb-ish) line, densified so it bends nicely on the globe. */
export function lineBetween(a, b, steps = 16) {
  const out = [];
  for (let i = 0; i <= steps; i += 1) out.push(interpolateGC(a, b, i / steps));
  return unwrap(out);
}

/** Great-circle flight path lifted into a gentle arc for readability. */
export function flightArc(a, b, steps = 64) {
  const dist = haversine(a, b);
  const pts = [];
  // perpendicular offset in degrees, proportional to distance
  const lift = Math.min(8, dist / 111 / 7);
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len;
  const ny = dx / len;
  for (let i = 0; i <= steps; i += 1) {
    const f = i / steps;
    const p = interpolateGC(a, b, f);
    const bump = Math.sin(Math.PI * f) * lift;
    pts.push([p[0] + nx * bump, p[1] + ny * bump]);
  }
  return unwrap(pts);
}

/** Keep longitudes continuous across the antimeridian. */
export function unwrap(coords) {
  for (let i = 1; i < coords.length; i += 1) {
    while (coords[i][0] - coords[i - 1][0] > 180) coords[i][0] -= 360;
    while (coords[i][0] - coords[i - 1][0] < -180) coords[i][0] += 360;
  }
  return coords;
}

/** Cumulative length table for walking along a polyline. */
export function measure(coords) {
  const cum = [0];
  for (let i = 1; i < coords.length; i += 1) cum.push(cum[i - 1] + haversine(coords[i - 1], coords[i]));
  return { coords, cum, length: cum[cum.length - 1] };
}

export function along(measured, f) {
  const { coords, cum, length } = measured;
  if (coords.length === 1 || length === 0) return { point: coords[0], index: 0 };
  const target = Math.min(1, Math.max(0, f)) * length;
  let lo = 0;
  let hi = cum.length - 1;
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1;
    if (cum[mid] <= target) lo = mid; else hi = mid;
  }
  const seg = cum[hi] - cum[lo] || 1;
  const k = (target - cum[lo]) / seg;
  const a = coords[lo];
  const b = coords[hi];
  return { point: [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k], index: lo };
}

export function bbox(coords) {
  let w = Infinity; let s = Infinity; let e = -Infinity; let n = -Infinity;
  for (const [x, y] of coords) {
    if (x < w) w = x; if (x > e) e = x;
    if (y < s) s = y; if (y > n) n = y;
  }
  return [[w, s], [e, n]];
}

export function centroid(points) {
  let x = 0; let y = 0;
  for (const p of points) { x += p[0]; y += p[1]; }
  return [x / points.length, y / points.length];
}

/** Rough UTC offset (minutes) from longitude, used only when EXIF has none. */
export function offsetFromLongitude(lon) {
  return Math.round(lon / 15) * 60;
}
