/* Inspector panels: Looks, Adjust, Live, Crop, Audio. Controls read from
   and write to the store; sync() re-reads everything after undo/redo. */

import { el, $$, clamp, fmtTime } from './util.js';
import {
  ADJUST_GROUPS, IDENTITY_ADJUST, LOOKS, ASPECTS, EFFECTS, SPEEDS,
  lookById, loadCustomLooks, saveCustomLooks, lookFromEdit,
} from './state.js';
import { gradeParams, Renderer } from './gl.js';
import { SOUNDTRACKS } from './samples.js';
import { passInfo } from './player.js';
import { ICONS } from './icons.js';

export const TABS = [
  { id: 'looks', label: 'Looks' },
  { id: 'adjust', label: 'Adjust' },
  { id: 'live', label: 'Live' },
  { id: 'crop', label: 'Crop' },
  { id: 'audio', label: 'Audio' },
];

/** Labelled slider; bipolar ones fill from the centre. */
function slider({ label, min, max, step = 0.01, value, format, onInput, onCommit, reset = 0 }) {
  const input = el('input', { type: 'range', min, max, step, value, 'aria-label': label });
  const out = el('output', { class: 'sl-value' });
  const name = el('span', { class: 'sl-label', title: 'Double-click to reset' }, label);
  const row = el('div', { class: 'sl' }, el('div', { class: 'sl-top' }, name, out), input);
  const bipolar = min < 0;
  const paint = (v) => {
    const pct = (x) => ((x - min) / (max - min)) * 100;
    const a = bipolar ? Math.min(pct(0), pct(v)) : 0;
    const b = bipolar ? Math.max(pct(0), pct(v)) : pct(v);
    input.style.setProperty('--a', `${a}%`);
    input.style.setProperty('--b', `${b}%`);
    out.textContent = format ? format(v) : (Math.abs(v) < 0.005 ? '0' : (v > 0 && bipolar ? '+' : '') + Math.round(v * 100));
    row.classList.toggle('is-set', Math.abs(v - reset) > 0.004);
  };
  input.addEventListener('input', () => { const v = Number(input.value); paint(v); onInput(v); });
  input.addEventListener('change', () => onCommit?.());
  const resetValue = () => { input.value = reset; paint(reset); onInput(reset); onCommit?.(); };
  name.addEventListener('dblclick', resetValue);
  input.addEventListener('dblclick', resetValue);
  paint(value);
  return { row, input, set(v) { input.value = v; paint(v); } };
}

function segmented(options, value, onPick, className = '') {
  const wrap = el('div', { class: `seg ${className}`, role: 'radiogroup' });
  const buttons = options.map((opt) => {
    const b = el('button', { type: 'button', role: 'radio', 'data-value': String(opt.value) }, opt.label);
    b.addEventListener('click', () => onPick(opt.value));
    wrap.append(b);
    return b;
  });
  const set = (v) => buttons.forEach((b) => {
    const on = b.dataset.value === String(v);
    b.classList.toggle('is-on', on);
    b.setAttribute('aria-checked', String(on));
  });
  set(value);
  return { el: wrap, set };
}

export class Inspector {
  constructor(root, app) {
    this.root = root;
    this.app = app;
    this.custom = loadCustomLooks();
    this.tab = 'looks';
    this.controls = {};
    this.thumbCanvas = document.createElement('canvas');
    this.thumbCanvas.width = 144;
    this.thumbCanvas.height = 144;
    try { this.thumbRenderer = new Renderer(this.thumbCanvas); } catch (_) { this.thumbRenderer = null; }
    this.build();
  }

  get store() { return this.app.store; }
  get edit() { return this.app.store.edit; }

  build() {
    this.tabBar = el('nav', { class: 'insp-tabs', role: 'tablist', 'aria-label': 'Editing tools' });
    TABS.forEach((tab, index) => {
      const b = el('button', {
        type: 'button', role: 'tab', class: 'insp-tab', 'data-tab': tab.id,
        title: `${tab.label} (${index + 1})`, html: `${ICONS[tab.id]}<span>${tab.label}</span>`,
      });
      b.addEventListener('click', () => this.show(tab.id));
      this.tabBar.append(b);
    });
    this.panels = el('div', { class: 'insp-panels' });
    this.root.append(this.tabBar, this.panels);
    this.panels.append(
      this.buildLooks(), this.buildAdjust(), this.buildLive(), this.buildCrop(), this.buildAudio(),
    );
    this.show('looks');
  }

