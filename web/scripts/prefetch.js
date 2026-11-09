'use strict';

// Warm only likely next documents and their static assets. A separate
// short-lived, per-tab cache handles a few safe bootstrap API responses.
(() => {
  const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  if (connection?.saveData || /(^|-)2g/.test(connection?.effectiveType || '')) return;

  const warmed = new Set(); let active = 0; const queue = [];
  const pageAssets = {
    '/lab_overview.html': ['editor.css', 'navigation_cache.js', 'prefetch.js', 'editor_groups.js', 'draft_manager.js', 'editor_recovery.js', 'common.js', 'inventory_ui.js', 'map_geometry.js', 'shelf_model.js', 'explorer.js', 'map_editor.js', 'lab_tools.js', 'map_elements.js', 'lab.js'],
    '/lab_inventory.html': ['editor.css', 'navigation_cache.js', 'prefetch.js', 'editor_groups.js', 'draft_manager.js', 'editor_recovery.js', 'common.js', 'shelf_model.js', 'inventory_ui.js', 'inventory_list.js'],
    '/project_dashboard.html': ['editor.css', 'navigation_cache.js', 'prefetch.js', 'dashboards.js'],
    '/treasury_dashboard.html': ['editor.css', 'navigation_cache.js', 'prefetch.js', 'dashboards.js'],
  };

  function addPrefetch(url) {
    if (warmed.has(url)) return;
    warmed.add(url);
    queue.push(() => fetch(url, { credentials: 'same-origin', priority: 'low' })
      .then((response) => response.ok ? response.arrayBuffer() : null).catch(() => null));
    drain();
  }
  function drain() {
    while (active < 4 && queue.length) {
      active += 1;
      queue.shift()().finally(() => { active -= 1; drain(); });
    }
  }

  function warmPage(rawHref) {
    const page = new URL(rawHref, location.href);
    if (page.origin !== location.origin || page.protocol !== location.protocol) return;
    addPrefetch(page.href);
    (pageAssets[page.pathname] || []).forEach((asset) => addPrefetch(new URL(asset, page).href));
  }

  function likelyLinks() {
    return [...document.querySelectorAll('.section-navigation a[href], .launch-button[href]')]
      .filter((link) => link.href && link.href !== location.href);
  }

  likelyLinks().forEach((link) => {
    const warm = () => warmPage(link.href);
    link.addEventListener('pointerenter', warm, { once: true });
    link.addEventListener('focus', warm, { once: true });
    link.addEventListener('touchstart', warm, { once: true, passive: true });
  });

  const afterIdle = window.requestIdleCallback
    ? (callback) => window.requestIdleCallback(callback, { timeout: 1200 })
    : (callback) => setTimeout(callback, 250);
  if (document.body.classList.contains('landing-page')) {
    afterIdle(() => {
      likelyLinks().forEach((link) => warmPage(link.href));
      const cache = window.itrNavigationCache;
      Promise.all(['/api/lab', '/api/inventory', '/api/shelf-index'].map((path) => cache?.warm(path)))
        .catch(() => {});
      // Only a confirmed authenticated officer/leader receives the additional
      // admin warm-up. Private responses stay in short-lived per-tab storage.
      (cache?.warm('/api/session') || Promise.resolve(null))
        .then((session) => {
          if (session?.member) cache?.warm('/api/projects/mine');
          if (session?.officer) {
            warmPage('/treasury_dashboard.html?section=projects');
            warmPage('/treasury_dashboard.html?section=budget');
            cache?.warm('/api/treasury/overview');
            cache?.warm('/api/budget/terms');
          }
        })
        .catch(() => {});
    });
  }
})();
