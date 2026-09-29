/* Keep the current trip in IndexedDB so it survives a reload:
   photo records (with thumbnail and display JPEG blobs) plus the trip
   meta (title, overrides, names, settings). */

const DB = 'trip-memory-map';
const VERSION = 1;

function open() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('photos')) db.createObjectStore('photos', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx(db, stores, mode, run) {
  return new Promise((resolve, reject) => {
    const t = db.transaction(stores, mode);
    const result = run(t);
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

let dbPromise = null;
const db = () => (dbPromise ||= open());

export async function loadTrip() {
  try {
    const d = await db();
    const photos = [];
    let meta = null;
    await tx(d, ['photos', 'meta'], 'readonly', (t) => {
      t.objectStore('photos').openCursor().onsuccess = (e) => {
        const cursor = e.target.result;
        if (cursor) { photos.push(cursor.value); cursor.continue(); }
      };
      t.objectStore('meta').get('trip').onsuccess = (e) => { meta = e.target.result || null; };
    });
    return photos.length ? { photos, meta } : null;
  } catch (_) {
    return null;
  }
}

export async function savePhotos(photos) {
  try {
    const d = await db();
    await tx(d, ['photos'], 'readwrite', (t) => {
      const store = t.objectStore('photos');
      for (const p of photos) store.put(p);
    });
  } catch (_) { /* storage unavailable: the trip just won't persist */ }
}

export async function saveMeta(meta) {
  try {
    const d = await db();
    await tx(d, ['meta'], 'readwrite', (t) => t.objectStore('meta').put(meta, 'trip'));
  } catch (_) { /* ignore */ }
}

export async function clearAll() {
  try {
    const d = await db();
    await tx(d, ['photos', 'meta'], 'readwrite', (t) => {
      t.objectStore('photos').clear();
      t.objectStore('meta').clear();
    });
  } catch (_) { /* ignore */ }
}
