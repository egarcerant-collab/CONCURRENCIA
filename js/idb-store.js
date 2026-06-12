// IndexedDB — almacenamiento local sin límite de 5 MB (reemplaza localStorage para datasets grandes)
(function () {
  const DB_NAME    = 'dusakawi_v1';
  const DB_VERSION = 1;
  const STORE      = 'datasets';
  let _db = null;

  function openDB() {
    if (_db) return Promise.resolve(_db);
    return new Promise((res, rej) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = e => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE, { keyPath: 'key' });
        }
      };
      req.onsuccess  = e => { _db = e.target.result; res(_db); };
      req.onerror    = e => rej(e.target.error);
    });
  }

  async function idbSave(key, rows, meta = {}) {
    try {
      const db = await openDB();
      return new Promise((res, rej) => {
        const tx  = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).put({
          key,
          rows,
          fileName:   meta.fileName   || key,
          uploadedAt: meta.uploadedAt || new Date().toISOString(),
          savedAt:    new Date().toISOString(),
          count:      rows.length,
        });
        tx.oncomplete = () => res(true);
        tx.onerror    = e  => rej(e.target.error);
      });
    } catch (e) {
      console.warn('[IDB] save error:', e);
      return false;
    }
  }

  async function idbLoad(key) {
    try {
      const db = await openDB();
      return new Promise((res, rej) => {
        const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(key);
        req.onsuccess = e => res(e.target.result || null);
        req.onerror   = e => rej(e.target.error);
      });
    } catch (e) {
      console.warn('[IDB] load error:', e);
      return null;
    }
  }

  async function idbDelete(key) {
    try {
      const db = await openDB();
      return new Promise(res => {
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).delete(key);
        tx.oncomplete = () => res(true);
      });
    } catch (e) { return false; }
  }

  // Lista todas las entradas con metadatos (para panel admin)
  async function idbList() {
    try {
      const db = await openDB();
      return new Promise((res, rej) => {
        const results = [];
        const req = db.transaction(STORE, 'readonly').objectStore(STORE).openCursor();
        req.onsuccess = e => {
          const cursor = e.target.result;
          if (cursor) {
            const { key, fileName, uploadedAt, savedAt, count } = cursor.value;
            results.push({ key, fileName, uploadedAt, savedAt, count });
            cursor.continue();
          } else {
            res(results);
          }
        };
        req.onerror = e => rej(e.target.error);
      });
    } catch (e) { return []; }
  }

  window.IDB_STORE_API = { idbSave, idbLoad, idbDelete, idbList };
})();
