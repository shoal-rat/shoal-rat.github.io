/* Timeline: overview, ruler, filmstrip with trim window and key-photo
   marker, soundtrack lane, playhead. Positions are recomputed from the edit
   document on every change; drags mutate the store live and commit on
   release so each gesture is one undo step. */

import { el, clamp, fmtTime, debounce } from './util.js';
import { MAX_TRIM } from './state.js';
import { passInfo } from './player.js';
import { drawWave } from './audio.js';
import { drawCover } from './media.js';

const PAD = 18;
const MIN_TRIM = 0.3;
const VIEW_LIMIT = 12;

export class Timeline {
  constructor(root, app) {
    this.root = root;
    this.app = app;
    this.thumbs = new Map();
    this.thumbToken = 0;
    this.view = [0, 1];
    this.build();
    this.redrawFilm = debounce(() => this.drawFilm(), 90);
    new ResizeObserver(() => { this.layout(); this.redrawFilm(); }).observe(this.body);
  }

  build() {
    this.playBtn = el('button', { class: 'tl-play', type: 'button', 'aria-label': 'Play', title: 'Play / pause (Space)' });
    this.timeLabel = el('span', { class: 'tl-time' }, '0:00.0');
    this.lenLabel = el('span', { class: 'tl-len' });
    this.keyBtn = el('button', { class: 'tl-keybtn', type: 'button', title: 'Make the frame under the playhead the key photo (K)' },
      el('span', { class: 'tl-diamond', 'aria-hidden': 'true' }), 'Set key photo');
    this.hint = el('span', { class: 'tl-hint' });
    const head = el('div', { class: 'tl-head' },
      el('div', { class: 'tl-transport' }, this.playBtn, this.timeLabel, this.lenLabel),
      this.hint,
      this.keyBtn);

    this.ovWindow = el('div', { class: 'tl-ov-window', title: 'Drag to look along the clip' });
    this.ovTrim = el('div', { class: 'tl-ov-trim' });
    this.ovHead = el('div', { class: 'tl-ov-head' });
    this.overview = el('div', { class: 'tl-overview' }, this.ovTrim, this.ovWindow, this.ovHead);

    this.ruler = el('canvas', { class: 'tl-ruler' });
    this.film = el('canvas', { class: 'tl-film' });
    this.shadeL = el('div', { class: 'tl-shade' });
    this.shadeR = el('div', { class: 'tl-shade' });
    this.gripIn = el('span', { class: 'tl-grip in', 'data-role': 'in', title: 'Trim start (I)' });
    this.gripOut = el('span', { class: 'tl-grip out', 'data-role': 'out', title: 'Trim end (O)' });
    this.trimLen = el('span', { class: 'tl-trim-len' });
    this.trim = el('div', { class: 'tl-trim', 'data-role': 'window' }, this.gripIn, this.gripOut, this.trimLen);
    this.keyMarker = el('button', { class: 'tl-key', type: 'button', 'data-role': 'key', title: 'Key photo — drag to change' });
    this.video = el('div', { class: 'tl-video', 'data-role': 'lane' }, this.film, this.shadeL, this.shadeR, this.trim, this.keyMarker);

    this.trackWave = el('canvas', { class: 'tl-track-wave' });
    this.trackName = el('span', { class: 'tl-track-name' });
    this.trackBlock = el('div', { class: 'tl-track', 'data-role': 'track' },
      this.trackWave, this.trackName,
      el('span', { class: 'tl-tgrip in', 'data-role': 'track-in' }),
      el('span', { class: 'tl-tgrip out', 'data-role': 'track-out' }));
    this.trackClip = el('div', { class: 'tl-track-clip' }, this.trackBlock);
    this.origWave = el('canvas', { class: 'tl-orig-wave' });
    this.addTrack = el('button', { class: 'tl-add', type: 'button' }, '+ Add a soundtrack');
    this.audio = el('div', { class: 'tl-audio' }, this.origWave, this.trackClip, this.addTrack);

    this.playhead = el('div', { class: 'tl-playhead', 'data-role': 'playhead' }, el('span'));
    this.body = el('div', { class: 'tl-body' }, this.ruler, this.video, this.audio, this.playhead);

    this.root.append(head, this.overview, this.body);

    this.playBtn.addEventListener('click', () => this.app.togglePlay());
    this.keyBtn.addEventListener('click', () => this.app.setKeyPhoto());
    this.addTrack.addEventListener('click', () => this.app.openPanel('audio'));
    this.body.addEventListener('pointerdown', (e) => this.onPointer(e));
    this.overview.addEventListener('pointerdown', (e) => this.onOverview(e));
  }

