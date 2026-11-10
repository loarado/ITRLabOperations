"""Browser regression coverage for the autosaving Lab Items worksheet."""
import json
import shutil
import sys
import tempfile
import threading
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from lab_server import ROOT, LabServer, blank_shelf, write_json
from playwright.sync_api import expect, sync_playwright


class BudgetTableBrowserTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.data = Path(self.temp.name) / 'data'
        (self.data / 'shelves').mkdir(parents=True)
        shutil.copy(ROOT / 'defaults/lab.json', self.data / 'lab.json')
        for item in json.loads((self.data / 'lab.json').read_text())['items']:
            if item['kind'] == 'shelf':
                write_json(self.data / 'shelves' / f"{item['id']}.json", blank_shelf(item['id']))
        self.server = LabServer(('127.0.0.1', 0), self.data, 'itr')
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.records = {'revision': 0, 'rows': []}
        self.p = sync_playwright().start()
        self.browser = self.p.chromium.launch()
        self.context = self.browser.new_context(viewport={'width': 1440, 'height': 1000})
        self.context.route('**/api/session', self.session_route)
        self.context.route('**/api/budget/**', self.budget_route)
        # Keep the first PUT response in flight long enough to prove that a
        # later cell edit is not overwritten by its older server snapshot.
        self.context.add_init_script('''(() => {
          const originalFetch = window.fetch.bind(window);
          window.fetch = async (...args) => {
            const response = await originalFetch(...args);
            const url = String(args[0]);
            const options = args[1] || {};
            if (url.includes('/api/budget/lab-items/') && options.method === 'PUT')
              return new Promise((resolve) => setTimeout(() => resolve(response), 400));
            return response;
          };
        })()''')
        self.page = self.context.new_page()
        self.errors = []
        self.page.on('pageerror', lambda error: self.errors.append(str(error)))
        self.url = f'http://127.0.0.1:{self.server.server_port}'

    def tearDown(self):
        self.browser.close()
        self.p.stop()
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()
        self.temp.cleanup()
        self.assertEqual(self.errors, [])

    @staticmethod
    def json(route, value):
        route.fulfill(status=200, content_type='application/json', body=json.dumps(value))

    def session_route(self, route):
        self.json(route, {
            'member': True, 'username': 'Officer Example', 'role': 'officer',
            'roles': ['officer'], 'admin': True, 'officer': True,
            'treasurer': False, 'president': False,
        })

    def budget_route(self, route):
        request = route.request
        term = dict(id='SPRING-2027', label='Spring 2027', state='upcoming', startsOn=None, endsOn=None)
        if request.url.endswith('/api/budget/bootstrap'):
            return self.json(route, {
                'terms': [term], 'term': term,
                'projectsCapital': dict(id=None, updatedAt=None, warnings=[], revision=0, rows=[]),
                'labItems': dict(id='BR-1', updatedAt=None, warnings=[], **self.records),
            })
        if request.url.endswith('/api/budget/terms'):
            return self.json(route, {'terms': [term]})
        if request.method == 'GET':
            return self.json(route, {'term': term, 'record': dict(id='BR-1', updatedAt=None, warnings=[], **self.records)})
        body = request.post_data_json
        rows = body['rows']
        for index, row in enumerate(rows, 1):
            row.setdefault('id', f'BLI-{index}')
            row['position'] = index
            row['category'] = 'lab-consumables'
            row['currency'] = 'USD'
            try:
                row['totalCost'] = str(float(row['unitPrice']) * float(row['quantity']))
            except (TypeError, ValueError):
                row['totalCost'] = None
        self.records = {'revision': self.records['revision'] + 1, 'rows': rows}
        self.json(route, {'saved': True, 'term': term, 'record': dict(id='BR-1', updatedAt=None, warnings=[], **self.records)})

    def test_late_autosave_response_keeps_newer_cell_edits_and_category_fits(self):
        self.page.goto(self.url + '/treasury_dashboard.html?section=budget')
        self.page.locator('[data-budget-tab="lab"]').click()
        name = self.page.locator('[data-lab-field="name"]').first
        vendor = self.page.locator('[data-lab-field="vendor"]').first
        expect(name).to_be_visible()
        name.fill('Solder')
        self.page.wait_for_timeout(650)
        vendor.fill('Example Vendor')
        self.page.wait_for_timeout(1400)
        expect(name).to_have_value('Solder')
        expect(vendor).to_have_value('Example Vendor')
        expect(self.page.locator('[data-lab-field="name"]')).to_have_count(2)
        category = self.page.locator('#labBudgetRows select').first
        self.assertGreaterEqual(category.bounding_box()['width'], 184)
        expect(category).to_have_value('lab-consumables')

    def test_capital_preview_and_readiness_are_closed_and_readable(self):
        self.page.goto(self.url + '/treasury_dashboard.html?section=budget')
        preview = self.page.locator('#projectImportPreview')
        expect(preview).not_to_have_attribute('open', '')
        name = self.page.locator('[data-capital-field="name"]').first
        expect(name).to_be_visible()
        name.fill('Motor')
        warnings = self.page.locator('#projectsCapitalBudgetWarnings')
        expect(warnings).to_be_visible()
        expect(warnings).not_to_have_attribute('open', '')
        warnings.locator('summary').click()
        expect(warnings).to_have_attribute('open', '')
        expect(warnings).to_contain_text('Line item 1 needs project name, category, link, vendor, unit price, and quantity.')


if __name__ == '__main__':
    unittest.main()
