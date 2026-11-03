import json,unittest
from unittest.mock import patch
import test_inventory

class Reports(unittest.TestCase):
    setUp=test_inventory.InventoryTests.setUp
    tearDown=test_inventory.InventoryTests.tearDown
    request=test_inventory.InventoryTests.request
    login=test_inventory.InventoryTests.login
    restart=test_inventory.InventoryTests.restart

    def test_anonymous_persistence_private_review_resolution_and_backup(self):
        inventory=self.server.stock_document()
        body=dict(shelfId='R01',text='<script>alert("text only")</script>',operationId='anonymous-report')
        result=self.request('POST','/api/reports',body)
        self.assertEqual(result[0],200);self.assertEqual(set(result[1]),{'submitted','reportId'})
        self.assertEqual(self.request('POST','/api/reports',body),result)
        self.assertEqual(self.request('POST','/api/reports',dict(body,operationId='accidental-repeat')),result)
        self.assertEqual(self.request('GET','/api/reports')[0],403)
        rid=result[1]['reportId']
        self.assertEqual(self.request('POST','/api/reports/'+rid,dict(status='resolved',revision=1))[0],403)
        self.assertEqual(self.server.stock_document(),inventory)
        self.restart();self.login()
        doc=self.request('GET','/api/reports')[1];self.assertEqual(len(doc['reports']),1)
        self.assertEqual(doc['reports'][rid]['text'],body['text'])
        self.assertEqual(self.request('POST','/api/reports/'+rid,dict(status='resolved',revision=0))[0],409)
        self.assertEqual(self.request('POST','/api/reports/'+rid,dict(status='resolved',revision=1))[0],200)
        self.restart();self.login();self.assertEqual(self.request('GET','/api/reports')[1]['reports'][rid]['status'],'resolved')
        backup=self.request('GET','/api/backup')[1]
        from restore_backup import validate_backup
        validate_backup(backup);self.assertIn('reports.json',backup['data']);self.assertIn('bin-contents-migration.json',backup['data'])
        lab=self.request('GET','/api/lab')[1];lab['items']=[i for i in lab['items'] if i['id']!='R01'];self.request('PUT','/api/lab',lab)
        report=self.request('GET','/api/reports')[1]['reports'][rid];self.assertFalse(report['mapped']);self.assertTrue(report['shelfLabel'])

    def test_validation_cross_origin_throttling_and_disk_recovery(self):
        for invalid in [dict(text=''),dict(text='x'*2001),dict(shelfId='wall'),dict(binId='../bad'),dict(binId='absent'),dict(itemId='absent'),dict(operationId='invalid/operation')]:
            body=dict(shelfId='R01',text='Something wrong',operationId='valid-operation');body.update(invalid)
            self.assertEqual(self.request('POST','/api/reports',body)[0],400)
        self.assertEqual(self.request('POST','/api/reports',dict(shelfId='R01',text='Wrong',operationId='cross-origin'),{'Origin':'https://evil.example'})[0],403)
        for i in range(5):self.assertEqual(self.request('POST','/api/reports',dict(shelfId='R01',text='Issue '+str(i),operationId='throttle-'+str(i)))[0],200)
        self.assertEqual(self.request('POST','/api/reports',dict(shelfId='R01',text='Sixth',operationId='sixth-report'))[0],429)
        self.restart()
        body=dict(shelfId='R01',text='Disk recovery',operationId='disk-report')
        with patch.object(self.server,'finish_transaction',side_effect=[None,OSError('disk failure')]):
            self.assertEqual(self.request('POST','/api/reports',body)[0],500)
        self.restart();self.assertEqual(self.request('POST','/api/reports',body)[0],200)
        doc=json.loads((self.data/'reports.json').read_text());self.assertEqual(len(doc['reports']),6)

    def test_optional_bin_context_rename_dismiss_and_public_api_privacy(self):
        from test_inventory import bin_data
        from lab_server import write_json
        shelf=json.loads((self.data/'shelves/R01.json').read_text());shelf['mode']='complex'
        shelf['matrix'][0][0]=dict(bin_data(),id='reported-bin',contents='',keywords='')
        write_json(self.data/'shelves/R01.json',shelf)
        result=self.request('POST','/api/reports',dict(shelfId='R01',binId='reported-bin',text='Bin label is wrong',operationId='bin-context'))
        self.assertEqual(result[0],200);rid=result[1]['reportId']
        self.assertNotIn('text',result[1]);self.assertNotIn('status',result[1])
        self.assertEqual(self.request('GET','/reports.json')[0],404)
        self.assertEqual(self.request('GET','/api/reports/'+rid)[0],404)
        self.login()
        doc=self.request('GET','/api/reports')[1];self.assertEqual(doc['reports'][rid]['binId'],'reported-bin')
        shelf.update(name='Renamed shelf');self.request('PUT','/api/shelves/R01',shelf)
        self.assertIn('Renamed shelf',self.request('GET','/api/reports')[1]['reports'][rid]['currentLocation'])
        self.assertEqual(self.request('POST','/api/reports/'+rid,dict(status='dismissed',revision=doc['revision']))[0],200)
        self.assertEqual(self.request('GET','/api/reports')[1]['reports'][rid]['status'],'dismissed')
