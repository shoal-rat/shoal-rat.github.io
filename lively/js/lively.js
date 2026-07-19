/* Lively for Web — a browser edition of the Lively iPhone app.
   Plain DOM + Canvas + Web Audio. No frameworks, no uploads: every clip and
   soundtrack stays on the visitor's device.

   Architecture mirrors the iOS app loosely:
     - state            = the "EditState" document
     - Source           = sample painter or an uploaded <video>
     - Player           = rAF render loop + trim looping + loop-pass events
     - AudioEngine      = original/track gain graph + per-pass scheduling
     - Exporter         = canvas.captureStream + MediaRecorder bake
*/
(() => {
'use strict';

const $ = (id) => document.getElementById(id);
const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);
const fmt = (s) => {
  const tenths = Math.max(0, Math.round(s * 10));
  return `${Math.floor(tenths / 600)}:${String(Math.floor(tenths / 10) % 60).padStart(2, '0')}.${tenths % 10}`;
};

/* ------------------------------------------------------------------ state */

const IDENTITY_ADJUST = {
  exposure: 0, brightness: 0, contrast: 0, saturation: 0,
  vibrance: 0, warmth: 0, vignette: 0, sharpness: 0,
};

const state = {
  source: null,
  playing: false,
  trim: { start: 0, end: 3 },
  filter: 'original',
  intensity: 1,
  adjust: { ...IDENTITY_ADJUST },
  originalVol: 1,
  muted: false,
  track: null,           // { buffer, title, trimStart, trimEnd, offset, volume, fadeIn, fadeOut }
  tool: 'filters',
  exporting: false,
};

/* ---------------------------------------------------------------- filters */

// Parametric looks; intensity interpolates every parameter toward identity.
const PRESETS = {
  original: { name: 'Original', p: {} },
  vivid:    { name: 'Vivid',    p: { sat: 1.25, con: 1.10, bri: 1.02 } },
  golden:   { name: 'Golden',   p: { sep: 0.25, sat: 1.12, bri: 1.06, hue: -6 } },
  coastal:  { name: 'Coastal',  p: { hue: 8, sat: 1.08, bri: 1.04, con: 1.02 } },
  fade:     { name: 'Fade',     p: { con: 0.88, sat: 0.82, bri: 1.08 } },
  matte:    { name: 'Matte',    p: { con: 0.90, sat: 0.85, bri: 1.04, sep: 0.08 } },
  dusk:     { name: 'Dusk',     p: { hue: 12, sat: 0.95, con: 1.10, bri: 0.94, sep: 0.10 } },
  pop:      { name: 'Pop',      p: { sat: 1.45, con: 1.14 } },
  sepia:    { name: 'Sepia',    p: { sep: 0.85, con: 1.02 } },
  chrome:   { name: 'Chrome',   p: { sat: 1.20, con: 1.16, bri: 1.06 } },
  mono:     { name: 'Mono',     p: { gray: 1, con: 1.02 } },
  noir:     { name: 'Noir',     p: { gray: 1, con: 1.35, bri: 0.95 } },
};
const PRESET_IDENTITY = { bri: 1, con: 1, sat: 1, sep: 0, gray: 0, hue: 0 };
const MONO_PRESETS = new Set(['mono', 'noir']);

function presetParams(key, t) {
  const target = { ...PRESET_IDENTITY, ...(PRESETS[key]?.p || {}) };
  const out = {};
  for (const k of Object.keys(PRESET_IDENTITY)) {
    out[k] = PRESET_IDENTITY[k] + (target[k] - PRESET_IDENTITY[k]) * t;
  }
  return out;
}

// Full pipeline -> one CSS/canvas filter string.
function filterString(filterKey, intensity, adj) {
  const p = presetParams(filterKey, filterKey === 'original' ? 0 : intensity);
  const bri = p.bri * (1 + adj.exposure * 0.45 + adj.brightness * 0.25);
  const con = p.con * (1 + adj.contrast * 0.35 + adj.sharpness * 0.06);
  const sat = p.sat * (1 + adj.saturation) * (1 + adj.vibrance * 0.5);
  let sep = p.sep;
  let hue = p.hue;
  if (adj.warmth > 0) sep = clamp(sep + adj.warmth * 0.28, 0, 1);
  else hue += adj.warmth * 10;
  const parts = [
    `brightness(${bri.toFixed(3)})`,
    `contrast(${con.toFixed(3)})`,
    `saturate(${Math.max(0, sat).toFixed(3)})`,
  ];
  if (sep > 0.001) parts.push(`sepia(${sep.toFixed(3)})`);
  if (p.gray > 0.001) parts.push(`grayscale(${p.gray.toFixed(3)})`);
  if (Math.abs(hue) > 0.05) parts.push(`hue-rotate(${hue.toFixed(1)}deg)`);
  return parts.join(' ');
}

/* ---------------------------------------------------------------- sample */

// Procedural flat sunset scene, seamless 3 s loop. Doubles as the app-icon
// aesthetic: flat bands, amber sun, ocean/mint mountains, drifting clouds.
const SAMPLE_DURATION = 3.0;

function drawSample(ctx, w, h, t) {
  const T = SAMPLE_DURATION;
  const ph = t / T; // 0..1
  // sky bands
  const bands = ['#FFE3B8', '#FFD59E', '#FFC489', '#FFB37B'];
  bands.forEach((c, i) => {
    ctx.fillStyle = c;
    ctx.fillRect(0, h * 0.16 * i, w, h * 0.16 + 1);
  });
  // sun
  const sunY = h * 0.30 + Math.sin(ph * 2 * Math.PI) * h * 0.02;
  ctx.fillStyle = '#FFB84C';
  ctx.beginPath(); ctx.arc(w * 0.62, sunY, w * 0.10, 0, 7); ctx.fill();
  // clouds (wrap horizontally)
  ctx.fillStyle = 'rgba(255,255,255,0.92)';
  const cloud = (cx, cy, s) => {
    const r = w * 0.024 * s;
    ctx.beginPath();
    ctx.roundRect(cx - r * 3, cy - r, r * 6, r * 2, r);
    ctx.fill();
    ctx.beginPath();
    ctx.roundRect(cx - r * 1.6, cy - r * 1.9, r * 3.2, r * 2, r);
    ctx.fill();
  };
  const wrap = (x, m) => ((x % (w + m)) + w + m) % (w + m) - m;
  cloud(wrap(w * 0.2 + ph * w * 0.55, w * 0.2), h * 0.14, 1.15);
  cloud(wrap(w * 0.75 + ph * w * 0.35, w * 0.2), h * 0.24, 0.85);
  cloud(wrap(w * 0.45 + ph * w * 0.45, w * 0.2), h * 0.07, 0.7);
  // birds: two chevrons gliding
  ctx.strokeStyle = '#4A3A28'; ctx.lineWidth = w * 0.006; ctx.lineCap = 'round';
  const bird = (bx, by, s) => {
    const r = w * 0.018 * s;
    const flap = Math.sin(ph * 2 * Math.PI * 3) * r * 0.5;
    ctx.beginPath();
    ctx.moveTo(bx - r, by + flap); ctx.lineTo(bx, by); ctx.lineTo(bx + r, by + flap);
    ctx.stroke();
  };
  bird(wrap(w * 0.1 + ph * w * 1.0, w * 0.3), h * 0.18, 1);
  bird(wrap(w * 0.0 + ph * w * 1.0, w * 0.3) + w * 0.12, h * 0.215, 0.75);
  // mountains
  const tri = (x1, x2, peak, yTop, color) => {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(x1, h * 0.78); ctx.lineTo(peak, yTop); ctx.lineTo(x2, h * 0.78);
    ctx.closePath(); ctx.fill();
  };
  tri(w * 0.05, w * 0.95, w * 0.5, h * 0.30, '#3D7DFF');
  tri(-w * 0.12, w * 0.62, w * 0.24, h * 0.46, '#2ECC9B');
  tri(w * 0.42, w * 1.12, w * 0.80, h * 0.50, '#27B98C');
  // water
  ctx.fillStyle = '#173056';
  ctx.fillRect(0, h * 0.78, w, h * 0.22);
  ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = w * 0.008;
  for (let i = 0; i < 3; i++) {
    const y = h * (0.84 + i * 0.05);
    const off = wrap(ph * w * (0.25 + i * 0.1) + i * w * 0.3, w * 0.3);
    ctx.beginPath(); ctx.moveTo(off - w * 0.10, y); ctx.lineTo(off + w * 0.10, y); ctx.stroke();
  }
}

/* ------------------------------------------------------------ audio engine */

const audio = {
  ctx: null, master: null, originalGain: null, trackEnv: null, trackVol: null,
  msDest: null, padNodes: null, trackSource: null,

  ensure() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.originalGain = this.ctx.createGain();
    this.trackEnv = this.ctx.createGain();   // fade automation
    this.trackVol = this.ctx.createGain();   // live volume slider
    this.originalGain.connect(this.master);
    this.trackEnv.connect(this.trackVol).connect(this.master);
    this.master.connect(this.ctx.destination);
    this.msDest = this.ctx.createMediaStreamDestination();
    this.master.connect(this.msDest);
  },

  syncOriginal() {
    if (!this.ctx) return;
    this.originalGain.gain.value = state.muted ? 0 : state.originalVol;
  },

  // Schedules the soundtrack for one loop pass beginning "now".
  scheduleTrackPass(passDuration) {
    if (!this.ctx) return;
    this.stopTrack();
    const tr = state.track;
    if (!tr) return;
    const audible = Math.min(tr.trimEnd - tr.trimStart, passDuration - tr.offset);
    if (audible <= 0.02) return;
    const t0 = this.ctx.currentTime + Math.max(0, tr.offset);
    const src = this.ctx.createBufferSource();
    src.buffer = tr.buffer;
    src.connect(this.trackEnv);
    const g = this.trackEnv.gain;
    g.cancelScheduledValues(this.ctx.currentTime);
    let fi = Math.max(0, Math.min(tr.fadeIn, audible / 2));
    let fo = Math.max(0, Math.min(tr.fadeOut, audible / 2));
    g.setValueAtTime(fi > 0.01 ? 0.0001 : 1, t0);
    if (fi > 0.01) g.linearRampToValueAtTime(1, t0 + fi);
    if (fo > 0.01) {
      g.setValueAtTime(1, t0 + audible - fo);
      g.linearRampToValueAtTime(0.0001, t0 + audible);
    }
    this.trackVol.gain.value = tr.volume;
    src.start(t0, tr.trimStart, audible);
    this.trackSource = src;
  },

  stopTrack() {
    if (this.trackSource) { try { this.trackSource.stop(); } catch (_) {} }
    this.trackSource = null;
    if (this.ctx) this.trackEnv.gain.cancelScheduledValues(this.ctx.currentTime);
  },

  // Soft ambient pad + loop-timed chirps for the sample scene.
  startPad() {
    if (!this.ctx || this.padNodes) return;
    const g = this.ctx.createGain(); g.gain.value = 0.05;
    const lp = this.ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 900;
    const o1 = this.ctx.createOscillator(); o1.frequency.value = 220;
    const o2 = this.ctx.createOscillator(); o2.frequency.value = 277.18;
    o1.connect(g); o2.connect(g); g.connect(lp).connect(this.originalGain);
    o1.start(); o2.start();
    this.padNodes = { o1, o2, g, lp };
  },
  stopPad() {
    if (!this.padNodes) return;
    try { this.padNodes.o1.stop(); this.padNodes.o2.stop(); } catch (_) {}
    this.padNodes = null;
  },
  chirpPass() {
    if (!this.ctx || !this.padNodes) return;
    for (const at of [0.6, 1.9]) {
      const t = this.ctx.currentTime + at;
      const o = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      o.frequency.setValueAtTime(1800, t);
      o.frequency.exponentialRampToValueAtTime(1350, t + 0.12);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.09, t + 0.03);
      g.gain.linearRampToValueAtTime(0.0001, t + 0.14);
      o.connect(g).connect(this.originalGain);
      o.start(t); o.stop(t + 0.16);
    }
  },
};