  show(id) {
    this.tab = id;
    $$('.insp-tab', this.tabBar).forEach((b) => {
      const on = b.dataset.tab === id;
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-selected', String(on));
    });
    $$('.panel', this.panels).forEach((p) => { p.hidden = p.dataset.panel !== id; });
    this.app.onTab?.(id);
    if (id === 'looks') this.thumbsDirty = true;
  }

  /* --------------------------------------------------------------- looks */

  buildLooks() {
    const grid = el('div', { class: 'look-grid', role: 'listbox', 'aria-label': 'Looks' });
    this.lookGrid = grid;
    this.customGrid = el('div', { class: 'look-grid' });
    this.customHead = el('div', { class: 'panel-sub' }, 'My looks');
    this.controls.amount = slider({
      label: 'Amount', min: 0, max: 1, value: 1,
      format: (v) => `${Math.round(v * 100)}%`,
      onInput: (v) => this.store.update((d) => { d.look.amount = v; }, 'look'),
      onCommit: () => this.store.commit('look'),
      reset: 1,
    });
    const save = el('button', { type: 'button', class: 'btn ghost small' }, '+ Save current as a look');
    save.addEventListener('click', () => this.saveLook());
    const panel = el('section', { class: 'panel', 'data-panel': 'looks' },
      el('div', { class: 'panel-head' }, el('h2', {}, 'Looks'), el('span', { class: 'panel-note' }, 'Tap a look, then dial it in')),
      grid,
      this.controls.amount.row,
      this.customHead,
      this.customGrid,
      save);
    this.renderLookCards();
    return panel;
  }

  renderLookCards() {
    const card = (look) => {
      const canvas = el('canvas', { width: 144, height: 144 });
      const b = el('button', { type: 'button', class: 'look', role: 'option', 'data-look': look.id }, canvas, el('span', {}, look.name));
      b.addEventListener('click', () => {
        this.store.set((d) => {
          if (d.look.id !== look.id) d.look.amount = 1;
          d.look.id = look.id;
        }, 'look');
      });
      if (look.custom) {
        const del = el('span', { class: 'look-del', role: 'button', title: 'Delete look', html: ICONS.close });
        del.addEventListener('click', (e) => {
          e.stopPropagation();
          this.custom = this.custom.filter((l) => l.id !== look.id);
          saveCustomLooks(this.custom);
          if (this.edit?.look.id === look.id) this.store.set((d) => { d.look.id = 'original'; }, 'look');
          this.renderLookCards();
        });
        b.append(del);
      }
      return b;
    };
    this.lookGrid.replaceChildren(...LOOKS.map(card));
    this.customGrid.replaceChildren(...this.custom.map(card));
    this.customHead.hidden = !this.custom.length;
    this.thumbsDirty = true;
    this.syncLooks();
  }

  saveLook() {
    if (!this.edit) return;
    const name = (prompt('Name this look', `Look ${this.custom.length + 1}`) || '').trim().slice(0, 24);
    if (!name) return;
    const look = lookFromEdit(this.edit, name, this.custom);
    this.custom.push(look);
    saveCustomLooks(this.custom);
    this.renderLookCards();
    this.store.set((d) => {
      d.look = { id: look.id, amount: 1 };
      d.adjust = { ...IDENTITY_ADJUST };
    }, 'look');
    this.app.toast(`Saved “${name}” — it stays in this browser.`);
  }

  /** Render every look over the given frame (called when the frame changes). */
  refreshThumbs(drawable, width, height) {
    if (!this.thumbRenderer || !drawable || this.tab !== 'looks') return;
    const r = this.thumbRenderer;
    try {
      r.setSource(drawable, width, height);
      const crop = { aspect: '1:1', zoom: 1, x: 0, y: 0, rotate: this.edit.crop.rotate, flip: this.edit.crop.flip };
      $$('.look', this.panels).forEach((card) => {
        const look = lookById(card.dataset.look, this.custom);
        r.render(gradeParams(this.edit, this.custom, look), { crop });
        const ctx = card.querySelector('canvas').getContext('2d');
        ctx.drawImage(this.thumbCanvas, 0, 0, 144, 144);
      });
      this.thumbsDirty = false;
    } catch (_) { /* context lost; ignore */ }
  }

