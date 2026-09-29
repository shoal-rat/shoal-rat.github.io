/* The edit document. One plain JSON object drives preview, timeline and
   export, so what you see is exactly what gets rendered. Every committed
   change is a snapshot on the undo stack. */

import { Emitter, clamp } from './util.js';

/* ---------------------------------------------------------------- adjust */

export const ADJUST_GROUPS = [
  {
    id: 'light', label: 'Light',
    items: [
      { key: 'exposure', label: 'Exposure', min: -1, max: 1 },
      { key: 'brightness', label: 'Brightness', min: -1, max: 1 },
      { key: 'highlights', label: 'Highlights', min: -1, max: 1 },
      { key: 'shadows', label: 'Shadows', min: -1, max: 1 },
      { key: 'contrast', label: 'Contrast', min: -1, max: 1 },
      { key: 'blacks', label: 'Black point', min: -1, max: 1 },
    ],
  },
  {
    id: 'color', label: 'Color',
    items: [
      { key: 'saturation', label: 'Saturation', min: -1, max: 1 },
      { key: 'vibrance', label: 'Vibrance', min: -1, max: 1 },
      { key: 'warmth', label: 'Warmth', min: -1, max: 1 },
      { key: 'tint', label: 'Tint', min: -1, max: 1 },
    ],
  },
  {
    id: 'finish', label: 'Finish',
    items: [
      { key: 'sharpness', label: 'Sharpness', min: 0, max: 1 },
      { key: 'fade', label: 'Fade', min: 0, max: 1 },
      { key: 'grain', label: 'Grain', min: 0, max: 1 },
      { key: 'vignette', label: 'Vignette', min: 0, max: 1 },
    ],
  },
];

export const ADJUST_KEYS = ADJUST_GROUPS.flatMap((g) => g.items.map((i) => i.key));
export const IDENTITY_ADJUST = Object.fromEntries(ADJUST_KEYS.map((k) => [k, 0]));

/* ----------------------------------------------------------------- looks
   A look is a set of adjustment offsets plus optional split toning and a
   monochrome mix. "Amount" scales the whole look toward identity. */

export const LOOKS = [
  { id: 'original', name: 'Original', p: {} },
  { id: 'vivid', name: 'Vivid', p: { saturation: 0.28, vibrance: 0.25, contrast: 0.18, brightness: 0.04 } },
  { id: 'golden', name: 'Golden', p: { warmth: 0.45, saturation: 0.1, brightness: 0.08, highlights: -0.15 },
    split: { shadow: [0.36, 0.28, 0.22], high: [1.0, 0.82, 0.55], amount: 0.5 } },
  { id: 'coastal', name: 'Coastal', p: { warmth: -0.28, tint: -0.05, saturation: 0.08, brightness: 0.1, contrast: 0.06 },
    split: { shadow: [0.12, 0.32, 0.42], high: [0.92, 0.97, 1.0], amount: 0.45 } },
  { id: 'fade', name: 'Fade', p: { fade: 0.55, contrast: -0.18, saturation: -0.2, brightness: 0.06 } },
  { id: 'matte', name: 'Matte', p: { fade: 0.35, contrast: -0.12, saturation: -0.14, warmth: 0.08, blacks: -0.3 } },
  { id: 'dusk', name: 'Dusk', p: { warmth: 0.18, tint: 0.22, exposure: -0.12, contrast: 0.2, highlights: -0.2 },
    split: { shadow: [0.3, 0.2, 0.48], high: [1.0, 0.7, 0.52], amount: 0.7 } },
  { id: 'pop', name: 'Pop', p: { saturation: 0.45, vibrance: 0.3, contrast: 0.26, shadows: 0.12 } },
  { id: 'film', name: 'Film', p: { fade: 0.22, warmth: 0.12, contrast: 0.12, saturation: -0.08, grain: 0.35, highlights: -0.25 },
    split: { shadow: [0.2, 0.3, 0.32], high: [1.0, 0.9, 0.74], amount: 0.45 } },
  { id: 'cinema', name: 'Cinema', p: { contrast: 0.22, saturation: -0.06, highlights: -0.2, shadows: 0.1, vignette: 0.25 },
    split: { shadow: [0.05, 0.36, 0.42], high: [1.0, 0.72, 0.45], amount: 0.85 } },
  { id: 'sakura', name: 'Sakura', p: { tint: 0.28, brightness: 0.12, fade: 0.18, saturation: -0.05 },
    split: { shadow: [0.45, 0.3, 0.4], high: [1.0, 0.86, 0.9], amount: 0.5 } },
  { id: 'chrome', name: 'Chrome', p: { saturation: 0.22, contrast: 0.3, brightness: 0.06, sharpness: 0.3, blacks: 0.15 } },
  { id: 'sepia', name: 'Sepia', p: { contrast: 0.08, fade: 0.12 }, mono: 1, monoTint: [1.08, 0.96, 0.78] },
  { id: 'mono', name: 'Mono', p: { contrast: 0.08 }, mono: 1, monoTint: [1, 1, 1] },
  { id: 'silvertone', name: 'Silvertone', p: { contrast: -0.08, fade: 0.2, brightness: 0.1 }, mono: 1, monoTint: [0.96, 0.99, 1.05] },
  { id: 'noir', name: 'Noir', p: { contrast: 0.55, exposure: -0.08, blacks: 0.25, vignette: 0.35 }, mono: 1, monoTint: [1, 1, 1] },
];