/* ---------------------------------------------------------------- sources */

function makeSampleSource() {
  return {
    kind: 'sample',
    duration: SAMPLE_DURATION,
    hasAudio: true,
    width: 720, height: 960,
    _t: 0, _wall: 0,
    begin(atTime) { this._t = atTime; this._wall = performance.now(); audio.startPad(); },
    halt() { audio.stopPad(); },
    tick() { // returns current clip time
      return this._t + (performance.now() - this._wall) / 1000;
    },
    seekLoop(t) { this._t = t; this._wall = performance.now(); },
    draw(ctx, w, h, t) { drawSample(ctx, w, h, t % SAMPLE_DURATION); },
    frameAt(t, cb) { cb((ctx, w, h) => drawSample(ctx, w, h, t)); },
  };
}

function makeVideoSource(file, onReady, onFail) {
  const url = URL.createObjectURL(file);
  const el = document.createElement('video');
  el.muted = false; el.playsInline = true; el.preload = 'auto';
  el.crossOrigin = 'anonymous';
  el.src = url;
  const src = {
    kind: 'video',
    el, url,
    duration: 0,
    hasAudio: true,
    width: 720, height: 960,
    _mes: null,
    begin() {
      audio.ensure();
      if (!this._mes) {
        this._mes = audio.ctx.createMediaElementSource(el);
        this._mes.connect(audio.originalGain);
      }
      el.play().catch(() => {});
    },
    halt() { el.pause(); },
    tick() { return el.currentTime; },
    seekLoop(t) { el.currentTime = t; },
    draw(ctx, w, h, _t) {
      const vw = el.videoWidth || 1, vh = el.videoHeight || 1;
      const s = Math.min(w / vw, h / vh);
      const dw = vw * s, dh = vh * s;
      ctx.fillStyle = '#0A0C0F'; ctx.fillRect(0, 0, w, h);
      ctx.drawImage(el, (w - dw) / 2, (h - dh) / 2, dw, dh);
    },
    frameAt(t, cb) { // async thumbnail painter via a muted clone
      const clone = document.createElement('video');
      clone.muted = true; clone.playsInline = true; clone.src = url;
      clone.addEventListener('loadedmetadata', () => { clone.currentTime = clamp(t, 0, clone.duration - 0.05); });
      clone.addEventListener('seeked', () => {
        cb((ctx, w, h) => {
          const vw = clone.videoWidth || 1, vh = clone.videoHeight || 1;
          const s = Math.max(w / vw, h / vh);
          ctx.drawImage(clone, (w - vw * s) / 2, (h - vh * s) / 2, vw * s, vh * s);
        });
      }, { once: true });
      clone.addEventListener('error', () => cb(null), { once: true });
    },
  };
  el.addEventListener('loadedmetadata', () => {
    src.duration = el.duration;
    if (el.videoWidth) { src.width = el.videoWidth; src.height = el.videoHeight; }
    onReady(src);
  }, { once: true });
  el.addEventListener('error', () => { URL.revokeObjectURL(url); onFail(); }, { once: true });
  // best-effort audio-track sniff once playback begins
  el.addEventListener('playing', () => {
    setTimeout(() => {
      if (typeof el.webkitAudioDecodedByteCount === 'number') {
        src.hasAudio = el.webkitAudioDecodedByteCount > 0;
      } else if (typeof el.mozHasAudio === 'boolean') {
        src.hasAudio = el.mozHasAudio;
      }
      ui.syncAudioPane();
    }, 400);
  }, { once: true });
  return src;
}

