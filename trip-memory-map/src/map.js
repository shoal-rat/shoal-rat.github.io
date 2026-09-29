/* MapLibre wrapper: a recoloured OpenFreeMap "Positron" base (paper by day,
   ink at night), route layers per transport mode, photo markers with simple
   decluttering, and the moving marker used by the replay. */

import * as maplibregl from '../vendor/maplibre/maplibre-gl.mjs';
import { MODE_STYLE } from './trip.js';
import { bbox } from './geo.js';

const STYLE_URL = 'https://tiles.openfreemap.org/styles/positron';

export const PALETTES = {
  paper: {
    background: '#f3ede2', water: '#c9d9e0', waterway: '#b5cad4', park: '#e1e5d0', wood: '#d9e0c6',
    residential: '#ece4d6', ice: '#f6f2ea', building: '#e6dccb', buildingOutline: '#d9ccb6',
    roadMinor: '#fbf8f1', roadMajor: '#ffffff', roadCasing: '#ddd1bc', motorway: '#f5e4c4',
    motorwayCasing: '#e0caa2', rail: '#c9bca6', boundary: '#b3a086', label: '#5a5043',
    labelHalo: '#f6f1e6', waterLabel: '#5f7f8f', casing: '#ffffff', arrow: '#ffffff',
  },
  ink: {
    background: '#121923', water: '#0a131e', waterway: '#132536', park: '#16211d', wood: '#15201b',
    residential: '#161e29', ice: '#1a2230', building: '#1b2430', buildingOutline: '#232e3c',
    roadMinor: '#1e2733', roadMajor: '#293344', roadCasing: '#0f151d', motorway: '#3a3426',
    motorwayCasing: '#16140f', rail: '#2b3545', boundary: '#4c5c70', label: '#b8c2ce',
    labelHalo: '#0f151e', waterLabel: '#6a88a5', casing: '#0b1017', arrow: '#0b1017',
  },
};

function paintFor(layer, pal) {
  const id = layer.id;
  const out = {};
  const L = layer.type;
  if (L === 'background') out['background-color'] = pal.background;
  else if (id === 'water') out['fill-color'] = pal.water;
  else if (id === 'waterway') out['line-color'] = pal.waterway;
  else if (id === 'park') out['fill-color'] = pal.park;
  else if (id.startsWith('landcover_wood')) out['fill-color'] = pal.wood;
  else if (id.startsWith('landcover_')) out['fill-color'] = pal.ice;
  else if (id.startsWith('landuse')) out['fill-color'] = pal.residential;
  else if (id === 'building') { out['fill-color'] = pal.building; out['fill-outline-color'] = pal.buildingOutline; }
  else if (id.startsWith('aeroway')) out[L === 'fill' ? 'fill-color' : 'line-color'] = pal.roadMinor;
  else if (id.startsWith('road_area') || id.startsWith('road_pier')) out[L === 'fill' ? 'fill-color' : 'line-color'] = pal.background;
  else if (id.startsWith('railway')) out['line-color'] = pal.rail;
  else if (id.startsWith('boundary')) out['line-color'] = pal.boundary;
  else if (L === 'line' && id.includes('casing')) out['line-color'] = id.includes('motorway') ? pal.motorwayCasing : pal.roadCasing;
  else if (L === 'line' && id.includes('motorway')) out['line-color'] = pal.motorway;
  else if (L === 'line' && (id.includes('major'))) out['line-color'] = pal.roadMajor;
  else if (L === 'line' && (id.includes('highway') || id.includes('tunnel'))) out['line-color'] = pal.roadMinor;
  else if (L === 'symbol') {
    out['text-color'] = id.startsWith('water') ? pal.waterLabel : pal.label;
    out['text-halo-color'] = pal.labelHalo;
  }
  return out;
}

function labelField(language) {
  return language === 'zh'
    ? ['coalesce', ['get', 'name:zh'], ['get', 'name:nonlatin'], ['get', 'name']]
    : ['coalesce', ['get', 'name:en'], ['get', 'name:latin'], ['get', 'name']];
}