  syncLooks() {
    const edit = this.edit;
    if (!edit) return;
    $$('.look', this.panels).forEach((c) => {
      const on = c.dataset.look === edit.look.id;
      c.classList.toggle('is-on', on);
      c.setAttribute('aria-selected', String(on));
    });
    this.controls.amount.set(edit.look.amount);
    this.controls.amount.row.hidden = edit.look.id === 'original';
  }

  /* -------------------------------------------------------------- adjust */

  buildAdjust() {
    const panel = el('section', { class: 'panel', 'data-panel': 'adjust' });
    const auto = el('button', { type: 'button', class: 'btn ghost small', html: `${ICONS.wand}<span>Auto</span>`, title: 'Balance exposure and contrast from this frame' });
    auto.addEventListener('click', () => this.app.autoEnhance());
    this.resetAdjust = el('button', { type: 'button', class: 'btn text small' }, 'Reset all');
    this.resetAdjust.addEventListener('click', () => this.store.set((d) => { d.adjust = { ...IDENTITY_ADJUST }; }, 'adjust'));
    panel.append(el('div', { class: 'panel-head' }, el('h2', {}, 'Adjust'), el('div', { class: 'panel-actions' }, auto, this.resetAdjust)));
    this.adjustSliders = {};
    for (const group of ADJUST_GROUPS) {
      panel.append(el('div', { class: 'panel-sub' }, group.label));
      for (const item of group.items) {
        const s = slider({
          label: item.label, min: item.min, max: item.max, value: 0,
          onInput: (v) => this.store.update((d) => { d.adjust[item.key] = v; }, 'adjust'),
          onCommit: () => this.store.commit('adjust'),
        });
        this.adjustSliders[item.key] = s;
        panel.append(s.row);
      }
    }
    panel.append(el('p', { class: 'panel-note' }, 'Double-click any slider to reset it. Hold \\ to compare with the original.'));
    return panel;
  }

  syncAdjust() {
    const edit = this.edit;
    if (!edit) return;
    for (const [key, s] of Object.entries(this.adjustSliders)) s.set(edit.adjust[key] || 0);
    this.resetAdjust.hidden = Object.values(edit.adjust).every((v) => Math.abs(v) < 0.004);
  }

  /* ---------------------------------------------------------------- live */

  buildLive() {
    const panel = el('section', { class: 'panel', 'data-panel': 'live' });
    panel.append(el('div', { class: 'panel-head' }, el('h2', {}, 'Live effect')));
    const icons = { live: ICONS.effectLive, loop: ICONS.effectLoop, bounce: ICONS.effectBounce, longexposure: ICONS.effectLong };
    const grid = el('div', { class: 'effect-grid', role: 'radiogroup' });
    this.effectButtons = EFFECTS.map((fx) => {
      const b = el('button', { type: 'button', class: 'effect', role: 'radio', 'data-effect': fx.id, title: fx.hint },
        el('span', { class: 'effect-icon', html: icons[fx.id] }),
        el('strong', {}, fx.name),
        el('small', {}, fx.hint));
      b.addEventListener('click', () => this.store.set((d) => { d.effect = fx.id; }, 'effect'));
      grid.append(b);
      return b;
    });
    panel.append(grid);

    panel.append(el('div', { class: 'panel-sub' }, 'Speed'));
    this.speedSeg = segmented(SPEEDS.map((s) => ({ value: s, label: `${s}×` })), 1,
      (v) => this.store.set((d) => { d.speed = v; }, 'speed'), 'speed');
    panel.append(this.speedSeg.el);

    panel.append(el('div', { class: 'panel-sub' }, 'Key photo'));
    this.keyThumb = el('canvas', { class: 'key-thumb', width: 240, height: 240 });
    this.keyTime = el('span', { class: 'key-time' });
    const setKey = el('button', { type: 'button', class: 'btn ghost small' }, 'Use frame at playhead');
    setKey.addEventListener('click', () => this.app.setKeyPhoto());
    const jump = el('button', { type: 'button', class: 'btn text small' }, 'Go to key photo');
    jump.addEventListener('click', () => this.app.seek(this.edit.keyTime));
    panel.append(el('div', { class: 'key-card' }, this.keyThumb,
      el('div', { class: 'key-copy' },
        el('p', {}, 'The still your Live Photo rests on — and the frame “Photo” export saves.'),
        this.keyTime, el('div', { class: 'key-actions' }, setKey, jump))));
    return panel;
  }

