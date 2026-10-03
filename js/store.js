// Reports live in IndexedDB on the phone (photos included) until the user shares them.
const DB = 'mmo', STORE = 'reports';
function open() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
}
async function tx(mode, fn) {
  const db = await open();
  return new Promise((res, rej) => { const t = db.transaction(STORE, mode); const out = fn(t.objectStore(STORE)); t.oncomplete = () => res(out.result ?? out); t.onerror = () => rej(t.error); });
}
export const addReport = (r) => tx('readwrite', (s) => s.add({ ...r, createdAt: Date.now() }));
export const allReports = () => tx('readonly', (s) => s.getAll());
export const deleteReport = (id) => tx('readwrite', (s) => s.delete(id));

/** Shrink a photo to a ~800 px JPEG for storage and sharing. */
export async function shrink(bitmap, max = 800) {
  const k = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
  const c = document.createElement('canvas'); c.width = Math.round(bitmap.width * k); c.height = Math.round(bitmap.height * k);
  c.getContext('2d').drawImage(bitmap, 0, 0, c.width, c.height);
  return new Promise((r) => c.toBlob(r, 'image/jpeg', 0.75));
}