function arrowImage(color) {
  const size = 18;
  const c = document.createElement('canvas');
  c.width = size * 2;
  c.height = size * 2;
  const g = c.getContext('2d');
  g.scale(2, 2);
  g.strokeStyle = color;
  g.lineWidth = 2.2;
  g.lineCap = 'round';
  g.lineJoin = 'round';
  g.beginPath();
  g.moveTo(6, 5);
  g.lineTo(11, 9);
  g.lineTo(6, 13);
  g.stroke();
  return { width: size * 2, height: size * 2, data: g.getImageData(0, 0, size * 2, size * 2).data };
}

export class TripMap {
  constructor(container, { onStopClick, onUserMove } = {}) {
    this.container = container;
    this.onStopClick = onStopClick;
    this.onUserMove = onUserMove;
    this.theme = 'paper';
    this.language = 'zh';
    this.markers = new Map();
    this.dayFilter = null;
    this.selected = null;
    this.ready = this.init();
  }

  async init() {
    const response = await fetch(STYLE_URL);
    const style = await response.json();
    // positron ships a shaded-relief raster we don't use
    style.layers = style.layers.filter((l) => !l.id.startsWith('ne2') && l.source !== 'ne2_shaded');
    delete style.sources.ne2_shaded;
    this.baseStyle = style;
    this.map = new maplibregl.Map({
      container: this.container,
      style: this.styled(),
      center: [120, 30],
      zoom: 2.2,
      attributionControl: { compact: true },
      canvasContextAttributes: { preserveDrawingBuffer: true },
      localIdeographFontFamily: '"PingFang SC", "Hiragino Sans GB", "Noto Sans CJK SC", "Microsoft YaHei", sans-serif',
      dragRotate: false,
      pitchWithRotate: false,
      fadeDuration: 120,
    });
    this.map.touchZoomRotate.disableRotation();
    await new Promise((resolve) => this.map.once('load', resolve));
    this.addRouteLayers();
    this.map.on('moveend', () => this.declutter());
    this.map.on('zoom', () => this.scheduleDeclutter());
    for (const type of ['dragstart', 'wheel', 'touchstart']) {
      this.map.on(type, (e) => { if (e.originalEvent) this.onUserMove?.(); });
    }
    return this;
  }

  styled() {
    const style = JSON.parse(JSON.stringify(this.baseStyle));
    const pal = PALETTES[this.theme];
    for (const layer of style.layers) {
      layer.paint = { ...(layer.paint || {}), ...paintFor(layer, pal) };
      if (layer.type === 'symbol' && layer.layout?.['text-field'] && !String(layer.id).includes('shield')) {
        layer.layout['text-field'] = labelField(this.language);
      }
    }
    return style;
  }

  /** Recolour in place so our route layers survive. */
  setTheme(theme) {
    this.theme = theme;
    if (!this.map) return;
    const pal = PALETTES[theme];
    for (const layer of this.baseStyle.layers) {
      if (!this.map.getLayer(layer.id)) continue;
      for (const [prop, value] of Object.entries(paintFor(layer, pal))) this.map.setPaintProperty(layer.id, prop, value);
    }
    this.map.setPaintProperty('seg-casing', 'line-color', pal.casing);
    this.map.setPaintProperty('seg-rail-ties', 'line-color', pal.casing);
    if (this.map.hasImage('seg-arrow')) this.map.removeImage('seg-arrow');
    this.map.addImage('seg-arrow', arrowImage(pal.arrow), { pixelRatio: 2 });
    this.container.dataset.theme = theme;
  }

  setLanguage(language) {
    this.language = language;
    if (!this.map) return;
    for (const layer of this.baseStyle.layers) {
      if (layer.type === 'symbol' && layer.layout?.['text-field'] && !layer.id.includes('shield') && this.map.getLayer(layer.id)) {
        this.map.setLayoutProperty(layer.id, 'text-field', labelField(language));
      }
    }
  }

