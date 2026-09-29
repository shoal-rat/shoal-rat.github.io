/* Procedural sample clips and synthesized audio.
   Every motion is periodic in LOOP seconds, so the samples loop seamlessly
   like a real Live Photo; nothing here is downloaded. */

export const LOOP = 3;

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const TAU = Math.PI * 2;
const wrap = (v, size) => ((v % size) + size) % size;

/* ------------------------------------------------------- golden hour */

function paintGolden(ctx, w, h, t) {
  const ph = (t % LOOP) / LOOP;

  const sky = ctx.createLinearGradient(0, 0, 0, h * 0.62);
  sky.addColorStop(0, '#5B4B8A');
  sky.addColorStop(0.38, '#E0719A');
  sky.addColorStop(0.72, '#FFA56B');
  sky.addColorStop(1, '#FFD39A');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, h * 0.62);

  // sun + glow
  const sx = w * 0.64;
  const sy = h * 0.47 + Math.sin(ph * TAU) * h * 0.004;
  const glow = ctx.createRadialGradient(sx, sy, 0, sx, sy, w * 0.55);
  glow.addColorStop(0, 'rgba(255,236,190,0.9)');
  glow.addColorStop(0.18, 'rgba(255,200,140,0.45)');
  glow.addColorStop(1, 'rgba(255,160,120,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, w, h * 0.62);
  ctx.fillStyle = '#FFF1D2';
  ctx.beginPath();
  ctx.arc(sx, sy, w * 0.085, 0, TAU);
  ctx.fill();

  // clouds: flat rounded bands drifting exactly one wrap per loop
  const cloud = (cx, cy, s, color) => {
    ctx.fillStyle = color;
    const r = w * 0.03 * s;
    ctx.beginPath();
    ctx.roundRect(cx - r * 4, cy - r * 0.8, r * 8, r * 1.6, r * 0.8);
    ctx.fill();
    ctx.beginPath();
    ctx.roundRect(cx - r * 2, cy - r * 1.8, r * 4.4, r * 1.8, r * 0.9);
    ctx.fill();
  };
  const span = w * 1.5;
  cloud(wrap(w * 0.1 + ph * span, span) - w * 0.25, h * 0.14, 1.2, 'rgba(255,214,222,0.8)');
  cloud(wrap(w * 0.9 + ph * span, span) - w * 0.25, h * 0.25, 0.8, 'rgba(255,196,170,0.75)');
  cloud(wrap(w * 0.5 + ph * span, span) - w * 0.25, h * 0.07, 0.6, 'rgba(236,178,210,0.7)');

  // birds gliding across, wing flap periodic
  ctx.strokeStyle = '#3B2A48';
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const bird = (bx, by, s, phase) => {
    const r = w * 0.022 * s;
    const flap = Math.sin((ph * 4 + phase) * TAU) * r * 0.55;
    ctx.lineWidth = w * 0.0055 * s;
    ctx.beginPath();
    ctx.moveTo(bx - r, by + flap);
    ctx.quadraticCurveTo(bx - r * 0.4, by - r * 0.15, bx, by);
    ctx.quadraticCurveTo(bx + r * 0.4, by - r * 0.15, bx + r, by + flap);
    ctx.stroke();
  };
  const bspan = w * 1.4;
  bird(wrap(w * 0.05 + ph * bspan, bspan) - w * 0.2, h * 0.3, 1, 0);
  bird(wrap(w * 0.05 + ph * bspan, bspan) - w * 0.2 + w * 0.11, h * 0.335, 0.72, 0.3);
  bird(wrap(w * 0.05 + ph * bspan, bspan) - w * 0.2 - w * 0.08, h * 0.35, 0.58, 0.6);

  // hills
  const hill = (points, color) => {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(0, h * 0.62);
    for (const [x, y] of points) ctx.lineTo(x * w, y * h);
    ctx.lineTo(w, h * 0.62);
    ctx.closePath();
    ctx.fill();
  };
  hill([[0, 0.5], [0.18, 0.43], [0.36, 0.5], [0.52, 0.45], [0.7, 0.52], [1, 0.47]], '#7E5E9A');
  hill([[0, 0.56], [0.22, 0.5], [0.44, 0.57], [0.62, 0.53], [0.84, 0.58], [1, 0.55]], '#3D7DFF');
  hill([[0, 0.6], [0.3, 0.56], [0.55, 0.61], [0.8, 0.57], [1, 0.6]], '#2ECC9B');

  // sea
  const sea = ctx.createLinearGradient(0, h * 0.62, 0, h);
  sea.addColorStop(0, '#FF9E7A');
  sea.addColorStop(0.18, '#C86A8E');
  sea.addColorStop(0.6, '#2B4A7E');
  sea.addColorStop(1, '#173056');
  ctx.fillStyle = sea;
  ctx.fillRect(0, h * 0.62, w, h * 0.38);

  // sun path shimmer
  for (let i = 0; i < 14; i += 1) {
    const y = h * (0.64 + i * 0.024);
    const width = w * (0.04 + i * 0.012) * (0.7 + 0.3 * Math.sin((ph * 2 + i * 0.37) * TAU));
    ctx.fillStyle = `rgba(255,236,200,${0.75 - i * 0.045})`;
    ctx.beginPath();
    ctx.roundRect(sx - width / 2 + Math.sin((ph + i * 0.13) * TAU) * w * 0.012, y, width, h * 0.006, h * 0.003);
    ctx.fill();
  }

  // swell lines
  ctx.strokeStyle = 'rgba(255,255,255,0.22)';
  ctx.lineWidth = h * 0.004;
  for (let i = 0; i < 5; i += 1) {
    const y = h * (0.72 + i * 0.055);
    const off = wrap(ph * w * (0.5 + i * 0.25) * (i % 2 ? -1 : 1) + i * w * 0.31, w * 1.3) - w * 0.15;
    ctx.beginPath();
    ctx.moveTo(off - w * 0.12, y);
    ctx.lineTo(off + w * 0.12, y);
    ctx.stroke();
  }

  // sparkles
  const r = rng(7);
  for (let i = 0; i < 26; i += 1) {
    const x = r() * w;
    const y = h * (0.66 + r() * 0.32);
    const tw = Math.max(0, Math.sin((ph * (1 + Math.floor(r() * 3)) + r()) * TAU));
    ctx.fillStyle = `rgba(255,248,230,${tw * 0.9})`;
    const s = h * 0.004 * (0.5 + tw);
    ctx.fillRect(x - s, y - s * 0.3, s * 2, s * 0.6);
  }
}

