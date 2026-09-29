/* Full-screen photo viewer: arrows / swipe / keyboard, caption with place,
   local time and camera, and a jump back to the map. */

import { fmtDate, fmtTime, fmtOffset, t } from './i18n.js';

export class Viewer {
  constructor(root, { photoUrl, onShowOnMap }) {
    this.root = root;
    this.photoUrl = photoUrl;
    this.onShowOnMap = onShowOnMap;
    this.img = root.querySelector('.vw-img');
    this.caption = root.querySelector('.vw-caption');
    root.querySelector('.vw-close').addEventListener('click', () => this.close());
    root.querySelector('.vw-prev').addEventListener('click', () => this.step(-1));
    root.querySelector('.vw-next').addEventListener('click', () => this.step(1));
    root.querySelector('.vw-map').addEventListener('click', () => {
      const entry = this.list[this.index];
      this.close();
      this.onShowOnMap?.(entry.stop);
    });
    root.addEventListener('click', (e) => { if (e.target === root || e.target.classList.contains('vw-stage')) this.close(); });
    let startX = null;
    root.addEventListener('touchstart', (e) => { startX = e.touches[0].clientX; }, { passive: true });
    root.addEventListener('touchend', (e) => {
      if (startX == null) return;
      const dx = e.changedTouches[0].clientX - startX;
      if (Math.abs(dx) > 50) this.step(dx < 0 ? 1 : -1);
      startX = null;
    });
    window.addEventListener('keydown', (e) => {
      if (root.hidden) return;
      if (e.key === 'Escape') this.close();
      else if (e.key === 'ArrowLeft') this.step(-1);
      else if (e.key === 'ArrowRight') this.step(1);
      else return;
      e.preventDefault();
      e.stopImmediatePropagation();
    }, true);
  }

  get isOpen() { return !this.root.hidden; }

  open(trip, photo) {
    this.list = [];
    for (const stop of trip.stops) for (const p of stop.photos) this.list.push({ photo: p, stop });
    this.index = Math.max(0, this.list.findIndex((e) => e.photo.id === photo.id));
    this.root.hidden = false;
    document.body.classList.add('is-viewing');
    this.show();
  }

  close() {
    this.root.hidden = true;
    document.body.classList.remove('is-viewing');
  }

  step(delta) {
    if (!this.list?.length) return;
    this.index = (this.index + delta + this.list.length) % this.list.length;
    this.show();
  }

  show() {
    const { photo, stop } = this.list[this.index];
    this.img.src = this.photoUrl(photo, 'display');
    this.img.alt = stop.name || photo.name;
    const place = stop.name || t('stopN', { n: stop.index + 1 });
    const bits = [
      `${fmtDate(photo.time, photo.offset, true)} ${fmtTime(photo.time, photo.offset)} (${fmtOffset(photo.offset)}${photo.tz === 'longitude' || photo.tz === 'nearby' ? ', ' + t('tzApprox') : ''})`,
      `${photo.lat.toFixed(5)}, ${photo.lon.toFixed(5)}`,
    ];
    if (photo.camera) bits.push(photo.camera);
    this.caption.querySelector('.vw-place').textContent = place;
    this.caption.querySelector('.vw-meta').textContent = bits.join(' · ');
    this.caption.querySelector('.vw-count').textContent = t('photoOf', { i: this.index + 1, n: this.list.length });
    this.caption.querySelector('.vw-file').textContent = photo.name;
  }
}
