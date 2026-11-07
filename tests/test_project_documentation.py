import unittest

from projects import validate_project


def project(**changes):
    value = {
        'title': 'Documentation test', 'lead': 'Ada', 'contact': 'ada@example.test',
        'team': '', 'description': 'A sufficiently detailed project request for validation.',
        'stage': 'idea', 'estimate': {'amount': '10', 'currency': 'USD', 'confidence': 'rough', 'basis': 'A documented estimate.'},
        'lineItems': [], 'nonItemCost': '0',
    }
    value.update(changes)
    return value


class ProjectDocumentationTests(unittest.TestCase):
    def test_named_multiple_links_and_nonblocking_failed_check_are_preserved(self):
        saved = validate_project(project(documentationLinks=[
            {'label': 'Design proposal', 'url': 'https://example.test/proposal', 'checkStatus': 'failed', 'checkedAt': '2026-11-07T00:00:00Z', 'checkMessage': 'HTTP 404'},
            {'label': 'CAD files', 'url': 'https://example.test/cad', 'checkStatus': 'passed', 'checkedAt': '2026-11-07T00:00:00Z', 'checkMessage': 'Link reached successfully.'},
        ]))
        self.assertEqual([link['label'] for link in saved['documentationLinks']], ['Design proposal', 'CAD files'])
        self.assertEqual(saved['documentationLinks'][0]['checkStatus'], 'failed')
        self.assertEqual(saved['documentationUrl'], 'https://example.test/proposal')

    def test_existing_single_link_is_migrated_and_invalid_named_link_is_rejected(self):
        migrated = validate_project(project(documentationUrl='https://example.test/legacy'))
        self.assertEqual(migrated['documentationLinks'], [{'label': 'Supporting documentation', 'url': 'https://example.test/legacy'}])
        with self.assertRaisesRegex(ValueError, 'valid http'):
            validate_project(project(documentationLinks=[{'label': 'Bad link', 'url': 'ftp://example.test/file'}]))


if __name__ == '__main__':
    unittest.main()
