import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


class PrefetchTests(unittest.TestCase):
    def test_prefetch_is_network_aware_and_warms_short_lived_bootstrap_data(self):
        source = (ROOT / 'web/scripts/prefetch.js').read_text()
        self.assertIn('connection?.saveData', source)
        self.assertIn("'/api/session'", source)
        self.assertIn("'/api/inventory'", source)
        self.assertIn("'/api/projects/mine'", source)
        self.assertIn("'/api/treasury/bootstrap'", source)
        self.assertIn("'/api/budget/bootstrap'", source)
        self.assertIn("priority: 'low'", source)
        self.assertIn('__itrWarmStatus', source)
        self.assertIn("'/lab_overview.html'", source)
        self.assertIn("'/treasury_dashboard.html'", source)

    def test_main_navigation_pages_load_the_shared_prefetcher(self):
        for page in ('index.html', 'lab_overview.html', 'lab_inventory.html', 'project_dashboard.html', 'treasury_dashboard.html'):
            self.assertIn('prefetch.js', (ROOT / 'web/pages' / page).read_text())
            self.assertIn('navigation_cache.js', (ROOT / 'web/pages' / page).read_text())

    def test_authenticated_startup_defers_report_loading_and_guards_shortcuts(self):
        common = (ROOT / 'web/scripts/common.js').read_text()
        inventory = (ROOT / 'web/scripts/inventory_ui.js').read_text()
        styles = (ROOT / 'web/styles/editor.css').read_text()
        self.assertIn("String(event.key || '').toLowerCase()", common)
        self.assertIn('void (async () =>', common)
        self.assertIn("'/api/account/signup'", common)
        self.assertIn("'Create account'", common)
        self.assertIn('result.detail || result.error', common)
        self.assertIn('0 0 18px 6px #fff200aa', styles)
        self.assertNotIn('await refreshReportIndicator();\n  if (!admin)', inventory)


if __name__ == '__main__':
    unittest.main()