/* --------------------------------------------------------- neon rain */

const RAIN = (() => {
  const r = rng(42);
  return Array.from({ length: 160 }, () => ({ x: r(), y: r(), len: 0.03 + r() * 0.05, speed: 1 + Math.floor(r() * 3), a: 0.25 + r() * 0.45 }));
})();

const WINDOWS = (() => {
  const r = rng(11);
  return Array.from({ length: 90 }, () => ({ x: r(), y: r(), on: r() > 0.35, flick: r() > 0.9, hue: r() }));
})();

function paintNeon(ctx, w, h, t) {
  const ph = (t % LOOP) / LOOP;
  const sky = ctx.createLinearGradient(0, 0, 0, h * 0.7);
  sky.addColorStop(0, '#0B1030');
  sky.addColorStop(0.6, '#2A1B4F');
  sky.addColorStop(1, '#5A2A62');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, h);

  // skyline blocks
  const blocks = [[0, 0.22, 0.16], [0.14, 0.12, 0.3], [0.27, 0.2, 0.2], [0.44, 0.09, 0.36], [0.56, 0.18, 0.14], [0.7, 0.14, 0.27], [0.83, 0.2, 0.22], [0.95, 0.15, 0.3]];
  blocks.forEach(([x, bw, top], index) => {
    ctx.fillStyle = index % 2 ? '#161A3A' : '#1D2147';
    ctx.fillRect(x * w, top * h, bw * w, h * 0.72 - top * h);
  });
  WINDOWS.forEach((win, index) => {
    const block = blocks[index % blocks.length];
    const x = (block[0] + 0.012 + win.x * (block[1] - 0.03)) * w;
    const y = (block[2] + 0.03 + win.y * (0.66 - block[2] - 0.06)) * h;
    let on = win.on;
    if (win.flick) on = Math.sin((ph * 6 + win.hue) * TAU) > -0.2;
    if (!on) return;
    ctx.fillStyle = win.hue > 0.7 ? '#7FD6FF' : win.hue > 0.4 ? '#FFD37A' : '#FFB0D0';
    ctx.globalAlpha = 0.75;
    ctx.fillRect(x, y, w * 0.011, h * 0.016);
  });
  ctx.globalAlpha = 1;

  // neon shapes (abstract, no lettering)
  const neon = (x, y, bw, bh, color, pulse) => {
    const a = 0.75 + 0.25 * Math.sin((ph * pulse) * TAU);
    ctx.save();
    ctx.shadowColor = color;
    ctx.shadowBlur = w * 0.02;
    ctx.strokeStyle = color;
    ctx.globalAlpha = a;
    ctx.lineWidth = w * 0.006;
    ctx.beginPath();
    ctx.roundRect(x * w, y * h, bw * w, bh * h, h * 0.02);
    ctx.stroke();
    ctx.restore();
  };
  neon(0.16, 0.36, 0.09, 0.07, '#FF4FA3', 2);
  neon(0.47, 0.3, 0.06, 0.18, '#3DE2FF', 1);
  neon(0.72, 0.4, 0.1, 0.05, '#FFB84C', 3);
  ctx.save();
  ctx.shadowColor = '#7CFFB5';
  ctx.shadowBlur = w * 0.02;
  ctx.strokeStyle = '#7CFFB5';
  ctx.lineWidth = w * 0.006;
  ctx.beginPath();
  ctx.arc(0.88 * w, 0.33 * h, h * 0.045, 0, TAU);
  ctx.stroke();
  ctx.restore();

  // street + reflections
  const street = ctx.createLinearGradient(0, h * 0.72, 0, h);
  street.addColorStop(0, '#1A1834');
  street.addColorStop(1, '#0C0D1C');
  ctx.fillStyle = street;
  ctx.fillRect(0, h * 0.72, w, h * 0.28);
  const reflect = (x, width, color) => {
    for (let i = 0; i < 10; i += 1) {
      const y = h * (0.74 + i * 0.024);
      const wob = Math.sin((ph * 2 + i * 0.3) * TAU) * w * 0.006;
      ctx.fillStyle = color;
      ctx.globalAlpha = 0.5 - i * 0.045;
      ctx.fillRect(x * w + wob, y, width * w * (1 - i * 0.05), h * 0.008);
    }
    ctx.globalAlpha = 1;
  };
  reflect(0.165, 0.09, '#FF4FA3');
  reflect(0.47, 0.06, '#3DE2FF');
  reflect(0.72, 0.1, '#FFB84C');

  // headlights sweeping (periodic)
  const carX = wrap(ph * w * 1.6, w * 1.6) - w * 0.3;
  const beam = ctx.createRadialGradient(carX, h * 0.8, 0, carX, h * 0.8, w * 0.18);
  beam.addColorStop(0, 'rgba(255,240,200,0.55)');
  beam.addColorStop(1, 'rgba(255,240,200,0)');
  ctx.fillStyle = beam;
  ctx.fillRect(0, h * 0.62, w, h * 0.38);

  // rain
  ctx.strokeStyle = '#BFD8FF';
  ctx.lineCap = 'round';
  for (const d of RAIN) {
    const y = wrap(d.y + ph * d.speed, 1) * h * 1.1 - h * 0.05;
    const x = (d.x * 1.1 - 0.05) * w + (y / h) * w * 0.04;
    ctx.globalAlpha = d.a;
    ctx.lineWidth = w * 0.0016;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x - d.len * w * 0.08, y - d.len * h);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

