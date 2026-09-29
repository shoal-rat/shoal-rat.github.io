/* Sidebar rendering: trip header, stats, mode bar, day chips and the
   stop/leg timeline. Pure DOM building; behaviour comes in via handlers. */

import { t, fmtDate, fmtTime, fmtDuration, fmtDistance, fmtDays, lang } from './i18n.js';
import { MODE_STYLE, MODE_KEY, MODES } from './trip.js';

const svg = (body) => `<svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;

export const MODE_ICON = {
  walk: svg('<circle cx="11" cy="3.6" r="1.6"/><path d="M8.5 18l2-5.5 2.5 2V18M10.5 12.5l.6-4.3M11 8.2L7.8 9.8 6.8 12.6M11 8.2l2.3 2.6 2.5.7"/>'),
  bike: svg('<circle cx="5" cy="13.5" r="3"/><circle cx="15" cy="13.5" r="3"/><path d="M5 13.5l3-6h5l2 6M8 7.5l2.2 6h2.3M12 5h2"/>'),
  bus: svg('<rect x="4" y="3" width="12" height="12" rx="2.2"/><path d="M4 9.5h12M6.5 15v2M13.5 15v2"/><circle cx="7" cy="12.3" r=".6" fill="currentColor"/><circle cx="13" cy="12.3" r=".6" fill="currentColor"/>'),
  car: svg('<path d="M3.5 12.5l1.4-4.2a2 2 0 011.9-1.3h6.4a2 2 0 011.9 1.3l1.4 4.2v3h-13z"/><path d="M5 15.5v1.5M15 15.5v1.5"/><circle cx="6.5" cy="12.8" r=".6" fill="currentColor"/><circle cx="13.5" cy="12.8" r=".6" fill="currentColor"/>'),
  rail: svg('<rect x="5" y="2.5" width="10" height="12" rx="3"/><path d="M5 9h10M7.5 17.5L9 14.5M12.5 17.5L11 14.5"/><circle cx="7.8" cy="11.8" r=".6" fill="currentColor"/><circle cx="12.2" cy="11.8" r=".6" fill="currentColor"/>'),
  boat: svg('<path d="M3 13.5l1.5 3h11l1.5-3z"/><path d="M10 13.5V3l5 8H10"/><path d="M2.5 18.5c1.5 0 1.5-.8 3-.8s1.5.8 3 .8 1.5-.8 3-.8 1.5.8 3 .8 1.5-.8 3-.8"/>'),
  flight: svg('<path d="M9 17.5l1.5-1 1.5 1V15l4.5-2.5v-1.8L12 11.8V5.5a1.5 1.5 0 00-3 0v6.3l-4.5-1.1V12.5L9 15z"/>'),
  unknown: svg('<circle cx="10" cy="10" r="7"/><path d="M8 7.8a2.1 2.1 0 114 .8c-.7.8-1.8 1-1.8 2.4M10.2 14v.1"/>'),
};

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else if (k === 'style') node.style.cssText = v;
    else node.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c != null && c !== false) node.append(c.nodeType ? c : document.createTextNode(String(c)));
  return node;
}

export function stopTitle(stop) {
  return stop.name || t('stopN', { n: stop.index + 1 });
}

export function renderTrip(root, trip, view, h) {
  const s = trip.stats;
  const frag = document.createDocumentFragment();

  // header
  const title = el('input', {
    class: 'trip-title', value: view.title || t('untitledTrip'), 'aria-label': t('renameHint'), title: t('renameHint'),
    spellcheck: 'false', maxlength: '60',
  });
  title.addEventListener('change', () => h.onTitle(title.value.trim()));
  title.addEventListener('keydown', (e) => { if (e.key === 'Enter') title.blur(); });
  const span = t('tripSpan', { start: fmtDate(s.start, s.startOffset), end: fmtDate(s.end, s.endOffset) });
  frag.append(el('header', { class: 'trip-head' },
    title,
    el('p', { class: 'trip-dates' }, `${span} · ${fmtDays(s.days)}`)));

  if (view.demo) frag.append(el('p', { class: 'demo-note' }, t('demoNote')));

  // stats
  frag.append(el('dl', { class: 'stats' },
    el('div', {}, el('dt', {}, t('distance')), el('dd', {}, fmtDistance(s.km))),
    el('div', {}, el('dt', {}, t('stops')), el('dd', {}, String(s.stops))),
    el('div', {}, el('dt', {}, t('photos')), el('dd', {}, String(s.photos))),
    el('div', {}, el('dt', {}, t('duration')), el('dd', {}, fmtDuration(s.ms)))));

  // mode bar
  const modes = Object.entries(s.byMode).filter(([, km]) => km > 0.01).sort((a, b) => b[1] - a[1]);
  if (modes.length) {
    const bar = el('div', { class: 'mode-bar', role: 'img', 'aria-label': t('legend') });
    const legend = el('ul', { class: 'mode-legend' });
    for (const [mode, km] of modes) {
      const pct = (km / s.km) * 100;
      bar.append(el('span', { style: `width:${Math.max(1.5, pct)}%;background:${MODE_STYLE[mode].color}`, title: `${t(MODE_KEY[mode])} ${fmtDistance(km)}` }));
      legend.append(el('li', { style: `--c:${MODE_STYLE[mode].color}` }, el('i'), `${t(MODE_KEY[mode])} `, el('b', {}, fmtDistance(km))));
    }
    frag.append(el('div', { class: 'modes' }, bar, legend));
  } else {
    frag.append(el('p', { class: 'hint-line' }, t('noSegments')));
  }

  // days
  if (trip.days.length > 1) {
    const days = el('nav', { class: 'day-chips', 'aria-label': t('days') });
    const chip = (label, sub, day) => {
      const b = el('button', { type: 'button', class: `day-chip${view.day === day ? ' is-on' : ''}`, 'aria-pressed': String(view.day === day) },
        el('strong', {}, label), sub ? el('span', {}, sub) : null);
      b.addEventListener('click', () => h.onDay(day));
      return b;
    };
    days.append(chip(t('allDays'), null, null));
    trip.days.forEach((d) => days.append(chip(t('dayN', { n: d.index + 1 }), fmtDate(d.start, d.offset), d.index)));
    frag.append(days);
  }

  // timeline
  const list = el('ol', { class: 'tl' });
  let lastDay = -1;
  for (const stop of trip.stops) {
    if (view.day != null && stop.day !== view.day) {
      // keep the leg that arrives into the filtered day visible
      continue;
    }
    if (stop.day !== lastDay) {
      lastDay = stop.day;
      const d = trip.days[stop.day];
      list.append(el('li', { class: 'tl-day' },
        el('span', {}, `${t('dayN', { n: d.index + 1 })} · ${fmtDate(d.start, d.offset, true)}`),
        el('span', {}, `${fmtDistance(d.km)} · ${t('photoCount', { n: d.photos })}`)));
    }
    const seg = trip.segments[stop.index - 1];
    if (seg && (view.day == null || seg.day === view.day)) list.append(renderSeg(seg, h));
    list.append(renderStop(stop, view, h));
  }
  frag.append(list);
  root.replaceChildren(frag);
}

function renderStop(stop, view, h) {
  const photos = el('div', { class: 'tl-photos' });
  const max = 4;
  stop.photos.slice(0, max).forEach((photo, i) => {
    const b = el('button', { type: 'button', class: 'tl-photo', 'aria-label': photo.name },
      el('img', { src: h.thumbUrl(photo), alt: '', loading: 'lazy', decoding: 'async' }));
    if (i === max - 1 && stop.photos.length > max) b.append(el('span', {}, `+${stop.photos.length - max + 1}`));
    b.addEventListener('click', (e) => { e.stopPropagation(); h.onPhoto(photo); });
    photos.append(b);
  });
  const name = el('button', { type: 'button', class: 'tl-name', title: t('renameHint') }, stopTitle(stop));
  name.addEventListener('click', (e) => { e.stopPropagation(); startRename(name, stop, h); });
  const stay = stop.end - stop.start;
  const meta = [fmtTime(stop.start, stop.offset)];
  if (stay > 60000) meta.push(t('stayFor', { d: fmtDuration(stay) }));
  meta.push(t('photoCount', { n: stop.photos.length }));
  const item = el('li', { class: `tl-stop${view.selected === stop.id ? ' is-on' : ''}`, 'data-stop': stop.id, tabindex: '0' },
    el('span', { class: 'tl-node' }, String(stop.index + 1)),
    el('div', { class: 'tl-body' }, name, el('p', { class: 'tl-meta' }, meta.join(' · ')), photos));
  item.addEventListener('click', () => h.onStop(stop));
  item.addEventListener('keydown', (e) => { if (e.key === 'Enter') h.onStop(stop); });
  return item;
}

function startRename(button, stop, h) {
  const input = el('input', { class: 'tl-rename', value: stop.name || '', placeholder: stopTitle(stop), maxlength: '60' });
  button.replaceWith(input);
  input.focus();
  input.select();
  let done = false;
  const finish = (save) => {
    if (done) return;
    done = true;
    if (save) h.onRename(stop, input.value.trim());
    else input.replaceWith(button);
  };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') finish(true);
    if (e.key === 'Escape') finish(false);
    e.stopPropagation();
  });
  input.addEventListener('blur', () => finish(true));
  input.addEventListener('click', (e) => e.stopPropagation());
}

function renderSeg(seg, h) {
  const style = MODE_STYLE[seg.mode];
  const chip = el('button', { type: 'button', class: 'mode-chip', 'aria-haspopup': 'menu', style: `--c:${style.color}` },
    el('span', { class: 'mode-icon', html: MODE_ICON[seg.mode] }), t(MODE_KEY[seg.mode]), el('span', { class: 'caret', html: '▾' }));
  chip.addEventListener('click', (e) => { e.stopPropagation(); h.onModeMenu(seg, chip); });
  const facts = [fmtDistance(seg.km), fmtDuration(seg.ms)];
  if (seg.speed != null && seg.km > 0.2 && seg.ms > 60000) facts.push(t('kmh', { n: seg.speed < 10 ? seg.speed.toFixed(1) : Math.round(seg.speed) }));
  const notes = [];
  if (seg.overnight) notes.push(el('span', { class: 'seg-tag' }, t('overnight')));
  if (seg.userMode) notes.push(el('span', { class: 'seg-tag is-user' }, t('userSet')));
  else if (seg.auto.confidence < 0.5) notes.push(el('span', { class: 'seg-tag is-warn', title: t('lowConfidence') }, seg.auto.note === 'longGap' ? t('longGap') : t('lowConfidence')));
  const route = { road: t('routeRoad'), arc: t('routeArc'), rail: t('routeRail'), straight: t('routeStraight') }[seg.routeKind];
  return el('li', { class: 'tl-seg', style: `--c:${style.color}` },
    el('span', { class: 'tl-rail', 'data-mode': seg.mode }),
    el('div', { class: 'tl-body' },
      el('div', { class: 'seg-row' }, chip, el('span', { class: 'seg-facts' }, facts.join(' · '))),
      el('div', { class: 'seg-notes' }, ...notes, route ? el('span', { class: 'seg-route' }, route) : null)));
}

export function modeMenu(anchor, seg, onPick) {
  document.querySelector('.mode-menu')?.remove();
  const menu = el('div', { class: 'mode-menu', role: 'menu' });
  for (const mode of MODES) {
    const b = el('button', { type: 'button', role: 'menuitemradio', 'aria-checked': String(seg.mode === mode), class: seg.mode === mode ? 'is-on' : '', style: `--c:${MODE_STYLE[mode].color}` },
      el('span', { class: 'mode-icon', html: MODE_ICON[mode] }), t(MODE_KEY[mode]),
      seg.auto.mode === mode ? el('small', {}, t('auto')) : null);
    b.addEventListener('click', () => { menu.remove(); onPick(mode === seg.auto.mode ? null : mode); });
    menu.append(b);
  }
  if (seg.userMode) {
    const reset = el('button', { type: 'button', class: 'reset' }, t('resetMode'));
    reset.addEventListener('click', () => { menu.remove(); onPick(null); });
    menu.append(reset);
  }
  document.body.append(menu);
  const r = anchor.getBoundingClientRect();
  const top = Math.min(window.innerHeight - menu.offsetHeight - 12, r.bottom + 6);
  menu.style.left = `${Math.min(window.innerWidth - menu.offsetWidth - 12, r.left)}px`;
  menu.style.top = `${Math.max(12, top)}px`;
  const close = (e) => {
    if (!menu.contains(e.target)) { menu.remove(); document.removeEventListener('pointerdown', close, true); }
  };
  setTimeout(() => document.addEventListener('pointerdown', close, true), 0);
  menu.querySelector('button')?.focus();
}

export { el, lang };
