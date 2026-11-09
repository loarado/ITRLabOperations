'use strict';

// Per-tab, short-lived navigation data. It makes an already-authorized next
// page feel immediate without treating session or operational data as durable.
(() => {
  const prefix = 'itr-navigation-warm:';
  const publicPaths = new Set(['/api/lab', '/api/inventory', '/api/shelf-index']);
  const privatePaths = new Set(['/api/session', '/api/projects/mine', '/api/treasury/overview', '/api/treasury/bootstrap', '/api/budget/terms', '/api/budget/bootstrap']);
  const key = (path) => prefix + path;
  function read(path) {
    if (!publicPaths.has(path) && !privatePaths.has(path)) return null;
    try {
      const entry = JSON.parse(sessionStorage.getItem(key(path)) || 'null');
      const maxAge = publicPaths.has(path) ? 15000 : 8000;
      return entry && Date.now() - entry.at <= maxAge ? entry.value : null;
    } catch { return null; }
  }
  function store(path, value) {
    if (!publicPaths.has(path) && !privatePaths.has(path)) return;
    try { sessionStorage.setItem(key(path), JSON.stringify({ at: Date.now(), value })); } catch {}
  }
  function clearPrivate() {
    try { privatePaths.forEach((path) => sessionStorage.removeItem(key(path))); } catch {}
  }
  async function warm(path) {
    try {
      const response = await fetch(path, { credentials: 'same-origin' });
      if (!response.ok) return null;
      const value = await response.json(); store(path, value); return value;
    } catch { return null; }
  }
  window.itrNavigationCache = { read, store, clearPrivate, warm };
})();
