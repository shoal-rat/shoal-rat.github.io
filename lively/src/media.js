/* Clip sources.
   VideoSource plays a local file in a muted <video> for the live preview and
   keeps a second, hidden element for frame-accurate seeks (thumbnails, the
   effect frame cache, export). SampleSource paints procedural clips. */

import { SAMPLES, LOOP, renderSampleAudio } from './samples.js';

function waitEvent(target, type, timeout = 4000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { cleanup(); reject(new Error(`timeout waiting for ${type}`)); }, timeout);
    const onEvent = () => { cleanup(); resolve(); };
    const onError = () => { cleanup(); reject(new Error(`${type} failed`)); };
    function cleanup() {
      clearTimeout(timer);
      target.removeEventListener(type, onEvent);
      target.removeEventListener('error', onError);
    }
    target.addEventListener(type, onEvent, { once: true });
    target.addEventListener('error', onError, { once: true });
  });
}

function makeVideo(url) {
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  video.crossOrigin = 'anonymous';
  video.src = url;
  video.setAttribute('aria-hidden', 'true');
  video.className = 'lv-hidden-media';
  document.body.append(video);
  return video;
}

/* ------------------------------------------------------------ video */

export class VideoSource {
  static async open(file) {
    const url = URL.createObjectURL(file);
    const main = makeVideo(url);
    try {
      await waitEvent(main, 'loadeddata', 15000);
    } catch (error) {
      main.remove();
      URL.revokeObjectURL(url);
      throw new Error('This video format can’t be played by your browser.');
    }
    const source = new VideoSource(file, url, main);
    source.scrubber = makeVideo(url);
    try { await waitEvent(source.scrubber, 'loadeddata', 15000); } catch (_) { /* seek will retry */ }
    return source;
  }

  constructor(file, url, main) {
    this.kind = 'video';
    this.file = file;
    this.name = file.name.replace(/\.[^.]+$/, '') || 'Untitled';
    this.url = url;
    this.element = main;
    this.duration = Number.isFinite(main.duration) ? main.duration : 3;
    this.width = main.videoWidth || 1280;
    this.height = main.videoHeight || 720;
    this.randomAccess = false;
    this.fps = 30;
    this.queue = Promise.resolve();
    this.audioBuffer = undefined;
  }

  /** Seek the hidden scrubber; resolves with it once the frame is ready. */
  frameAt(time) {
    const run = async () => {
      const video = this.scrubber;
      const t = Math.min(Math.max(0, time), Math.max(0, this.duration - 0.001));
      if (Math.abs(video.currentTime - t) > 0.0005 || video.readyState < 2) {
        const presented = 'requestVideoFrameCallback' in video
          ? new Promise((resolve) => {
            const timer = setTimeout(resolve, 250);
            video.requestVideoFrameCallback(() => { clearTimeout(timer); resolve(); });
          })
          : Promise.resolve();
        video.currentTime = t;
        // long-GOP files can take a while to decode up to the target frame;
        // on timeout, carry on with whatever frame the element shows
        try { await waitEvent(video, 'seeked', 20000); } catch (_) { /* best effort */ }
        await presented;
      }
      return video;
    };
    const result = this.queue.then(run, run);
    this.queue = result.catch(() => {});
    return result;
  }

  async decodeAudio(ctx) {
    if (this.audioBuffer !== undefined) return this.audioBuffer;
    try {
      const bytes = await this.file.arrayBuffer();
      this.audioBuffer = await ctx.decodeAudioData(bytes);
    } catch (_) {
      this.audioBuffer = null;
    }
    return this.audioBuffer;
  }

  dispose() {
    this.element.pause();
    this.element.remove();
    this.scrubber?.remove();
    URL.revokeObjectURL(this.url);
  }
}

/* ------------------------------------------------------------ sample */

export class SampleSource {
  constructor(id) {
    const sample = SAMPLES.find((s) => s.id === id) || SAMPLES[0];
    this.kind = 'sample';
    this.sample = sample;
    this.name = sample.name;
    this.width = sample.width;
    this.height = sample.height;
    this.duration = LOOP;
    this.randomAccess = true;
    this.fps = 30;
    this.canvasA = this.makeCanvas();
    this.canvasB = this.makeCanvas();
    this.pool = [this.makeCanvas(), this.makeCanvas(), this.makeCanvas()];
    this.poolIndex = 0;
    this.audioBuffer = undefined;
  }