export const SAMPLES = [
  { id: 'golden', name: 'Golden Hour', width: 900, height: 1200, paint: paintGolden, audio: 'golden' },
  { id: 'neon', name: 'Neon Rain', width: 1280, height: 720, paint: paintNeon, audio: 'rain' },
];

/* ------------------------------------------------------------- audio */

function noiseBuffer(ctx, seconds, seed = 1) {
  const buffer = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * seconds), ctx.sampleRate);
  const data = buffer.getChannelData(0);
  const r = rng(seed);
  for (let i = 0; i < data.length; i += 1) data[i] = r() * 2 - 1;
  return buffer;
}

function chime(ctx, dest, time, freq, gain = 0.2, decay = 1.6) {
  [1, 2.01, 3.02].forEach((ratio, index) => {
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq * ratio;
    const level = gain / (index * 1.8 + 1);
    g.gain.setValueAtTime(0.0001, time);
    g.gain.exponentialRampToValueAtTime(level, time + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, time + decay / (index + 1));
    osc.connect(g).connect(dest);
    osc.start(time);
    osc.stop(time + decay + 0.05);
  });
}

function pad(ctx, dest, start, end, freqs, gain = 0.05, cutoff = 900) {
  const g = ctx.createGain();
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = cutoff;
  g.gain.setValueAtTime(0.0001, start);
  g.gain.linearRampToValueAtTime(gain, start + 0.6);
  g.gain.setValueAtTime(gain, end - 0.6);
  g.gain.linearRampToValueAtTime(0.0001, end);
  g.connect(lp).connect(dest);
  freqs.forEach((f, index) => {
    const osc = ctx.createOscillator();
    osc.type = index % 2 ? 'triangle' : 'sawtooth';
    osc.frequency.value = f;
    osc.detune.value = (index - 1) * 6;
    osc.connect(g);
    osc.start(start);
    osc.stop(end);
  });
}

