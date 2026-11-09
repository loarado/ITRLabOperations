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
        self.assertIn("priority: 'low'", source)
        self.assertIn("'/lab_overview.html'", source)
        self.assertIn("'/treasury_dashboard.html'", source)

    def test_main_navigation_pages_load_the_shared_prefetcher(self):
        for page in ('index.html', 'lab_overview.html', 'lab_inventory.html', 'project_dashboard.html', 'treasury_dashboard.html'):
            self.assertIn('prefetch.js', (ROOT / 'web/pages' / page).read_text())
            self.assertIn('navigation_cache.js', (ROOT / 'web/pages' / page).read_text())


if __name__ == '__main__':
    unittest.main()