/* ----------------------------------------------------------------- player */

const stage = $('stage');
const stageCtx = stage.getContext('2d');

const player = {
  raf: 0,

  start() {
    if (!state.source) return;
    audio.ensure();
    audio.ctx.resume();
    state.playing = true;
    const s = state.source;
    s.seekLoop(state.trim.start);
    s.begin(state.trim.start);
    this.loopPass();
    this.tickLoop();
    ui.syncPlayButton();
  },

  pause() {
    state.playing = false;
    state.source?.halt();
    audio.stopTrack();
    ui.syncPlayButton();
  },

  resume() { this.start(); },

  loopPass() {
    const dur = state.trim.end - state.trim.start;
    audio.scheduleTrackPass(dur);
    if (state.source?.kind === 'sample') audio.chirpPass();
    exporter.onLoopPass();
  },

  tickLoop() {
    cancelAnimationFrame(this.raf);
    const step = () => {
      const s = state.source;
      if (!s) return;
      let t = s.tick();
      if (state.playing && t >= state.trim.end - 0.03) {
        s.seekLoop(state.trim.start);
        t = state.trim.start;
        this.loopPass();
      }
      s.draw(stageCtx, stage.width, stage.height, t);
      ui.playhead.textContent = fmt(Math.max(0, t - state.trim.start));
      exporter.drawFrame(t);
      this.raf = requestAnimationFrame(step);
    };
    this.raf = requestAnimationFrame(step);
  },

  teardown() {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    state.playing = false;
    if (state.source) {
      state.source.halt();
      if (state.source.url) URL.revokeObjectURL(state.source.url);
    }
    audio.stopTrack();
    audio.stopPad();
    state.source = null;
  },
};

