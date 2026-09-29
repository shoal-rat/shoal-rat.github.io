/* Playback clock and frame provider.
   Output time (tau) runs within one "pass" of the edited clip; each effect
   maps tau back to source frames. The live effect on a video file streams
   straight from the <video> element; loop/bounce/long exposure read from a
   frame cache so they can run backwards, cross-fade and average. */

import { Emitter, clamp } from './util.js';
import { FrameCache, cacheKey } from './media.js';

export function passInfo(edit) {
  const D = Math.max(0.05, edit.trim.out - edit.trim.in);
  const speed = edit.speed || 1;
  if (edit.effect === 'loop') {
    const X = Math.min(0.6, D * 0.25);
    return { D, X, length: (D - X) / speed };
  }
  if (edit.effect === 'bounce') return { D, X: 0, length: (2 * D) / speed };
  if (edit.effect === 'longexposure') return { D, X: 0, length: D / speed };
  return { D, X: 0, length: D / speed };
}

/** Map output time within a pass to the source frame(s) it shows. */
export function mapFrame(edit, tau) {
  const { D, X, length } = passInfo(edit);
  const u = clamp(tau, 0, length) * (edit.speed || 1);
  const tin = edit.trim.in;
  if (edit.effect === 'loop' && X > 0) {
    const a = tin + X + u;
    const seamStart = D - 2 * X;
    if (u > seamStart) {
      const w = clamp((u - seamStart) / X, 0, 1);
      const b = tin + (u - seamStart);
      return { a, b, mix: w, display: w > 0.5 ? b : a };
    }
    return { a, b: null, mix: 0, display: a };
  }
  if (edit.effect === 'bounce') {
    const t = u <= D ? tin + u : tin + 2 * D - u;
    return { a: t, b: null, mix: 0, display: t };
  }
  const t = tin + u;
  return { a: t, b: null, mix: 0, display: t };
}

/** First output time at which a source time is shown. */
export function tauFor(edit, sourceT) {
  const { D, X } = passInfo(edit);
  const rel = clamp(sourceT - edit.trim.in, 0, D);
  if (edit.effect === 'loop') return Math.max(0, rel - X) / (edit.speed || 1);
  return rel / (edit.speed || 1);
}

const usesCache = (source, edit) =>
  source.kind === 'video' && (edit.effect === 'loop' || edit.effect === 'bounce' || edit.effect === 'longexposure');

export class Player extends Emitter {
  constructor(audio, renderer) {
    super();
    this.audio = audio;
    this.renderer = renderer;
    this.cache = new FrameCache();
    this.source = null;
    this.playing = false;
    this.tau = 0;
    this.cursor = 0;
    this.scrubTime = null;
    this.frameDirty = true;
    this.lastNow = 0;
    this.accumKey = '';
    this.prepareToken = 0;
    this.busy = false;
    this.seekPending = false;
  }

  load(source, edit) {
    this.pause(true);
    this.cache.dispose();
    this.accumKey = '';
    this.source = source;
    this.tau = 0;
    this.cursor = edit.trim.in;
    this.frameDirty = true;
    if (source.kind === 'video') {
      const el = source.element;
      el.onseeked = () => { this.seekPending = false; this.frameDirty = true; };
      if ('requestVideoFrameCallback' in el) {
        const onFrame = () => {
          if (this.source !== source) return;
          this.frameDirty = true;
          el.requestVideoFrameCallback(onFrame);
        };
        el.requestVideoFrameCallback(onFrame);
      }
    }
  }

  get currentSourceTime() {
    return this.scrubTime != null ? this.scrubTime : this.displayTime ?? this.cursor;
  }

  /* ---------------------------------------------------------- prepare */

