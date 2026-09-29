/* Optional network lookups — only used when the user turns them on.
   Road routes: FOSSGIS OSRM instances on routing.openstreetmap.de.
   Place names: OpenStreetMap Nominatim, one request per second. */

const ROUTE_PROFILE = { walk: 'foot', bike: 'bike', bus: 'car', car: 'car' };
const ROUTE_LIMIT_KM = { walk: 25, bike: 80, bus: 400, car: 600 };

const routeCache = new Map();

function cacheGet(key) {
  if (routeCache.has(key)) return routeCache.get(key);
  try {
    const raw = sessionStorage.getItem(`tripmap.route.${key}`);
    if (raw) return JSON.parse(raw);
  } catch (_) { /* ignore */ }
  return undefined;
}

function cacheSet(key, value) {
  routeCache.set(key, value);
  try { sessionStorage.setItem(`tripmap.route.${key}`, JSON.stringify(value)); } catch (_) { /* quota */ }
}

export function routable(seg) {
  const profile = ROUTE_PROFILE[seg.mode];
  return !!profile && seg.km > 0.05 && seg.km <= ROUTE_LIMIT_KM[seg.mode];
}

/** Returns an array of [lon, lat] or null. */
export async function fetchRoute(seg, signal) {
  const profile = ROUTE_PROFILE[seg.mode];
  const a = seg.from.center;
  const b = seg.to.center;
  const key = `${profile}|${a[0].toFixed(5)},${a[1].toFixed(5)}|${b[0].toFixed(5)},${b[1].toFixed(5)}`;
  const cached = cacheGet(key);
  if (cached !== undefined) return cached;
  const url = `https://routing.openstreetmap.de/routed-${profile}/route/v1/driving/${a[0]},${a[1]};${b[0]},${b[1]}?overview=full&geometries=geojson&alternatives=false&steps=false`;
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`route ${response.status}`);
  const data = await response.json();
  const coords = data?.routes?.[0]?.geometry?.coordinates || null;
  // ignore absurd detours (e.g. a ferry-less island) — keep the straight line
  const result = coords && coords.length > 1 ? coords : null;
  cacheSet(key, result);
  return result;
}

/* ------------------------------------------------------------- places */

const GEO_KEY = 'tripmap.places.v1';
let placeCache = null;
let lastRequest = 0;

function places() {
  if (!placeCache) {
    try { placeCache = JSON.parse(localStorage.getItem(GEO_KEY) || '{}'); } catch (_) { placeCache = {}; }
  }
  return placeCache;
}

function savePlaces() {
  try { localStorage.setItem(GEO_KEY, JSON.stringify(placeCache)); } catch (_) { /* quota */ }
}

function pickName(data) {
  if (!data) return null;
  const a = data.address || {};
  const specific = data.name || a.tourism || a.attraction || a.amenity || a.leisure || a.historic || a.building || a.railway || a.aeroway;
  const area = a.neighbourhood || a.quarter || a.suburb || a.city_district || a.village || a.town || a.city || a.county || a.state;
  if (specific && area && specific !== area) return `${specific} · ${area}`;
  return specific || area || (data.display_name ? data.display_name.split(',').slice(0, 2).join(' ·') : null);
}

export async function reverseGeocode([lon, lat], language, signal) {
  const key = `${language}|${lat.toFixed(4)},${lon.toFixed(4)}`;
  const cache = places();
  if (key in cache) return cache[key];
  const wait = Math.max(0, lastRequest + 1100 - Date.now());
  if (wait) await new Promise((r) => setTimeout(r, wait));
  lastRequest = Date.now();
  const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lon}&zoom=17&addressdetails=1&accept-language=${language === 'zh' ? 'zh-CN,zh' : 'en'}`;
  const response = await fetch(url, { signal, headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(`geocode ${response.status}`);
  const name = pickName(await response.json());
  cache[key] = name;
  savePlaces();
  return name;
}