/* --------------------------------------------------------------- exporter */

const exporter = {
  supported: (() => {
    try {
      const c = document.createElement('canvas').getContext('2d');
      if (!('filter' in c)) return false;
      return typeof MediaRecorder !== 'undefined' && !!HTMLCanvasElement.prototype.captureStream;
    } catch (_) { return false; }
  })(),
  active: false, canvas: null, ctx: null, recorder: null, chunks: [],
  startedAt: 0, waitingForPass: false, timer: 0,

  mime() {
    const prefs = [
      'video/mp4;codecs=avc1', 'video/mp4',
      'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm',
    ];
    return prefs.find((m) => MediaRecorder.isTypeSupported(m)) || '';
  },

  begin() {
    if (!this.supported || this.active || !state.source) return;
    audio.ensure();
    const s = state.source;
    this.canvas = document.createElement('canvas');
    this.canvas.width = s.width % 2 ? s.width + 1 : s.width;
    this.canvas.height = s.height % 2 ? s.height + 1 : s.height;
    this.ctx = this.canvas.getContext('2d');
    this.chunks = [];
    const stream = this.canvas.captureStream(30);
    audio.msDest.stream.getAudioTracks().forEach((t) => stream.addTrack(t));
    const type = this.mime();
    this.recorder = new MediaRecorder(stream, type ? { mimeType: type, videoBitsPerSecond: 8_000_000 } : undefined);
    this.recorder.ondataavailable = (e) => { if (e.data.size) this.chunks.push(e.data); };
    this.recorder.onstop = () => this.finish();
    this.active = true;
    this.waitingForPass = true;   // start recording at the next loop boundary
    state.exporting = true;
    ui.syncExport('busy', 'Waiting for the loop to restart…');
    if (!state.playing) player.start();
  },

  onLoopPass() {
    if (!this.active || !this.waitingForPass) return;
    this.waitingForPass = false;
    this.recorder.start(200);
    this.startedAt = performance.now();
    const dur = (state.trim.end - state.trim.start) * 1000;
    ui.syncExport('busy', 'Rendering one pass…');
    this.timer = setInterval(() => {
      const p = clamp((performance.now() - this.startedAt) / dur, 0, 1);
      ui.exportBar.style.width = `${(p * 100).toFixed(1)}%`;
      if (p >= 1) { clearInterval(this.timer); this.recorder.stop(); }
    }, 100);
  },

  drawFrame(t) {
    if (!this.active || this.waitingForPass || !this.ctx) return;
    const c = this.ctx, w = this.canvas.width, h = this.canvas.height;
    c.save();
    c.filter = filterString(state.filter, state.intensity, state.adjust);
    state.source.draw(c, w, h, t);
    c.restore();
    const v = state.adjust.vignette;
    if (v > 0.01) {
      const g = c.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.42, w / 2, h / 2, Math.max(w, h) * 0.72);
      g.addColorStop(0, 'rgba(0,0,0,0)');
      g.addColorStop(1, `rgba(0,0,0,${(v * 0.72).toFixed(3)})`);
      c.fillStyle = g;
      c.fillRect(0, 0, w, h);
    }
  },

  finish() {
    clearInterval(this.timer);
    const type = this.recorder?.mimeType || 'video/webm';
    const blob = new Blob(this.chunks, { type });
    const ext = type.includes('mp4') ? 'mp4' : 'webm';
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `Lively-export.${ext}`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    this.active = false;
    state.exporting = false;
    this.canvas = null; this.ctx = null; this.recorder = null; this.chunks = [];
    ui.syncExport('done');
  },

  cancel() {
    if (!this.active) return;
    clearInterval(this.timer);
    try { this.recorder?.stop(); } catch (_) {}
    this.recorder = null; this.active = false; this.waitingForPass = false;
    state.exporting = false;
    this.canvas = null; this.ctx = null; this.chunks = [];
    ui.syncExport('idle');
  },
};

