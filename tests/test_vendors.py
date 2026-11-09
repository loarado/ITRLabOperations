import unittest

from vendors import approved_vendors, canonical_vendor, vendor_matches


class ApprovedVendorTests(unittest.TestCase):
    def test_catalog_has_expected_supplier_column_and_searches_names(self):
        self.assertGreater(len(approved_vendors()), 6000)
        self.assertIn('AA Blocks Inc', vendor_matches('aa block'))

    def test_vendor_is_canonicalized_and_unknown_values_are_rejected(self):
        self.assertEqual(canonical_vendor('  aa blocks inc  '), 'AA Blocks Inc')
        self.assertEqual(canonical_vendor(''), '')
        with self.assertRaisesRegex(ValueError, 'approved vendor'):
            canonical_vendor('Not a supplier')


if __name__ == '__main__':
    unittest.main()
