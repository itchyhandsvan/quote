// Product photos, saved in this browser (IndexedDB) by item name, so "Classic" keeps its photo
// for future jobs. Each entry keeps the cropped photo used in the PDF (111 x 90 frame) and a
// copy of the original, so the crop can be adjusted later.

const DB_NAME = "itchyquote";
const STORE = "photos";
export const FRAME_RATIO = 111 / 90;
export const OUTPUT_WIDTH = 1110;

function key(itemName) {
  return itemName.trim().toLowerCase();
}

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function withStore(mode, fn) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const req = fn(tx.objectStore(STORE));
    tx.oncomplete = () => resolve(req?.result);
    tx.onerror = () => reject(tx.error);
  });
}

// Older versions stored just the cropped Blob; newer ones store { cropped, original }.
async function getEntry(itemName) {
  const value = await withStore("readonly", (s) => s.get(key(itemName)));
  if (!value) return null;
  return value instanceof Blob ? { cropped: value, original: null } : value;
}

// The cropped photo that goes into the PDF.
export async function getPhoto(itemName) {
  return (await getEntry(itemName))?.cropped ?? null;
}

// The photo as picked (scaled down), for re-cropping. Falls back to the cropped one.
export async function getOriginal(itemName) {
  const entry = await getEntry(itemName);
  return entry ? entry.original ?? entry.cropped : null;
}

export function deletePhoto(itemName) {
  return withStore("readwrite", (s) => s.delete(key(itemName)));
}

export function savePhoto(itemName, { cropped, original }) {
  return withStore("readwrite", (s) => s.put({ cropped, original }, key(itemName)));
}