  syncLive() {
    const edit = this.edit;
    if (!edit) return;
    this.effectButtons.forEach((b) => {
      const on = b.dataset.effect === edit.effect;
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-checked', String(on));
    });
    this.speedSeg.set(edit.speed);
    this.keyTime.textContent = `at ${fmtTime(edit.keyTime - edit.trim.in, 2)} into the clip`;
  }

  async refreshKeyThumb() {
    const source = this.app.source;
    if (!source || !this.edit) return;
    const t = this.edit.keyTime;
    if (this.keyThumbTime === t && this.keyThumbSource === source) return;
    this.keyThumbTime = t;
    this.keyThumbSource = source;
    const drawable = await source.frameAt(t);
    if (!this.thumbRenderer) return;
    this.thumbRenderer.setSource(drawable, source.width, source.height);
    this.thumbRenderer.render(gradeParams(this.edit, this.custom), { crop: { ...this.edit.crop, aspect: '1:1' } });
    this.keyThumb.getContext('2d').drawImage(this.thumbCanvas, 0, 0, 240, 240);
  }

  /* ---------------------------------------------------------------- crop */

  buildCrop() {
    const panel = el('section', { class: 'panel', 'data-panel': 'crop' });
    const reset = el('button', { type: 'button', class: 'btn text small' }, 'Reset');
    reset.addEventListener('click', () => this.store.set((d) => {
      d.crop = { aspect: 'original', zoom: 1, x: 0, y: 0, rotate: 0, flip: false };
    }, 'crop'));
    this.resetCrop = reset;
    panel.append(el('div', { class: 'panel-head' }, el('h2', {}, 'Crop & rotate'), reset));
    this.aspectSeg = segmented(ASPECTS.map((a) => ({ value: a.id, label: a.label })), 'original',
      (v) => this.store.set((d) => { d.crop.aspect = v; d.crop.x = 0; d.crop.y = 0; }, 'crop'), 'aspect');
    panel.append(el('div', { class: 'panel-sub' }, 'Aspect'), this.aspectSeg.el);
    this.controls.zoom = slider({
      label: 'Zoom', min: 1, max: 3, value: 1, reset: 1, format: (v) => `${v.toFixed(2)}×`,
      onInput: (v) => this.store.update((d) => { d.crop.zoom = v; }, 'crop'),
      onCommit: () => this.store.commit('crop'),
    });
    this.controls.panX = slider({
      label: 'Horizontal', min: -1, max: 1, value: 0,
      onInput: (v) => this.store.update((d) => { d.crop.x = v; }, 'crop'),
      onCommit: () => this.store.commit('crop'),
    });
    this.controls.panY = slider({
      label: 'Vertical', min: -1, max: 1, value: 0,
      onInput: (v) => this.store.update((d) => { d.crop.y = v; }, 'crop'),
      onCommit: () => this.store.commit('crop'),
    });
    panel.append(el('div', { class: 'panel-sub' }, 'Framing'), this.controls.zoom.row, this.controls.panX.row, this.controls.panY.row);
    const rotL = el('button', { type: 'button', class: 'btn ghost small', html: `${ICONS.rotate}<span>Rotate</span>` });
    rotL.addEventListener('click', () => this.store.set((d) => { d.crop.rotate = (d.crop.rotate + 270) % 360; d.crop.x = 0; d.crop.y = 0; }, 'crop'));
    const flip = el('button', { type: 'button', class: 'btn ghost small', html: `${ICONS.flip}<span>Flip</span>` });
    flip.addEventListener('click', () => this.store.set((d) => { d.crop.flip = !d.crop.flip; }, 'crop'));
    panel.append(el('div', { class: 'panel-sub' }, 'Orientation'), el('div', { class: 'row-actions' }, rotL, flip));
    panel.append(el('p', { class: 'panel-note' }, 'Drag the picture to reposition it; scroll or pinch to zoom.'));
    return panel;
  }

