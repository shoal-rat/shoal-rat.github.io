/* Audio: preview engine, offline export mix, waveform peaks, voice recorder.
   Both preview and export schedule sound with the same pass model:
   a pass is one play-through of the edited clip in output seconds; the
   soundtrack starts `offset` seconds into every pass. */

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.originalBuffer = null;
    this.trackBuffer = null;
    this.sources = [];
  }

  ensure() {
    if (this.ctx) return this.ctx;
    const AC = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AC({ latencyHint: 'interactive' });
    this.master = this.ctx.createGain();
    this.originalBus = this.ctx.createGain();
    this.trackBus = this.ctx.createGain();
    this.originalBus.connect(this.master);
    this.trackBus.connect(this.master);
    this.master.connect(this.ctx.destination);
    return this.ctx;
  }

  async resume() {
    this.ensure();
    if (this.ctx.state !== 'running') {
      try { await this.ctx.resume(); } catch (_) { /* needs a gesture */ }
    }
  }

  applyMix(edit) {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const original = edit.audio.original;
    this.originalBus.gain.setTargetAtTime(original.muted ? 0 : original.volume, now, 0.02);
    const track = edit.audio.track;
    this.trackBus.gain.setTargetAtTime(track ? track.volume : 0, now, 0.02);
  }

  stop() {
    for (const node of this.sources) {
      try { node.stop(); } catch (_) { /* already stopped */ }
      try { node.disconnect(); } catch (_) { /* ignore */ }
    }
    this.sources = [];
  }

  /**
   * Schedule the remainder of the current pass.
   * pass: { length, elapsed, sourceTime, rate, original }
   */
  schedule(edit, pass) {
    if (!this.ctx) return;
    this.stop();
    this.applyMix(edit);
    const now = this.ctx.currentTime + 0.02;
    schedulePass(this.ctx, edit, pass, now, {
      original: this.originalBuffer,
      track: this.trackBuffer,
      originalDest: this.originalBus,
      trackDest: this.trackBus,
      keep: (node) => this.sources.push(node),
    });
  }
}

/** Shared by preview and offline export. */
export function schedulePass(ctx, edit, pass, when, { original, track, originalDest, trackDest, keep = () => {} }) {
  const remaining = pass.length - pass.elapsed;
  if (remaining <= 0.01) return;

  if (pass.original && original) {
    const src = ctx.createBufferSource();
    src.buffer = original;
    src.playbackRate.value = pass.rate;
    const env = ctx.createGain();
    // tiny fades avoid clicks at the pass boundaries
    env.gain.setValueAtTime(0, when);
    env.gain.linearRampToValueAtTime(1, when + 0.012);
    env.gain.setValueAtTime(1, when + Math.max(0.013, remaining - 0.015));
    env.gain.linearRampToValueAtTime(0, when + remaining);
    src.connect(env).connect(originalDest);
    const offset = Math.min(Math.max(0, pass.sourceTime), original.duration - 0.001);
    src.start(when, offset, Math.max(0.01, remaining * pass.rate));
    keep(src);
  }

  const tr = edit.audio.track;
  if (tr && track) {
    const length = Math.max(0, Math.min(tr.trimOut, track.duration) - tr.trimIn);
    const startOut = tr.offset;
    const endOut = Math.min(pass.length, startOut + length);
    if (endOut > pass.elapsed + 0.01 && endOut > startOut) {
      const begin = Math.max(pass.elapsed, startOut);
      const at = when + (begin - pass.elapsed);
      const from = tr.trimIn + (begin - startOut);
      const duration = endOut - begin;
      const src = ctx.createBufferSource();
      src.buffer = track;
      const env = ctx.createGain();
      const fi = Math.min(tr.fadeIn, (endOut - startOut) / 2);
      const fo = Math.min(tr.fadeOut, (endOut - startOut) / 2);
      const gainAt = (tau) => {
        let g = 1;
        if (fi > 0.01) g = Math.min(g, (tau - startOut) / fi);
        if (fo > 0.01) g = Math.min(g, (endOut - tau) / fo);
        return Math.max(0, Math.min(1, g));
      };
      const toTime = (tau) => at + (tau - begin);
      env.gain.setValueAtTime(Math.max(0.0001, gainAt(begin)), at);
      if (fi > 0.01 && begin < startOut + fi) env.gain.linearRampToValueAtTime(1, toTime(startOut + fi));
      if (fo > 0.01) {
        const fadeStart = Math.max(begin, endOut - fo);
        env.gain.setValueAtTime(gainAt(fadeStart), toTime(fadeStart));
        env.gain.linearRampToValueAtTime(0.0001, toTime(endOut));
      } else {
        env.gain.setValueAtTime(1, Math.max(at, toTime(endOut) - 0.012));
        env.gain.linearRampToValueAtTime(0.0001, toTime(endOut));
      }
      src.connect(env).connect(trackDest);
      src.start(at, from, duration);
      keep(src);
    }
  }
}