  /** Build whatever the current effect needs (frame cache, exposure). */
  async prepare(edit) {
    const source = this.source;
    if (!source) return;
    const token = ++this.prepareToken;
    this.abort?.abort();
    const needCache = usesCache(source, edit);
    const key = cacheKey(source, edit);
    try {
      if (needCache && !this.cache.matches(key)) {
        this.abort = new AbortController();
        this.setBusy(true, 0, 'Preparing frames');
        const wasPlaying = this.playing;
        if (wasPlaying) this.pause();
        await this.cache.build(source, edit.trim.in, edit.trim.out, {
          signal: this.abort.signal,
          onProgress: (p) => { if (token === this.prepareToken) this.emit('busy', { busy: true, progress: p, label: 'Preparing frames' }); },
        });
        if (token !== this.prepareToken) return;
        if (wasPlaying) this.play(edit);
      }
      if (edit.effect === 'longexposure') {
        const accKey = `${key}|${edit.speed}`;
        if (this.accumKey !== accKey) {
          this.setBusy(true, 0, 'Blending exposure');
          await this.buildExposure(edit, token);
          if (token !== this.prepareToken) return;
          this.accumKey = accKey;
        }
      }
      this.setBusy(false);
      this.frameDirty = true;
    } catch (error) {
      if (error.name !== 'AbortError') {
        this.setBusy(false);
        this.emit('error', error);
      }
    }
  }

  async buildExposure(edit, token) {
    const source = this.source;
    const renderer = this.renderer;
    let frames;
    let width;
    let height;
    if (source.kind === 'video') {
      frames = this.cache.frames;
      width = this.cache.width;
      height = this.cache.height;
    } else {
      const scale = Math.min(1, 960 / Math.max(source.width, source.height));
      width = Math.round(source.width * scale);
      height = Math.round(source.height * scale);
      frames = null;
    }
    renderer.beginAccumulate(width, height);
    if (frames) {
      frames.forEach((frame) => renderer.accumulate(frame));
    } else {
      const count = Math.max(2, Math.round((edit.trim.out - edit.trim.in) * 24));
      for (let i = 0; i < count; i += 1) {
        if (token !== this.prepareToken) return;
        renderer.accumulate(source.draw(edit.trim.in + (i / (count - 1)) * (edit.trim.out - edit.trim.in)));
        if (i % 8 === 0) {
          this.emit('busy', { busy: true, progress: i / count, label: 'Blending exposure' });
          await new Promise((r) => setTimeout(r, 0));
        }
      }
    }
  }

  setBusy(busy, progress = 0, label = '') {
    this.busy = busy;
    this.emit('busy', { busy, progress, label });
  }

  invalidateExposure() { this.accumKey = ''; }

  /* --------------------------------------------------------- transport */

  play(edit) {
    if (!this.source || this.busy) return;
    if (edit.effect === 'longexposure') return;
    this.audio.resume();
    this.scrubTime = null;
    const { length } = passInfo(edit);
    // resume from the cursor if it's inside the trim, else from the top
    const inside = this.cursor >= edit.trim.in && this.cursor < edit.trim.out - 0.02;
    this.tau = inside ? tauFor(edit, this.cursor) : 0;
    if (this.tau >= length - 0.02) this.tau = 0;
    this.playing = true;
    this.lastNow = performance.now();
    if (this.isStreaming(edit)) {
      const el = this.source.element;
      el.playbackRate = edit.speed;
      el.currentTime = mapFrame(edit, this.tau).a;
      el.play().catch(() => {});
    }
    this.scheduleAudio(edit);
    this.emit('state');
  }

  pause(silent = false) {
    if (this.source?.kind === 'video') this.source.element.pause();
    this.audio.stop();
    if (this.playing && this.displayTime != null) this.cursor = this.displayTime;
    this.playing = false;
    if (!silent) this.emit('state');
  }

  toggle(edit) {
    if (this.playing) this.pause(); else this.play(edit);
  }

  /** Jump (paused or playing) to a source time. */
  seek(edit, sourceT) {
    const t = clamp(sourceT, 0, this.source?.duration || 0);
    this.cursor = t;
    this.scrubTime = null;
    this.frameDirty = true;
    if (this.playing) {
      if (t < edit.trim.in || t >= edit.trim.out) { this.pause(); this.cursor = t; return; }
      this.tau = tauFor(edit, t);
      if (this.isStreaming(edit)) this.source.element.currentTime = t;
      this.scheduleAudio(edit);
    }
  }

  /** Show an arbitrary source frame while dragging, without moving the cursor. */
  scrub(sourceT) {
    this.scrubTime = sourceT == null ? null : clamp(sourceT, 0, this.source?.duration || 0);
    this.frameDirty = true;
  }

