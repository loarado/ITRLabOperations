'use strict';

// Warm only likely next documents and their static assets. This intentionally
// does not cache API responses: map, inventory, and private dashboard data
// must still be freshly authorized and read when the destination opens.
(() => {
  const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  if (connection?.saveData || /(^|-)2g/.test(connection?.effectiveType || '')) return;

  const warmed = new Set();
  const pageAssets = {
    '/lab_overview.html': ['editor.css', 'editor_groups.js', 'draft_manager.js', 'editor_recovery.js', 'common.js', 'inventory_ui.js', 'map_geometry.js', 'shelf_model.js', 'explorer.js', 'map_editor.js', 'lab_tools.js', 'map_elements.js', 'lab.js'],
    '/lab_inventory.html': ['editor.css', 'editor_groups.js', 'draft_manager.js', 'editor_recovery.js', 'common.js', 'shelf_model.js', 'inventory_ui.js', 'inventory_list.js'],
    '/project_dashboard.html': ['editor.css', 'dashboards.js'],
    '/treasury_dashboard.html': ['editor.css', 'dashboards.js'],
  };

  function addPrefetch(url, as) {
    if (warmed.has(url)) return;
    warmed.add(url);
    const link = document.createElement('link');
    link.rel = 'prefetch'; link.href = url; link.as = as;
    document.head.append(link);
  }

  function warmPage(rawHref) {
    const page = new URL(rawHref, location.href);
    if (page.origin !== location.origin || page.protocol !== location.protocol) return;
    addPrefetch(page.href, 'document');
    (pageAssets[page.pathname] || []).forEach((asset) => addPrefetch(new URL(asset, page).href, asset.endsWith('.css') ? 'style' : 'script'));
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

  const afterIdle = window.requestIdleCallback || ((callback) => setTimeout(callback, 900));
  if (document.body.classList.contains('landing-page')) {
    afterIdle(() => {
      likelyLinks().forEach((link) => warmPage(link.href));
      // Only an authenticated officer/leader receives the additional admin
      // destination warm-up; no private API response is prefetched or stored.
      fetch('/api/session', { credentials: 'same-origin' })
        .then((response) => response.ok ? response.json() : null)
        .then((session) => {
          if (session?.officer) {
            warmPage('/treasury_dashboard.html?section=projects');
            warmPage('/treasury_dashboard.html?section=budget');
          }
        })
        .catch(() => {});
    });
  }
})();
