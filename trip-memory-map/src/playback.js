/* Replay: a schedule of stop dwells and travel legs in "show seconds".
   Each frame positions the mover, draws the travelled path, steers the
   camera (pulling back on long legs) and shows a postcard at every stop. */

import { along, bearing } from './geo.js';
import { fmtDate, fmtTime, t } from './i18n.js';

const STOP_ZOOM = 14.6;
const REPLAY_PITCH = 50;
const ease = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
const lerp = (a, b, f) => a + (b - a) * f;

export class Playback {
  constructor({ map, card, onFrame, onState, photoUrl }) {
    this.map = map;
    this.card = card;
    this.onFrame = onFrame;
    this.onState = onState;
    this.photoUrl = photoUrl;
    this.items = [];
    this.total = 0;
    this.pos = 0;
    this.speed = 1;
    this.playing = false;
    this.active = false;
    this.zoomCache = new Map();
  }

  build(trip) {
    this.trip = trip;
    this.lastBearing = null;
    this.items = [];
    this.zoomCache.clear();
    let clock = 0;
    const dwell = (stop) => {
      const d = 1.8 + 0.8 * Math.min(4, stop.photos.length - 1);
      this.items.push({ kind: 'stop', stop, t0: clock, t1: clock + d });
      clock += d;
    };
    if (!trip || !trip.stops.length) { this.total = 0; return; }
    dwell(trip.stops[0]);
    for (const seg of trip.segments) {
      const d = Math.min(7, Math.max(1.6, 1.2 + 1.15 * Math.log2(1 + seg.km))) + (seg.overnight ? 0.6 : 0);
      this.items.push({ kind: 'seg', seg, t0: clock, t1: clock + d });
      clock += d;
      dwell(seg.to);
    }
    this.total = clock;
    this.dayMarks = [];
    let lastDay = -1;
    for (const item of this.items) {
      if (item.kind === 'stop' && item.stop.day !== lastDay) {
        lastDay = item.stop.day;
        this.dayMarks.push({ day: lastDay, at: item.t0 / this.total });
      }
    }
    this.pos = Math.min(this.pos, this.total);
  }

  /* --------------------------------------------------------- transport */

  play() {
    if (!this.total) return;
    if (this.pos >= this.total - 0.01) this.pos = 0;
    this.playing = true;
    this.active = true;
    this.last = performance.now();
    this.map.refreshSegments(true);
    this.map.setReplay(true);
    this.onState?.();
    this.loop();
  }

  pause() {
    this.playing = false;
    cancelAnimationFrame(this.raf);
    this.onState?.();
  }

  toggle() { if (this.playing) this.pause(); else this.play(); }

  stop() {
    this.pause();
    this.active = false;
    this.card.hidden = true;
    this.map.setReplay(false);
    this.map.setProgress([]);
    this.map.refreshSegments(false);
    this.onState?.();
  }

  seek(pos) {
    this.pos = Math.max(0, Math.min(this.total, pos));
    if (!this.active) {
      this.active = true;
      this.map.refreshSegments(true);
      this.map.setReplay(true);
      this.onState?.();
    }
    this.render();
  }

  setSpeed(speed) { this.speed = speed; }

  /** Jump to the dwell of a stop (used by ← / → keys). */
  jumpToStop(delta) {
    const stops = this.items.filter((i) => i.kind === 'stop');
    const current = stops.findIndex((i) => this.pos < i.t1 - 0.001);
    const index = Math.max(0, Math.min(stops.length - 1, (current < 0 ? stops.length - 1 : current) + delta));
    this.seek(stops[index].t0 + 0.01);
  }

  loop() {
    cancelAnimationFrame(this.raf);
    const step = (now) => {
      if (!this.playing) return;
      const dt = Math.min(0.1, (now - this.last) / 1000);
      this.last = now;
      this.pos += dt * this.speed;
      if (this.pos >= this.total) {
        this.pos = this.total;
        this.render();
        this.playing = false;
        this.onState?.('ended');
        return;
      }
      this.render();
      this.raf = requestAnimationFrame(step);
    };
    this.raf = requestAnimationFrame(step);
  }

  /* ------------------------------------------------------------ frame */

