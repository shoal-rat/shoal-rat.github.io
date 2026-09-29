/* Trip Memory Map — app controller. */

import { t, setLang, lang } from './i18n.js';
import { importFiles, filesFromDrop, harmonizeOffsets } from './importer.js';
import { buildTrip, setRoadGeometry } from './trip.js';
import { TripMap } from './map.js';
import { Playback } from './playback.js';
import { renderTrip, modeMenu, el } from './panel.js';
import { Viewer } from './viewer.js';
import { loadTrip, savePhotos, saveMeta, clearAll } from './store.js';
import { toGpx, toArchive, fromArchive, makePoster } from './export.js';
import { routable, fetchRoute, reverseGeocode } from './network.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

const defaultMeta = () => ({
  title: '',
  overrides: {},
  names: {},
  geo: {},
  demo: false,
  demoNames: null,
  demoTitle: null,
  settings: { routeMode: 'private', geocode: false, mergeRadius: 250, theme: 'paper' },
});

function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}

class App {
  constructor() {
    this.photos = [];
    this.meta = defaultMeta();
    this.trip = null;
    this.view = { day: null, selected: null };
    this.urls = new Map();
    this.networkToken = 0;
    this.geoToken = 0;
    this.mapReady = false;
  }

  async init() {
    this.root = $('#app');
    setLang(lang);
    this.applyText();
    this.map = new TripMap($('#map'), {
      onStopClick: (stop) => this.focusStop(stop, { fly: true, scroll: true, open: true }),
      onUserMove: () => { if (this.playback.playing) this.playback.pause(); },
    });
    this.playback = new Playback({
      map: this.map,
      card: $('#postcard'),
      photoUrl: (p) => this.url(p, 'display'),
      onFrame: (f) => this.onFrame(f),
      onState: (s) => this.onPlayState(s),
    });
    this.viewer = new Viewer($('#viewer'), {
      photoUrl: (p, kind) => this.url(p, kind),
      onShowOnMap: (stop) => this.focusStop(stop, { fly: true, scroll: true }),
    });
    this.bind();
    const savedPromise = loadTrip();
    try {
      await this.map.ready;
      this.mapReady = true;
      this.map.setTheme(this.meta.settings.theme);
      this.map.setLanguage(lang);
    } catch (error) {
      $('#map-error').hidden = false;
    }

    // photos dropped while the base map was still loading
    if (this.photos.length) {
      this.rebuild({ fit: true, animate: false });
      return;
    }
    const saved = await savedPromise;
    if (this.photos.length) { this.rebuild({ fit: true, animate: false }); return; }
    if (saved) {
      this.photos = saved.photos;
      this.meta = { ...defaultMeta(), ...(saved.meta || {}) };
      this.meta.settings = { ...defaultMeta().settings, ...(saved.meta?.settings || {}) };
      if (this.mapReady) this.setTheme(this.meta.settings.theme);
      this.rebuild({ fit: true, animate: false });
      this.toast(t('restored'));
    } else if (new URLSearchParams(location.search).has('demo')) {
      this.loadDemo();
    } else {
      this.rebuild();
    }
  }

  /* ------------------------------------------------------------- text */

  applyText() {
    document.title = `${t('appName')} — ${t('appSub')}`;
    $$('[data-i18n]').forEach((node) => { node.textContent = t(node.dataset.i18n); });
    $$('[data-i18n-title]').forEach((node) => {
      node.title = t(node.dataset.i18nTitle);
      node.setAttribute('aria-label', t(node.dataset.i18nTitle));
    });
  }

  /* -------------------------------------------------------------- urls */

  url(photo, kind = 'thumb') {
    let entry = this.urls.get(photo.id);
    if (!entry) { entry = {}; this.urls.set(photo.id, entry); }
    const blob = kind === 'display' ? (photo.display || photo.thumb) : photo.thumb;
    if (!entry[kind]) entry[kind] = URL.createObjectURL(blob);
    return entry[kind];
  }

