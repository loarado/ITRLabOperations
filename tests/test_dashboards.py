import copy
import json
import unittest

import test_server


class Dashboards(unittest.TestCase):
    def setUp(self):
        test_server.ServerTests.setUp(self)
        class AccountStub:
            user = dict(id='00000000-0000-0000-0000-000000000001', name='Ada Builder', email='ada@example.test')
            def session_user(self, token): return self.user if token == 'member-token' else None
            def delete_session(self, token): pass
        self.server.accounts = AccountStub()
        self.cookie = 'itr_session=member-token'
    tearDown = test_server.ServerTests.tearDown
    request = test_server.ServerTests.request

    def project(self, **changes):
        result = dict(title='Walking robot', lead='Ada Builder', contact='ada@example.test', team='Ada and Sam',
                      description='A small robot for the lab open house.', stage='idea', nonItemCost='0',
                      estimate=dict(amount='250', currency='USD', confidence='rough', basis='Comparable kits cost about $250.'),
                      lineItems=[])
        result.update(changes)
        return result

    def treasurer_login(self):
        self.assertEqual(self.request('POST', '/api/login', {'username': 'treasurer', 'password': 'treasury'})[0], 200)

    def test_public_project_required_estimate_and_treasury_review(self):
        invalid = self.project(); invalid['estimate'] = dict(invalid['estimate'], amount='')
        self.assertEqual(self.request('POST', '/api/projects', {'project': invalid, 'operationId': 'bad-estimate'})[0], 400)
        body = {'project': self.project(), 'operationId': 'project-walking-robot'}
        status, receipt = self.request('POST', '/api/projects', body)
        self.assertEqual(status, 200); self.assertTrue(receipt['submitted'])
        self.assertEqual(self.request('POST', '/api/projects', body), (200, receipt))
        self.assertEqual(self.request('GET', '/api/projects')[0], 403)
        self.treasurer_login()
        session = self.request('GET', '/api/session')[1]
        self.assertTrue(session['treasurer']); self.assertFalse(session['admin'])
        overview = self.request('GET', '/api/treasury/overview')[1]
        self.assertEqual(overview['totals'], {'USD': '250'})
        project_id = receipt['projectId']
        review = dict(revision=overview['revision'], operationId='treasury-walking-robot', record=dict(
            status='approved', planningPeriod='Spring 2027', approvedAmount='200', currency='USD',
            fundingSource='Robotics budget', notes='Approve the first prototype.'))
        self.assertEqual(self.request('POST', '/api/treasury/projects/' + project_id, review)[0], 200)
        detail = self.request('GET', '/api/treasury/projects/' + project_id)[1]
        self.assertEqual(detail['record']['approvedAmount'], '200')
        self.assertEqual(detail['record']['history'][-1]['actor'], 'treasurer')
        revisions = self.request('GET', '/api/treasury/overview')[1]
        self.assertEqual(self.request('DELETE', '/api/treasury/projects/' + project_id,
                                      dict(projectsRevision=revisions['projectsRevision'], treasuryRevision=revisions['revision']))[0], 200)
        self.assertEqual(self.request('GET', '/api/treasury/projects/' + project_id)[0], 404)

    def test_supporting_documentation_link_is_validated_and_visible_to_treasurer(self):
        invalid = self.project(documentationUrl='ftp://example.test/proposal')
        self.assertEqual(self.request('POST', '/api/projects', {'project': invalid, 'operationId': 'invalid-documentation'})[0], 400)
        project = self.project(documentationUrl='https://example.test/walking-robot-proposal')
        status, receipt = self.request('POST', '/api/projects', {'project': project, 'operationId': 'documentation-project'})
        self.assertEqual(status, 200)
        self.treasurer_login()
        overview = self.request('GET', '/api/treasury/overview')[1]
        submitted = next(row for row in overview['projects'] if row['projectId'] == receipt['projectId'])
        self.assertEqual(submitted['documentationUrl'], project['documentationUrl'])
        self.assertEqual(submitted['description'], project['description'])

    def test_procurement_project_checks_items_and_backups_include_dashboard_data(self):
        project = self.project(stage='procurement-ready', lineItems=[dict(name='Servo motor', specification='High torque', quantity='2', unit='each', unitPrice='17.50', priority='needed', vendor='', productLink='', inventoryItemId=None)])
        status, receipt = self.request('POST', '/api/projects', {'project': project, 'operationId': 'servo-project'})
        self.assertEqual(status, 200)
        self.assertEqual(self.request('GET', '/api/inventory/suggestions?q=se')[0], 200)
        self.treasurer_login()
        self.assertEqual(self.request('POST', '/api/logout', {})[0], 200)
        self.assertEqual(self.request('POST', '/api/login', {'password': 'itr'})[0], 200)
        backup = self.request('GET', '/api/backup')[1]
        self.assertIn('projects.json', backup['data']); self.assertIn('treasury.json', backup['data'])
        from restore_backup import validate_backup
        validate_backup(backup)
        saved = json.loads((self.data / 'projects.json').read_text())
        self.assertIn(receipt['projectId'], saved['projects'])

    def test_dashboard_assets_are_served_and_treasurer_cannot_edit_inventory(self):
        self.assertEqual(self.request('GET', '/project_dashboard.html')[0], 200)
        self.assertEqual(self.request('GET', '/treasury_dashboard.html')[0], 200)
        self.assertEqual(self.request('GET', '/dashboards.js')[0], 200)
        self.treasurer_login()
        self.assertEqual(self.request('POST', '/api/inventory', {'action': 'save'})[0], 403)


if __name__ == '__main__':
    unittest.main()
