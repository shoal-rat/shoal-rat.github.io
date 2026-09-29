/* Reading photos: EXIF (exifr), time zones, thumbnails.
   Everything stays in the page. HEIC is decoded natively where the browser
   can (Safari) and through a lazily loaded decoder elsewhere. */

import exifr from '../vendor/exifr/exifr-lite.mjs';
import { offsetFromLongitude } from './geo.js';

const IMAGE_EXT = /\.(jpe?g|heic|heif|png|webp|tiff?|avif)$/i;
const HEIC = /\.(heic|heif)$/i;
const THUMB = 320;
const DISPLAY = 1600;

export function isImage(file) {
  return file.type.startsWith('image/') || IMAGE_EXT.test(file.name);
}

export function photoId(name, time, size) {
  let h = 5381;
  const s = `${name}|${time}|${size}`;
  for (let i = 0; i < s.length; i += 1) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return `p${h.toString(36)}`;
}

function parseOffset(value) {
  if (typeof value !== 'string') return null;
  const m = value.trim().match(/^([+-])(\d{1,2}):?(\d{2})$/);
  if (!m) return null;
  return (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3]));
}

function parseExifDate(value) {
  if (value instanceof Date) return { utcGuess: value.getTime(), wall: null };
  if (typeof value !== 'string') return null;
  const m = value.match(/^(\d{4})[:-](\d{2})[:-](\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
  if (!m) return null;
  const wall = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
  return Number.isFinite(wall) ? { wall } : null;
}

/** Local wall time + best offset → UTC. */
function resolveTime(tags, lon) {
  const parsed = parseExifDate(tags.DateTimeOriginal || tags.CreateDate || tags.DateTimeDigitized || tags.ModifyDate);
  if (!parsed) return null;
  if (parsed.wall == null) return { time: parsed.utcGuess, offset: -new Date(parsed.utcGuess).getTimezoneOffset(), tz: 'browser' };
  let offset = parseOffset(tags.OffsetTimeOriginal) ?? parseOffset(tags.OffsetTime) ?? parseOffset(tags.OffsetTimeDigitized);
  let tz = 'exif';
  if (offset == null && tags.GPSDateStamp && Array.isArray(tags.GPSTimeStamp)) {
    const d = String(tags.GPSDateStamp).match(/(\d{4})[:-](\d{2})[:-](\d{2})/);
    if (d) {
      const [h, mi, s] = tags.GPSTimeStamp.map(Number);
      const gpsUtc = Date.UTC(+d[1], +d[2] - 1, +d[3], h, mi, Math.floor(s || 0));
      const diff = Math.round((parsed.wall - gpsUtc) / 60000 / 15) * 15;
      if (Math.abs(diff) <= 14 * 60) { offset = diff; tz = 'gps'; }
    }
  }
  if (offset == null && Number.isFinite(lon)) { offset = offsetFromLongitude(lon); tz = 'longitude'; }
  if (offset == null) { offset = -new Date(parsed.wall).getTimezoneOffset(); tz = 'browser'; }
  return { time: parsed.wall - offset * 60000, offset, tz };
}

export async function readMeta(file) {
  const tags = await exifr.parse(file, {
    tiff: true, exif: true, gps: true, ifd1: false, xmp: false, iptc: false, icc: false, jfif: false, ihdr: false,
    reviveValues: false, translateValues: false, mergeOutput: true,
  });
  if (!tags) return { tags: null };
  const lat = Number(tags.latitude);
  const lon = Number(tags.longitude);
  const hasGps = Number.isFinite(lat) && Number.isFinite(lon) && !(lat === 0 && lon === 0);
  const time = resolveTime(tags, hasGps ? lon : undefined);
  return {
    tags,
    lat: hasGps ? lat : null,
    lon: hasGps ? lon : null,
    alt: Number.isFinite(Number(tags.GPSAltitude)) ? Number(tags.GPSAltitude) : null,
    time: time?.time ?? null,
    offset: time?.offset ?? 0,
    tz: time?.tz ?? null,
    camera: [tags.Make, tags.Model].filter(Boolean).join(' ').trim() || null,
  };
}

/**
 * Photos without a recorded UTC offset got a guess from longitude. If another
 * photo nearby (same region) carries a real offset, trust that instead —
 * phones on the same trip usually share the zone. Mutates and returns photos.
 */
export function harmonizeOffsets(photos) {
  const anchors = photos.filter((p) => p.tz === 'exif' || p.tz === 'gps');
  if (!anchors.length) return photos;
  for (const photo of photos) {
    if (photo.tz === 'exif' || photo.tz === 'gps') continue;
    let best = null;
    let bestKm = 400;
    for (const a of anchors) {
      const km = haversineKm(photo.lat, photo.lon, a.lat, a.lon);
      if (km < bestKm && Math.abs(a.time - photo.time) < 5 * 86400e3) { best = a; bestKm = km; }
    }
    if (!best || best.offset === photo.offset) continue;
    const wall = photo.time + photo.offset * 60000;
    photo.offset = best.offset;
    photo.time = wall - best.offset * 60000;
    photo.tz = 'nearby';
  }
  return photos;
}

function haversineKm(lat1, lon1, lat2, lon2) {
  const r = Math.PI / 180;
  const a = Math.sin(((lat2 - lat1) * r) / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(((lon2 - lon1) * r) / 2) ** 2;
  return 12742 * Math.asin(Math.min(1, Math.sqrt(a)));
}

/* ------------------------------------------------------------- images */

let heicLoader = null;
function loadHeic2any() {
  if (!heicLoader) {
    heicLoader = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = new URL('../vendor/heic2any/heic2any.min.js', import.meta.url).href;
      s.onload = () => resolve(window.heic2any);
      s.onerror = () => reject(new Error('heic decoder failed to load'));
      document.head.append(s);
    });
  }
  return heicLoader;
}

async function decode(file, onHeic) {
  try {
    return await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch (_) {
    if (!(HEIC.test(file.name) || /heic|heif/i.test(file.type))) throw _;
  }
  onHeic?.();
  const heic2any = await loadHeic2any();
  const jpeg = await heic2any({ blob: file, toType: 'image/jpeg', quality: 0.86 });
  return createImageBitmap(Array.isArray(jpeg) ? jpeg[0] : jpeg);
}

function toBlob(bitmap, max, quality) {
  const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
}

export async function makeImages(file, onHeic) {
  const bitmap = await decode(file, onHeic);
  const [thumb, display] = await Promise.all([toBlob(bitmap, THUMB, 0.8), toBlob(bitmap, DISPLAY, 0.86)]);
  const result = { thumb, display, width: bitmap.width, height: bitmap.height };
  bitmap.close?.();
  return result;
}

/* ------------------------------------------------------------- import */

/**
 * Read files into photo records.
 * Returns { photos, skipped: [{ name, reason }] }.
 */
export async function importFiles(files, { existing = new Set(), onProgress, onHeic } = {}) {
  const photos = [];
  const skipped = [];
  const queue = [...files];
  let done = 0;
  const total = queue.length;
  onProgress?.(0, total);

  const worker = async () => {
    while (queue.length) {
      const file = queue.shift();
      try {
        if (!isImage(file)) { skipped.push({ name: file.name, reason: 'skipNotImage' }); continue; }
        const meta = await readMeta(file);
        if (meta.lat == null) { skipped.push({ name: file.name, reason: 'skipNoGps' }); continue; }
        if (meta.time == null) { skipped.push({ name: file.name, reason: 'skipNoTime' }); continue; }
        const id = photoId(file.name, meta.time, file.size);
        if (existing.has(id)) { skipped.push({ name: file.name, reason: 'skipDuplicate' }); continue; }
        const images = await makeImages(file, onHeic);
        photos.push({
          id,
          name: file.name,
          time: meta.time,
          offset: meta.offset,
          tz: meta.tz,
          lat: meta.lat,
          lon: meta.lon,
          alt: meta.alt,
          camera: meta.camera,
          width: images.width,
          height: images.height,
          thumb: images.thumb,
          display: images.display,
        });
        existing.add(id);
      } catch (error) {
        skipped.push({ name: file.name, reason: 'skipUnreadable' });
      } finally {
        done += 1;
        onProgress?.(done, total);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, total) }, worker));
  return { photos, skipped };
}

/** Expand dropped folders (DataTransferItemList) into files. */
export async function filesFromDrop(dataTransfer) {
  const items = Array.from(dataTransfer.items || []);
  const entries = items.map((i) => i.webkitGetAsEntry?.()).filter(Boolean);
  if (!entries.length) return Array.from(dataTransfer.files || []);
  const out = [];
  const walk = async (entry) => {
    if (entry.isFile) {
      await new Promise((resolve) => entry.file((f) => { out.push(f); resolve(); }, resolve));
    } else if (entry.isDirectory) {
      const reader = entry.createReader();
      let batch;
      do {
        batch = await new Promise((resolve) => reader.readEntries(resolve, () => resolve([])));
        for (const child of batch) await walk(child);
      } while (batch.length);
    }
  };
  for (const entry of entries) await walk(entry);
  return out;
}
