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

    def test_member_project_list_includes_sanitized_treasury_status(self):
        status, receipt = self.request('POST', '/api/projects', {'project': self.project(), 'operationId': 'member-project-list'})
        self.assertEqual(status, 200)
        mine = self.request('GET', '/api/projects/mine')[1]['projects']
        self.assertEqual(len(mine), 1)
        self.assertEqual(mine[0]['projectId'], receipt['projectId'])
        self.assertEqual(mine[0]['treasury'], {})
        self.treasurer_login()
        overview = self.request('GET', '/api/treasury/overview')[1]
        review = dict(revision=overview['revision'], operationId='member-project-status', record=dict(
            status='needs-details', planningPeriod='', approvedAmount='', currency='USD',
            fundingSource='', notes='Private treasury discussion.'))
        self.assertEqual(self.request('POST', '/api/treasury/projects/' + receipt['projectId'], review)[0], 200)
        self.cookie = 'itr_session=member-token'
        mine = self.request('GET', '/api/projects/mine')[1]['projects']
        self.assertEqual(mine[0]['treasury']['status'], 'needs-details')
        self.assertIn('updatedAt', mine[0]['treasury'])
        self.assertNotIn('notes', mine[0]['treasury'])

    def test_project_discussion_is_shared_only_by_owner_and_treasury(self):
        status, receipt = self.request('POST', '/api/projects', {'project': self.project(), 'operationId': 'project-discussion'})
        self.assertEqual(status, 200)
        comments_url = '/api/projects/' + receipt['projectId'] + '/comments'
        self.assertEqual(self.request('GET', comments_url), (200, {'comments': []}))
        status, result = self.request('POST', comments_url, {'text': 'Could Treasury review the motor estimate?'})
        self.assertEqual(status, 200)
        self.assertEqual(result['comment']['authorRole'], 'member')
        self.assertEqual(result['comment']['authorName'], 'Ada Builder')
        self.treasurer_login()
        status, result = self.request('GET', comments_url)
        self.assertEqual(status, 200)
        self.assertEqual(len(result['comments']), 1)
        status, result = self.request('POST', comments_url, {'text': 'Please add a vendor comparison.'})
        self.assertEqual(status, 200)
        self.assertEqual(result['comment']['authorRole'], 'treasurer')
        overview = self.request('GET', '/api/treasury/overview')[1]
        review = dict(revision=overview['revision'], operationId='discussion-review', reviewComment='Please include this comparison before approval.', record=dict(
            status='needs-details', planningPeriod='', approvedAmount='', currency='USD', fundingSource='', notes='Private review note.'))
        self.assertEqual(self.request('POST', '/api/treasury/projects/' + receipt['projectId'], review)[0], 200)
        self.cookie = 'itr_session=member-token'
        comments = self.request('GET', comments_url)[1]['comments']
        self.assertEqual([comment['text'] for comment in comments], ['Could Treasury review the motor estimate?', 'Please add a vendor comparison.', 'Please include this comparison before approval.'])
        self.assertEqual(comments[-1]['source'], 'review')
        mine = self.request('GET', '/api/projects/mine')[1]['projects'][0]
        self.assertTrue(mine['treasury']['reviewHasMessage'])
        self.treasurer_login()
        overview = self.request('GET', '/api/treasury/overview')[1]
        no_message_review = dict(revision=overview['revision'], operationId='discussion-review-no-message', reviewComment='', record=dict(
            status='planned', planningPeriod='', approvedAmount='', currency='USD', fundingSource='', notes='Private follow-up.'))
        self.assertEqual(self.request('POST', '/api/treasury/projects/' + receipt['projectId'], no_message_review)[0], 200)
        overview = self.request('GET', '/api/treasury/overview')[1]
        reviewed = next(project for project in overview['projects'] if project['projectId'] == receipt['projectId'])
        self.assertEqual(reviewed['treasury']['fundingSource'], 'IIT')
        self.cookie = 'itr_session=member-token'
        mine = self.request('GET', '/api/projects/mine')[1]['projects'][0]
        self.assertFalse(mine['treasury']['reviewHasMessage'])
        self.cookie = ''
        self.assertEqual(self.request('GET', comments_url)[0], 403)

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
        status, project_page = self.request('GET', '/project_dashboard.html')
        self.assertEqual(status, 200)
        self.assertIn(b'projectVisitorNotice', project_page)
        self.assertIn(b'backToProjectList', project_page)
        self.assertIn(b'id="projectReadiness"', project_page)
        self.assertIn(b'id="readinessRequired"', project_page)
        self.assertIn(b'id="readinessRecommended"', project_page)
        self.assertIn(b'id="projectReviewCard"', project_page)
        self.assertIn(b'id="editProjectRequest"', project_page)
        self.assertIn(b'id="submitProjectRequest"', project_page)
        status, treasury_page = self.request('GET', '/treasury_dashboard.html')
        self.assertEqual(status, 200)
        self.assertNotIn(b'id="deleteProject"', treasury_page)
        self.assertIn(b'id="reviewComment"', treasury_page)
        self.assertIn(b'id="treasuryMessages"', treasury_page)
        self.assertIn(b'id="sendTreasuryMessage"', treasury_page)
        self.assertNotIn(b'id="approvedCurrency"', treasury_page)
        self.assertIn(b'id="fundingSource" maxlength="500" value="IIT"', treasury_page)
        status, dashboard_script = self.request('GET', '/dashboards.js')
        self.assertEqual(status, 200)
        self.assertIn(b"unitPrice: 'price'", dashboard_script)
        self.assertIn(b'function updateReadiness()', dashboard_script)
        self.assertIn(b"stage === 'procurement-ready'", dashboard_script)
        self.assertIn(b'updateReadiness();', dashboard_script)
        self.assertIn(b'function showReview()', dashboard_script)
        self.treasurer_login()
        self.assertEqual(self.request('POST', '/api/inventory', {'action': 'save'})[0], 403)


if __name__ == '__main__':
    unittest.main()