  /* ----------------------------------------------------------- routes */

  addRouteLayers() {
    const map = this.map;
    const pal = PALETTES[this.theme];
    const empty = { type: 'FeatureCollection', features: [] };
    map.addSource('segments', { type: 'geojson', data: empty });
    map.addSource('progress', { type: 'geojson', data: empty });
    map.addImage('seg-arrow', arrowImage(pal.arrow), { pixelRatio: 2 });
    const color = ['match', ['get', 'mode'], ...Object.entries(MODE_STYLE).flatMap(([m, s]) => [m, s.color]), '#888'];
    const width = ['match', ['get', 'mode'], ...Object.entries(MODE_STYLE).flatMap(([m, s]) => [m, s.width]), 3];
    const opacity = ['case', ['boolean', ['get', 'dim'], false], 0.22, 1];
    const zoomWidth = (w) => ['interpolate', ['linear'], ['zoom'], 3, ['*', w, 0.7], 10, w, 16, ['*', w, 1.5]];

    map.addLayer({
      id: 'seg-casing', type: 'line', source: 'segments',
      filter: ['!=', ['get', 'mode'], 'flight'],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': pal.casing, 'line-width': zoomWidth(['+', width, 3.5]), 'line-opacity': ['*', opacity, 0.9] },
    });
    const dashLayer = (id, modes, dash) => {
      map.addLayer({
        id, type: 'line', source: 'segments',
        filter: ['in', ['get', 'mode'], ['literal', modes]],
        layout: { 'line-cap': dash ? 'round' : 'round', 'line-join': 'round' },
        paint: {
          'line-color': color, 'line-width': zoomWidth(width), 'line-opacity': opacity,
          ...(dash ? { 'line-dasharray': dash } : {}),
        },
      });
    };
    dashLayer('seg-solid', ['bus', 'car', 'rail'], null);
    dashLayer('seg-walk', ['walk'], MODE_STYLE.walk.dash);
    dashLayer('seg-bike', ['bike'], MODE_STYLE.bike.dash);
    dashLayer('seg-boat', ['boat'], MODE_STYLE.boat.dash);
    dashLayer('seg-flight', ['flight'], MODE_STYLE.flight.dash);
    dashLayer('seg-unknown', ['unknown'], MODE_STYLE.unknown.dash);
    map.addLayer({
      id: 'seg-rail-ties', type: 'line', source: 'segments',
      filter: ['==', ['get', 'mode'], 'rail'],
      paint: { 'line-color': pal.casing, 'line-width': zoomWidth(1.6), 'line-dasharray': [2, 3], 'line-opacity': opacity },
    });
    map.addLayer({
      id: 'seg-arrows', type: 'symbol', source: 'segments',
      filter: ['all', ['!=', ['get', 'mode'], 'flight'], ['!', ['boolean', ['get', 'dim'], false]]],
      layout: {
        'symbol-placement': 'line', 'symbol-spacing': 110, 'icon-image': 'seg-arrow',
        'icon-size': ['interpolate', ['linear'], ['zoom'], 4, 0.6, 12, 0.9], 'icon-allow-overlap': true, 'icon-rotation-alignment': 'map',
      },
    });
    map.addLayer({
      id: 'progress-glow', type: 'line', source: 'progress',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': color, 'line-width': zoomWidth(['+', width, 7]), 'line-opacity': 0.22, 'line-blur': 3 },
    });
    map.addLayer({
      id: 'progress-line', type: 'line', source: 'progress',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': color, 'line-width': zoomWidth(['+', width, 1]) },
    });
  }

  segmentFeatures(dimAll = false) {
    const trip = this.trip;
    if (!trip) return { type: 'FeatureCollection', features: [] };
    return {
      type: 'FeatureCollection',
      features: trip.segments.map((seg) => ({
        type: 'Feature',
        properties: { mode: seg.mode, index: seg.index, dim: dimAll || (this.dayFilter != null && seg.day !== this.dayFilter && seg.from.day !== this.dayFilter) },
        geometry: { type: 'LineString', coordinates: seg.geometry },
      })),
    };
  }

