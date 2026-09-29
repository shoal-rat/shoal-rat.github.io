/* Exports: GPX (waypoints + track), a JSON trip archive that can be
   reopened later (thumbnails and display images embedded), and a
   share poster composed from a map snapshot. */

import { fmtDate, fmtDistance, fmtDuration, fmtDays, t } from './i18n.js';
import { MODE_STYLE, MODE_KEY } from './trip.js';

const esc = (s) => String(s ?? '').replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]));
const iso = (ms) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');

export function toGpx(trip, title) {
  const wpts = trip.photos.map((p) => {
    const stop = trip.stops.find((s) => s.photos.includes(p));
    return `  <wpt lat="${p.lat.toFixed(6)}" lon="${p.lon.toFixed(6)}">${p.alt != null ? `\n    <ele>${p.alt.toFixed(1)}</ele>` : ''}
    <time>${iso(p.time)}</time>
    <name>${esc(stop?.name || p.name)}</name>
    <desc>${esc(p.name)}</desc>
  </wpt>`;
  }).join('\n');
  const segs = trip.segments.map((seg) => {
    const n = seg.geometry.length;
    const pts = seg.geometry.map(([lon, lat], i) => {
      const time = seg.from.end + ((seg.to.start - seg.from.end) * i) / Math.max(1, n - 1);
      return `      <trkpt lat="${lat.toFixed(6)}" lon="${lon.toFixed(6)}"><time>${iso(time)}</time></trkpt>`;
    }).join('\n');
    return `    <trkseg>\n${pts}\n    </trkseg>`;
  }).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Trip Memory Map (weikezhang.cn/trip-memory-map)" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata><name>${esc(title)}</name><time>${iso(trip.stats.start)}</time></metadata>
${wpts}
  <trk>
    <name>${esc(title)}</name>
${segs}
  </trk>
</gpx>
`;
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

async function dataUrlToBlob(url) {
  return (await fetch(url)).blob();
}

export async function toArchive(photos, meta) {
  const list = [];
  for (const p of photos) {
    const { thumb, display, ...rest } = p;
    list.push({ ...rest, thumb: await blobToDataUrl(thumb), display: display ? await blobToDataUrl(display) : null });
  }
  return JSON.stringify({ format: 'trip-memory-map', version: 1, saved: new Date().toISOString(), meta, photos: list });
}

export async function fromArchive(text) {
  const data = JSON.parse(text);
  if (data?.format !== 'trip-memory-map' || !Array.isArray(data.photos)) throw new Error('bad archive');
  const photos = [];
  for (const p of data.photos) {
    photos.push({ ...p, thumb: await dataUrlToBlob(p.thumb), display: p.display ? await dataUrlToBlob(p.display) : null });
  }
  return { photos, meta: data.meta || {} };
}

/* -------------------------------------------------------------- poster */

function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.roundRect(x, y, w, h, r);
}

async function loadImage(url) {
  const img = new Image();
  img.decoding = 'async';
  img.src = url;
  await img.decode();
  return img;
}

function coverDraw(g, img, x, y, w, h) {
  const s = Math.max(w / img.width, h / img.height);
  const dw = img.width * s;
  const dh = img.height * s;
  g.save();
  roundRect(g, x, y, w, h, 18);
  g.clip();
  g.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
  g.restore();
}

export async function makePoster({ snapshot, trip, title, theme, photoUrl }) {
  const W = 1600;
  const H = 2000;
  const dark = theme === 'ink';
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d');
  const bg = dark ? '#10161f' : '#f4efe5';
  const ink = dark ? '#e7ecf2' : '#2b2620';
  const muted = dark ? '#8c99a8' : '#7b7163';
  g.fillStyle = bg;
  g.fillRect(0, 0, W, H);

  const serif = '"Songti SC", "STSong", "Noto Serif CJK SC", "Hiragino Mincho ProN", Georgia, serif';
  const sans = '-apple-system, "PingFang SC", "Hiragino Sans GB", "Segoe UI", sans-serif';
  g.fillStyle = '#d4553d';
  g.fillRect(96, 104, 64, 6);
  g.fillStyle = ink;
  g.font = `700 88px ${serif}`;
  g.fillText(title, 96, 214, W - 192);
  const s = trip.stats;
  g.fillStyle = muted;
  g.font = `500 34px ${sans}`;
  const span = t('tripSpan', { start: fmtDate(s.start, s.startOffset), end: fmtDate(s.end, s.endOffset) });
  g.fillText(`${span} · ${fmtDays(s.days)} · ${fmtDistance(s.km)} · ${s.photos} ${t('photos')}`, 96, 272, W - 192);

  // map
  const mapX = 96;
  const mapY = 330;
  const mapW = W - 192;
  const mapH = 1160;
  const src = snapshot.canvas;
  // crop the snapshot around the route, at the poster's aspect ratio
  const dpr = snapshot.dpr;
  const e = snapshot.extent;
  const aspect = mapW / mapH;
  const margin = 70 * dpr;
  let cw = (e.x1 - e.x0) * dpr + margin * 2;
  let ch = (e.y1 - e.y0) * dpr + margin * 2;
  if (cw / ch > aspect) ch = cw / aspect; else cw = ch * aspect;
  if (cw > src.width) { cw = src.width; ch = cw / aspect; }
  if (ch > src.height) { ch = src.height; cw = ch * aspect; }
  const cx = ((e.x0 + e.x1) / 2) * dpr;
  const cy = ((e.y0 + e.y1) / 2) * dpr;
  const sx = Math.min(Math.max(0, cx - cw / 2), src.width - cw);
  const sy = Math.min(Math.max(0, cy - ch / 2), src.height - ch);
  const sw = cw;
  const sh = ch;
  const scale = mapW / sw;
  g.save();
  roundRect(g, mapX, mapY, mapW, mapH, 28);
  g.clip();
  g.drawImage(src, sx, sy, sw, sh, mapX, mapY, mapW, mapH);
  // stop dots with numbers
  for (const { stop, p } of snapshot.stops) {
    const x = mapX + (p.x * snapshot.dpr - sx) * scale;
    const y = mapY + (p.y * snapshot.dpr - sy) * scale;
    if (x < mapX || x > mapX + mapW || y < mapY || y > mapY + mapH) continue;
    g.fillStyle = '#ffffff';
    g.beginPath(); g.arc(x, y, 17, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#d4553d';
    g.beginPath(); g.arc(x, y, 13, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#ffffff';
    g.font = `700 15px ${sans}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(String(stop.index + 1), x, y + 1);
    g.textAlign = 'start';
    g.textBaseline = 'alphabetic';
  }
  g.restore();

  // legend
  const modes = Object.entries(s.byMode).filter(([, km]) => km > 0.05).sort((a, b) => b[1] - a[1]);
  let lx = 96;
  g.font = `500 28px ${sans}`;
  for (const [mode, km] of modes) {
    const label = `${t(MODE_KEY[mode])} ${fmtDistance(km)}`;
    g.fillStyle = MODE_STYLE[mode].color;
    g.beginPath(); g.arc(lx + 10, 1540, 10, 0, Math.PI * 2); g.fill();
    g.fillStyle = ink;
    g.fillText(label, lx + 30, 1550);
    lx += 30 + g.measureText(label).width + 44;
    if (lx > W - 300) break;
  }

  // photo strip
  const picks = [];
  const stops = trip.stops;
  const want = Math.min(5, trip.photos.length);
  for (let i = 0; i < want; i += 1) {
    const stop = stops[Math.round((i * (stops.length - 1)) / Math.max(1, want - 1))];
    const photo = stop.photos[0];
    if (!picks.includes(photo)) picks.push(photo);
  }
  const gap = 20;
  const pw = (W - 192 - gap * (picks.length - 1)) / picks.length;
  for (let i = 0; i < picks.length; i += 1) {
    try {
      const img = await loadImage(photoUrl(picks[i], 'display'));
      coverDraw(g, img, 96 + i * (pw + gap), 1600, pw, 230);
    } catch (_) { /* skip */ }
  }

  g.fillStyle = muted;
  g.font = `500 26px ${sans}`;
  g.fillText(t('posterFooter'), 96, 1920);
  g.fillText(`${fmtDuration(s.ms)}`, W - 96 - g.measureText(fmtDuration(s.ms)).width, 1920);
  return new Promise((resolve) => c.toBlob(resolve, 'image/png'));
}