  makeCanvas() {
    const canvas = document.createElement('canvas');
    canvas.width = this.width;
    canvas.height = this.height;
    return canvas;
  }

  paint(canvas, time) {
    this.sample.paint(canvas.getContext('2d'), canvas.width, canvas.height, time);
    return canvas;
  }

  /** Preview frames: slot 'a' or 'b' so a cross-fade can hold two at once. */
  draw(time, slot = 'a') {
    return this.paint(slot === 'b' ? this.canvasB : this.canvasA, time);
  }

  /** Random access; rotates through a small pool so a caller's frame stays
      intact while another caller (thumbnails, export) paints the next one. */
  async frameAt(time) {
    this.poolIndex = (this.poolIndex + 1) % this.pool.length;
    return this.paint(this.pool[this.poolIndex], time);
  }

  async decodeAudio() {
    if (this.audioBuffer === undefined) {
      try { this.audioBuffer = await renderSampleAudio(this.sample.audio); } catch (_) { this.audioBuffer = null; }
    }
    return this.audioBuffer;
  }

  dispose() {}
}

/* ------------------------------------------------------- frame cache */

export class FrameCache {
  constructor() {
    this.frames = [];
    this.key = '';
    this.fps = 24;
    this.t0 = 0;
    this.t1 = 0;
    this.width = 0;
    this.height = 0;
  }

  matches(key) { return this.key === key && this.frames.length > 0; }

  async build(source, t0, t1, { signal, onProgress, fps = 24, maxPixels = 42e6, maxEdge = 960 } = {}) {
    this.dispose();
    const count = Math.max(2, Math.round((t1 - t0) * fps) + 1);
    let scale = Math.min(1, maxEdge / Math.max(source.width, source.height));
    const perFrame = maxPixels / count;
    if (source.width * source.height * scale * scale > perFrame) {
      scale = Math.sqrt(perFrame / (source.width * source.height));
    }
    const width = Math.max(16, Math.round(source.width * scale));
    const height = Math.max(16, Math.round(source.height * scale));
    const frames = [];
    for (let i = 0; i < count; i += 1) {
      if (signal?.aborted) { frames.forEach((f) => f.close?.()); throw new DOMException('aborted', 'AbortError'); }
      const t = Math.min(t1, t0 + i / fps);
      const drawable = await source.frameAt(t);
      frames.push(await createImageBitmap(drawable, { resizeWidth: width, resizeHeight: height, resizeQuality: 'medium' }));
      onProgress?.((i + 1) / count);
    }
    this.frames = frames;
    this.fps = fps;
    this.t0 = t0;
    this.t1 = t1;
    this.width = width;
    this.height = height;
    this.key = `${source.name}|${t0.toFixed(3)}|${t1.toFixed(3)}`;
    return this;
  }

  at(time) {
    if (!this.frames.length) return null;
    const index = Math.round((time - this.t0) * this.fps);
    return this.frames[Math.min(this.frames.length - 1, Math.max(0, index))];
  }

  dispose() {
    this.frames.forEach((frame) => frame.close?.());
    this.frames = [];
    this.key = '';
  }
}

export function cacheKey(source, edit) {
  return `${source.name}|${edit.trim.in.toFixed(3)}|${edit.trim.out.toFixed(3)}`;
}

/** Cover-fit a drawable into a small canvas context. */
export function drawCover(ctx, drawable, width, height) {
  const sw = drawable.videoWidth || drawable.width;
  const sh = drawable.videoHeight || drawable.height;
  const scale = Math.max(width / sw, height / sh);
  const dw = sw * scale;
  const dh = sh * scale;
  ctx.drawImage(drawable, (width - dw) / 2, (height - dh) / 2, dw, dh);
}

export const ACCEPTED_VIDEO = /\.(mp4|m4v|mov|webm|ogv|mkv)$/i;