  revokeAll() {
    for (const entry of this.urls.values()) Object.values(entry).forEach((u) => URL.revokeObjectURL(u));
    this.urls.clear();
  }

  /* ---------------------------------------------------------- binding */

  bind() {
    const photosInput = $('#file-photos');
    const folderInput = $('#file-folder');
    const archiveInput = $('#file-archive');
    photosInput.addEventListener('change', () => { const f = Array.from(photosInput.files || []); photosInput.value = ''; if (f.length) this.addFiles(f); });
    folderInput.addEventListener('change', () => { const f = Array.from(folderInput.files || []); folderInput.value = ''; if (f.length) this.addFiles(f); });
    archiveInput.addEventListener('change', () => { const f = archiveInput.files?.[0]; archiveInput.value = ''; if (f) this.openArchive(f); });

    const actions = {
      'add-photos': () => photosInput.click(),
      'add-folder': () => folderInput.click(),
      demo: () => this.loadDemo(),
      menu: (b) => this.toggleMenu(b),
      settings: () => this.openSettings(),
      fit: () => this.map.fit({ day: this.view.day }),
      theme: () => this.setTheme(this.meta.settings.theme === 'paper' ? 'ink' : 'paper'),
      'zoom-in': () => this.map.map?.zoomIn(),
      'zoom-out': () => this.map.map?.zoomOut(),
      play: () => { if (this.mapReady) this.playback.toggle(); },
      'stop-replay': () => { this.playback.stop(); this.map.fit({ day: this.view.day }); },
      'export-gpx': () => this.exportGpx(),
      'export-archive': () => this.exportArchive(),
      'open-archive': () => archiveInput.click(),
      poster: () => this.makePoster(),
      'new-trip': () => this.newTrip(),
      'report-toggle': () => { $('#report-list').hidden = !$('#report-list').hidden; },
      'report-close': () => { $('#report').hidden = true; },
      'close-dialog': (b) => b.closest('dialog')?.close(),
      sheet: () => this.cycleSheet(),
    };
    document.addEventListener('click', (e) => {
      const b = e.target.closest('[data-action]');
      if (!b) return;
      const fn = actions[b.dataset.action];
      if (fn) { e.preventDefault(); fn(b); }
    });

    // playback bar
    const range = $('#pb-range');
    range.addEventListener('input', () => {
      this.scrubbing = true;
      if (this.playback.playing) this.playback.pause();
      this.playback.seek((Number(range.value) / 1000) * this.playback.total);
    });
    range.addEventListener('change', () => { this.scrubbing = false; });
    $$('#pb-speed button').forEach((b) => b.addEventListener('click', () => {
      this.playback.setSpeed(Number(b.dataset.speed));
      $$('#pb-speed button').forEach((x) => x.classList.toggle('is-on', x === b));
    }));

    // drag & drop anywhere
    const drop = $('#drop');
    let depth = 0;
    window.addEventListener('dragenter', (e) => {
      if (!e.dataTransfer?.types?.includes('Files')) return;
      depth += 1;
      drop.hidden = false;
    });
    window.addEventListener('dragleave', () => { depth = Math.max(0, depth - 1); if (!depth) drop.hidden = true; });
    window.addEventListener('dragover', (e) => { if (e.dataTransfer?.types?.includes('Files')) e.preventDefault(); });
    window.addEventListener('drop', async (e) => {
      depth = 0;
      drop.hidden = true;
      if (!e.dataTransfer?.types?.includes('Files')) return;
      e.preventDefault();
      const files = await filesFromDrop(e.dataTransfer);
      const archive = files.find((f) => /\.json$/i.test(f.name));
      if (archive && files.length === 1) this.openArchive(archive);
      else if (files.length) this.addFiles(files);
    });

    // keyboard
    window.addEventListener('keydown', (e) => {
      if (e.target.closest('input, textarea, select, [contenteditable]') || this.viewer.isOpen || document.querySelector('dialog[open]')) return;
      if (!this.trip) return;
      if (e.key === ' ') { e.preventDefault(); this.playback.toggle(); }
      else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        e.preventDefault();
        this.playback.pause();
        this.playback.jumpToStop(e.key === 'ArrowRight' ? 1 : -1);
      } else if (e.key === 'Escape' && this.playback.active) {
        this.playback.stop();
        this.map.fit({ day: this.view.day });
      }
    });

