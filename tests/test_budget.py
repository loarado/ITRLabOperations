import unittest

from budget import LAB_CATEGORY, lab_readiness, validate_lab_rows, validate_term_id


class BudgetValidationTests(unittest.TestCase):
    def test_lab_rows_default_to_the_lab_category_and_calculate_totals(self):
        row = validate_lab_rows([{
            'name': 'Solder', 'link': 'https://vendor.example/solder',
            'unitPrice': '3.50', 'quantity': '2', 'vendor': 'Example Vendor',
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
        with self.assertRaisesRegex(ValueError, 'http'):
            validate_lab_rows([{'link': 'ftp://vendor.example/item'}])

    def test_row_ids_and_terms_are_safe(self):
        with self.assertRaisesRegex(ValueError, 'unique'):
            validate_lab_rows([{'id': 'BLI-1'}, {'id': 'BLI-1'}])
        self.assertEqual(validate_term_id('SPRING-2027'), 'SPRING-2027')
        with self.assertRaises(ValueError):
            validate_term_id('Spring 2027')


if __name__ == '__main__':
    unittest.main()