/* -------------------------------------------------------------- recording */

const recording = {
  stream: null, recorder: null, chunks: [], meterRaf: 0, startAt: 0,

  async start() {
    audio.ensure();
    await audio.ctx.resume();
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (_) {
      alert('Microphone access is needed to record a voiceover.');
      return false;
    }
    const analyser = audio.ctx.createAnalyser();
    analyser.fftSize = 512;
    const tap = audio.ctx.createMediaStreamSource(this.stream);
    tap.connect(analyser); // analysis only — not routed to speakers
    const data = new Uint8Array(analyser.frequencyBinCount);
    const meter = () => {
      analyser.getByteTimeDomainData(data);
      let peak = 0;
      for (const v of data) peak = Math.max(peak, Math.abs(v - 128) / 128);
      ui.recLevel.style.width = `${Math.round(clamp(peak * 1.6, 0, 1) * 100)}%`;
      ui.recTime.textContent = fmt((performance.now() - this.startAt) / 1000);
      this.meterRaf = requestAnimationFrame(meter);
    };
    this.chunks = [];
    const mime = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm'].find((m) => MediaRecorder.isTypeSupported(m)) || '';
    this.recorder = new MediaRecorder(this.stream, mime ? { mimeType: mime } : undefined);
    this.recorder.ondataavailable = (e) => { if (e.data.size) this.chunks.push(e.data); };
    this.recorder.start(250);
    this.startAt = performance.now();
    meter();
    return true;
  },

  async stop() {
    cancelAnimationFrame(this.meterRaf);
    const rec = this.recorder;
    if (!rec) return null;
    const done = new Promise((res) => { rec.onstop = res; });
    rec.stop();
    await done;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null; this.recorder = null;
    const blob = new Blob(this.chunks, { type: rec.mimeType || 'audio/webm' });
    this.chunks = [];
    try {
      const buf = await audio.ctx.decodeAudioData(await blob.arrayBuffer());
      return buf;
    } catch (_) {
      alert("This browser couldn't decode its own recording — try adding a music file instead.");
      return null;
    }
  },
};

/* ------------------------------------------------------------ range slider */

