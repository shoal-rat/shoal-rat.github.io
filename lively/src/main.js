/* Lively for Web — app controller.
   Wires the store, renderer, player, timeline, inspector and exporter,
   and owns the welcome screen, file handling, keyboard and the frame loop. */

import { $, $$, el, clamp, debounce, modKey, fmtTime } from './util.js';
import { Store, defaultEdit, MAX_TRIM, LOOKS } from './state.js';
import { Renderer, cropGeometry, gradeParams } from './gl.js';
import { VideoSource, SampleSource, ACCEPTED_VIDEO } from './media.js';
import { AudioEngine, VoiceRecorder } from './audio.js';
import { Player, passInfo } from './player.js';
import { Timeline } from './timeline.js';
import { Inspector } from './inspector.js';
import { Exporter } from './exporter.js';
import { SAMPLES, renderSoundtrack } from './samples.js';
import { ICONS } from './icons.js';

class App {
  constructor() {
    this.store = new Store();
    this.audio = new AudioEngine();
    this.source = null;
    this.trackBuffers = new Map();
    this.synthCache = new Map();
    this.compare = { split: null, hold: false };
    this.dirty = true;
    this.recorder = null;
    this.audioDecoding = false;
  }

  init() {
    this.root = $('#app');
    this.view = $('#view');
    this.stage = $('#stage');
    this.stageBox = $('#stage-box');
    try {
      this.renderer = new Renderer(this.view);
    } catch (error) {
      this.root.dataset.state = 'unsupported';
      return;
    }
    this.player = new Player(this.audio, this.renderer);
    this.timeline = new Timeline($('#timeline'), this);
    this.inspector = new Inspector($('#inspector'), this);
    this.exporter = new Exporter(this);

    this.store.on('change', (e) => this.onChange(e));
    this.store.on('history', () => this.syncHistory());
    this.player.on('busy', (b) => this.showBusy(b));
    this.player.on('state', () => { this.dirty = true; });
    this.player.on('error', (e) => this.toast(e.message || 'Something went wrong preparing the clip.'));

    this.view.addEventListener('webglcontextlost', (e) => { e.preventDefault(); this.toast('The graphics context was lost — reload to continue.'); });

    this.bindChrome();
    this.bindStage();
    this.bindKeys();
    this.bindDrop();
    this.buildWelcome();
    new ResizeObserver(() => { this.canvasKey = ''; this.dirty = true; }).observe(this.stage);
    requestAnimationFrame((t) => this.loop(t));

    const sample = new URLSearchParams(location.search).get('sample');
    if (sample && SAMPLES.some((s) => s.id === sample)) this.openSample(sample);
  }

  get edit() { return this.store.edit; }

  /* -------------------------------------------------------------- chrome */

  bindChrome() {
    this.videoInput = $('#file-video');
    this.audioInput = $('#file-audio');
    this.videoInput.addEventListener('change', () => {
      const files = Array.from(this.videoInput.files || []);
      this.videoInput.value = '';
      if (files.length) this.openFiles(files);
    });
    this.audioInput.addEventListener('change', () => {
      const file = this.audioInput.files?.[0];
      this.audioInput.value = '';
      if (file) this.loadAudioFile(file);
    });
    $$('[data-open]').forEach((b) => b.addEventListener('click', () => this.videoInput.click()));
    $('#btn-undo').addEventListener('click', () => this.store.undo());
    $('#btn-redo').addEventListener('click', () => this.store.redo());
    $('#btn-compare').addEventListener('click', () => this.toggleSplit());
    $('#btn-export').addEventListener('click', () => this.exporter.open());
    $('#btn-home').addEventListener('click', () => this.closeClip());
    $('#btn-keys').addEventListener('click', () => $('#keys-dialog').showModal());
    $('#keys-close').addEventListener('click', () => $('#keys-dialog').close());
    $$('.kbd-mod').forEach((k) => { k.textContent = modKey; });
    this.syncHistory();
  }

  syncHistory() {
    $('#btn-undo').disabled = !this.store.canUndo;
    $('#btn-redo').disabled = !this.store.canRedo;
  }