/** Render the whole export soundtrack offline. */
export async function renderMix(edit, { original, track, passes, passLength, sourceStart, rate, includeOriginal, sampleRate = 48000 }) {
  const total = passes * passLength;
  const ctx = new OfflineAudioContext(2, Math.max(1, Math.ceil(total * sampleRate)), sampleRate);
  const originalBus = ctx.createGain();
  const trackBus = ctx.createGain();
  originalBus.gain.value = edit.audio.original.muted ? 0 : edit.audio.original.volume;
  trackBus.gain.value = edit.audio.track ? edit.audio.track.volume : 0;
  originalBus.connect(ctx.destination);
  trackBus.connect(ctx.destination);
  for (let i = 0; i < passes; i += 1) {
    schedulePass(ctx, edit, {
      length: passLength, elapsed: 0, sourceTime: sourceStart, rate, original: includeOriginal,
    }, i * passLength, { original, track, originalDest: originalBus, trackDest: trackBus });
  }
  return ctx.startRendering();
}

/* ------------------------------------------------------------ peaks */

const peakCache = new WeakMap();

export function peaks(buffer, bins = 600) {
  const cached = peakCache.get(buffer);
  if (cached && cached.length === bins) return cached;
  const out = new Float32Array(bins);
  const channels = Math.min(2, buffer.numberOfChannels);
  const step = buffer.length / bins;
  let max = 0.0001;
  for (let c = 0; c < channels; c += 1) {
    const data = buffer.getChannelData(c);
    for (let i = 0; i < bins; i += 1) {
      const start = Math.floor(i * step);
      const end = Math.min(data.length, Math.floor((i + 1) * step));
      let peak = out[i];
      for (let j = start; j < end; j += 16) {
        const v = Math.abs(data[j]);
        if (v > peak) peak = v;
      }
      out[i] = peak;
      if (peak > max) max = peak;
    }
  }
  for (let i = 0; i < bins; i += 1) out[i] /= max;
  peakCache.set(buffer, out);
  return out;
}

/** Draw a slice [t0, t1] of a buffer's peaks as rounded bars. */
export function drawWave(canvas, buffer, t0, t1, color) {
  const ctx = canvas.getContext('2d');
  const { width, height } = canvas;
  ctx.clearRect(0, 0, width, height);
  if (!buffer) return;
  const all = peaks(buffer, 1200);
  const i0 = Math.floor((t0 / buffer.duration) * all.length);
  const i1 = Math.ceil((t1 / buffer.duration) * all.length);
  const bars = Math.max(8, Math.floor(width / (3 * (window.devicePixelRatio || 1))));
  const barW = width / bars;
  ctx.fillStyle = color;
  for (let b = 0; b < bars; b += 1) {
    const a = i0 + Math.floor((b / bars) * (i1 - i0));
    const z = i0 + Math.floor(((b + 1) / bars) * (i1 - i0));
    let p = 0;
    for (let i = a; i <= z && i < all.length; i += 1) p = Math.max(p, all[i] || 0);
    const h = Math.max(1.5, p * height * 0.86);
    ctx.fillRect(b * barW + barW * 0.2, (height - h) / 2, barW * 0.6, h);
  }
}

/* ---------------------------------------------------------- recorder */

export class VoiceRecorder {
  async start(audioCtx, onLevel) {
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 512;
    audioCtx.createMediaStreamSource(this.stream).connect(analyser);
    const data = new Uint8Array(analyser.frequencyBinCount);
    const mime = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm'].find((m) => window.MediaRecorder?.isTypeSupported?.(m)) || '';
    this.chunks = [];
    this.recorder = new MediaRecorder(this.stream, mime ? { mimeType: mime } : undefined);
    this.recorder.ondataavailable = (event) => { if (event.data.size) this.chunks.push(event.data); };
    this.recorder.start(200);
    this.startedAt = performance.now();
    const meter = () => {
      analyser.getByteTimeDomainData(data);
      let peak = 0;
      for (const v of data) peak = Math.max(peak, Math.abs(v - 128) / 128);
      onLevel?.(Math.min(1, peak * 1.6), (performance.now() - this.startedAt) / 1000);
      this.raf = requestAnimationFrame(meter);
    };
    meter();
  }

  async stop(audioCtx) {
    cancelAnimationFrame(this.raf);
    const recorder = this.recorder;
    if (!recorder) return null;
    const stopped = new Promise((resolve) => { recorder.onstop = resolve; });
    recorder.stop();
    await stopped;
    this.stream.getTracks().forEach((t) => t.stop());
    const blob = new Blob(this.chunks, { type: recorder.mimeType || 'audio/webm' });
    this.recorder = null;
    return audioCtx.decodeAudioData(await blob.arrayBuffer());
  }

  cancel() {
    cancelAnimationFrame(this.raf);
    try { this.recorder?.stop(); } catch (_) { /* ignore */ }
    this.stream?.getTracks().forEach((t) => t.stop());
    this.recorder = null;
  }
}