  itemAt(pos) {
    const items = this.items;
    let lo = 0;
    let hi = items.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (items[mid].t1 <= pos) lo = mid + 1; else hi = mid;
    }
    return items[lo];
  }

  segZoom(seg) {
    if (!this.zoomCache.has(seg.id)) {
      const cam = this.map.cameraForSegment(seg);
      this.zoomCache.set(seg.id, cam ? cam.zoom : STOP_ZOOM);
    }
    return this.zoomCache.get(seg.id);
  }

  render() {
    const item = this.itemAt(this.pos);
    if (!item) return;
    const features = [];
    for (const seg of this.trip.segments) {
      if (item.kind === 'seg' && seg === item.seg) break;
      if (item.kind === 'stop' && seg.index >= item.stop.index) break;
      features.push({ type: 'Feature', properties: { mode: seg.mode }, geometry: { type: 'LineString', coordinates: seg.geometry } });
    }

    let center;
    let zoom = STOP_ZOOM;
    let vehicle;
    let utc;
    let offset;
    if (item.kind === 'stop') {
      const stop = item.stop;
      center = stop.center;
      // parked at the stop: the vehicle it arrived with, facing where it goes next
      const arrived = this.trip.segments[stop.index - 1];
      const next = this.trip.segments[stop.index];
      const seg = arrived || next;
      let heading = this.lastBearing;
      if (heading == null && next) heading = bearing(next.geometry[0], next.geometry[Math.min(2, next.geometry.length - 1)]);
      vehicle = seg ? { seg, lngLat: stop.center, bearing: heading ?? 90, lift: 0, moving: false, parked: true } : null;
      const f = (this.pos - item.t0) / (item.t1 - item.t0);
      const photoIndex = Math.min(stop.photos.length - 1, Math.floor(f * stop.photos.length));
      const photo = stop.photos[photoIndex];
      utc = photo.time;
      offset = photo.offset;
      this.showCard(stop, photoIndex);
    } else {
      const seg = item.seg;
      const raw = (this.pos - item.t0) / (item.t1 - item.t0);
      const f = ease(raw);
      const { point, index } = along(seg.measured, f);
      center = point;
      const behind = along(seg.measured, Math.max(0, f - 0.01)).point;
      const ahead = along(seg.measured, Math.min(1, f + 0.01)).point;
      const heading = behind[0] === ahead[0] && behind[1] === ahead[1] ? bearing(seg.from.center, seg.to.center) : bearing(behind, ahead);
      this.lastBearing = heading;
      vehicle = {
        seg, lngLat: point, bearing: heading,
        lift: seg.mode === 'flight' ? Math.pow(Math.sin(Math.PI * f), 0.7) : 0,
        moving: raw > 0.02 && raw < 0.98,
      };
      const zFit = Math.min(STOP_ZOOM, this.segZoom(seg));
      const lift = Math.pow(Math.sin(Math.PI * raw), 0.8);
      zoom = STOP_ZOOM - (STOP_ZOOM - zFit) * lift;
      if (STOP_ZOOM - zFit > 1.5) {
        const mid = along(seg.measured, 0.5).point;
        const k = 0.75 * lift;
        center = [lerp(point[0], mid[0], k), lerp(point[1], mid[1], k)];
      }
      features.push({
        type: 'Feature', properties: { mode: seg.mode },
        geometry: { type: 'LineString', coordinates: [...seg.geometry.slice(0, index + 1), point] },
      });
      utc = lerp(seg.from.end, seg.to.start, raw);
      offset = raw < 0.5 ? seg.from.offset : seg.to.offset;
      this.card.hidden = true;
    }
    this.map.setProgress(features);
    this.map.setVehicle(vehicle);
    this.map.jump(center, zoom, REPLAY_PITCH);
    this.onFrame?.({
      pos: this.pos,
      total: this.total,
      clock: `${fmtDate(utc, offset, true)} ${fmtTime(utc, offset)}`,
      item,
    });
    if (item.kind === 'stop') this.positionCard(item.stop.center);
  }

  showCard(stop, photoIndex) {
    const card = this.card;
    const photo = stop.photos[photoIndex];
    if (card.dataset.photo !== photo.id) {
      card.dataset.photo = photo.id;
      card.querySelector('img').src = this.photoUrl(photo);
      card.querySelector('.pc-name').textContent = stop.name || t('stopN', { n: stop.index + 1 });
      card.querySelector('.pc-time').textContent = `${fmtDate(photo.time, photo.offset)} · ${fmtTime(photo.time, photo.offset)}`;
      card.querySelector('.pc-count').textContent = stop.photos.length > 1 ? t('photoOf', { i: photoIndex + 1, n: stop.photos.length }) : '';
      card.classList.remove('is-in');
      void card.offsetWidth;
      card.classList.add('is-in');
    }
    card.hidden = false;
  }

  positionCard(center) {
    const p = this.map.project(center);
    const card = this.card;
    const w = card.offsetWidth || 220;
    const h = card.offsetHeight || 200;
    const host = card.parentElement.getBoundingClientRect();
    const x = Math.max(12, Math.min(host.width - w - 12, p.x - w / 2));
    const y = Math.max(12, p.y - h - 34);
    card.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
  }
}