  syncCrop() {
    const c = this.edit?.crop;
    if (!c) return;
    this.aspectSeg.set(c.aspect);
    this.controls.zoom.set(c.zoom);
    this.controls.panX.set(c.x);
    this.controls.panY.set(c.y);
    this.resetCrop.hidden = c.aspect === 'original' && c.zoom === 1 && !c.x && !c.y && !c.rotate && !c.flip;
  }

  /* --------------------------------------------------------------- audio */

  buildAudio() {
    const panel = el('section', { class: 'panel', 'data-panel': 'audio' });
    panel.append(el('div', { class: 'panel-head' }, el('h2', {}, 'Sound')));

    // original
    this.muteBtn = el('button', { type: 'button', class: 'icon-btn', title: 'Mute original audio' });
    this.muteBtn.addEventListener('click', () => this.store.set((d) => { d.audio.original.muted = !d.audio.original.muted; }, 'audio'));
    this.controls.origVol = slider({
      label: 'Original audio', min: 0, max: 1, value: 1, reset: 1, format: (v) => `${Math.round(v * 100)}%`,
      onInput: (v) => this.store.update((d) => { d.audio.original.volume = v; d.audio.original.muted = false; }, 'mix'),
      onCommit: () => this.store.commit('mix'),
    });
    this.origNote = el('p', { class: 'panel-note' });
    panel.append(el('div', { class: 'with-icon' }, this.muteBtn, this.controls.origVol.row), this.origNote);

    // soundtrack chooser
    panel.append(el('div', { class: 'panel-sub' }, 'Soundtrack'));
    const fileBtn = el('button', { type: 'button', class: 'src-btn', html: `${ICONS.upload}<span><strong>Music file</strong><small>MP3, M4A, WAV…</small></span>` });
    fileBtn.addEventListener('click', () => this.app.pickAudio());
    this.recBtn = el('button', { type: 'button', class: 'src-btn', html: `${ICONS.mic}<span><strong>Voiceover</strong><small>Record with your mic</small></span>` });
    this.recBtn.addEventListener('click', () => this.app.toggleRecording());
    this.recRow = el('div', { class: 'rec-row', hidden: true },
      el('span', { class: 'rec-dot' }), this.recTime = el('span', { class: 'rec-time' }, '0:00.0'),
      el('span', { class: 'rec-meter' }, this.recLevel = el('span')),
      el('button', { type: 'button', class: 'btn primary small', onclick: () => this.app.toggleRecording() }, 'Stop'));
    const builtIn = el('div', { class: 'synth-list' }, ...SOUNDTRACKS.map((s) => {
      const b = el('button', { type: 'button', class: 'synth', 'data-synth': s.id, html: `${ICONS.note}<span><strong>${s.name}</strong><small>${s.mood}</small></span>` });
      b.addEventListener('click', () => this.app.useSynth(s.id));
      return b;
    }));
    this.chooser = el('div', { class: 'chooser' }, el('div', { class: 'src-row' }, fileBtn, this.recBtn), this.recRow,
      el('div', { class: 'panel-sub small' }, 'Or use one of ours'), builtIn);
    panel.append(this.chooser);

    // track editor
    this.trackTitle = el('strong', { class: 'track-title' });
    const remove = el('button', { type: 'button', class: 'icon-btn', title: 'Remove soundtrack', html: ICONS.trash });
    remove.addEventListener('click', () => this.app.removeTrack());
    const replace = el('button', { type: 'button', class: 'btn text small' }, 'Replace');
    replace.addEventListener('click', () => { this.replacing = true; this.syncAudio(); });
    this.controls.tVol = slider({
      label: 'Volume', min: 0, max: 1, value: 1, reset: 1, format: (v) => `${Math.round(v * 100)}%`,
      onInput: (v) => this.store.update((d) => { if (d.audio.track) d.audio.track.volume = v; }, 'mix'),
      onCommit: () => this.store.commit('mix'),
    });
    this.controls.tOffset = slider({
      label: 'Starts at', min: 0, max: 3, step: 0.05, value: 0, reset: 0, format: (v) => fmtTime(v),
      onInput: (v) => this.store.update((d) => { if (d.audio.track) d.audio.track.offset = v; }, 'track'),
      onCommit: () => this.store.commit('track'),
    });
    this.controls.tIn = slider({
      label: 'Fade in', min: 0, max: 3, step: 0.05, value: 0, reset: 0, format: (v) => `${v.toFixed(1)}s`,
      onInput: (v) => this.store.update((d) => { if (d.audio.track) d.audio.track.fadeIn = v; }, 'track'),
      onCommit: () => this.store.commit('track'),
    });
    this.controls.tOut = slider({
      label: 'Fade out', min: 0, max: 3, step: 0.05, value: 0, reset: 0, format: (v) => `${v.toFixed(1)}s`,
      onInput: (v) => this.store.update((d) => { if (d.audio.track) d.audio.track.fadeOut = v; }, 'track'),
      onCommit: () => this.store.commit('track'),
    });
    this.trackEditor = el('div', { class: 'track-editor' },
      el('div', { class: 'track-head' }, el('span', { class: 'track-icon', html: ICONS.note }), this.trackTitle, replace, remove),
      el('p', { class: 'panel-note' }, 'Drag the purple block on the timeline to slide it; drag its edges to trim.'),
      this.controls.tVol.row, this.controls.tOffset.row, this.controls.tIn.row, this.controls.tOut.row);
    panel.append(this.trackEditor);
    return panel;
  }