  /* ------------------------------------------------------------ geometry */

  get edit() { return this.app.store.edit; }
  get source() { return this.app.source; }

  width() { return this.body.clientWidth; }
  x(t) { const [v0, v1] = this.view; return PAD + ((t - v0) / (v1 - v0)) * (this.width() - PAD * 2); }
  t(x) { const [v0, v1] = this.view; return v0 + ((x - PAD) / (this.width() - PAD * 2)) * (v1 - v0); }

  fitView(force = false) {
    const source = this.source;
    if (!source) return;
    const dur = source.duration;
    if (dur <= VIEW_LIMIT) { this.view = [0, dur]; return; }
    const { in: a, out: b } = this.edit.trim;
    const span = Math.min(dur, Math.max(8, (b - a) * 3));
    const [v0, v1] = this.view;
    if (!force && v1 - v0 === span && a >= v0 && b <= v1) return;
    const center = (a + b) / 2;
    const start = clamp(center - span / 2, 0, dur - span);
    this.view = [start, start + span];
    this.redrawFilm();
  }

  load() {
    this.thumbs.forEach((bmp) => bmp.close?.());
    this.thumbs.clear();
    this.view = [0, this.source.duration];
    this.fitView(true);
    this.overview.hidden = this.source.duration <= VIEW_LIMIT;
    this.layout();
    this.drawFilm();
  }

  /* --------------------------------------------------------------- draw */

  layout() {
    const source = this.source;
    const edit = this.edit;
    if (!source || !edit) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = this.width();
    const { in: a, out: b } = edit.trim;
    const xa = this.x(a);
    const xb = this.x(b);

    this.shadeL.style.cssText = `left:0;width:${Math.max(0, xa)}px`;
    this.shadeR.style.cssText = `left:${xb}px;right:0`;
    this.trim.style.left = `${xa}px`;
    this.trim.style.width = `${Math.max(0, xb - xa)}px`;
    this.trimLen.textContent = fmtTime(b - a);
    const k = this.x(edit.keyTime);
    this.keyMarker.style.left = `${k}px`;
    this.keyMarker.hidden = edit.effect === 'longexposure';

    // overview
    if (!this.overview.hidden) {
      const ow = this.overview.clientWidth;
      const f = (t) => (t / source.duration) * ow;
      this.ovWindow.style.left = `${f(this.view[0])}px`;
      this.ovWindow.style.width = `${f(this.view[1]) - f(this.view[0])}px`;
      this.ovTrim.style.left = `${f(a)}px`;
      this.ovTrim.style.width = `${Math.max(2, f(b) - f(a))}px`;
    }

    // ruler
    const rh = 18;
    this.ruler.width = w * dpr;
    this.ruler.height = rh * dpr;
    const rc = this.ruler.getContext('2d');
    rc.scale(dpr, dpr);
    rc.clearRect(0, 0, w, rh);
    const pps = (w - PAD * 2) / (this.view[1] - this.view[0]);
    const steps = [0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60];
    const step = steps.find((s) => s * pps >= 64) || 60;
    const minor = step / (step >= 1 ? 4 : 5);
    const style = getComputedStyle(this.root);
    rc.fillStyle = style.getPropertyValue('--tl-muted') || '#8a90a0';
    rc.font = '10px ui-monospace, SFMono-Regular, Menlo, monospace';
    for (let t = Math.ceil(this.view[0] / minor) * minor; t <= this.view[1] + 1e-6; t += minor) {
      const x = this.x(t);
      const major = Math.abs(t / step - Math.round(t / step)) < 1e-6;
      rc.fillRect(Math.round(x), major ? 10 : 14, 1, major ? 8 : 4);
      if (major) rc.fillText(fmtTime(t, step < 1 ? 1 : 0), x + 3, 9);
    }

    // soundtrack lane
    const P = passInfo(edit).length;
    const track = edit.audio.track;
    const buffer = this.app.audio.trackBuffer;
    this.trackClip.style.left = `${xa}px`;
    this.trackClip.style.width = `${Math.max(0, xb - xa)}px`;
    this.addTrack.hidden = !!track;
    this.trackClip.hidden = !track;
    if (track && buffer && P > 0) {
      const lanePx = xb - xa;
      const len = track.trimOut - track.trimIn;
      const left = (track.offset / P) * lanePx;
      const width = (len / P) * lanePx;
      this.trackBlock.style.left = `${left}px`;
      this.trackBlock.style.width = `${Math.max(12, width)}px`;
      this.trackName.textContent = track.name;
      const cw = Math.max(12, Math.round(width * dpr));
      const ch = Math.round(30 * dpr);
      const waveKey = `${cw}|${track.trimIn.toFixed(3)}|${track.trimOut.toFixed(3)}|${track.id}`;
      if (this.waveKey !== waveKey) {
        this.waveKey = waveKey;
        this.trackWave.width = cw;
        this.trackWave.height = ch;
        drawWave(this.trackWave, buffer, track.trimIn, track.trimOut, 'rgba(255,255,255,0.85)');
      }
    }
    // faint original-audio waveform under the lane
    const original = this.app.audio.originalBuffer;
    const owKey = `${w}|${this.view[0]}|${this.view[1]}|${!!original}`;
    if (this.owKey !== owKey) {
      this.owKey = owKey;
      this.origWave.width = w * dpr;
      this.origWave.height = 30 * dpr;
      const color = style.getPropertyValue('--tl-wave') || 'rgba(120,130,150,0.35)';
      if (original) {
        const t0 = Math.max(0, this.t(0));
        const t1 = Math.min(original.duration, this.t(w));
        drawWave(this.origWave, original, t0, t1, color);
      } else {
        this.origWave.getContext('2d').clearRect(0, 0, this.origWave.width, this.origWave.height);
      }
    }

    this.lenLabel.textContent = edit.effect === 'longexposure'
      ? ' · long exposure'
      : ` / ${fmtTime(P)}${edit.speed !== 1 ? ` · ${edit.speed}×` : ''}`;
    this.hint.textContent = this.hintText();
  }