  toast(message, ms = 3200) {
    const t = $('#toast');
    t.textContent = message;
    t.classList.add('is-on');
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => t.classList.remove('is-on'), ms);
  }

  showBusy({ busy, progress, label }) {
    const b = $('#busy');
    b.hidden = !busy;
    if (busy) {
      $('#busy-label').textContent = `${label || 'Working'}… ${Math.round((progress || 0) * 100)}%`;
      b.style.setProperty('--p', `${Math.round((progress || 0) * 100)}`);
    }
    this.dirty = true;
  }

  /* ------------------------------------------------------------- welcome */

  buildWelcome() {
    const grid = $('#sample-grid');
    this.sampleCanvases = SAMPLES.map((sample) => {
      const canvas = el('canvas', { width: sample.width / 4, height: sample.height / 4 });
      const card = el('button', { type: 'button', class: `sample-card ${sample.height > sample.width ? 'tall' : 'wide'}` },
        el('span', { class: 'sample-media' }, canvas),
        el('span', { class: 'sample-copy' }, el('strong', {}, sample.name), el('small', {}, `${sample.width > sample.height ? 'Landscape' : 'Portrait'} · 3 s · with sound`)));
      card.addEventListener('click', () => this.openSample(sample.id));
      grid.append(card);
      return { canvas, sample };
    });
  }

  animateWelcome(now) {
    if (this.source || this.root.dataset.state !== 'empty') return;
    const t = (now / 1000) % 3;
    for (const { canvas, sample } of this.sampleCanvases) {
      sample.paint(canvas.getContext('2d'), canvas.width, canvas.height, t);
    }
    this.animateDemo(now, t);
  }

  /** The welcome "phone": the golden sample graded live, cycling looks. */
  animateDemo(now, t) {
    if (!this.demo) {
      const canvas = $('#demo-canvas');
      if (!canvas) return;
      try {
        this.demo = {
          renderer: new Renderer(canvas),
          frame: Object.assign(document.createElement('canvas'), { width: 540, height: 720 }),
          looks: ['original', 'golden', 'dusk', 'coastal', 'film', 'sakura', 'noir'],
          chips: [],
        };
      } catch (_) { this.demo = { failed: true }; return; }
      const chips = $('#demo-chips');
      this.demo.chips = this.demo.looks.map(() => chips.appendChild(el('i')));
    }
    if (this.demo.failed) return;
    const index = Math.floor(now / 2200) % this.demo.looks.length;
    const id = this.demo.looks[index];
    const look = LOOKS.find((l) => l.id === id);
    const sample = SAMPLES[0];
    sample.paint(this.demo.frame.getContext('2d'), 540, 720, t);
    const r = this.demo.renderer;
    r.setSource(this.demo.frame, 540, 720);
    r.render(gradeParams(null, [], look), { crop: { aspect: 'original', zoom: 1, x: 0, y: 0, rotate: 0, flip: false }, seed: Math.floor(now / 40) % 997 });
    if (this.demo.index !== index) {
      this.demo.index = index;
      $('#demo-look').textContent = look.name;
      this.demo.chips.forEach((c, i) => c.classList.toggle('is-on', i === index));
    }
  }

  /* --------------------------------------------------------------- files */

  bindDrop() {
    const overlay = $('#drop');
    let depth = 0;
    window.addEventListener('dragenter', (e) => {
      if (!e.dataTransfer?.types?.includes('Files')) return;
      depth += 1;
      overlay.hidden = false;
    });
    window.addEventListener('dragleave', () => { depth = Math.max(0, depth - 1); if (!depth) overlay.hidden = true; });
    window.addEventListener('dragover', (e) => { if (e.dataTransfer?.types?.includes('Files')) e.preventDefault(); });
    window.addEventListener('drop', (e) => {
      depth = 0;
      overlay.hidden = true;
      if (!e.dataTransfer?.files?.length) return;
      e.preventDefault();
      const files = Array.from(e.dataTransfer.files);
      const audio = files.find((f) => f.type.startsWith('audio/'));
      if (audio && this.source && !files.some((f) => f.type.startsWith('video/') || ACCEPTED_VIDEO.test(f.name))) {
        this.loadAudioFile(audio);
        return;
      }
      this.openFiles(files);
    });
  }

  async openFiles(files) {
    const video = files.find((f) => f.type.startsWith('video/') || ACCEPTED_VIDEO.test(f.name));
    if (!video) {
      const heic = files.find((f) => /\.(heic|heif|jpe?g)$/i.test(f.name));
      this.toast(heic
        ? 'That’s the still half of a Live Photo — drop its .MOV too (or instead).'
        : 'Lively opens videos: MP4, MOV, M4V or WebM.');
      return;
    }
    const pair = files.find((f) => f !== video && f.name.replace(/\.[^.]+$/, '') === video.name.replace(/\.[^.]+$/, ''));
    this.root.dataset.state = 'loading';
    try {
      const source = await VideoSource.open(video);
      await this.openSource(source);
      if (pair) this.toast(`Opened the motion half of ${video.name.replace(/\.[^.]+$/, '')} — your Live Photo.`);
      else if (source.duration > MAX_TRIM) this.toast(`Picked the first 3 s. Drag the yellow window to choose your moment (up to ${MAX_TRIM} s).`, 5200);
    } catch (error) {
      this.root.dataset.state = this.source ? 'editing' : 'empty';
      this.toast(error.message || 'That video couldn’t be opened.');
    }
  }

  async openSample(id) {
    await this.openSource(new SampleSource(id));
  }

  async openSource(source) {
    const previous = this.source;
    this.player.load(source, defaultEdit(source.duration));
    previous?.dispose();
    this.source = source;
    this.store.reset(defaultEdit(source.duration));
    this.trackBuffers.clear();
    this.audio.trackBuffer = null;
    this.audio.originalBuffer = null;
    this.audio.ensure();
    this.audioDecoding = true;
    this.root.dataset.state = 'editing';
    document.body.classList.add('is-editing');
    $('#doc-name').textContent = source.name;
    document.title = `${source.name} — Lively for Web`;
    this.canvasKey = '';
    this.timeline.load();
    this.inspector.replacing = false;
    this.inspector.sync();
    this.inspector.show('looks');
    this.refreshLookThumbs();
    this.inspector.refreshKeyThumb();
    this.dirty = true;
    this.player.play(this.edit);
    source.decodeAudio(this.audio.ctx).then((buffer) => {
      if (this.source !== source) return;
      this.audio.originalBuffer = buffer;
      this.audioDecoding = false;
      this.inspector.syncAudio();
      this.timeline.owKey = '';
      this.timeline.layout();
      if (this.player.playing) this.player.scheduleAudio(this.edit);
    });
    // audio needs a user gesture on some browsers; retry on the next one
    const unlock = () => {
      this.audio.resume().then(() => { if (this.player.playing) this.player.scheduleAudio(this.edit); });
    };
    window.addEventListener('pointerdown', unlock, { once: true });
  }

  closeClip() {
    if (!this.source) return;
    if (this.store.canUndo && !confirm('Close this clip? Your edits aren’t saved.')) return;
    this.player.dispose();
    this.source.dispose();
    this.source = null;
    this.root.dataset.state = 'empty';
    document.body.classList.remove('is-editing');
    document.title = 'Lively for Web — edit Live Photos in your browser';
  }

  /* --------------------------------------------------------- store sync */

  onChange({ reason }) {
    this.dirty = true;
    const edit = this.edit;
    if (!edit) return;
    this.audio.trackBuffer = edit.audio.track ? this.trackBuffers.get(edit.audio.track.id) || null : null;
    switch (reason) {
      case 'reset':
        break;
      case 'undo':
      case 'redo':
        this.timeline.fitView();
        this.timeline.layout();
        this.inspector.sync();
        this.canvasKey = '';
        this.afterStructural();
        break;
      case 'trim':
        this.timeline.layout();
        this.inspector.syncLive();
        break;
      case 'key':
        this.timeline.layout();
        this.inspector.syncLive();
        break;
      case 'effect':
      case 'speed':
        this.timeline.layout();
        this.inspector.syncLive();
        this.inspector.syncAudio();
        this.afterStructural(true);
        break;
      case 'look':
        this.inspector.syncLooks();
        this.inspector.keyThumbTime = null;
        this.refreshKeyThumbSoon();
        break;
      case 'adjust':
        this.inspector.syncAdjust();
        this.refreshKeyThumbSoon();
        break;
      case 'crop':
        this.canvasKey = '';
        this.inspector.syncCrop();
        this.refreshLookThumbs();
        break;
      case 'mix':
        this.audio.applyMix(edit);
        break;
      case 'track':
        this.timeline.layout();
        this.inspector.syncAudio();
        this.rescheduleSoon();
        break;
      default:
        break;
    }
  }

  /** Effect, speed or trim changed: rebuild what the player needs. */
  async afterStructural(autoplay = false) {
    const edit = this.edit;
    const was = this.player.playing;
    this.player.pause(true);
    this.player.invalidateExposure();
    await this.player.prepare(edit);
    if (this.edit !== edit) return;
    if ((was || autoplay) && edit.effect !== 'longexposure') this.player.play(edit);
    this.dirty = true;
  }

  afterTrim() {
    this.inspector.syncAudio();
    this.inspector.keyThumbTime = null;
    this.inspector.refreshKeyThumb();
    this.refreshLookThumbs();
    this.afterStructural();
  }

  rescheduleSoon = debounce(() => {
    if (this.player.playing) this.player.scheduleAudio(this.edit);
  }, 120);

  refreshKeyThumbSoon = debounce(() => {
    this.inspector.keyThumbTime = null;
    this.inspector.refreshKeyThumb();
  }, 250);

  refreshLookThumbs = debounce(async () => {
    if (!this.source) return;
    if (this.inspector.tab !== 'looks') { this.inspector.thumbsDirty = true; return; }
    const source = this.source;
    const drawable = await source.frameAt(this.edit.keyTime);
    if (source !== this.source) return;
    this.inspector.refreshThumbs(drawable, source.width, source.height);
  }, 120);

  onTab(id) {
    this.root.dataset.tab = id;
    if (id === 'looks' && this.inspector?.thumbsDirty) this.refreshLookThumbs();
    if (id === 'live') this.inspector?.refreshKeyThumb();
    this.dirty = true;
  }

  openPanel(id) { this.inspector.show(id); }

  /* ------------------------------------------------------------ transport */

  togglePlay() {
    if (!this.source) return;
    if (this.edit.effect === 'longexposure') {
      this.toast('Long Exposure is a still — pick Live, Loop or Bounce to play.');
      return;
    }
    this.player.toggle(this.edit);
  }

  pause() { this.player?.pause(); }

  seek(t) {
    this.player.seek(this.edit, t);
    this.dirty = true;
  }

  setKeyPhoto() {
    if (!this.source) return;
    const t = clamp(this.player.currentSourceTime, this.edit.trim.in, this.edit.trim.out);
    this.store.set((d) => { d.keyTime = t; }, 'key');
    this.inspector.keyThumbTime = null;
    this.inspector.refreshKeyThumb();
    this.refreshLookThumbs();
    this.toast(`Key photo set at ${fmtTime(t - this.edit.trim.in, 2)}.`);
  }

  setTrimAt(side) {
    const t = this.player.currentSourceTime;
    const dur = this.source.duration;
    this.store.set((d) => {
      if (side === 'in') d.trim.in = clamp(t, Math.max(0, d.trim.out - MAX_TRIM), d.trim.out - 0.3);
      else d.trim.out = clamp(t, d.trim.in + 0.3, Math.min(dur, d.trim.in + MAX_TRIM));
      d.keyTime = clamp(d.keyTime, d.trim.in, d.trim.out);
    }, 'trim');
    this.timeline.fitView();
    this.afterTrim();
  }

  /* ---------------------------------------------------------------- audio */

  pickAudio() { this.audioInput.click(); }

  async loadAudioFile(file) {
    try {
      this.audio.ensure();
      const buffer = await this.audio.ctx.decodeAudioData(await file.arrayBuffer());
      this.installTrack(buffer, { id: `file-${Date.now().toString(36)}`, name: file.name.replace(/\.[^.]+$/, ''), kind: 'file' });
    } catch (_) {
      this.toast('That audio file couldn’t be decoded in this browser.');
    }
  }

  async useSynth(id) {
    try {
      if (!this.synthCache.has(id)) this.synthCache.set(id, renderSoundtrack(id));
      const buffer = await this.synthCache.get(id);
      const name = { glow: 'Glow', tide: 'Tide', lofi: 'Lo-fi' }[id] || id;
      this.installTrack(buffer, { id, name, kind: 'synth' });
    } catch (_) {
      this.toast('Couldn’t generate that soundtrack.');
    }
  }

  installTrack(buffer, meta) {
    this.trackBuffers.set(meta.id, buffer);
    const P = passInfo(this.edit).length;
    this.audio.trackBuffer = buffer;
    this.inspector.replacing = false;
    this.store.set((d) => {
      d.audio.track = {
        ...meta,
        trimIn: 0,
        trimOut: Math.min(buffer.duration, Math.max(P, 0.5)),
        offset: 0,
        volume: 1,
        fadeIn: 0,
        fadeOut: Math.min(0.6, P / 4),
      };
    }, 'track');
    this.inspector.show('audio');
    if (this.edit.effect === 'longexposure') {
      this.toast('Soundtrack added — it plays with Live, Loop and Bounce.');
      return;
    }
    if (this.player.playing) this.player.scheduleAudio(this.edit);
    else this.player.play(this.edit);
  }

  removeTrack() {
    this.store.set((d) => { d.audio.track = null; }, 'track');
    if (this.player.playing) this.player.scheduleAudio(this.edit);
  }

  async toggleRecording() {
    if (this.recorder) {
      const recorder = this.recorder;
      this.recorder = null;
      this.inspector.setRecording(false);
      try {
        const buffer = await recorder.stop(this.audio.ctx);
        if (buffer) this.installTrack(buffer, { id: `voice-${Date.now().toString(36)}`, name: 'Voiceover', kind: 'voice' });
      } catch (_) {
        this.toast('The recording couldn’t be decoded — try a music file instead.');
      }
      return;
    }
    try {
      this.audio.ensure();
      await this.audio.resume();
      this.player.pause();
      const recorder = new VoiceRecorder();
      await recorder.start(this.audio.ctx, (level, seconds) => this.inspector.setRecording(true, level, seconds));
      this.recorder = recorder;
      this.inspector.setRecording(true, 0, 0);
    } catch (_) {
      this.toast('Microphone access is needed to record a voiceover.');
    }
  }

  /* --------------------------------------------------------------- auto */

  async autoEnhance() {
    if (!this.source) return;
    const drawable = await this.source.frameAt(this.player.currentSourceTime);
    const c = document.createElement('canvas');
    c.width = 96;
    c.height = Math.max(8, Math.round((96 * this.source.height) / this.source.width));
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(drawable, 0, 0, c.width, c.height);
    const { data } = ctx.getImageData(0, 0, c.width, c.height);
    const lum = [];
    let sum = 0;
    for (let i = 0; i < data.length; i += 4) {
      const l = (0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]) / 255;
      lum.push(l);
      sum += l;
    }
    lum.sort((a, b) => a - b);
    const mean = sum / lum.length;
    const p02 = lum[Math.floor(lum.length * 0.02)];
    const p98 = lum[Math.floor(lum.length * 0.98)];
    this.store.set((d) => {
      d.adjust.exposure = +clamp((Math.log2(0.46 / Math.max(0.05, mean)) / 1.5) * 0.7, -0.5, 0.5).toFixed(2);
      d.adjust.contrast = +clamp((0.82 - (p98 - p02)) * 0.8, -0.1, 0.35).toFixed(2);
      d.adjust.shadows = +(mean < 0.4 ? clamp((0.4 - mean) * 1.4, 0, 0.35) : 0).toFixed(2);
      d.adjust.highlights = p98 > 0.95 ? -0.25 : 0;
      d.adjust.blacks = +(p02 > 0.08 ? clamp(p02 * 2, 0, 0.4) : 0).toFixed(2);
      d.adjust.vibrance = 0.15;
    }, 'adjust');
    this.toast('Balanced from the frame under the playhead.');
  }

  /* ---------------------------------------------------------------- stage */

  toggleSplit(force) {
    const on = force ?? this.compare.split == null;
    this.compare.split = on ? 0.5 : null;
    $('#btn-compare').classList.toggle('is-on', on);
    $('#split').hidden = !on;
    this.positionSplit();
    this.dirty = true;
  }

  positionSplit() {
    if (this.compare.split == null) return;
    $('#split').style.left = `${this.compare.split * 100}%`;
  }

  bindStage() {
    const view = this.view;
    let holdTimer = 0;
    view.addEventListener('pointerdown', (e) => {
      if (!this.source || e.button > 0) return;
      const cropping = this.inspector.tab === 'crop';
      const start = { x: e.clientX, y: e.clientY, crop: { ...this.edit.crop } };
      view.setPointerCapture(e.pointerId);
      let moved = false;
      if (!cropping) {
        holdTimer = setTimeout(() => { this.compare.hold = true; this.stage.classList.add('is-original'); this.dirty = true; }, 220);
      }
      const move = (ev) => {
        if (Math.hypot(ev.clientX - start.x, ev.clientY - start.y) > 3) moved = true;
        if (!cropping || !moved) return;
        const g = cropGeometry(this.source.width, this.source.height, start.crop);
        const rect = view.getBoundingClientRect();
        const slackX = g.rw - g.cw;
        const slackY = g.rh - g.ch;
        const dxSrc = -((ev.clientX - start.x) * g.cw) / rect.width;
        const dySrc = -((ev.clientY - start.y) * g.ch) / rect.height;
        this.store.update((d) => {
          d.crop.x = slackX > 1 ? clamp(start.crop.x + dxSrc / (slackX * 0.5), -1, 1) : 0;
          d.crop.y = slackY > 1 ? clamp(start.crop.y + dySrc / (slackY * 0.5), -1, 1) : 0;
        }, 'crop');
      };
      const up = () => {
        clearTimeout(holdTimer);
        view.removeEventListener('pointermove', move);
        view.removeEventListener('pointerup', up);
        view.removeEventListener('pointercancel', up);
        if (this.compare.hold) {
          this.compare.hold = false;
          this.stage.classList.remove('is-original');
          this.dirty = true;
        } else if (cropping && moved) {
          this.store.commit('crop');
        } else if (!moved && !cropping) {
          this.togglePlay();
        }
      };
      view.addEventListener('pointermove', move);
      view.addEventListener('pointerup', up);
      view.addEventListener('pointercancel', up);
    });
    const commitZoom = debounce(() => this.store.commit('crop'), 350);
    view.addEventListener('wheel', (e) => {
      if (!this.source || this.inspector.tab !== 'crop') return;
      e.preventDefault();
      this.store.update((d) => { d.crop.zoom = clamp(d.crop.zoom * Math.exp(-e.deltaY * 0.0016), 1, 3); }, 'crop');
      commitZoom();
    }, { passive: false });

    const split = $('#split');
    split.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      split.setPointerCapture(e.pointerId);
      const rect = view.getBoundingClientRect();
      const move = (ev) => {
        this.compare.split = clamp((ev.clientX - rect.left) / rect.width, 0.02, 0.98);
        this.positionSplit();
        this.dirty = true;
      };
      const up = () => { split.removeEventListener('pointermove', move); split.removeEventListener('pointerup', up); };
      split.addEventListener('pointermove', move);
      split.addEventListener('pointerup', up);
    });
  }

  layoutCanvas() {
    const source = this.source;
    const edit = this.edit;
    const g = cropGeometry(source.width, source.height, edit.crop);
    // stacked (phone/tablet) layout: size the stage to the picture instead
    // of reserving a tall black box for landscape clips
    if (window.matchMedia('(max-width: 960px)').matches) {
      const inner = this.stage.clientWidth - 28;
      const want = Math.round(clamp(inner / g.aspect, 200, window.innerHeight * 0.6) + 28);
      if (this.stageHeight !== want) {
        this.stageHeight = want;
        this.stage.style.setProperty('--stage-h', `${want}px`);
      }
    } else if (this.stageHeight) {
      this.stageHeight = 0;
      this.stage.style.removeProperty('--stage-h');
    }
    const box = this.stageBox.getBoundingClientRect();
    const key = `${box.width}|${box.height}|${g.aspect.toFixed(5)}|${g.maxW}`;
    if (key === this.canvasKey) return;
    this.canvasKey = key;
    let cw = box.width;
    let ch = cw / g.aspect;
    if (ch > box.height) { ch = box.height; cw = ch * g.aspect; }
    this.view.style.width = `${Math.floor(cw)}px`;
    this.view.style.height = `${Math.floor(ch)}px`;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const pw = Math.max(2, Math.round(Math.min(cw * dpr, g.maxW)));
    this.renderer.resize(pw, Math.max(2, Math.round(pw / g.aspect)));
  }

  /* ------------------------------------------------------------ keyboard */

  bindKeys() {
    window.addEventListener('keydown', (e) => {
      const target = e.target;
      const typing = target.closest?.('input:not([type=range]):not([type=checkbox]), textarea, select, [contenteditable]');
      const mod = e.metaKey || e.ctrlKey;
      if (document.querySelector('dialog[open]') && e.key !== 'Escape') return;
      if (mod && e.key.toLowerCase() === 'z') {
        if (typing) return;
        e.preventDefault();
        if (e.shiftKey) this.store.redo(); else this.store.undo();
        return;
      }
      if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); this.store.redo(); return; }
      if (mod && e.key.toLowerCase() === 'e') { e.preventDefault(); this.exporter.open(); return; }
      if (mod && e.key.toLowerCase() === 'o') { e.preventDefault(); this.videoInput.click(); return; }
      if (typing || mod || e.altKey || !this.source) return;
      const onRange = target.matches?.('input[type=range]');
      switch (e.key) {
        case ' ':
          if (target.closest('button') && target !== document.body) return;
          e.preventDefault();
          this.togglePlay();
          break;
        case 'ArrowLeft':
        case 'ArrowRight':
          if (onRange) return;
          e.preventDefault();
          this.player.step(this.edit, (e.key === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? 10 : 1));
          this.dirty = true;
          break;
        case 'i': case 'I': this.setTrimAt('in'); break;
        case 'o': case 'O': this.setTrimAt('out'); break;
        case 'k': case 'K': this.setKeyPhoto(); break;
        case '\\':
          if (!this.compare.hold) { this.compare.hold = true; this.stage.classList.add('is-original'); this.dirty = true; }
          break;
        case 'Escape':
          if (this.compare.split != null) this.toggleSplit(false);
          break;
        case '?':
          $('#keys-dialog').showModal();
          break;
        default:
          if (/^[1-5]$/.test(e.key) && !onRange) this.inspector.show(['looks', 'adjust', 'live', 'crop', 'audio'][Number(e.key) - 1]);
      }
    });
    window.addEventListener('keyup', (e) => {
      if (e.key === '\\' && this.compare.hold) {
        this.compare.hold = false;
        this.stage.classList.remove('is-original');
        this.dirty = true;
      }
    });
  }

  /* ---------------------------------------------------------------- loop */

  loop(now) {
    requestAnimationFrame((t) => this.loop(t));
    this.animateWelcome(now);
    const source = this.source;
    if (!source || !this.edit) return;
    const edit = this.edit;
    const frame = this.player.tick(edit, now);
    this.timeline.setPlayhead(this.player.currentSourceTime, this.player.playing);
    $('#fx-badge').textContent = { live: 'LIVE', loop: 'LOOP', bounce: 'BOUNCE', longexposure: 'LONG EXPOSURE' }[edit.effect];
    if (!frame || (!frame.changed && !this.dirty)) return;
    this.dirty = false;
    this.layoutCanvas();
    if (frame.still) {
      if (!this.renderer.useAccumulated()) return;
    } else {
      if (!frame.a) return;
      try {
        this.renderer.setSource(frame.a, source.width, source.height);
        if (frame.b) this.renderer.setSecond(frame.b);
      } catch (_) {
        return; // frame not decodable yet
      }
    }
    this.renderer.render(gradeParams(edit, this.inspector.custom), {
      crop: edit.crop,
      bypass: this.compare.hold,
      split: this.compare.split,
      seed: frame.seed ? Math.floor(frame.seed / 40) % 997 : 0,
      mix2: frame.b ? frame.mix : 0,
    });
  }
}

const app = new App();
window.lively = app;
app.init();