  step(edit, frames) {
    if (this.playing) this.pause();
    const fps = this.source?.fps || 30;
    this.seek(edit, (this.displayTime ?? this.cursor) + frames / fps);
  }

  isStreaming(edit) {
    return this.source?.kind === 'video' && edit.effect === 'live';
  }

  scheduleAudio(edit) {
    const { length } = passInfo(edit);
    const frame = mapFrame(edit, this.tau);
    this.audio.schedule(edit, {
      length,
      elapsed: this.tau,
      sourceTime: frame.a,
      rate: edit.speed,
      original: edit.effect === 'live',
    });
  }

  /* -------------------------------------------------------------- tick */

  /**
   * Advance the clock and return what to draw:
   * { a, b, mix, changed, still } — a/b are drawables, still = long exposure.
   */
  tick(edit, now) {
    const source = this.source;
    if (!source) return null;
    const dt = Math.min(0.1, (now - this.lastNow) / 1000);
    this.lastNow = now;

    // dragging on the timeline always shows that exact frame
    if (this.scrubTime != null) return this.frameForTime(edit, this.scrubTime);

    if (edit.effect === 'longexposure') {
      const changed = this.frameDirty;
      this.frameDirty = false;
      this.displayTime = null;
      return { still: true, changed };
    }

    if (!this.playing) return this.frameForTime(edit, this.cursor);

    const { length } = passInfo(edit);
    if (this.isStreaming(edit)) {
      const el = source.element;
      const t = el.currentTime;
      if (t >= edit.trim.out - 0.012 || el.ended || t < edit.trim.in - 0.2) {
        el.currentTime = edit.trim.in;
        if (el.paused) el.play().catch(() => {});
        this.tau = 0;
        this.scheduleAudio(edit);
      } else {
        this.tau = (t - edit.trim.in) / edit.speed;
      }
      this.displayTime = clamp(t, edit.trim.in, edit.trim.out);
      const changed = this.frameDirty || !('requestVideoFrameCallback' in el);
      this.frameDirty = false;
      return { a: el, b: null, mix: 0, changed, seed: now };
    }

    this.tau += dt;
    if (this.tau >= length) {
      this.tau %= length;
      this.scheduleAudio(edit);
    }
    const frame = mapFrame(edit, this.tau);
    this.displayTime = frame.display;
    return this.draw(edit, frame, true, now);
  }

  frameForTime(edit, t) {
    const source = this.source;
    this.displayTime = t;
    if (source.kind === 'sample') {
      const changed = this.frameDirty || this.lastDrawn !== t;
      this.frameDirty = false;
      this.lastDrawn = t;
      return { a: changed ? source.draw(t) : source.canvasA, b: null, mix: 0, changed };
    }
    // paused video: prefer the cache when it holds this time, else seek the element
    if (usesCache(source, edit) && this.cache.frames.length && t >= this.cache.t0 && t <= this.cache.t1 && this.scrubTime == null) {
      const changed = this.frameDirty || this.lastDrawn !== t;
      this.frameDirty = false;
      this.lastDrawn = t;
      return { a: this.cache.at(t), b: null, mix: 0, changed };
    }
    const el = source.element;
    if (!el.paused) el.pause();
    if (Math.abs(el.currentTime - t) > 0.004 && !this.seekPending) {
      this.seekPending = true;
      el.currentTime = t;
    }
    const changed = this.frameDirty && !this.seekPending;
    if (changed) this.frameDirty = false;
    return { a: el, b: null, mix: 0, changed };
  }

  draw(edit, frame, playing, now) {
    const source = this.source;
    if (source.kind === 'sample') {
      return {
        a: source.draw(frame.a, 'a'),
        b: frame.b != null ? source.draw(frame.b, 'b') : null,
        mix: frame.mix,
        changed: true,
        seed: playing ? now : 0,
      };
    }
    if (!this.cache.frames.length) return { a: source.element, b: null, mix: 0, changed: this.frameDirty };
    return {
      a: this.cache.at(frame.a),
      b: frame.b != null ? this.cache.at(frame.b) : null,
      mix: frame.mix,
      changed: true,
      seed: playing ? now : 0,
    };
  }

  dispose() {
    this.pause(true);
    this.abort?.abort();
    this.cache.dispose();
    this.renderer.endAccumulate(true);
  }
}
