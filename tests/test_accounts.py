import unittest
from types import SimpleNamespace

from neon_accounts import AccountError, NeonAccounts


class AccountValidationTests(unittest.TestCase):
    def test_password_length_validation(self):
        self.assertEqual(NeonAccounts.validate_password('a' * 12), 'a' * 12)
        for password in ('a' * 11, 'a' * 257, None):
            with self.assertRaises(AccountError):
                NeonAccounts.validate_password(password)

    def test_create_user_uses_all_three_validated_values(self):
        calls = []

        class Cursor:
            def execute(self, query, values):
                calls.append((query, values))

            def __enter__(self): return self
            def __exit__(self, *args): return False

        class Connection:
            def cursor(self): return Cursor()
            def __enter__(self): return self
            def __exit__(self, *args): return False

        account = object.__new__(NeonAccounts)
        account.connection = lambda: Connection()
        account.psycopg = SimpleNamespace(errors=SimpleNamespace(UniqueViolation=RuntimeError))
        created = account.create_user('Member Example', 'MEMBER@example.test', 'a' * 12)
        self.assertEqual(created['name'], 'Member Example')
        self.assertEqual(created['email'], 'member@example.test')
        self.assertEqual(len(calls), 1)


if __name__ == '__main__':
    unittest.main()
