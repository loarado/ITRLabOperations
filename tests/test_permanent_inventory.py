"""Permanent deletion keeps audit snapshots, geometry and unrelated records intact."""
import json
import unittest
import test_inventory
from lab_server import write_json
from inventory import convert_bin_contents, validate_item

class PermanentInventory(unittest.TestCase):
    setUp=test_inventory.InventoryTests.setUp
    tearDown=test_inventory.InventoryTests.tearDown
    request=test_inventory.InventoryTests.request
    login=test_inventory.InventoryTests.login
    mutation=test_inventory.InventoryTests.mutation
    restart=test_inventory.InventoryTests.restart

    def test_scope_authorization_conflicts_restart_and_restore(self):
        self.login()
        a=self.mutation(action='save',item={'name':'Disposable'},stock={'shelfId':'R01'})[1]
        b=self.mutation(action='save',itemId=a['itemId'],stock={'shelfId':'R02'})[1]
        unrelated=self.mutation(action='save',item={'name':'Keep'},stock={'shelfId':'R01'})[1]
        geometry=(self.data/'lab.json').read_bytes()
        self.assertEqual(self.mutation(action='remove-location',stockId=a['stockId'])[0],200)
        doc=self.server.stock_document();self.assertIn(a['itemId'],doc['items']);self.assertIn(b['stockId'],doc['stocks'])
        self.assertNotIn(a['stockId'],doc['stocks'])
        revision=doc['revision']
        self.mutation(action='archive',stockId=b['stockId'])
        self.assertEqual(self.mutation(action='delete-item',itemId=a['itemId'],revision=revision)[0],409)
        audit=self.data/'history/inventory/1.json';before=audit.read_bytes()
        self.assertEqual(self.mutation(action='delete-item',itemId=a['itemId'])[0],200)
        doc=self.server.stock_document();self.assertNotIn(a['itemId'],doc['items'])
        self.assertFalse(any(s['itemId']==a['itemId'] for s in doc['stocks'].values()))
        self.assertIn(unrelated['itemId'],doc['items']);self.assertIn(a['itemId'],doc['deletedItems'])
        self.assertEqual(audit.read_bytes(),before);self.assertEqual((self.data/'lab.json').read_bytes(),geometry)
        self.restart();self.assertNotIn(a['itemId'],self.server.stock_document()['items'])
        self.assertEqual(self.mutation(action='delete-item',itemId=unrelated['itemId'])[0],403)
        self.login();lab=self.request('GET','/api/lab')[1]
        restored=self.request('POST','/api/lab/restore',{'revision':lab['revision'],'version':'original'})[1]
        restored['versionName']='Restore after deletion'
        self.assertEqual(self.request('PUT','/api/lab',restored)[0],200)
        self.assertNotIn(a['itemId'],self.server.stock_document()['items'])
        self.assertTrue(list((self.data.parent/'.itr-backups').glob('before-inventory-delete-*.tar.gz')))
        # An old quick acknowledgement cannot reinsert a deleted item into an open UI.
        operation=next(op for op,result in doc['operations'].items() if result.get('itemId')==a['itemId'])
        self.assertEqual(self.request('POST','/api/inventory',{'operationId':operation})[0],400)

    def test_migration_tombstone_prevents_recreation(self):
        shelf=self.request('GET','/api/shelves/R01')[1];shelf['matrix'][0][0]=dict(test_inventory.bin_data(),id='legacy',contents='Motor')
        converted,_,_=convert_bin_contents(self.server.stock_document(),{'R01':shelf})
        iid=next(iter(converted['items']));converted['deletedItems']={iid:{'name':'Motor'}}
        converted['items'].clear();converted['stocks'].clear()
        again,_,report=convert_bin_contents(converted,{'R01':shelf})
        self.assertEqual(again['items'],{});self.assertEqual(report['converted'],0)

if __name__=='__main__':unittest.main()
