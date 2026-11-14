import unittest

from budget import (EVENT_BUDGET_LIMIT, EVENT_ROW_LIMIT, LAB_CATEGORY,
                    default_event_rows, lab_readiness, validate_event_rows,
                    validate_lab_rows, validate_projects_capital_rows,
                    validate_term_id)
from treasury import requires_dual_budget_approval


class BudgetValidationTests(unittest.TestCase):
    def test_lab_rows_default_to_the_lab_category_and_calculate_totals(self):
        row = validate_lab_rows([{
            'name': 'Solder', 'link': 'https://vendor.example/solder',
            'unitPrice': '3.50', 'quantity': '2', 'vendor': 'AA Blocks Inc',
        }])[0]
        self.assertEqual(row['category'], LAB_CATEGORY)
        self.assertEqual(row['totalCost'], '7.0')
        self.assertEqual(lab_readiness([row]), [])

    def test_lab_rows_retain_incomplete_drafts_with_readiness_warnings(self):
        row = validate_lab_rows([{'name': 'Solder'}])[0]
        self.assertEqual(lab_readiness([row])[0]['missing'], ['Vendor', 'Unit price', 'Quantity'])

    def test_lab_rows_reject_another_project_category_and_invalid_values(self):
        with self.assertRaisesRegex(ValueError, 'Lab Consumables'):
            validate_lab_rows([{'category': 'raw-material'}])
        with self.assertRaisesRegex(ValueError, 'greater than zero'):
            validate_lab_rows([{'quantity': '0'}])
        with self.assertRaisesRegex(ValueError, 'whole number'):
            validate_lab_rows([{'quantity': '2.5'}])
        with self.assertRaisesRegex(ValueError, 'http'):
            validate_lab_rows([{'link': 'ftp://vendor.example/item'}])

    def test_row_ids_and_terms_are_safe(self):
        with self.assertRaisesRegex(ValueError, 'unique'):
            validate_lab_rows([{'id': 'BLI-1'}, {'id': 'BLI-1'}])
        self.assertEqual(validate_term_id('SPRING-2027'), 'SPRING-2027')
        with self.assertRaises(ValueError):
            validate_term_id('Spring 2027')

    def test_projects_capital_rows_require_one_of_five_project_categories(self):
        row = validate_projects_capital_rows([{
            'name': 'Drive gears', 'category': 'mechanism-components',
            'unitPrice': '12.50', 'quantity': '2', 'vendor': 'AA Blocks Inc',
        }])[0]
        self.assertEqual(row['category'], 'mechanism-components')
        self.assertEqual(row['totalCost'], '25.0')
        self.assertEqual(validate_projects_capital_rows([{'name': 'Drive gears', 'projectName': 'Walking robot'}])[0]['projectName'], 'Walking robot')
        self.assertIsNone(validate_projects_capital_rows([{'name': 'Draft row'}])[0]['category'])
        with self.assertRaisesRegex(ValueError, 'valid Projects'):
            validate_projects_capital_rows([{'category': LAB_CATEGORY}])

    def test_requests_at_500_or_more_require_both_budget_approvals(self):
        project = lambda amount: {'estimate': {'amount': amount, 'currency': 'USD'}}
        self.assertFalse(requires_dual_budget_approval(project('499.99')))
        self.assertTrue(requires_dual_budget_approval(project('500')))
        self.assertTrue(requires_dual_budget_approval(project('500.01')))

    def test_events_default_to_fifteen_workshops_and_cannot_exceed_the_cap(self):
        defaults = default_event_rows()
        self.assertEqual(len(defaults), EVENT_ROW_LIMIT)
        self.assertEqual(defaults[0]['name'], 'ITR Workshop')
        self.assertEqual(sum(float(row['unitPrice']) for row in defaults), float(EVENT_BUDGET_LIMIT))
        self.assertEqual(validate_event_rows(defaults)[0]['totalCost'], '200')
        with self.assertRaisesRegex(ValueError, '3000'):
            validate_event_rows([{**row, 'unitPrice': '201'} for row in defaults])
        with self.assertRaisesRegex(ValueError, 'at most 15'):
            validate_event_rows(defaults + [defaults[0]])


if __name__ == '__main__':
    unittest.main()