function wash(ctx, dest, start, end, { freq = 600, q = 0.6, gain = 0.2, swell = 0, seed = 3 } = {}) {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(ctx, end - start, seed);
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = freq;
  bp.Q.value = q;
  const g = ctx.createGain();
  g.gain.value = gain;
  if (swell > 0) {
    for (let t = start; t < end; t += swell) {
      g.gain.setValueAtTime(gain * 0.25, t);
      g.gain.linearRampToValueAtTime(gain, t + swell * 0.45);
      g.gain.linearRampToValueAtTime(gain * 0.25, t + swell);
    }
  }
  src.connect(bp).connect(g).connect(dest);
  src.start(start);
  src.stop(end);
}

async function render(seconds, build) {
  const rate = 44100;
  const ctx = new OfflineAudioContext(2, Math.ceil(rate * seconds), rate);
  const master = ctx.createGain();
  master.gain.value = 0.9;
  const comp = ctx.createDynamicsCompressor();
  master.connect(comp).connect(ctx.destination);
  build(ctx, master);
  return ctx.startRendering();
}

const PENTA = [261.63, 293.66, 329.63, 392, 440, 523.25, 587.33, 659.25, 783.99];

export const SOUNDTRACKS = [
  { id: 'glow', name: 'Glow', mood: 'Chimes over a warm pad', seconds: 16 },
  { id: 'tide', name: 'Tide', mood: 'Slow waves and a low drone', seconds: 16 },
  { id: 'lofi', name: 'Lo-fi', mood: 'Soft beat and electric piano', seconds: 12 },
];