  refreshSegments(dimAll = false) {
    this.dimAll = dimAll;
    this.map?.getSource('segments')?.setData(this.segmentFeatures(dimAll));
  }

  setProgress(features) {
    this.map?.getSource('progress')?.setData({ type: 'FeatureCollection', features });
  }

  /* ---------------------------------------------------------- markers */

  setTrip(trip, thumbUrl) {
    this.trip = trip;
    for (const marker of this.markers.values()) marker.marker.remove();
    this.markers.clear();
    if (!trip) { this.refreshSegments(); return; }
    trip.stops.forEach((stop) => {
      const el = document.createElement('button');
      el.type = 'button';
      el.className = 'stop-marker';
      el.dataset.stop = stop.id;
      el.setAttribute('aria-label', stop.name || `#${stop.index + 1}`);
      const img = document.createElement('img');
      img.src = thumbUrl(stop.photos[0]);
      img.alt = '';
      img.decoding = 'async';
      const count = document.createElement('span');
      count.className = 'stop-count';
      count.textContent = stop.photos.length > 1 ? String(stop.photos.length) : '';
      const num = document.createElement('span');
      num.className = 'stop-num';
      num.textContent = String(stop.index + 1);
      el.append(img, count, num);
      el.addEventListener('click', (e) => { e.stopPropagation(); this.onStopClick?.(stop); });
      const marker = new maplibregl.Marker({ element: el, anchor: 'center' }).setLngLat(stop.center).addTo(this.map);
      this.markers.set(stop.id, { marker, el, stop });
    });
    this.refreshSegments();
    this.applyDayFilter();
    this.declutter();
  }

  setDayFilter(day) {
    this.dayFilter = day;
    this.refreshSegments(this.dimAll);
    this.applyDayFilter();
  }

  applyDayFilter() {
    for (const { el, stop } of this.markers.values()) {
      el.classList.toggle('is-dim', this.dayFilter != null && stop.day !== this.dayFilter);
    }
  }

  select(stopId) {
    this.selected = stopId;
    for (const [id, { el }] of this.markers) el.classList.toggle('is-selected', id === stopId);
    this.declutter();
  }

  scheduleDeclutter() {
    cancelAnimationFrame(this.declutterRaf);
    this.declutterRaf = requestAnimationFrame(() => this.declutter());
  }

  /** Hide markers that would sit on top of a more important one. */
  declutter() {
    if (!this.map || !this.markers.size) return;
    const items = [...this.markers.values()].map((m) => ({ ...m, p: this.map.project(m.stop.center) }));
    items.sort((a, b) => {
      const sel = (x) => (x.stop.id === this.selected ? 1 : 0);
      const day = (x) => (this.dayFilter == null || x.stop.day === this.dayFilter ? 1 : 0);
      return sel(b) - sel(a) || day(b) - day(a) || b.stop.photos.length - a.stop.photos.length || a.stop.index - b.stop.index;
    });
    const shown = [];
    for (const item of items) {
      const host = shown.find((s) => Math.hypot(s.p.x - item.p.x, s.p.y - item.p.y) < 40);
      if (host) {
        item.el.classList.add('is-hidden');
        host.absorbed += item.stop.photos.length;
      } else {
        item.el.classList.remove('is-hidden');
        item.absorbed = item.stop.photos.length;
        shown.push(item);
      }
    }
    for (const s of shown) {
      const count = s.el.querySelector('.stop-count');
      count.textContent = s.absorbed > 1 ? String(s.absorbed) : '';
    }
  }

  /* ----------------------------------------------------------- camera */

