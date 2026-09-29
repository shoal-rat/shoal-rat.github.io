/* From photos to a trip: sort, cluster into stops, connect with segments,
   infer how you travelled, group by local day, add up stats. The trip keeps
   user choices (mode overrides, stop names, title) keyed by stable ids so a
   rebuild after adding photos or changing the merge radius keeps them. */

import { haversine, centroid, lineBetween, flightArc, measure } from './geo.js';
import { localParts } from './i18n.js';

export const MODES = ['walk', 'bike', 'bus', 'car', 'rail', 'boat', 'flight', 'unknown'];

export const MODE_STYLE = {
  walk: { color: '#e4572e', dash: [1.2, 1.6], width: 3.4, icon: 'walk' },
  bike: { color: '#2a9d8f', dash: [2.2, 1.4], width: 3.4, icon: 'bike' },
  bus: { color: '#7b5ea7', dash: null, width: 4, icon: 'bus' },
  car: { color: '#3d5a80', dash: null, width: 4, icon: 'car' },
  rail: { color: '#1f3a5f', dash: null, width: 4.6, icon: 'rail', ties: true },
  boat: { color: '#2f80ed', dash: [0.6, 1.8], width: 4, icon: 'boat' },
  flight: { color: '#c0892e', dash: [2.6, 2.2], width: 3, icon: 'flight' },
  unknown: { color: '#9a958b', dash: [0.4, 2.2], width: 3, icon: 'unknown' },
};

export const MODE_KEY = {
  walk: 'modeWalk', bike: 'modeBike', bus: 'modeBus', car: 'modeCar',
  rail: 'modeRail', boat: 'modeBoat', flight: 'modeFlight', unknown: 'modeUnknown',
};

/**
 * Guess the mode from distance (km) and elapsed time (h).
 * Returns { mode, confidence (0..1), note }.
 */
export function inferMode(km, hours) {
  if (!(hours > 0)) return { mode: km > 300 ? 'flight' : 'unknown', confidence: 0.2, note: 'noTime' };
  const v = km / hours;
  const pick = (mode, lo, hi) => {
    // confidence: how central the speed sits in its band (log scale)
    const l = Math.log(v);
    const a = Math.log(lo);
    const b = Math.log(hi);
    const c = 1 - Math.abs((l - (a + b) / 2) / ((b - a) / 2 || 1));
    return { mode, confidence: Math.max(0.35, Math.min(0.95, 0.55 + c * 0.4)) };
  };
  let result;
  if ((km > 700 && v > 140) || v >= 260) result = pick('flight', 260, 900);
  else if (v >= 85 && km >= 25) result = pick('rail', 85, 320);
  else if (v >= 85) result = pick('car', 60, 130);
  else if (v >= 22) result = km > 180 ? pick('rail', 60, 200) : pick('car', 22, 90);
  else if (v >= 7) result = km < 20 && v < 20 ? pick('bike', 7, 20) : pick('car', 15, 60);
  else if (v >= 1.8) result = pick('walk', 1.8, 7);
  else if (km < 3) result = { mode: 'walk', confidence: 0.45, note: 'longGap' };
  else result = { mode: 'unknown', confidence: 0.2, note: 'longGap' };
  if (hours > 4 && result.mode !== 'flight') {
    result.confidence = Math.min(result.confidence, 0.4);
    result.note = result.note || 'longGap';
  }
  return result;
}

function localDayKey(utcMs, offsetMin) {
  const p = localParts(utcMs, offsetMin);
  return `${p.y}-${String(p.mo + 1).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`;
}

/**
 * photos: [{ id, name, time, offset, lat, lon, ... }]
 * meta: { overrides: { stopId: mode }, names: { stopId: name }, geo: { stopId: name } }
 */
export function buildTrip(photos, meta = {}, { mergeRadius = 250 } = {}) {
  const sorted = [...photos].sort((a, b) => a.time - b.time || a.name.localeCompare(b.name));
  const stops = [];
  let current = null;
  for (const photo of sorted) {
    const p = [photo.lon, photo.lat];
    if (current) {
      const d = haversine(current.center, p) * 1000;
      const gap = photo.time - current.end;
      if (d <= mergeRadius && gap < 3 * 3600e3) {
        current.photos.push(photo);
        current.points.push(p);
        current.center = centroid(current.points);
        current.end = photo.time;
        continue;
      }
    }
    current = { id: photo.id, photos: [photo], points: [p], center: p, start: photo.time, end: photo.time };
    stops.push(current);
  }

  const dayKeys = [];
  stops.forEach((stop, index) => {
    stop.index = index;
    stop.offset = stop.photos[0].offset;
    stop.name = meta.names?.[stop.id] || meta.geo?.[stop.id] || null;
    stop.userNamed = !!meta.names?.[stop.id];
    const key = localDayKey(stop.start, stop.offset);
    if (!dayKeys.includes(key)) dayKeys.push(key);
    stop.day = dayKeys.indexOf(key);
    stop.dayKey = key;
    delete stop.points;
  });

  const segments = [];
  for (let i = 0; i < stops.length - 1; i += 1) {
    const from = stops[i];
    const to = stops[i + 1];
    const km = haversine(from.center, to.center);
    const ms = to.start - from.end;
    const auto = inferMode(km, ms / 3600e3);
    const override = meta.overrides?.[to.id];
    const mode = override && MODES.includes(override) ? override : auto.mode;
    segments.push({
      id: to.id,
      index: i,
      from,
      to,
      km,
      ms,
      speed: ms > 0 ? km / (ms / 3600e3) : null,
      auto,
      mode,
      userMode: !!override,
      overnight: from.dayKey !== to.dayKey,
      day: to.day,
      geometry: null,
      routeKind: null,
    });
  }
  segments.forEach((seg) => setStraightGeometry(seg));

  const days = dayKeys.map((key, index) => {
    const dayStops = stops.filter((s) => s.day === index);
    const daySegs = segments.filter((s) => s.day === index);
    return {
      index, key,
      start: dayStops[0].start,
      offset: dayStops[0].offset,
      stops: dayStops,
      km: daySegs.reduce((sum, s) => sum + s.km, 0),
      photos: dayStops.reduce((sum, s) => sum + s.photos.length, 0),
    };
  });

  const byMode = {};
  for (const seg of segments) byMode[seg.mode] = (byMode[seg.mode] || 0) + seg.km;

  return {
    photos: sorted,
    stops,
    segments,
    days,
    stats: {
      photos: sorted.length,
      stops: stops.length,
      km: segments.reduce((sum, s) => sum + s.km, 0),
      ms: sorted.length ? sorted[sorted.length - 1].time - sorted[0].time : 0,
      days: days.length,
      byMode,
      start: sorted[0]?.time,
      end: sorted[sorted.length - 1]?.time,
      startOffset: sorted[0]?.offset || 0,
      endOffset: sorted[sorted.length - 1]?.offset || 0,
    },
  };
}

export function setStraightGeometry(seg) {
  const a = seg.from.center;
  const b = seg.to.center;
  if (seg.mode === 'flight') {
    seg.geometry = flightArc(a, b);
    seg.routeKind = 'arc';
  } else {
    seg.geometry = lineBetween(a, b, seg.km > 50 ? 32 : 8);
    seg.routeKind = seg.mode === 'rail' ? 'rail' : 'straight';
  }
  seg.measured = measure(seg.geometry);
}

export function setRoadGeometry(seg, coords) {
  seg.geometry = [seg.from.center, ...coords, seg.to.center];
  seg.routeKind = 'road';
  seg.measured = measure(seg.geometry);
}