  hintText() {
    const edit = this.edit;
    const source = this.source;
    if (!source) return '';
    if (edit.trim.out - edit.trim.in >= MAX_TRIM - 0.05) return `Live Photos are short — ${MAX_TRIM}s is the longest trim.`;
    if (source.duration > 4 && edit.trim.out - edit.trim.in <= 3.05 && edit.trim.in === 0) return 'Drag the yellow window to choose your moment.';
    return '';
  }

  setPlayhead(t, playing) {
    const x = this.x(t);
    this.playhead.style.transform = `translateX(${x}px)`;
    this.playhead.hidden = this.edit?.effect === 'longexposure';
    this.timeLabel.textContent = fmtTime(Math.max(0, t - (this.edit?.trim.in || 0)));
    if (!this.overview.hidden && this.source) {
      this.ovHead.style.left = `${(t / this.source.duration) * this.overview.clientWidth}px`;
    }
    if (playing !== this.lastPlaying) {
      this.lastPlaying = playing;
      this.playBtn.classList.toggle('is-playing', playing);
      this.playBtn.setAttribute('aria-label', playing ? 'Pause' : 'Play');
    }
  }

  async drawFilm() {
    const source = this.source;
    if (!source) return;
    const token = ++this.thumbToken;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = this.width();
    const h = 58;
    this.film.width = Math.round(w * dpr);
    this.film.height = Math.round(h * dpr);
    const ctx = this.film.getContext('2d');
    ctx.fillStyle = '#1b1e25';
    ctx.fillRect(0, 0, this.film.width, this.film.height);
    const aspect = clamp(source.width / source.height, 0.5, 2);
    const cellW = h * aspect * dpr;
    const x0 = this.x(this.view[0]) * dpr;
    const x1 = this.x(this.view[1]) * dpr;
    const count = Math.max(1, Math.ceil((x1 - x0) / cellW));
    const realW = (x1 - x0) / count;
    const tasks = [];
    for (let i = 0; i < count; i += 1) {
      const t = this.view[0] + ((i + 0.5) / count) * (this.view[1] - this.view[0]);
      tasks.push({ i, t: Math.round(t * 25) / 25 });
    }
    for (const task of tasks) {
      if (token !== this.thumbToken) return;
      let bmp = this.thumbs.get(task.t);
      if (!bmp) {
        let drawable;
        try { drawable = await source.frameAt(task.t); } catch (_) { continue; }
        if (token !== this.thumbToken) return;
        const c = document.createElement('canvas');
        c.width = Math.round(realW);
        c.height = this.film.height;
        drawCover(c.getContext('2d'), drawable, c.width, c.height);
        bmp = c;
        this.thumbs.set(task.t, bmp);
      }
      ctx.drawImage(bmp, x0 + task.i * realW, 0, realW + 0.5, this.film.height);
    }
  }

  /* ---------------------------------------------------------- pointers */

