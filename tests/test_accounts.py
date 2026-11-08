import unittest

from neon_accounts import AccountError, NeonAccounts


class AccountValidationTests(unittest.TestCase):
    def test_password_length_validation(self):
        self.assertEqual(NeonAccounts.validate_password('a' * 12), 'a' * 12)
        for password in ('a' * 11, 'a' * 257, None):
            with self.assertRaises(AccountError):
                NeonAccounts.validate_password(password)


if __name__ == '__main__':
    unittest.main()