export const lookById = (id, custom = []) =>
  LOOKS.find((l) => l.id === id) || custom.find((l) => l.id === id) || LOOKS[0];

/* ---------------------------------------------------------------- crop */

export const ASPECTS = [
  { id: 'original', label: 'Original' },
  { id: '1:1', label: '1:1', value: 1 },
  { id: '4:5', label: '4:5', value: 4 / 5 },
  { id: '3:4', label: '3:4', value: 3 / 4 },
  { id: '9:16', label: '9:16', value: 9 / 16 },
  { id: '16:9', label: '16:9', value: 16 / 9 },
];

export const EFFECTS = [
  { id: 'live', name: 'Live', hint: 'Plays like the photo was taken — once, with sound.' },
  { id: 'loop', name: 'Loop', hint: 'An endless loop with the seam cross-faded away.' },
  { id: 'bounce', name: 'Bounce', hint: 'Plays forward, then backward, forever.' },
  { id: 'longexposure', name: 'Long Exposure', hint: 'Blends every frame into one still, like a slow shutter.' },
];

export const SPEEDS = [0.5, 0.75, 1, 1.5, 2];

export const MAX_TRIM = 10;     // seconds — Live Photos are short
export const DEFAULT_TRIM = 3;

export function defaultEdit(duration) {
  const out = Math.min(duration, DEFAULT_TRIM);
  return {
    trim: { in: 0, out },
    keyTime: out / 2,
    effect: 'live',
    speed: 1,
    look: { id: 'original', amount: 1 },
    adjust: { ...IDENTITY_ADJUST },
    crop: { aspect: 'original', zoom: 1, x: 0, y: 0, rotate: 0, flip: false },
    audio: {
      original: { volume: 1, muted: false },
      track: null,  // { id, name, kind, trimIn, trimOut, offset, volume, fadeIn, fadeOut }
    },
  };
}

/* --------------------------------------------------------------- store */

const clone = (value) => JSON.parse(JSON.stringify(value));

export class Store extends Emitter {
  constructor() {
    super();
    this.edit = null;
    this.undoStack = [];
    this.redoStack = [];
    this.lastCommitted = null;
  }

  reset(edit) {
    this.edit = edit;
    this.undoStack = [];
    this.redoStack = [];
    this.lastCommitted = clone(edit);
    this.emit('change', { reason: 'reset' });
    this.emit('history');
  }

  /** Live mutation (e.g. while dragging). Call commit() when the gesture ends. */
  update(mutator, reason = 'edit') {
    if (!this.edit) return;
    mutator(this.edit);
    this.emit('change', { reason });
  }

  /** Mutate and immediately record an undo step. */
  set(mutator, reason = 'edit') {
    this.update(mutator, reason);
    this.commit(reason);
  }

  commit(reason = 'edit') {
    if (!this.edit) return;
    const now = JSON.stringify(this.edit);
    const before = JSON.stringify(this.lastCommitted);
    if (now === before) return;
    this.undoStack.push({ snapshot: this.lastCommitted, reason });
    if (this.undoStack.length > 120) this.undoStack.shift();
    this.redoStack = [];
    this.lastCommitted = JSON.parse(now);
    this.emit('history');
  }

  get canUndo() { return this.undoStack.length > 0; }
  get canRedo() { return this.redoStack.length > 0; }

  undo() {
    const step = this.undoStack.pop();
    if (!step) return;
    this.redoStack.push({ snapshot: clone(this.edit), reason: step.reason });
    this.edit = clone(step.snapshot);
    this.lastCommitted = clone(step.snapshot);
    this.emit('change', { reason: 'undo' });
    this.emit('history');
  }

  redo() {
    const step = this.redoStack.pop();
    if (!step) return;
    this.undoStack.push({ snapshot: clone(this.edit), reason: step.reason });
    this.edit = clone(step.snapshot);
    this.lastCommitted = clone(step.snapshot);
    this.emit('change', { reason: 'redo' });
    this.emit('history');
  }
}

/* ------------------------------------------------------------ custom looks */

const LOOKS_KEY = 'lively.customLooks.v1';

export function loadCustomLooks() {
  try {
    const list = JSON.parse(localStorage.getItem(LOOKS_KEY) || '[]');
    return Array.isArray(list) ? list.filter((l) => l && l.id && l.p) : [];
  } catch (_) {
    return [];
  }
}

export function saveCustomLooks(list) {
  try { localStorage.setItem(LOOKS_KEY, JSON.stringify(list)); } catch (_) { /* private mode */ }
}

/** Freeze the current look + adjustments into a new custom look. */
export function lookFromEdit(edit, name, custom) {
  const base = lookById(edit.look.id, custom);
  const amount = edit.look.id === 'original' ? 0 : edit.look.amount;
  const p = {};
  for (const key of ADJUST_KEYS) {
    const value = (base.p[key] || 0) * amount + (edit.adjust[key] || 0);
    if (Math.abs(value) > 0.001) p[key] = +clamp(value, -1.5, 1.5).toFixed(3);
  }
  const look = { id: `custom-${Date.now().toString(36)}`, name, p, custom: true };
  if (base.split) look.split = { ...base.split, amount: base.split.amount * amount };
  if (base.mono) { look.mono = base.mono * amount; look.monoTint = base.monoTint; }
  return look;
}