  setRecording(on, level = 0, seconds = 0) {
    this.recRow.hidden = !on;
    this.recBtn.disabled = on;
    if (on) {
      this.recLevel.style.width = `${Math.round(level * 100)}%`;
      this.recTime.textContent = fmtTime(seconds);
    }
  }

  syncAudio() {
    const edit = this.edit;
    if (!edit) return;
    const o = edit.audio.original;
    const hasOriginal = !!this.app.audio.originalBuffer;
    this.muteBtn.innerHTML = o.muted ? ICONS.mute : ICONS.speaker;
    this.muteBtn.classList.toggle('is-muted', o.muted);
    this.controls.origVol.set(o.muted ? 0 : o.volume);
    this.controls.origVol.row.classList.toggle('is-disabled', !hasOriginal);
    let note = '';
    if (this.app.audioDecoding) note = 'Reading the clip’s audio…';
    else if (!hasOriginal) note = 'This clip has no audio track your browser can read.';
    else if (edit.effect !== 'live') note = 'Loop and Bounce play silently, like on iPhone — a soundtrack still plays.';
    else if (edit.speed !== 1) note = 'At other speeds the original audio shifts pitch, like tape.';
    this.origNote.textContent = note;
    this.origNote.hidden = !note;

    const tr = edit.audio.track;
    const showEditor = !!tr && !this.replacing;
    this.trackEditor.hidden = !showEditor;
    this.chooser.hidden = showEditor;
    if (tr) {
      this.trackTitle.textContent = tr.name;
      const P = passInfo(edit).length;
      this.controls.tOffset.input.max = Math.max(0.1, P - 0.1).toFixed(2);
      this.controls.tVol.set(tr.volume);
      this.controls.tOffset.set(clamp(tr.offset, 0, Math.max(0.1, P - 0.1)));
      this.controls.tIn.set(tr.fadeIn);
      this.controls.tOut.set(tr.fadeOut);
    }
    $$('.synth', this.panels).forEach((b) => b.classList.toggle('is-on', tr?.kind === 'synth' && tr.id === b.dataset.synth));
  }

  /* ---------------------------------------------------------------- sync */

  sync() {
    this.syncLooks();
    this.syncAdjust();
    this.syncLive();
    this.syncCrop();
    this.syncAudio();
  }
}