  padding() {
    const narrow = window.innerWidth < 860;
    if (narrow) {
      // use the sheet's resting height, not a mid-transition measurement
      const app = document.getElementById('app');
      const vh = window.innerHeight;
      const sheet = app?.dataset.state === 'empty' ? vh * 0.86
        : ({ peek: 190, half: vh * 0.52, full: vh * 0.9 }[app?.dataset.sheet] ?? 190);
      const playbar = app?.dataset.state === 'trip' ? 74 : 0;
      return { top: 70, bottom: Math.min(vh - 140, sheet + playbar + 30), left: 40, right: 56 };
    }
    const panel = document.querySelector('.panel')?.getBoundingClientRect();
    return { top: 80, bottom: 130, left: (panel ? panel.right : 420) + 50, right: 70 };
  }

  boundsFor(stops, segments) {
    const coords = stops.map((s) => s.center);
    for (const seg of segments) coords.push(...seg.geometry);
    return bbox(coords);
  }

  fit({ day = null, animate = true } = {}) {
    const trip = this.trip;
    if (!trip || !this.map) return;
    const stops = day == null ? trip.stops : trip.stops.filter((s) => s.day === day);
    const segs = day == null ? trip.segments : trip.segments.filter((s) => s.day === day && s.from.day === day);
    if (!stops.length) return;
    const b = this.boundsFor(stops, segs);
    if (stops.length === 1) {
      this.map.easeTo({ center: stops[0].center, zoom: 15, padding: this.padding(), duration: animate ? 800 : 0 });
      return;
    }
    this.map.fitBounds(b, { padding: this.padding(), maxZoom: 15.5, duration: animate ? 900 : 0 });
  }

  flyTo(center, zoom = 15.5) {
    this.map?.flyTo({ center, zoom: Math.max(this.map.getZoom(), zoom), padding: this.padding(), speed: 1.4, curve: 1.5 });
  }

  cameraForSegment(seg) {
    return this.map.cameraForBounds(this.boundsFor([seg.from, seg.to], [seg]), { padding: this.padding(), maxZoom: 16 });
  }

  jump(center, zoom) {
    this.map.jumpTo({ center, zoom, padding: this.padding() });
  }

  /* ------------------------------------------------------------ mover */

  setMover(lngLat, mode) {
    if (!this.mover) {
      const el = document.createElement('div');
      el.className = 'mover';
      el.innerHTML = '<span class="mover-dot"></span>';
      this.moverEl = el;
      this.mover = new maplibregl.Marker({ element: el, anchor: 'center' });
    }
    if (!lngLat) { this.mover.remove(); this.moverOn = false; return; }
    this.mover.setLngLat(lngLat);
    if (!this.moverOn) { this.mover.addTo(this.map); this.moverOn = true; }
    if (this.moverMode !== mode) {
      this.moverMode = mode;
      this.moverEl.dataset.mode = mode;
      this.moverEl.style.setProperty('--c', MODE_STYLE[mode]?.color || '#e4572e');
    }
  }

  project(lngLat) { return this.map.project(lngLat); }

  /** Canvas snapshot plus marker positions, for the share poster. */
  snapshot() {
    this.map.triggerRepaint();
    return new Promise((resolve) => {
      this.map.once('render', () => {
        const canvas = this.map.getCanvas();
        const stops = this.trip.stops.map((s) => ({ stop: s, p: this.map.project(s.center) }));
        // screen extent of everything the poster must show
        let x0 = Infinity; let y0 = Infinity; let x1 = -Infinity; let y1 = -Infinity;
        const add = (p) => { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); };
        stops.forEach((s) => add(s.p));
        for (const seg of this.trip.segments) {
          const step = Math.max(1, Math.floor(seg.geometry.length / 24));
          for (let i = 0; i < seg.geometry.length; i += step) add(this.map.project(seg.geometry[i]));
        }
        resolve({ canvas, dpr: canvas.width / canvas.clientWidth, stops, extent: { x0, y0, x1, y1 } });
      });
    });
  }

  resize() { this.map?.resize(); }
}
