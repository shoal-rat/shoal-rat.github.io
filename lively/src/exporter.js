/* Export: MP4 (WebCodecs + mp4-muxer, frame-accurate, faster than real
   time), WebM fallback (MediaRecorder, real time), GIF (gifenc) and stills
   (key photo or long exposure) — all rendered by the same shader at full
   resolution from frame-accurate seeks. */

import { el, clamp, fmtTime, downloadBlob, formatBytes, nextFrame } from './util.js';
import { Renderer, cropGeometry, outputSize, gradeParams } from './gl.js';
import { passInfo, mapFrame } from './player.js';
import { renderMix } from './audio.js';
import { ICONS } from './icons.js';

const FPS = 30;

async function pickVideoCodec(width, height, bitrate) {
  if (typeof VideoEncoder === 'undefined') return null;
  const candidates = ['avc1.640034', 'avc1.640033', 'avc1.4d0034', 'avc1.4d0028', 'avc1.42003e', 'avc1.42001f'];
  for (const codec of candidates) {
    const config = { codec, width, height, bitrate, framerate: FPS, avc: { format: 'avc' } };
    try {
      const { supported } = await VideoEncoder.isConfigSupported(config);
      if (supported) return config;
    } catch (_) { /* try next */ }
  }
  return null;
}

async function pickAudioCodec(sampleRate) {
  if (typeof AudioEncoder === 'undefined') return null;
  for (const [codec, muxCodec] of [['mp4a.40.2', 'aac'], ['opus', 'opus']]) {
    const config = { codec, sampleRate, numberOfChannels: 2, bitrate: 160000 };
    try {
      const { supported } = await AudioEncoder.isConfigSupported(config);
      if (supported) return { config, muxCodec };
    } catch (_) { /* next */ }
  }
  return null;
}

export class Exporter {
  constructor(app) {
    this.app = app;
    this.canvas = document.createElement('canvas');
    this.renderer = null;
    this.buildDialog();
  }

  get edit() { return this.app.store.edit; }
  get source() { return this.app.source; }

  ensureRenderer() {
    if (!this.renderer || this.renderer.lost) this.renderer = new Renderer(this.canvas, { preserve: true });
    return this.renderer;
  }

  /* --------------------------------------------------------------- dialog */

