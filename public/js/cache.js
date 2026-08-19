// ── Stale-while-revalidate API cache (IndexedDB) ─────────────────────────────
//
// The DASHBOARD_DB tables refresh once a day, but every page load used to
// re-download 60+ MB of JSON. swrJSON(url, onUpdate) returns the last good
// payload from IndexedDB immediately (instant render), then re-fetches in the
// background; if the server data actually changed (SHA-256 of the response
// body differs) it saves the new payload and calls onUpdate(freshData) so the
// caller can re-render. First-ever visit (no cache) awaits the network as
// before. If IndexedDB is unavailable (private mode), degrades to plain fetch.
//
// 401 anywhere → redirect to login and throw Error('unauthorized') so callers
// can bail out quietly.

(function () {
  const DB_NAME = 'hp-dash-cache';
  const STORE   = 'api';

  function idbOpen() {
    return new Promise((resolve) => {
      if (!window.indexedDB) return resolve(null);
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    });
  }
  const dbPromise = idbOpen();

  async function idbGet(key) {
    const db = await dbPromise;
    if (!db) return null;
    return new Promise((resolve) => {
      try {
        const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(key);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => resolve(null);
      } catch (_) { resolve(null); }
    });
  }

  async function idbPut(key, val) {
    const db = await dbPromise;
    if (!db) return;
    return new Promise((resolve) => {
      try {
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).put(val, key);
        tx.oncomplete = tx.onerror = tx.onabort = () => resolve();
      } catch (_) { resolve(); }
    });
  }

  // Fetch url → { hash, data }. Hash is over the raw body so "did the daily
  // refresh actually change anything" is answered exactly, not heuristically.
  async function fetchJSON(url) {
    // cache:'no-store' is load-bearing. The API sets Cache-Control:
    // private, max-age=3600, so without it the browser answers this fetch from
    // its own HTTP cache for up to an hour — and a hard reload does NOT force
    // script-initiated fetches to revalidate. Net effect: the pipeline finishes
    // at 02:45, you reload, and the page still shows yesterday with no way to
    // force it short of clearing site data. The SWR layer below already does
    // the caching (IndexedDB + SHA-256 of the body), so the HTTP cache on top
    // of it is pure downside.
    const r = await fetch(url, { cache: 'no-store' });
    if (r.status === 401) {
      window.location.href = '/login.html';
      throw new Error('unauthorized');
    }
    if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
    const buf = await r.arrayBuffer();
    let hash;
    if (window.crypto && crypto.subtle) {
      const h = await crypto.subtle.digest('SHA-256', buf);
      hash = Array.from(new Uint8Array(h)).map(b => b.toString(16).padStart(2, '0')).join('');
    } else {
      hash = 'len:' + buf.byteLength; // http-only fallback; close enough there
    }
    return { hash, data: JSON.parse(new TextDecoder().decode(buf)) };
  }

  async function swrJSON(url, onUpdate) {
    const cached = await idbGet(url);

    if (cached && cached.data !== undefined) {
      // Serve stale now, revalidate quietly. Background failures keep the
      // cached view (except 401, which redirects to login inside fetchJSON).
      fetchJSON(url).then(({ hash, data }) => {
        if (hash === cached.hash) return;
        idbPut(url, { hash, data, savedAt: new Date().toISOString() });
        if (onUpdate) onUpdate(data);
      }).catch(err => {
        if (err.message !== 'unauthorized') console.warn('revalidate failed:', url, err);
      });
      return cached.data;
    }

    const { hash, data } = await fetchJSON(url);
    idbPut(url, { hash, data, savedAt: new Date().toISOString() });
    return data;
  }

  window.swrJSON = swrJSON;
})();