// Two-handle selector over a strip; values in seconds within [0, total].
function makeRange(host, opts) {
  const dimL = document.createElement('div'); dimL.className = 'dim';
  const dimR = document.createElement('div'); dimR.className = 'dim';
  const win = document.createElement('div'); win.className = 'win';
  const lo = document.createElement('div'); lo.className = 'grip lo';
  const hi = document.createElement('div'); hi.className = 'grip hi';
  win.append(lo, hi);
  host.append(dimL, dimR, win);

  const r = { lo: 0, hi: 1, total: 1, gap: 0.3, onChange: opts.onChange, onCommit: opts.onCommit };

  function render() {
    const pl = (r.lo / r.total) * 100, ph = (r.hi / r.total) * 100;
    dimL.style.left = '0'; dimL.style.width = `${pl}%`;
    dimR.style.right = '0'; dimR.style.width = `${100 - ph}%`;
    win.style.left = `${pl}%`; win.style.width = `${ph - pl}%`;
  }
  r.set = (loV, hiV, total) => {
    if (total != null) r.total = Math.max(total, 0.1);
    r.lo = clamp(loV, 0, r.total); r.hi = clamp(hiV, 0, r.total);
    render();
  };

  function grab(which, ev) {
    ev.preventDefault();
    const rect = host.getBoundingClientRect();
    const move = (e) => {
      const x = (e.touches ? e.touches[0].clientX : e.clientX) - rect.left;
      const v = clamp((x / rect.width) * r.total, 0, r.total);
      if (which === 'lo') r.lo = Math.min(v, r.hi - r.gap);
      else r.hi = Math.max(v, r.lo + r.gap);
      r.lo = clamp(r.lo, 0, r.total); r.hi = clamp(r.hi, 0, r.total);
      render();
      r.onChange?.(r.lo, r.hi, which);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      r.onCommit?.(r.lo, r.hi);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }
  lo.addEventListener('pointerdown', (e) => grab('lo', e));
  hi.addEventListener('pointerdown', (e) => grab('hi', e));
  return r;
}

/* --------------------------------------------------------------------- UI */

const ui = {
  playhead: $('playhead'),
  exportBar: $('export-bar'),
  recLevel: $('rec-level'),
  recTime: $('rec-time'),
  trimRange: null,
  audioRange: null,

  init() {
    this.buildFilterStrip();
    this.buildAdjustList();
    this.trimRange = makeRange($('range-trim'), {
      onChange: (lo, hi, which) => {
        state.trim.start = lo; state.trim.end = hi;
        if (state.source?.kind === 'video' && which === 'lo') state.source.seekLoop(lo);
        this.syncTrimLabels();
      },
      onCommit: () => { this.clampTrackOffset(); if (state.playing) player.start(); },
    });
    this.audioRange = makeRange($('range-audio'), {
      onChange: (lo, hi) => {
        if (!state.track) return;
        state.track.trimStart = lo; state.track.trimEnd = hi;
      },
      onCommit: () => { if (state.playing) player.start(); },
    });
    this.audioRange.gap = 0.1;

    // tool switching
    $('toolbar').addEventListener('click', (e) => {
      const btn = e.target.closest('.tool');
      if (!btn || !state.source) return;
      state.tool = btn.dataset.tool;
      document.querySelectorAll('.tool').forEach((t) => t.classList.toggle('is-active', t === btn));
      for (const key of ['filters', 'adjust', 'audio', 'trim', 'export']) {
        $(`pane-${key}`).hidden = key !== state.tool;
      }
    });

    // start / open
    $('btn-sample').addEventListener('click', () => this.openSource(makeSampleSource()));
    $('btn-open').addEventListener('click', () => $('file-video').click());
    $('file-video').addEventListener('change', (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      audio.ensure();
      makeVideoSource(file, (src) => this.openSource(src), () => alert("This video couldn't be opened."));
      e.target.value = '';
    });

    // transport
    $('btn-play').addEventListener('click', () => { state.playing ? player.pause() : player.resume(); });
    $('btn-close').addEventListener('click', () => this.closeSource());

    // filter intensity
    $('s-intensity').addEventListener('input', (e) => {
      state.intensity = Number(e.target.value);
      $('o-intensity').textContent = `${Math.round(state.intensity * 100)}%`;
      this.applyPreviewFilter();
    });

    // original audio
    $('s-original').addEventListener('input', (e) => {
      state.originalVol = Number(e.target.value);
      $('o-original').textContent = `${Math.round(state.originalVol * 100)}%`;
      audio.syncOriginal();
    });
    $('btn-mute').addEventListener('click', () => {
      state.muted = !state.muted;
      $('spk-waves').style.opacity = state.muted ? 0.25 : 1;
      $('btn-mute').setAttribute('aria-label', state.muted ? 'Unmute original audio' : 'Mute original audio');
      audio.syncOriginal();
    });

    // soundtrack: file
    $('btn-music').addEventListener('click', () => $('file-audio').click());
    $('file-audio').addEventListener('change', async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      audio.ensure();
      try {
        const buf = await audio.ctx.decodeAudioData(await file.arrayBuffer());
        this.installTrack(buf, file.name.replace(/\.[^.]+$/, ''));
      } catch (_) {
        alert("This audio file couldn't be decoded.");
      }
      e.target.value = '';
    });

    // soundtrack: voiceover
    $('btn-record').addEventListener('click', async () => {
      if (await recording.start()) {
        $('record-row').hidden = false;
        $('btn-record').disabled = true; $('btn-music').disabled = true;
        player.pause();
      }
    });
    $('btn-rec-stop').addEventListener('click', async () => {
      const buf = await recording.stop();
      $('record-row').hidden = true;
      $('btn-record').disabled = false; $('btn-music').disabled = false;
      if (buf) this.installTrack(buf, 'Voiceover');
    });
    $('btn-remove-track').addEventListener('click', () => {
      state.track = null;
      audio.stopTrack();
      this.syncTrackUI();
      if (state.playing) player.start();
    });

    // soundtrack sliders
    const bindTrack = (id, out, key, fmtFn) => {
      $(id).addEventListener('input', (e) => {
        if (!state.track) return;
        state.track[key] = Number(e.target.value);
        $(out).textContent = fmtFn(state.track[key]);
        if (key === 'volume' && audio.ctx) audio.trackVol.gain.value = state.track.volume;
      });
      $(id).addEventListener('change', () => { if (state.playing && key !== 'volume') player.start(); });
    };
    bindTrack('s-offset', 'o-offset', 'offset', fmt);
    bindTrack('s-tvol', 'o-tvol', 'volume', (v) => `${Math.round(v * 100)}%`);
    bindTrack('s-fadein', 'o-fadein', 'fadeIn', (v) => `${v.toFixed(1)}s`);
    bindTrack('s-fadeout', 'o-fadeout', 'fadeOut', (v) => `${v.toFixed(1)}s`);

    // trim reset
    $('btn-reset-trim').addEventListener('click', () => {
      const d = state.source?.duration || 3;
      state.trim = { start: 0, end: d };
      this.trimRange.set(0, d, d);
      this.syncTrimLabels();
      if (state.playing) player.start();
    });

    // adjust reset
    $('btn-reset-adjust').addEventListener('click', () => {
      state.adjust = { ...IDENTITY_ADJUST };
      this.buildAdjustList();
      this.applyPreviewFilter();
    });

    // export
    $('btn-export').addEventListener('click', () => exporter.begin());
    $('btn-export-again').addEventListener('click', () => this.syncExport('idle'));
    if (!exporter.supported) {
      $('btn-export').disabled = true;
      $('export-unsupported').hidden = false;
    }
  },

  /* ---- source lifecycle ---- */

  openSource(src) {
    player.teardown();
    exporter.cancel();
    state.source = src;
    state.trim = { start: 0, end: src.duration };
    state.filter = 'original'; state.intensity = 1;
    state.adjust = { ...IDENTITY_ADJUST };
    state.track = null; state.originalVol = 1; state.muted = false;

    $('start-overlay').hidden = true;
    $('live-badge').hidden = false;
    $('playhead').hidden = false;
    $('btn-close').hidden = false;
    $('btn-play').hidden = false;

    this.trimRange.set(0, src.duration, src.duration);
    this.trimRange.gap = Math.min(0.5, src.duration / 4);
    this.syncTrimLabels();
    this.buildAdjustList();
    this.applyPreviewFilter();
    this.syncTrackUI();
    this.syncAudioPane();
    this.buildFilmstrip();
    this.refreshChips();
    $('s-original').value = 1; $('o-original').textContent = '100%';
    $('o-intensity').textContent = '100%';
    $('s-intensity').value = 1;
    this.selectChip('original');
    player.start();
    // chips need a drawn frame; refresh once playback has painted
    setTimeout(() => this.refreshChips(), 350);
  },

  closeSource() {
    player.teardown();
    exporter.cancel();
    $('start-overlay').hidden = false;
    $('live-badge').hidden = true;
    $('playhead').hidden = true;
    $('btn-close').hidden = true;
    $('btn-play').hidden = true;
    stage.style.filter = '';
    stageCtx.clearRect(0, 0, stage.width, stage.height);
    this.syncExport('idle');
    // back to the filters tab for next time
    state.tool = 'filters';
    document.querySelectorAll('.tool').forEach((t) => t.classList.toggle('is-active', t.dataset.tool === 'filters'));
    for (const key of ['filters', 'adjust', 'audio', 'trim', 'export']) $(`pane-${key}`).hidden = key !== 'filters';
  },

  /* ---- filters ---- */

  buildFilterStrip() {
    const strip = $('filter-strip');
    strip.innerHTML = '';
    for (const key of Object.keys(PRESETS)) {
      const chip = document.createElement('button');
      chip.className = 'filter-chip'; chip.dataset.key = key;
      chip.setAttribute('role', 'option');
      const c = document.createElement('canvas');
      c.width = 128; c.height = 128;
      const label = document.createElement('span');
      label.textContent = PRESETS[key].name;
      chip.append(c, label);
      chip.addEventListener('click', () => this.selectChip(key));
      strip.append(chip);
    }
  },

  selectChip(key) {
    state.filter = key;
    if (key === 'original') { state.intensity = 1; $('s-intensity').value = 1; $('o-intensity').textContent = '100%'; }
    document.querySelectorAll('.filter-chip').forEach((el) => el.classList.toggle('is-active', el.dataset.key === key));
    $('row-intensity').hidden = key === 'original';
    this.applyPreviewFilter();
    this.buildAdjustList(); // mono presets disable color rows
  },

  refreshChips() {
    if (!state.source) return;
    document.querySelectorAll('.filter-chip canvas').forEach((c) => {
      const key = c.parentElement.dataset.key;
      const g = c.getContext('2d');
      // crop-fill the current stage frame into the square chip
      const sw = stage.width, sh = stage.height, side = Math.min(sw, sh);
      g.drawImage(stage, (sw - side) / 2, (sh - side) / 2, side, side, 0, 0, c.width, c.height);
      c.style.filter = filterString(key, 1, IDENTITY_ADJUST);
    });
  },

  applyPreviewFilter() {
    stage.style.filter = filterString(state.filter, state.intensity, state.adjust);
    const v = state.adjust.vignette;
    const vg = $('vignette');
    vg.style.opacity = v > 0.01 ? 1 : 0;
    vg.style.background = `radial-gradient(ellipse at center, rgba(0,0,0,0) 52%, rgba(0,0,0,${(v * 0.72).toFixed(3)}) 100%)`;
  },

  /* ---- adjust ---- */

  buildAdjustList() {
    const defs = [
      ['exposure', 'Exposure', -1, 1], ['brightness', 'Brightness', -1, 1],
      ['contrast', 'Contrast', -1, 1], ['saturation', 'Saturation', -1, 1],
      ['vibrance', 'Vibrance', -1, 1], ['warmth', 'Warmth', -1, 1],
      ['vignette', 'Vignette', 0, 1], ['sharpness', 'Sharpness', 0, 1],
    ];
    const list = $('adjust-list');
    list.innerHTML = '';
    const mono = MONO_PRESETS.has(state.filter);
    for (const [key, label, min, max] of defs) {
      const row = document.createElement('div');
      row.className = 'slider-row';
      if (mono && ['saturation', 'vibrance', 'warmth'].includes(key)) row.classList.add('disabled');
      const lab = document.createElement('label'); lab.textContent = label;
      const input = document.createElement('input');
      input.type = 'range'; input.min = min; input.max = max; input.step = 0.01;
      input.value = state.adjust[key];
      const out = document.createElement('output');
      const show = () => { out.textContent = Number(state.adjust[key]).toFixed(2).replace(/^(-?)0\./, '$1.'); };
      show();
      input.addEventListener('input', () => {
        state.adjust[key] = Number(input.value);
        show();
        this.applyPreviewFilter();
        $('btn-reset-adjust').hidden = Object.keys(IDENTITY_ADJUST).every((k) => state.adjust[k] === 0);
      });
      lab.addEventListener('dblclick', () => {
        state.adjust[key] = 0; input.value = 0; show(); this.applyPreviewFilter();
      });
      row.append(lab, input, out);
      list.append(row);
    }
    $('btn-reset-adjust').hidden = Object.keys(IDENTITY_ADJUST).every((k) => state.adjust[k] === 0);
  },

  /* ---- audio ---- */

  syncAudioPane() {
    const has = state.source?.hasAudio !== false;
    $('row-original').classList.toggle('disabled', !has);
    $('no-audio-note').hidden = has;
  },

  installTrack(buffer, title) {
    state.track = {
      buffer, title,
      trimStart: 0,
      trimEnd: Math.min(buffer.duration, Math.max(0.5, state.trim.end - state.trim.start)),
      offset: 0, volume: 1, fadeIn: 0, fadeOut: 0,
    };
    this.syncTrackUI();
    this.drawWaveform(buffer);
    this.audioRange.set(state.track.trimStart, state.track.trimEnd, buffer.duration);
    this.clampTrackOffset();
    if (state.playing) player.start(); else player.resume();
  },

  clampTrackOffset() {
    const kept = state.trim.end - state.trim.start;
    const max = Math.max(0.1, kept - 0.1);
    $('s-offset').max = max;
    if (state.track && state.track.offset > max) {
      state.track.offset = max;
      $('s-offset').value = max;
      $('o-offset').textContent = fmt(max);
    }
    this.syncTrimLabels();
  },

  syncTrackUI() {
    const tr = state.track;
    $('track-empty').hidden = !!tr;
    $('track-editor').hidden = !tr;
    $('btn-remove-track').hidden = !tr;
    if (tr) {
      $('track-title').textContent = `♪ ${tr.title}`;
      $('s-offset').value = tr.offset; $('o-offset').textContent = fmt(tr.offset);
      $('s-tvol').value = tr.volume; $('o-tvol').textContent = `${Math.round(tr.volume * 100)}%`;
      $('s-fadein').value = tr.fadeIn; $('o-fadein').textContent = `${tr.fadeIn.toFixed(1)}s`;
      $('s-fadeout').value = tr.fadeOut; $('o-fadeout').textContent = `${tr.fadeOut.toFixed(1)}s`;
    }
  },

  drawWaveform(buffer) {
    const c = $('waveform');
    const g = c.getContext('2d');
    g.clearRect(0, 0, c.width, c.height);
    const data = buffer.getChannelData(0);
    const bins = 120, step = Math.floor(data.length / bins) || 1;
    let peaks = [];
    for (let i = 0; i < bins; i++) {
      let p = 0;
      for (let j = i * step; j < (i + 1) * step && j < data.length; j += 24) p = Math.max(p, Math.abs(data[j]));
      peaks.push(p);
    }
    const maxP = Math.max(...peaks, 0.001);
    g.fillStyle = '#3D7DFF';
    const bw = c.width / bins;
    peaks.forEach((p, i) => {
      const hgt = Math.max(2, (p / maxP) * c.height * 0.86);
      g.beginPath();
      g.roundRect(i * bw + bw * 0.18, (c.height - hgt) / 2, bw * 0.64, hgt, bw * 0.3);
      g.fill();
    });
  },

  /* ---- trim ---- */

  syncTrimLabels() {
    $('tc-start').textContent = fmt(state.trim.start);
    $('tc-end').textContent = fmt(state.trim.end);
    $('tc-kept').textContent = `${fmt(state.trim.end - state.trim.start)} kept`;
    const full = state.source && state.trim.start <= 0.05 &&
      state.trim.end >= state.source.duration - 0.05;
    $('btn-reset-trim').hidden = !!full;
  },

  buildFilmstrip() {
    const strip = $('filmstrip');
    strip.innerHTML = '';
    const src = state.source;
    if (!src) return;
    const n = 8;
    for (let i = 0; i < n; i++) {
      const cell = document.createElement('canvas');
      cell.width = 96; cell.height = 96;
      strip.append(cell);
      const t = src.duration * (i + 0.5) / n;
      src.frameAt(t, (painter) => {
        if (!painter) return;
        const g = cell.getContext('2d');
        painter(g, cell.width, cell.height);
      });
    }
  },

  /* ---- transport / export ---- */

  syncPlayButton() {
    $('ic-pause').hidden = !state.playing;
    $('ic-play').hidden = state.playing;
    $('btn-play').setAttribute('aria-label', state.playing ? 'Pause' : 'Play');
  },

  syncExport(mode, label) {
    $('export-idle').hidden = mode !== 'idle';
    $('export-busy').hidden = mode !== 'busy';
    $('export-done').hidden = mode !== 'done';
    if (label) $('export-label').textContent = label;
    if (mode !== 'busy') this.exportBar.style.width = '0%';
  },
};

ui.init();

})();
