/* Inline SVG icons (stroke = currentColor). */

const svg = (body, size = 20, view = 20) =>
  `<svg viewBox="0 0 ${view} ${view}" width="${size}" height="${size}" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;

export const ICONS = {
  looks: svg('<circle cx="10" cy="7.2" r="4.2"/><circle cx="7" cy="12.6" r="4.2"/><circle cx="13" cy="12.6" r="4.2"/>'),
  adjust: svg('<path d="M3 6h14M3 14h14"/><circle cx="13" cy="6" r="2.3" fill="var(--surface)"/><circle cx="7" cy="14" r="2.3" fill="var(--surface)"/>'),
  live: svg('<circle cx="10" cy="10" r="7.2" stroke-dasharray="2.4 2"/><circle cx="10" cy="10" r="4"/><circle cx="10" cy="10" r="1.3" fill="currentColor"/>'),
  crop: svg('<path d="M5.5 2.5v11a1 1 0 001 1h11"/><path d="M2.5 5.5h11a1 1 0 011 1v11"/>'),
  audio: svg('<path d="M3 8.5v3M6.2 5.5v9M9.4 7.5v5M12.6 3.5v13M15.8 8v4"/>'),
  play: '<svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true"><path d="M6 3.8v12.4a.8.8 0 001.2.7l10-6.2a.8.8 0 000-1.4l-10-6.2A.8.8 0 006 3.8z" fill="currentColor"/></svg>',
  pause: '<svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true"><rect x="4.5" y="3.5" width="3.8" height="13" rx="1.2" fill="currentColor"/><rect x="11.7" y="3.5" width="3.8" height="13" rx="1.2" fill="currentColor"/></svg>',
  undo: svg('<path d="M7.5 5L3.5 9l4 4"/><path d="M4 9h8a4.5 4.5 0 010 9h-2"/>'),
  redo: svg('<path d="M12.5 5l4 4-4 4"/><path d="M16 9H8a4.5 4.5 0 000 9h2"/>'),
  compare: svg('<rect x="2.5" y="4" width="15" height="12" rx="2"/><path d="M10 2.5v15"/>'),
  export: svg('<path d="M10 12.5V3m0 0L6.5 6.5M10 3l3.5 3.5"/><path d="M4 10.5v5.5h12v-5.5"/>'),
  close: svg('<path d="M5 5l10 10M15 5L5 15"/>'),
  plus: svg('<path d="M10 4v12M4 10h12"/>'),
  upload: svg('<path d="M10 13V3.5m0 0L6.5 7M10 3.5L13.5 7"/><path d="M3.5 12.5v3a1.5 1.5 0 001.5 1.5h10a1.5 1.5 0 001.5-1.5v-3"/>'),
  mic: svg('<rect x="7" y="2.5" width="6" height="10" rx="3"/><path d="M4.5 9.5a5.5 5.5 0 0011 0M10 15v2.5"/>'),
  note: svg('<path d="M7.5 15.5V4.5l9-2v11"/><circle cx="5.5" cy="15.5" r="2"/><circle cx="14.5" cy="13.5" r="2"/>'),
  speaker: svg('<path d="M3.5 7.5v5h3l4 3.5v-12l-4 3.5z"/><path d="M13.5 7a4 4 0 010 6M15.6 5a6.8 6.8 0 010 10"/>'),
  mute: svg('<path d="M3.5 7.5v5h3l4 3.5v-12l-4 3.5z"/><path d="M13.5 8l4 4M17.5 8l-4 4"/>'),
  trash: svg('<path d="M4 6h12M8 6V4h4v2M5.5 6l.8 10.5h7.4L14.5 6"/>'),
  wand: svg('<path d="M3.5 16.5l9-9M11 3v2.5M15.5 7.5H18M14.6 4.4l1.8-1.8M14.6 10.6l1.8 1.8M8.4 4.4 6.6 2.6"/>'),
  rotate: svg('<path d="M4 10a6 6 0 1 0 2-4.5"/><path d="M4 3.5v3h3"/>'),
  flip: svg('<path d="M10 2.5v15"/><path d="M7 6L3 14h4z"/><path d="M13 6l4 8h-4z"/>'),
  key: '<svg viewBox="0 0 12 12" width="11" height="11" aria-hidden="true"><path d="M6 1l5 5-5 5-5-5z" fill="currentColor"/></svg>',
  menu: svg('<circle cx="4.5" cy="10" r="1.2" fill="currentColor"/><circle cx="10" cy="10" r="1.2" fill="currentColor"/><circle cx="15.5" cy="10" r="1.2" fill="currentColor"/>'),
  back: svg('<path d="M12 4L6 10l6 6"/>'),
  check: svg('<path d="M4 10.5l4 4 8-9"/>'),
  share: svg('<path d="M10 12V3m0 0L6.5 6.5M10 3l3.5 3.5"/><path d="M5 9H4v8.5h12V9h-1"/>'),
  effectLive: svg('<circle cx="10" cy="10" r="7" stroke-dasharray="2.2 2"/><circle cx="10" cy="10" r="3.6"/>', 26),
  effectLoop: svg('<path d="M5 12.5a4 4 0 010-5h10a4 4 0 010 5H9"/><path d="M11 10.5l-2 2 2 2"/>', 26),
  effectBounce: svg('<path d="M3 13l4-6 3 4 3-4 4 6"/><path d="M3 16h14" stroke-dasharray="1.5 2"/>', 26),
  effectLong: svg('<path d="M3 13c3-5 5-5 7 0s4 5 7 0" opacity=".35"/><path d="M3 10c3-5 5-5 7 0s4 5 7 0" opacity=".65"/><path d="M3 7c3-5 5-5 7 0s4 5 7 0"/>', 26),
};