export function renderSoundtrack(id) {
  if (id === 'glow') {
    return render(16, (ctx, out) => {
      pad(ctx, out, 0, 16, [130.81, 196, 261.63], 0.035, 700);
      const r = rng(5);
      for (let beat = 0; beat < 32; beat += 1) {
        const time = beat * 0.5;
        if (r() > 0.28) chime(ctx, out, time, PENTA[Math.floor(r() * PENTA.length)], 0.12, 1.8);
      }
    });
  }
  if (id === 'tide') {
    return render(16, (ctx, out) => {
      pad(ctx, out, 0, 16, [65.41, 98, 130.81], 0.05, 380);
      wash(ctx, out, 0, 16, { freq: 500, q: 0.4, gain: 0.45, swell: 5.3, seed: 9 });
      wash(ctx, out, 0, 16, { freq: 2400, q: 0.8, gain: 0.08, swell: 4.1, seed: 13 });
    });
  }
  return render(12, (ctx, out) => {
    const beat = 60 / 80;
    const chords = [[220, 261.63, 329.63], [174.61, 220, 261.63], [196, 246.94, 293.66], [164.81, 196, 246.94]];
    chords.forEach((chord, index) => {
      const start = index * beat * 4;
      chord.forEach((f) => {
        const osc = ctx.createOscillator();
        const trem = ctx.createOscillator();
        const tg = ctx.createGain();
        const g = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = f;
        trem.frequency.value = 4.2;
        tg.gain.value = 0.02;
        trem.connect(tg).connect(g.gain);
        g.gain.setValueAtTime(0.0001, start);
        g.gain.linearRampToValueAtTime(0.06, start + 0.05);
        g.gain.exponentialRampToValueAtTime(0.01, start + beat * 4);
        osc.connect(g).connect(out);
        osc.start(start);
        osc.stop(start + beat * 4 + 0.05);
        trem.start(start);
        trem.stop(start + beat * 4 + 0.05);
      });
    });
    for (let i = 0; i < 16; i += 1) {
      const time = i * beat;
      // kick
      const k = ctx.createOscillator();
      const kg = ctx.createGain();
      k.frequency.setValueAtTime(110, time);
      k.frequency.exponentialRampToValueAtTime(45, time + 0.18);
      kg.gain.setValueAtTime(i % 2 ? 0.0001 : 0.4, time);
      kg.gain.exponentialRampToValueAtTime(0.0001, time + 0.3);
      k.connect(kg).connect(out);
      k.start(time);
      k.stop(time + 0.32);
      // snare-ish on 2 and 4
      if (i % 2) wash(ctx, out, time, time + 0.18, { freq: 1800, q: 0.7, gain: 0.25, seed: 20 + i });
      // hats
      wash(ctx, out, time + beat / 2, time + beat / 2 + 0.05, { freq: 7000, q: 1.2, gain: 0.08, seed: 40 + i });
    }
  });
}

/** Ambient sound that belongs to each sample clip (periodic in LOOP). */
export function renderSampleAudio(kind) {
  if (kind === 'rain') {
    return render(LOOP, (ctx, out) => {
      wash(ctx, out, 0, LOOP, { freq: 3200, q: 0.35, gain: 0.35, seed: 71 });
      wash(ctx, out, 0, LOOP, { freq: 420, q: 0.5, gain: 0.18, seed: 72 });
      pad(ctx, out, 0, LOOP, [55, 82.41], 0.03, 260);
      [0.4, 1.3, 2.2, 2.7].forEach((time, index) => chime(ctx, out, time, 1400 + index * 180, 0.03, 0.2));
    });
  }
  return render(LOOP, (ctx, out) => {
    pad(ctx, out, 0, LOOP, [220, 277.18, 329.63], 0.03, 900);
    wash(ctx, out, 0, LOOP, { freq: 520, q: 0.4, gain: 0.22, swell: LOOP, seed: 31 });
    [0.55, 0.7, 1.85, 2.05].forEach((time, index) => {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      const f = index % 2 ? 2300 : 1900;
      osc.frequency.setValueAtTime(f, time);
      osc.frequency.exponentialRampToValueAtTime(f * 0.72, time + 0.12);
      g.gain.setValueAtTime(0.0001, time);
      g.gain.linearRampToValueAtTime(0.07, time + 0.02);
      g.gain.linearRampToValueAtTime(0.0001, time + 0.14);
      osc.connect(g).connect(out);
      osc.start(time);
      osc.stop(time + 0.16);
    });
  });
}