  onPointer(event) {
    if (!this.source || event.button > 0) return;
    const edit = this.edit;
    const role = event.target.closest('[data-role]')?.dataset.role || 'lane';
    const rect = this.body.getBoundingClientRect();
    const startX = event.clientX;
    const snapshot = JSON.parse(JSON.stringify(edit));
    const store = this.app.store;
    const dur = this.source.duration;
    const P = passInfo(edit).length;
    const lanePx = this.x(edit.trim.out) - this.x(edit.trim.in);
    const toTime = (clientX) => this.t(clientX - rect.left);
    event.preventDefault();
    this.body.setPointerCapture(event.pointerId);
    this.root.classList.add('is-dragging');

    let move;
    if (role === 'in' || role === 'out') {
      move = (e) => {
        const t = clamp(toTime(e.clientX), 0, dur);
        store.update((d) => {
          if (role === 'in') {
            d.trim.in = clamp(t, Math.max(0, d.trim.out - MAX_TRIM), d.trim.out - MIN_TRIM);
          } else {
            d.trim.out = clamp(t, d.trim.in + MIN_TRIM, Math.min(dur, d.trim.in + MAX_TRIM));
          }
          d.keyTime = clamp(d.keyTime, d.trim.in, d.trim.out);
        }, 'trim');
        this.app.player.scrub(role === 'in' ? store.edit.trim.in : store.edit.trim.out);
      };
    } else if (role === 'window') {
      move = (e) => {
        const dt = this.t(e.clientX - rect.left) - this.t(startX - rect.left);
        const len = snapshot.trim.out - snapshot.trim.in;
        const a = clamp(snapshot.trim.in + dt, 0, dur - len);
        store.update((d) => {
          d.trim.in = a;
          d.trim.out = a + len;
          d.keyTime = clamp(snapshot.keyTime + (a - snapshot.trim.in), a, a + len);
        }, 'trim');
        this.app.player.scrub(a);
      };
    } else if (role === 'key') {
      move = (e) => {
        const t = clamp(toTime(e.clientX), edit.trim.in, edit.trim.out);
        store.update((d) => { d.keyTime = t; }, 'key');
        this.app.player.scrub(t);
      };
    } else if (role === 'track' || role === 'track-in' || role === 'track-out') {
      const buffer = this.app.audio.trackBuffer;
      move = (e) => {
        const dOut = ((e.clientX - startX) / lanePx) * P;
        store.update((d) => {
          const tr = d.audio.track;
          const s = snapshot.audio.track;
          if (!tr || !s) return;
          if (role === 'track') {
            tr.offset = clamp(s.offset + dOut, 0, Math.max(0, P - 0.1));
          } else if (role === 'track-in') {
            const delta = clamp(dOut, -Math.min(s.offset, s.trimIn), s.trimOut - s.trimIn - 0.25);
            tr.trimIn = s.trimIn + delta;
            tr.offset = s.offset + delta;
          } else {
            tr.trimOut = clamp(s.trimOut + dOut, s.trimIn + 0.25, buffer ? buffer.duration : s.trimOut);
          }
        }, 'track');
      };
    } else {
      // scrub along the lane / ruler / playhead
      move = (e) => {
        const t = clamp(toTime(e.clientX), 0, dur);
        this.app.seek(t);
      };
      move(event);
    }

    const up = (e) => {
      this.body.removeEventListener('pointermove', move);
      this.body.removeEventListener('pointerup', up);
      this.body.removeEventListener('pointercancel', up);
      this.root.classList.remove('is-dragging');
      this.app.player.scrub(null);
      const reason = { in: 'trim', out: 'trim', window: 'trim', key: 'key' }[role] || (role.startsWith('track') ? 'track' : null);
      if (reason) {
        store.commit(reason);
        if (reason === 'trim') { this.fitView(); this.app.afterTrim(); }
        if (reason === 'key') this.app.seek(store.edit.keyTime);
      }
      if (Math.abs(e.clientX - startX) < 3 && role === 'key') this.app.seek(edit.keyTime);
    };
    this.body.addEventListener('pointermove', move);
    this.body.addEventListener('pointerup', up);
    this.body.addEventListener('pointercancel', up);
  }

  onOverview(event) {
    const source = this.source;
    if (!source || this.overview.hidden) return;
    const rect = this.overview.getBoundingClientRect();
    const span = this.view[1] - this.view[0];
    const place = (clientX) => {
      const t = ((clientX - rect.left) / rect.width) * source.duration;
      const start = clamp(t - span / 2, 0, source.duration - span);
      this.view = [start, start + span];
      this.layout();
      this.redrawFilm();
    };
    place(event.clientX);
    this.overview.setPointerCapture(event.pointerId);
    const move = (e) => place(e.clientX);
    const up = () => {
      this.overview.removeEventListener('pointermove', move);
      this.overview.removeEventListener('pointerup', up);
    };
    this.overview.addEventListener('pointermove', move);
    this.overview.addEventListener('pointerup', up);
  }
}