    // settings controls
    $$('input[name="route-mode"]').forEach((r) => r.addEventListener('change', () => {
      this.meta.settings.routeMode = r.value;
      this.saveMetaSoon();
      this.rebuild();
    }));
    $('#set-geocode').addEventListener('change', (e) => {
      this.meta.settings.geocode = e.target.checked;
      this.saveMetaSoon();
      if (e.target.checked) this.applyGeocode();
      else { this.meta.geo = {}; this.rebuild(); }
    });
    $('#set-radius').addEventListener('input', (e) => { $('#set-radius-out').textContent = `${e.target.value} m`; });
    $('#set-radius').addEventListener('change', (e) => {
      this.meta.settings.mergeRadius = Number(e.target.value);
      this.saveMetaSoon();
      this.rebuild();
    });
    $$('input[name="lang"]').forEach((r) => r.addEventListener('change', () => {
      setLang(r.value);
      this.applyText();
      this.map.setLanguage(lang);
      this.rebuild();
    }));
    $$('input[name="theme"]').forEach((r) => r.addEventListener('change', () => this.setTheme(r.value)));
    $('#clear-data').addEventListener('click', () => this.newTrip(true));

    // mobile sheet drag
    this.bindSheet();
    window.addEventListener('resize', () => this.map.resize());
  }

  /* ------------------------------------------------------------ import */

  async addFiles(files) {
    this.playback.stop();
    const card = $('#importing');
    card.hidden = false;
    this.root.dataset.busy = 'import';
    const label = $('#importing-label');
    const bar = $('#importing-bar');
    label.textContent = t('importing');
    const existing = new Set(this.photos.map((p) => p.id));
    const { photos, skipped } = await importFiles(files, {
      existing,
      onProgress: (done, total) => {
        $('#importing-count').textContent = t('importingN', { done, total });
        bar.style.width = `${total ? (done / total) * 100 : 0}%`;
      },
      onHeic: () => { label.textContent = t('convertingHeic'); },
    });
    card.hidden = true;
    delete this.root.dataset.busy;
    this.showReport(photos.length, skipped);
    if (!photos.length) return photos;
    if (this.meta.demo) {
      // adding real photos to the demo starts a fresh trip
      this.photos = [];
      this.meta = { ...defaultMeta(), settings: this.meta.settings };
      this.revokeAll();
      await clearAll();
    }
    this.photos.push(...photos);
    harmonizeOffsets(this.photos);
    await savePhotos(this.photos);
    this.saveMetaSoon();
    this.view.day = null;
    this.rebuild({ fit: true });
    return photos;
  }

  showReport(count, skipped) {
    const report = $('#report');
    report.hidden = false;
    $('#report-ok').textContent = t('imported', { n: count });
    $('#report-skip').textContent = skipped.length ? t('skipped', { n: skipped.length }) : '';
    $('#report-skip-toggle').hidden = !skipped.length;
    const list = $('#report-list');
    list.hidden = true;
    list.replaceChildren(...skipped.slice(0, 200).map((s) => el('li', {}, el('span', {}, s.name), el('em', {}, t(s.reason)))));
    $('#report-empty').hidden = count > 0;
    $('#report-empty').textContent = t('nothingImported');
    clearTimeout(this.reportTimer);
    if (count > 0 && !skipped.length) this.reportTimer = setTimeout(() => { report.hidden = true; }, 3500);
  }

  async loadDemo() {
    if (this.photos.length && !this.meta.demo && !confirm(t('clearConfirm'))) return;
    let demo;
    let files;
    try {
      const get = async (url, tries = 3) => {
        for (let i = 0; ; i += 1) {
          try {
            const r = await fetch(url);
            if (!r.ok) throw new Error(String(r.status));
            return r;
          } catch (error) {
            if (i >= tries - 1) throw error;
            await new Promise((resolve) => setTimeout(resolve, 400 * (i + 1)));
          }
        }
      };
      demo = await (await get('demo/trip.json')).json();
      files = new Array(demo.photos.length);
      const queue = demo.photos.map((name, index) => ({ name, index }));
      await Promise.all(Array.from({ length: 4 }, async () => {
        while (queue.length) {
          const { name, index } = queue.shift();
          const blob = await (await get(`demo/photos/${name}`)).blob();
          files[index] = new File([blob], name, { type: 'image/jpeg' });
        }
      }));
    } catch (_) {
      this.toast(t('demoFailed'));
      return;
    }
    this.photos = [];
    this.revokeAll();
    await clearAll();
    this.meta = { ...defaultMeta(), settings: { ...this.meta.settings } };
    const photos = await this.addFiles(files);
    this.meta.demo = true;
    const byName = new Map(photos.map((p) => [p.name, p.id]));
    const map = (obj) => Object.fromEntries(Object.entries(obj).map(([k, v]) => [byName.get(k), v]).filter(([k]) => k));
    this.meta.overrides = map(demo.overrides);
    this.meta.demoNames = {
      zh: map(Object.fromEntries(Object.entries(demo.names).map(([k, v]) => [k, v.zh]))),
      en: map(Object.fromEntries(Object.entries(demo.names).map(([k, v]) => [k, v.en]))),
    };
    this.meta.demoTitle = demo.title;
    this.saveMetaSoon();
    this.rebuild({ fit: true });
    $('#report').hidden = true;
  }

  async openArchive(file) {
    try {
      const { photos, meta } = await fromArchive(await file.text());
      this.playback.stop();
      this.revokeAll();
      await clearAll();
      this.photos = photos;
      this.meta = { ...defaultMeta(), ...meta, settings: { ...defaultMeta().settings, ...(meta.settings || {}) } };
      await savePhotos(photos);
      this.saveMetaSoon();
      this.view = { day: null, selected: null };
      this.rebuild({ fit: true });
    } catch (_) {
      this.toast(t('archiveBad'));
    }
  }

  async newTrip(fromSettings = false) {
    if (!confirm(t('clearConfirm'))) return;
    this.playback.stop();
    this.revokeAll();
    await clearAll();
    this.photos = [];
    this.meta = { ...defaultMeta(), settings: this.meta.settings };
    this.view = { day: null, selected: null };
    this.rebuild();
    if (fromSettings) $('#settings').close();
  }

  /* ----------------------------------------------------------- rebuild */

  names() {
    const names = { ...(this.meta.demoNames?.[lang] || {}) };
    Object.assign(names, this.meta.names);
    return names;
  }

  title() {
    if (this.meta.title) return this.meta.title;
    if (this.meta.demoTitle) return this.meta.demoTitle[lang] || this.meta.demoTitle.zh;
    return '';
  }

  rebuild({ fit = false, animate = true } = {}) {
    this.trip = this.photos.length
      ? buildTrip(this.photos, { overrides: this.meta.overrides, names: this.names(), geo: this.meta.geo }, { mergeRadius: this.meta.settings.mergeRadius })
      : null;
    this.root.dataset.state = this.trip ? 'trip' : 'empty';
    if (this.view.day != null && (!this.trip || this.view.day >= this.trip.days.length)) this.view.day = null;
    this.playback.stop();
    this.playback.build(this.trip);
    if (this.mapReady) {
      this.map.setTrip(this.trip, (p) => this.url(p));
      this.map.setDayFilter(this.view.day);
      if (this.view.selected) this.map.select(this.view.selected);
    }
    if (this.trip && this.root.dataset.sheet !== 'peek' && window.innerWidth < 860 && fit) this.root.dataset.sheet = 'peek';
    this.renderPanel();
    this.renderPlaybar();
    if (fit && this.trip && this.mapReady) this.map.fit({ day: this.view.day, animate });
    if (this.trip && this.meta.settings.routeMode === 'network') this.applyRoutes();
    if (this.trip && this.meta.settings.geocode) this.applyGeocode();
  }

  renderPanel() {
    const host = $('#trip');
    if (!this.trip) { host.replaceChildren(); return; }
    renderTrip(host, this.trip, { ...this.view, title: this.title(), demo: this.meta.demo }, {
      thumbUrl: (p) => this.url(p),
      onTitle: (v) => { this.meta.title = v; this.saveMetaSoon(); },
      onDay: (d) => this.setDay(d),
      onStop: (stop) => this.focusStop(stop, { fly: true }),
      onPhoto: (photo) => this.viewer.open(this.trip, photo),
      onRename: (stop, name) => {
        if (name) this.meta.names[stop.id] = name; else delete this.meta.names[stop.id];
        this.saveMetaSoon();
        stop.name = name || this.names()[stop.id] || this.meta.geo[stop.id] || null;
        this.renderPanel();
      },
      onModeMenu: (seg, chip) => modeMenu(chip, seg, (mode) => {
        if (mode) this.meta.overrides[seg.id] = mode; else delete this.meta.overrides[seg.id];
        this.saveMetaSoon();
        this.rebuild();
      }),
    });
  }

  setDay(day) {
    this.view.day = day;
    this.map.setDayFilter(day);
    this.renderPanel();
    this.map.fit({ day });
  }

  focusStop(stop, { fly = false, scroll = false, open = false } = {}) {
    this.view.selected = stop.id;
    this.map.select(stop.id);
    if (this.playback.active) {
      const item = this.playback.items.find((i) => i.kind === 'stop' && i.stop.id === stop.id);
      if (item) this.playback.seek(item.t0 + 0.01);
    } else if (fly) {
      this.map.flyTo(stop.center);
    }
    $$('.tl-stop').forEach((li) => li.classList.toggle('is-on', li.dataset.stop === stop.id));
    if (scroll) $(`.tl-stop[data-stop="${stop.id}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    if (open && window.innerWidth < 860 && this.root.dataset.sheet === 'peek') this.setSheet('half');
  }

  /* ----------------------------------------------------------- network */

  async applyRoutes() {
    const token = ++this.networkToken;
    const segs = this.trip.segments.filter(routable);
    let failed = 0;
    for (let i = 0; i < segs.length; i += 1) {
      if (token !== this.networkToken) return;
      this.status(t('routing', { done: i + 1, total: segs.length }));
      try {
        const coords = await fetchRoute(segs[i]);
        if (coords) setRoadGeometry(segs[i], coords); else failed += 1;
      } catch (_) { failed += 1; }
      if (i % 3 === 2) this.map.refreshSegments(this.playback.active);
    }
    if (token !== this.networkToken) return;
    this.status(null);
    this.map.refreshSegments(this.playback.active);
    this.playback.build(this.trip);
    this.renderPanel();
    if (failed) this.toast(t('routingFailed'));
  }

  async applyGeocode() {
    if (!this.trip) return;
    const token = ++this.geoToken;
    const todo = this.trip.stops.filter((s) => !this.meta.names[s.id] && !this.names()[s.id] && !this.meta.geo[s.id]);
    for (let i = 0; i < todo.length; i += 1) {
      if (token !== this.geoToken || !this.meta.settings.geocode) return;
      this.status(t('geocoding', { done: i + 1, total: todo.length }));
      try {
        const name = await reverseGeocode(todo[i].center, lang);
        if (name) {
          this.meta.geo[todo[i].id] = name;
          todo[i].name = name;
          if (i % 2 === 1) this.renderPanel();
        }
      } catch (_) { break; }
    }
    this.status(null);
    this.saveMetaSoon();
    this.renderPanel();
  }

  status(text) {
    const s = $('#status');
    s.hidden = !text;
    if (text) s.textContent = text;
  }

  /* ---------------------------------------------------------- playback */

  renderPlaybar() {
    const bar = $('#playbar');
    bar.hidden = !this.trip || this.trip.stops.length < 2;
    const marks = $('#pb-marks');
    marks.replaceChildren(...(this.playback.dayMarks || []).filter((m) => m.day > 0).map((m) => {
      const i = el('i', { style: `left:${(m.at * 100).toFixed(2)}%`, title: t('dayN', { n: m.day + 1 }) });
      return i;
    }));
    $('#pb-range').value = 0;
    $('#pb-clock').textContent = t('replay');
    this.onPlayState();
  }

  onFrame(f) {
    if (!this.scrubbing) $('#pb-range').value = Math.round((f.pos / f.total) * 1000);
    $('#pb-clock').textContent = f.clock;
    const stop = f.item.kind === 'stop' ? f.item.stop : null;
    if (stop && this.lastPlayStop !== stop.id) {
      this.lastPlayStop = stop.id;
      $$('.tl-stop').forEach((li) => li.classList.toggle('is-on', li.dataset.stop === stop.id));
      if (this.playback.playing) $(`.tl-stop[data-stop="${stop.id}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      this.map.select(stop.id);
    }
  }

  onPlayState(state) {
    const playing = this.playback.playing;
    const btn = $('#pb-play');
    btn.classList.toggle('is-playing', playing);
    btn.setAttribute('aria-label', playing ? t('pause') : t('play'));
    btn.title = playing ? t('pause') : t('play');
    this.root.classList.toggle('is-replaying', this.playback.active);
    $('#pb-stop').hidden = !this.playback.active;
    if (!this.playback.active) {
      $('#pb-clock').textContent = t('replay');
      $('#pb-range').value = 0;
      this.lastPlayStop = null;
    }
    if (state === 'ended') setTimeout(() => { if (!this.playback.playing) this.toast(t('fitAll')); }, 10);
  }

  /* ----------------------------------------------------------- theming */

  setTheme(theme) {
    this.meta.settings.theme = theme;
    this.root.dataset.theme = theme;
    this.map.setTheme(theme);
    $$('input[name="theme"]').forEach((r) => { r.checked = r.value === theme; });
    this.saveMetaSoon();
  }

  /* ---------------------------------------------------------- dialogs */

  toggleMenu(button) {
    const menu = $('#menu');
    if (!menu.hidden) { menu.hidden = true; return; }
    menu.hidden = false;
    $$('#menu [data-needs-trip]').forEach((b) => { b.disabled = !this.trip; });
    const close = (e) => {
      if (!menu.contains(e.target) && e.target !== button && !button.contains(e.target)) {
        menu.hidden = true;
        document.removeEventListener('pointerdown', close, true);
      }
    };
    setTimeout(() => document.addEventListener('pointerdown', close, true), 0);
    menu.addEventListener('click', () => { menu.hidden = true; }, { once: true });
  }

  openSettings() {
    const s = this.meta.settings;
    $$('input[name="route-mode"]').forEach((r) => { r.checked = r.value === s.routeMode; });
    $('#set-geocode').checked = s.geocode;
    $('#set-radius').value = s.mergeRadius;
    $('#set-radius-out').textContent = `${s.mergeRadius} m`;
    $$('input[name="lang"]').forEach((r) => { r.checked = r.value === lang; });
    $$('input[name="theme"]').forEach((r) => { r.checked = r.value === s.theme; });
    $('#settings').showModal();
  }

  exportGpx() {
    if (!this.trip) return;
    const title = this.title() || t('untitledTrip');
    download(new Blob([toGpx(this.trip, title)], { type: 'application/gpx+xml' }), `${title.replace(/[\\/:*?"<>|]+/g, ' ').trim()}.gpx`);
    this.toast(t('exportedGpx'));
  }

  async exportArchive() {
    if (!this.trip) return;
    const title = this.title() || t('untitledTrip');
    const text = await toArchive(this.photos, { ...this.meta, title: this.meta.title || title });
    download(new Blob([text], { type: 'application/json' }), `${title.replace(/[\\/:*?"<>|]+/g, ' ').trim()}.tripmap.json`);
    this.toast(t('archiveSaved'));
  }

  async makePoster() {
    if (!this.trip) return;
    const dialog = $('#poster');
    const media = $('#poster-media');
    media.replaceChildren(el('p', { class: 'poster-wait' }, t('posterMaking')));
    dialog.showModal();
    this.playback.stop();
    this.map.select(null);
    this.map.fit({ day: null, animate: false });
    await new Promise((r) => setTimeout(r, 1400));
    const snapshot = await this.map.snapshot();
    const blob = await makePoster({
      snapshot, trip: this.trip, title: this.title() || t('untitledTrip'),
      theme: this.meta.settings.theme, photoUrl: (p, kind) => this.url(p, kind),
    });
    const url = URL.createObjectURL(blob);
    media.replaceChildren(el('img', { src: url, alt: t('posterTitle') }));
    $('#poster-download').onclick = () => download(blob, `${(this.title() || t('untitledTrip')).trim()}.png`);
  }

  /* ------------------------------------------------------------ sheet */

  bindSheet() {
    const handle = $('#sheet-handle');
    this.root.dataset.sheet = 'peek';
    let startY = 0;
    let startH = 0;
    let moved = false;
    handle.addEventListener('pointerdown', (e) => {
      if (window.innerWidth >= 860) return;
      const panel = $('.panel');
      startY = e.clientY;
      startH = panel.getBoundingClientRect().height;
      moved = false;
      handle.setPointerCapture(e.pointerId);
      panel.style.transition = 'none';
      const move = (ev) => {
        const h = Math.max(120, Math.min(window.innerHeight * 0.92, startH - (ev.clientY - startY)));
        if (Math.abs(ev.clientY - startY) > 4) moved = true;
        panel.style.height = `${h}px`;
      };
      const up = (ev) => {
        handle.removeEventListener('pointermove', move);
        handle.removeEventListener('pointerup', up);
        panel.style.transition = '';
        panel.style.height = '';
        if (!moved) return;
        const h = startH - (ev.clientY - startY);
        const vh = window.innerHeight;
        const snaps = [['peek', 0], ['half', vh * 0.5], ['full', vh * 0.88]];
        const best = snaps.reduce((a, b) => (Math.abs(b[1] - h) < Math.abs(a[1] - h) ? b : a));
        this.setSheet(best[0]);
      };
      handle.addEventListener('pointermove', move);
      handle.addEventListener('pointerup', up);
    });
  }

  setSheet(state) {
    this.root.dataset.sheet = state;
    setTimeout(() => this.map.resize(), 320);
  }

  cycleSheet() {
    const order = ['peek', 'half', 'full'];
    const next = order[(order.indexOf(this.root.dataset.sheet) + 1) % order.length];
    this.setSheet(next);
  }

  /* -------------------------------------------------------------- misc */

  saveMetaSoon() {
    clearTimeout(this.metaTimer);
    this.metaTimer = setTimeout(() => saveMeta(this.meta), 300);
  }

  toast(message) {
    const node = $('#toast');
    node.textContent = message;
    node.classList.add('is-on');
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => node.classList.remove('is-on'), 3200);
  }
}

const app = new App();
window.tripmap = app;
app.init();