  buildDialog() {
    this.dialog = el('dialog', { class: 'export', 'aria-labelledby': 'export-title' });
    this.formats = el('div', { class: 'fmt-grid', role: 'radiogroup' });
    const fmt = (id, title, sub) => {
      const b = el('button', { type: 'button', class: 'fmt', role: 'radio', 'data-format': id },
        el('strong', {}, title), el('small', {}, sub));
      b.addEventListener('click', () => { this.format = id; this.syncDialog(); });
      this.formats.append(b);
      return b;
    };
    this.fmtVideo = fmt('video', 'Video', 'MP4 with sound');
    this.fmtGif = fmt('gif', 'GIF', 'Loops anywhere');
    this.fmtPhoto = fmt('photo', 'Photo', 'Key photo, JPEG');

    this.sizeSelect = el('select', { class: 'field' });
    this.repeatSelect = el('select', { class: 'field' },
      el('option', { value: '1' }, 'Once'), el('option', { value: '3' }, '3 times'), el('option', { value: '5' }, '5 times'));
    this.audioToggle = el('input', { type: 'checkbox', checked: true });
    this.optRepeat = el('label', { class: 'opt' }, el('span', {}, 'Play'), this.repeatSelect);
    this.optAudio = el('label', { class: 'opt check' }, this.audioToggle, el('span', {}, 'Include sound'));
    this.summary = el('p', { class: 'exp-summary' });
    this.warn = el('p', { class: 'exp-warn', hidden: true });
    this.sizeSelect.addEventListener('change', () => this.syncDialog());
    this.repeatSelect.addEventListener('change', () => this.syncDialog());

    this.go = el('button', { type: 'button', class: 'btn primary' }, 'Export');
    this.go.addEventListener('click', () => this.run());
    const cancel = el('button', { type: 'button', class: 'btn ghost' }, 'Cancel');
    cancel.addEventListener('click', () => this.close());

    this.setup = el('div', { class: 'exp-setup' },
      this.formats,
      el('div', { class: 'opts' }, el('label', { class: 'opt' }, el('span', {}, 'Size'), this.sizeSelect), this.optRepeat, this.optAudio),
      this.summary, this.warn,
      el('div', { class: 'exp-actions' }, cancel, this.go));

    this.bar = el('div', { class: 'exp-bar' }, el('span'));
    this.stage = el('p', { class: 'exp-stage' });
    const stop = el('button', { type: 'button', class: 'btn ghost' }, 'Stop');
    stop.addEventListener('click', () => { this.cancelled = true; });
    this.progress = el('div', { class: 'exp-progress', hidden: true }, this.bar, this.stage, el('div', { class: 'exp-actions' }, stop));

    this.resultMedia = el('div', { class: 'exp-media' });
    this.resultInfo = el('p', { class: 'exp-summary' });
    this.download = el('button', { type: 'button', class: 'btn primary', html: `${ICONS.export}<span>Download</span>` });
    this.shareBtn = el('button', { type: 'button', class: 'btn ghost', html: `${ICONS.share}<span>Share</span>`, hidden: true });
    const again = el('button', { type: 'button', class: 'btn text' }, 'Export something else');
    again.addEventListener('click', () => this.showSetup());
    const done = el('button', { type: 'button', class: 'btn ghost' }, 'Done');
    done.addEventListener('click', () => this.close());
    this.download.addEventListener('click', () => this.result && downloadBlob(this.result.blob, this.result.name));
    this.shareBtn.addEventListener('click', async () => {
      try {
        const file = new File([this.result.blob], this.result.name, { type: this.result.blob.type });
        await navigator.share({ files: [file], title: 'Made with Lively' });
      } catch (_) { /* dismissed */ }
    });
    this.resultView = el('div', { class: 'exp-result', hidden: true },
      this.resultMedia, this.resultInfo,
      el('div', { class: 'exp-actions' }, again, done, this.shareBtn, this.download));

    this.dialog.append(
      el('div', { class: 'exp-head' }, el('h2', { id: 'export-title' }, 'Export'),
        el('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Close', html: ICONS.close, onclick: () => this.close() })),
      this.setup, this.progress, this.resultView);
    this.dialog.addEventListener('cancel', (e) => { if (this.running) e.preventDefault(); });
    document.body.append(this.dialog);
  }

  open() {
    if (!this.source) return;
    this.app.pause();
    this.format = this.edit.effect === 'longexposure' ? 'photo' : (this.format || 'video');
    this.showSetup();
    this.dialog.showModal();
  }

  close() {
    if (this.running) { this.cancelled = true; return; }
    this.dialog.close();
    if (this.result?.url) URL.revokeObjectURL(this.result.url);
    this.result = null;
  }

  showSetup() {
    this.setup.hidden = false;
    this.progress.hidden = true;
    this.resultView.hidden = true;
    this.syncDialog();
  }

  geometry() {
    return cropGeometry(this.source.width, this.source.height, this.edit.crop);
  }

  syncDialog() {
    const edit = this.edit;
    const still = edit.effect === 'longexposure';
    if (still && this.format !== 'photo') this.format = 'photo';
    [this.fmtVideo, this.fmtGif, this.fmtPhoto].forEach((b) => {
      const on = b.dataset.format === this.format;
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-checked', String(on));
    });
    this.fmtVideo.disabled = still;
    this.fmtGif.disabled = still;
    this.fmtPhoto.querySelector('small').textContent = still ? 'Long exposure, JPEG' : 'Key photo, JPEG';

    const g = this.geometry();
    const full = Math.max(g.maxW, g.maxH);
    const sizes = this.format === 'gif'
      ? [480, 360, 640].filter((s) => s <= full || s === 480)
      : [full, 2160, 1920, 1280, 720].filter((s, i, arr) => s <= full && arr.indexOf(s) === i);
    const prev = Number(this.sizeSelect.value);
    this.sizeSelect.replaceChildren(...sizes.map((s) => {
      const o = outputSize(g, s);
      const label = s === full && this.format !== 'gif' ? `Original · ${o.width}×${o.height}` : `${o.width}×${o.height}`;
      return el('option', { value: s }, label);
    }));
    if (sizes.includes(prev)) this.sizeSelect.value = String(prev);
    else if (this.format === 'video' && sizes.includes(1920)) this.sizeSelect.value = '1920';

    const loops = edit.effect === 'loop' || edit.effect === 'bounce';
    this.optRepeat.hidden = !(this.format === 'video' && loops);
    const hasAudio = (edit.effect === 'live' && this.app.audio.originalBuffer && !edit.audio.original.muted) || (edit.audio.track && this.app.audio.trackBuffer);
    this.optAudio.hidden = this.format !== 'video' || !hasAudio;

    const P = passInfo(edit).length;
    const repeats = this.optRepeat.hidden ? 1 : Number(this.repeatSelect.value);
    const o = outputSize(g, Number(this.sizeSelect.value));
    let text = '';
    if (this.format === 'video') text = `${o.width}×${o.height} · ${fmtTime(P * repeats)} · 30 fps`;
    if (this.format === 'gif') text = `${o.width}×${o.height} · ${fmtTime(P)} loop · 15 fps`;
    if (this.format === 'photo') text = `${o.width}×${o.height} JPEG`;
    this.summary.textContent = text;
    const webcodecs = typeof VideoEncoder !== 'undefined';
    const recorder = typeof MediaRecorder !== 'undefined' && HTMLCanvasElement.prototype.captureStream;
    this.warn.hidden = !(this.format === 'video' && !webcodecs);
    this.warn.textContent = recorder
      ? 'This browser can’t encode MP4 directly, so Lively will record a WebM in real time instead.'
      : 'This browser can’t encode video. Try Chrome, Edge, Safari 17+ or Firefox 130+.';
    this.go.disabled = this.format === 'video' && !webcodecs && !recorder;
  }

  setProgress(p, label) {
    this.bar.firstChild.style.width = `${Math.round(clamp(p, 0, 1) * 100)}%`;
    if (label) this.stage.textContent = label;
  }

  /* ------------------------------------------------------------------ run */

  async run() {
    this.setup.hidden = true;
    this.progress.hidden = false;
    this.running = true;
    this.cancelled = false;
    this.setProgress(0, 'Starting…');
    let result = null;
    try {
      const size = Number(this.sizeSelect.value);
      if (this.format === 'photo') result = await this.exportPhoto(size);
      else if (this.format === 'gif') result = await this.exportGif(size);
      else if (typeof VideoEncoder !== 'undefined') result = await this.exportMp4(size);
      else result = await this.exportRecorder(size);
    } catch (error) {
      this.running = false;
      if (this.cancelled) { this.showSetup(); return; }
      console.error(error);
      this.showSetup();
      this.warn.hidden = false;
      this.warn.textContent = `Export failed: ${error.message || error}. Try a smaller size.`;
      return;
    }
    this.running = false;
    if (!result || this.cancelled) { this.showSetup(); return; }
    this.showResult(result);
  }

  showResult(result) {
    this.result = result;
    result.url = URL.createObjectURL(result.blob);
    this.progress.hidden = true;
    this.resultView.hidden = false;
    let media;
    if (result.kind === 'video') media = el('video', { src: result.url, controls: true, loop: true, autoplay: true, muted: true, playsinline: true });
    else media = el('img', { src: result.url, alt: 'Exported result' });
    this.resultMedia.replaceChildren(media);
    this.resultInfo.textContent = `${result.name} · ${result.width}×${result.height} · ${formatBytes(result.blob.size)}`;
    const canShare = !!navigator.canShare?.({ files: [new File([result.blob], result.name, { type: result.blob.type })] });
    this.shareBtn.hidden = !canShare;
    downloadBlob(result.blob, result.name);
  }

  baseName() {
    const safe = (this.source.name || 'Lively').replace(/[^\w\- ]+/g, '').trim() || 'Lively';
    return `${safe} – Lively`;
  }

  /* ----------------------------------------------------------- frame feed */

  /* Source frames for export. Video frames the effect will show again
     (Bounce runs backwards over the same frames) are kept as compact JPEGs,
     so every source frame is decoded once, in forward order. */
  beginFrameCache(keep) {
    this.frameCache = new Map();
    this.keepFrames = keep;
    if (keep && !this.jpegCanvas) this.jpegCanvas = document.createElement('canvas');
  }

  endFrameCache() {
    this.frameCache = null;
  }

  async sourceFrame(t) {
    const source = this.source;
    if (source.kind === 'sample') return { drawable: await source.frameAt(t) };
    const key = Math.round(t * source.fps);
    const hit = this.frameCache?.get(key);
    if (hit) {
      const bitmap = await createImageBitmap(hit);
      return { drawable: bitmap, dispose: () => bitmap.close() };
    }
    const drawable = await source.frameAt(key / source.fps);
    if (this.keepFrames && this.frameCache) {
      const c = this.jpegCanvas;
      const scale = Math.min(1, 2160 / Math.max(source.width, source.height));
      c.width = Math.round(source.width * scale);
      c.height = Math.round(source.height * scale);
      c.getContext('2d').drawImage(drawable, 0, 0, c.width, c.height);
      const blob = await new Promise((resolve) => c.toBlob(resolve, 'image/jpeg', 0.94));
      if (blob) this.frameCache.set(key, blob);
    }
    return { drawable };
  }

  /** Draw the output frame for pass time tau into the export canvas. */
  async renderAt(tau, outW, outH, seed, flipOut = false) {
    const edit = this.edit;
    const source = this.source;
    const renderer = this.ensureRenderer();
    const frame = mapFrame(edit, tau);
    const first = await this.sourceFrame(frame.a);
    if (frame.b != null && frame.mix > 0.001) {
      const copy = await createImageBitmap(first.drawable);
      first.dispose?.();
      const second = await this.sourceFrame(frame.b);
      renderer.setSource(copy, source.width, source.height);
      renderer.setSecond(second.drawable);
      copy.close?.();
      second.dispose?.();
    } else {
      renderer.setSource(first.drawable, source.width, source.height);
      first.dispose?.();
    }
    renderer.resize(outW, outH);
    renderer.render(gradeParams(edit, this.app.inspector.custom), {
      crop: edit.crop, mix2: frame.b != null ? frame.mix : 0, seed, flipOut,
    });
  }

  frameTimes(repeats) {
    const P = passInfo(this.edit).length;
    const perPass = Math.max(1, Math.round(P * FPS));
    const times = [];
    for (let r = 0; r < repeats; r += 1) for (let i = 0; i < perPass; i += 1) times.push(i / FPS);
    return { times, perPass, P };
  }

  async mixAudio(repeats) {
    const edit = this.edit;
    const { P } = this.frameTimes(1);
    const audio = this.app.audio;
    const includeOriginal = edit.effect === 'live' && !!audio.originalBuffer && !edit.audio.original.muted;
    const hasTrack = !!(edit.audio.track && audio.trackBuffer);
    if (!this.audioToggle.checked || (!includeOriginal && !hasTrack)) return null;
    return renderMix(edit, {
      original: audio.originalBuffer, track: audio.trackBuffer,
      passes: repeats, passLength: P, sourceStart: edit.trim.in, rate: edit.speed,
      includeOriginal, sampleRate: 48000,
    });
  }

  /* ------------------------------------------------------------------ mp4 */

  async exportMp4(size) {
    const { Muxer, ArrayBufferTarget } = await import('../vendor/mp4-muxer.mjs');
    const edit = this.edit;
    const g = this.geometry();
    const { width, height } = outputSize(g, size);
    const repeats = this.optRepeat.hidden ? 1 : Number(this.repeatSelect.value);
    const { times: passTimes, perPass } = this.frameTimes(1);
    const bitrate = Math.round(clamp(width * height * FPS * 0.11, 2e6, 24e6));
    const videoConfig = await pickVideoCodec(width, height, bitrate);
    if (!videoConfig) throw new Error('no H.264 encoder available');

    this.setProgress(0.01, 'Mixing sound…');
    const mix = await this.mixAudio(repeats);
    const audioCodec = mix ? await pickAudioCodec(mix.sampleRate) : null;

    const target = new ArrayBufferTarget();
    const muxer = new Muxer({
      target,
      video: { codec: 'avc', width, height, frameRate: FPS },
      audio: audioCodec ? { codec: audioCodec.muxCodec, numberOfChannels: 2, sampleRate: mix.sampleRate } : undefined,
      fastStart: 'in-memory',
      firstTimestampBehavior: 'offset',
    });

    let failure = null;
    const chunks = [];
    const encoder = new VideoEncoder({
      output: (chunk, meta) => {
        try {
          muxer.addVideoChunk(chunk, meta);
          if (repeats > 1) chunks.push(chunk);
        } catch (e) { failure = e; }
      },
      error: (e) => { failure = e; },
    });
    encoder.configure(videoConfig);
    this.beginFrameCache(edit.effect === 'bounce');
    const times = passTimes;
    const frameShare = audioCodec ? 0.8 : 0.9;

    for (let i = 0; i < times.length; i += 1) {
      if (this.cancelled) { encoder.close(); this.endFrameCache(); throw new Error('cancelled'); }
      if (failure) throw failure;
      await this.renderAt(times[i], width, height, i + 1, true);
      // explicit readback: GPU-backed canvas frames stall some encoders
      const frame = new VideoFrame(this.renderer.readPixels(), {
        format: 'RGBA', codedWidth: width, codedHeight: height,
        timestamp: Math.round((i * 1e6) / FPS), duration: Math.round(1e6 / FPS),
      });
      encoder.encode(frame, { keyFrame: i === 0 || i % (FPS * 2) === 0 });
      frame.close();
      while (encoder.encodeQueueSize > 6 && !failure && encoder.state === 'configured') {
        await new Promise((r) => setTimeout(r, 4));
      }
      if (i % 3 === 0) this.setProgress(0.05 + (i / times.length) * frameShare, `Rendering frame ${i + 1} of ${times.length}`);
    }
    await encoder.flush();
    encoder.close();
    this.endFrameCache();
    if (failure) throw failure;

    // every pass is identical: re-mux the first pass at later timestamps
    const passUs = Math.round((perPass * 1e6) / FPS);
    for (let r = 1; r < repeats; r += 1) {
      for (const chunk of chunks) muxer.addVideoChunk(chunk, undefined, chunk.timestamp + r * passUs);
    }

    if (audioCodec && mix) {
      this.setProgress(0.9, 'Encoding sound…');
      await this.encodeAudio(mix, audioCodec.config, muxer);
    }
    muxer.finalize();
    this.setProgress(1, 'Done');
    const blob = new Blob([target.buffer], { type: 'video/mp4' });
    return { kind: 'video', blob, name: `${this.baseName()}.mp4`, width, height };
  }

  async encodeAudio(buffer, config, muxer) {
    let failure = null;
    const encoder = new AudioEncoder({
      output: (chunk, meta) => {
        try { muxer.addAudioChunk(chunk, meta); } catch (e) { failure = e; }
      },
      error: (e) => { failure = e; },
    });
    encoder.configure(config);
    const block = 1024;
    const left = buffer.getChannelData(0);
    const right = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : left;
    for (let offset = 0; offset < buffer.length; offset += block) {
      const n = Math.min(block, buffer.length - offset);
      const data = new Float32Array(n * 2);
      data.set(left.subarray(offset, offset + n), 0);
      data.set(right.subarray(offset, offset + n), n);
      const audioData = new AudioData({
        format: 'f32-planar', sampleRate: buffer.sampleRate, numberOfFrames: n, numberOfChannels: 2,
        timestamp: Math.round((offset / buffer.sampleRate) * 1e6), data,
      });
      encoder.encode(audioData);
      audioData.close();
      if (failure) throw failure;
    }
    await encoder.flush();
    encoder.close();
  }

  /* -------------------------------------------------------- webm fallback */

  async exportRecorder(size) {
    const g = this.geometry();
    const { width, height } = outputSize(g, Math.min(size, 1920));
    const repeats = this.optRepeat.hidden ? 1 : Number(this.repeatSelect.value);
    const { times } = this.frameTimes(repeats);
    const mix = await this.mixAudio(repeats);
    const display = document.createElement('canvas');
    display.width = width;
    display.height = height;
    const dctx = display.getContext('2d');
    const stream = display.captureStream(FPS);
    let ctx = null;
    if (mix) {
      ctx = new AudioContext();
      const dest = ctx.createMediaStreamDestination();
      const src = ctx.createBufferSource();
      src.buffer = mix;
      src.connect(dest);
      dest.stream.getAudioTracks().forEach((t) => stream.addTrack(t));
      this.pendingAudio = src;
    }
    const type = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4'].find((m) => MediaRecorder.isTypeSupported(m)) || '';
    const recorder = new MediaRecorder(stream, { mimeType: type || undefined, videoBitsPerSecond: 8e6 });
    const chunks = [];
    recorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    const stopped = new Promise((r) => { recorder.onstop = r; });
    // pre-render frames to bitmaps so playback into the recorder is smooth
    const frames = [];
    this.beginFrameCache(this.edit.effect === 'bounce');
    for (let i = 0; i < times.length; i += 1) {
      if (this.cancelled) throw new Error('cancelled');
      await this.renderAt(times[i], width, height, i + 1);
      frames.push(await createImageBitmap(this.canvas));
      this.setProgress((i / times.length) * 0.6, `Rendering frame ${i + 1} of ${times.length}`);
    }
    this.endFrameCache();
    recorder.start(250);
    if (this.pendingAudio) this.pendingAudio.start();
    const start = performance.now();
    for (let i = 0; i < frames.length; i += 1) {
      if (this.cancelled) break;
      const due = start + (i * 1000) / FPS;
      while (performance.now() < due) await nextFrame();
      dctx.drawImage(frames[i], 0, 0);
      this.setProgress(0.6 + (i / frames.length) * 0.4, 'Recording in real time…');
    }
    await new Promise((r) => setTimeout(r, 120));
    recorder.stop();
    await stopped;
    frames.forEach((f) => f.close());
    ctx?.close();
    this.pendingAudio = null;
    if (this.cancelled) throw new Error('cancelled');
    const blobType = recorder.mimeType || 'video/webm';
    const ext = blobType.includes('mp4') ? 'mp4' : 'webm';
    return { kind: 'video', blob: new Blob(chunks, { type: blobType }), name: `${this.baseName()}.${ext}`, width, height };
  }

  /* ------------------------------------------------------------------ gif */

  async exportGif(size) {
    const { GIFEncoder, quantize, applyPalette } = await import('../vendor/gifenc.esm.js');
    const g = this.geometry();
    const { width, height } = outputSize(g, size);
    const gifFps = 15;
    const P = passInfo(this.edit).length;
    const count = Math.max(2, Math.round(P * gifFps));
    const gif = GIFEncoder();
    const scratch = document.createElement('canvas');
    scratch.width = width;
    scratch.height = height;
    const sctx = scratch.getContext('2d', { willReadFrequently: true });
    this.beginFrameCache(this.edit.effect === 'bounce');
    for (let i = 0; i < count; i += 1) {
      if (this.cancelled) throw new Error('cancelled');
      await this.renderAt(i / gifFps, width, height, 0);
      sctx.drawImage(this.canvas, 0, 0);
      const { data } = sctx.getImageData(0, 0, width, height);
      const palette = quantize(data, 256, { format: 'rgb565' });
      const index = applyPalette(data, palette, 'rgb565');
      gif.writeFrame(index, width, height, { palette, delay: Math.round(1000 / gifFps), repeat: 0 });
      this.setProgress(i / count, `Encoding GIF frame ${i + 1} of ${count}`);
      if (i % 2) await nextFrame();
    }
    this.endFrameCache();
    gif.finish();
    const blob = new Blob([gif.bytes()], { type: 'image/gif' });
    return { kind: 'image', blob, name: `${this.baseName()}.gif`, width, height };
  }

  /* ---------------------------------------------------------------- photo */

  async exportPhoto(size) {
    const edit = this.edit;
    const source = this.source;
    const g = this.geometry();
    const { width, height } = outputSize(g, size);
    const renderer = this.ensureRenderer();
    const params = gradeParams(edit, this.app.inspector.custom);
    if (edit.effect === 'longexposure') {
      const count = Math.max(2, Math.round((edit.trim.out - edit.trim.in) * 24));
      const scale = Math.min(1, 2400 / Math.max(source.width, source.height));
      const aw = Math.round(source.width * scale);
      const ah = Math.round(source.height * scale);
      renderer.beginAccumulate(aw, ah);
      for (let i = 0; i < count; i += 1) {
        if (this.cancelled) throw new Error('cancelled');
        const t = edit.trim.in + (i / (count - 1)) * (edit.trim.out - edit.trim.in);
        renderer.accumulate(await source.frameAt(t));
        this.setProgress(i / count, `Blending frame ${i + 1} of ${count}`);
      }
      renderer.useAccumulated();
      renderer.resize(width, height);
      renderer.render(params, { crop: edit.crop });
      renderer.endAccumulate(true);
    } else {
      this.setProgress(0.3, 'Rendering key photo…');
      renderer.setSource(await source.frameAt(edit.keyTime), source.width, source.height);
      renderer.resize(width, height);
      renderer.render(params, { crop: edit.crop });
    }
    const blob = await new Promise((resolve) => this.canvas.toBlob(resolve, 'image/jpeg', 0.93));
    this.setProgress(1, 'Done');
    const suffix = edit.effect === 'longexposure' ? 'long exposure' : 'key photo';
    return { kind: 'image', blob, name: `${this.baseName()} ${suffix}.jpg`, width, height };
  }
}
