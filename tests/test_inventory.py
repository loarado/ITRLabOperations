import copy
import hashlib
import json
import threading
import unittest
import test_server
from lab_server import LabServer, write_json
from inventory import identify_bins, validate_item, validate_stock, estimated_value, retire_bin_fields


def bin_data():
    return dict(name='Hardware', contents='Legacy descriptive notes', keywords='bolts', w=2, h=2,
                background='#ffffff', color='#000000', fontSize=12, fontFamily='Arial', bold=False)


class InventoryTests(unittest.TestCase):
    setUp = test_server.ServerTests.setUp
    tearDown = test_server.ServerTests.tearDown
    request = test_server.ServerTests.request
    login = test_server.ServerTests.login

    def restart(self):
        self.server.shutdown(); self.server.server_close(); self.thread.join()
        self.server = LabServer(('127.0.0.1',0), self.data, 'itr')
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True); self.thread.start()
        self.cookie = ''

    def test_migration_checkpoint_idempotence_and_copied_locations(self):
        shelf = self.request('GET', '/api/shelves/R01')[1]
        shelf['matrix'][0][0] = bin_data()
        shelf['matrix'][0][3] = dict(bin_data(), id='existing')
        shelf['decor'] = []
        shelf.update(mode='complex',contents='Keep notes')
        write_json(self.data/'shelves/R01.json',shelf)
        other = copy.deepcopy(shelf); other['id'] = 'unplaced'; write_json(self.data/'shelves/unplaced.json',other)
        history = self.data/'history/lab/0.json'; write_json(history,dict(layout=self.request('GET','/api/lab')[1], shelves={'R01':shelf}))
        before = history.read_bytes()
        self.restart()
        saved = json.loads((self.data/'shelves/R01.json').read_text())
        self.assertEqual(saved['matrix'][0][3]['id'],'existing')
        self.assertEqual(saved['revision'],shelf['revision'])
        self.assertEqual(saved['contents'],'Keep notes')
        self.assertEqual(identify_bins(shelf)['matrix'],saved['matrix'])
        self.assertEqual(history.read_bytes(),before)
        self.assertEqual(self.server.stock_document()['stocks'],{})
        keys = self.server.stock_locations()
        self.assertIn('R01/existing',keys);self.assertIn('unplaced/existing',keys)
        self.assertFalse(keys['unplaced/existing']['mapped'])
        checkpoint = list((self.data.parent/'.itr-backups').glob('*.tar.gz'))
        self.assertTrue(checkpoint)
        digest = hashlib.sha256((self.data/'shelves/R01.json').read_bytes()).hexdigest()
        self.restart()
        self.assertEqual(hashlib.sha256((self.data/'shelves/R01.json').read_bytes()).hexdigest(),digest)
        self.assertEqual(history.read_bytes(),before)
        # Reads resolve IDs without modifying even a subsequently introduced legacy file.
        legacy = copy.deepcopy(shelf); legacy['id']='old-import';write_json(self.data/'shelves/old-import.json',legacy)
        raw=(self.data/'shelves/old-import.json').read_bytes()
        self.assertEqual(self.request('GET','/api/shelves/old-import')[1]['matrix'],retire_bin_fields(identify_bins(legacy))['matrix'])
        self.assertEqual((self.data/'shelves/old-import.json').read_bytes(),raw)

    def test_stock_survives_location_removal_modes_and_layout_restore(self):
        self.login()
        header={'X-Editor-Instance':'stock-safety'}
        shelf=self.request('GET','/api/shelves/R01')[1]
        shelf.update(mode='complex',versionName='Stock location')
        shelf['matrix'][0][0]=dict(bin_data(),id='bin-one')
        self.assertEqual(self.request('PUT','/api/shelves/R01',shelf,header)[0],200)
        stock=dict(itemId='bolts',shelfId='R01',binId='bin-one',tracking='exact',quantity='23',unit='each',notes='',archived=False)
        inventory=self.server.stock_document();inventory['items']['bolts']=validate_item({'name':'M4 bolts'});inventory['stocks']['entry']=stock
        write_json(self.data/'inventory.json',inventory)
        original=(self.data/'inventory.json').read_bytes()
        shelf=self.request('GET','/api/shelves/R01')[1];shelf.update(mode='simple',versionName='Hidden bins')
        self.assertEqual(self.request('PUT','/api/shelves/R01',shelf,header)[0],200)
        self.assertTrue(self.request('GET','/api/inventory')[1]['locations']['R01/bin-one']['hidden'])
        shelf=self.request('GET','/api/shelves/R01')[1];shelf['matrix'][0][0]=None
        self.assertEqual(self.request('PUT','/api/shelves/R01',shelf,header)[0],200)
        self.assertNotIn('R01/bin-one',self.request('GET','/api/inventory')[1]['locations'])
        lab=self.request('GET','/api/lab')[1]
        restored=self.request('POST','/api/lab/restore',dict(version='1',revision=lab['revision']),header)[1]
        self.assertIn('R01/bin-one',self.request('GET','/api/inventory',headers=header)[1]['locations'])
        self.assertEqual(self.request('PUT','/api/lab',restored,header)[0],200)
        self.assertEqual((self.data/'inventory.json').read_bytes(),original)
        lab=self.request('GET','/api/lab')[1];lab['items']=[i for i in lab['items'] if i['id']!='R01']
        self.assertEqual(self.request('PUT','/api/lab',lab,header)[0],200)
        inventory=self.request('GET','/api/inventory')[1]
        self.assertFalse(inventory['locations']['R01/bin-one']['mapped'])
        self.assertEqual(inventory['stocks']['entry']['quantity'],'23')
        self.assertEqual((self.data/'inventory.json').read_bytes(),original)

    def mutation(self, **body):
        import secrets
        body.setdefault('revision', self.server.stock_document()['revision'])
        body.setdefault('operationId','op-'+secrets.token_hex(8))
        return self.request('POST','/api/inventory',body)

    def test_authorization_concurrency_and_multi_location_editor(self):
        self.assertEqual(self.mutation(action='save',item={'name':'M4 bolts'})[0],403)
        self.login()
        first=self.mutation(action='save',item={'name':'M4 bolts'},stock=dict(shelfId='R01',binId=None,tracking='exact',quantity='10',unit='each'))
        self.assertEqual(first[0],200);item_id=first[1]['itemId'];stock_id=first[1]['stockId']
        second=self.mutation(action='save',itemId=item_id,stock=dict(shelfId='R02',binId=None,tracking='presence',unit='pack'))
        self.assertEqual(second[0],200)
        doc=self.request('GET','/api/inventory')[1];self.assertEqual(len(doc['items']),1);self.assertEqual(len(doc['stocks']),2)
        self.assertEqual(self.mutation(action='save',revision=0,itemId=item_id,item={'name':'Stale'})[0],409)
        self.assertEqual(self.mutation(action='save',itemId=item_id,stockId=stock_id,stock=dict(shelfId='R01',binId=None,tracking='exact',quantity='-1',unit='each'))[0],400)
        self.assertEqual(self.server.stock_document()['stocks'][stock_id]['quantity'],'10')
        self.assertEqual(self.mutation(action='save',itemId=item_id,item={'name':'M4 steel bolts'})[0],200)
        self.assertEqual(self.server.stock_document()['items'][item_id]['name'],'M4 steel bolts')
        self.assertEqual(self.request('POST','/api/inventory',dict(action='save'),{'Origin':'http://evil.example'})[0],403)
        self.request('POST','/api/logout',{})
        self.assertEqual(self.request('GET','/api/inventory/history')[0],403)
        self.assertEqual(self.mutation(action='archive',stockId=stock_id)[0],403)

    def test_atomic_transfers_corrections_archive_and_audit(self):
        self.login()
        created=self.mutation(action='save',item={'name':'Fastener','unitPrice':'0.10','currency':'USD','priceUnit':'each'},stock=dict(shelfId='R01',tracking='exact',quantity='12.5',unit='each'))[1]
        item_id=created['itemId'];stock_id=created['stockId']
        self.assertEqual(self.mutation(action='transfer',stockId=stock_id,amount='20',shelfId='R02')[0],400)
        self.assertEqual(self.mutation(action='transfer',stockId=stock_id,amount='0',shelfId='R02')[0],400)
        body=dict(action='transfer',stockId=stock_id,amount='2.5',shelfId='R02',revision=self.server.stock_document()['revision'],operationId='retry-transfer')
        self.assertEqual(self.request('POST','/api/inventory',body)[0],200)
        self.assertEqual(self.request('POST','/api/inventory',body)[0],200)
        stocks=self.server.stock_document()['stocks'];self.assertEqual(sorted(s['quantity'] for s in stocks.values()),['10.0','2.5'])
        self.assertEqual(self.mutation(action='transfer',stockId=stock_id,amount='1.25',shelfId='R02')[0],200)
        self.assertEqual(sum(__import__('decimal').Decimal(s['quantity']) for s in self.server.stock_document()['stocks'].values()),__import__('decimal').Decimal('12.5'))
        self.assertEqual(self.mutation(action='archive',stockId=stock_id)[0],200)
        self.assertTrue(self.server.stock_document()['stocks'][stock_id]['archived'])
        self.assertEqual(self.mutation(action='reactivate',stockId=stock_id)[0],200)
        audit=self.request('GET','/api/inventory/history')[1];self.assertEqual(audit[0]['action'],'reactivate')
        self.assertEqual(self.request('GET','/api/inventory/history/1')[1]['stocks'][stock_id]['quantity'],'12.5')
        self.assertFalse((self.data/'pending-save.json').exists())
        backup=self.request('GET','/api/backup')[1]
        self.assertEqual(backup['format'],'itr-full-backup');self.assertEqual(backup['data']['inventory.json'],self.server.stock_document())
        self.assertIn('history/inventory/1.json',backup['data'])

    def test_inventory_interrupted_save_rolls_forward_and_retry_is_safe(self):
        from unittest.mock import patch
        self.login()
        body=dict(action='save',item={'name':'Recovered'},stock=dict(shelfId='R01',unit='each'),revision=0,operationId='failed-disk-operation')
        with patch.object(self.server,'finish_transaction',side_effect=[None,OSError('test disk failure')]):
            self.assertEqual(self.request('POST','/api/inventory',body)[0],500)
        self.assertTrue((self.data/'pending-save.json').exists())
        journal=(self.data/'pending-save.json').read_bytes()
        self.assertEqual(self.request('GET','/api/inventory')[0],503)
        self.assertEqual((self.data/'pending-save.json').read_bytes(),journal)
        self.restart();self.login()
        self.assertEqual(len(self.server.stock_document()['items']),1)
        self.assertEqual(self.request('POST','/api/inventory',body)[0],200)
        self.assertEqual(len(self.server.stock_document()['items']),1)
        self.assertFalse((self.data/'pending-save.json').exists())

    def test_full_backup_recovery_validates_before_writing_and_preserves_all_records(self):
        import tempfile
        from restore_backup import restore_backup
        self.login()
        self.mutation(action='save',item={'name':'Backup stock'},stock=dict(shelfId='R01',quantity=None,tracking='exact',unit='pack'))
        backup=self.request('GET','/api/backup')[1]
        with tempfile.TemporaryDirectory() as temp:
            target=__import__('pathlib').Path(temp)/'recovered'
            restore_backup(backup,target)
            for name,doc in backup['data'].items():
                self.assertEqual(json.loads((target/'data'/name).read_text()),doc)
            self.assertEqual(json.loads((target/'defaults/lab.json').read_text()),backup['defaults']['lab.json'])
            with self.assertRaises(ValueError):restore_backup(backup,target)
            for mutate in ('negative','path','missing-shelf'):
                invalid=copy.deepcopy(backup)
                if mutate=='negative':next(iter(invalid['data']['inventory.json']['stocks'].values()))['quantity']='-5'
                elif mutate=='path':invalid['data']['../escape.json']={}
                else:invalid['data'].pop('shelves/R01.json')
                bad=__import__('pathlib').Path(temp)/mutate
                with self.assertRaises(ValueError):restore_backup(invalid,bad)
                self.assertFalse(bad.exists())
            recovered=LabServer(('127.0.0.1',0),target/'data','itr',target/'defaults')
            self.assertEqual(recovered.stock_document(),backup['data']['inventory.json'])
            self.assertEqual(recovered.stock_locations()['R01']['label'],self.server.stock_locations()['R01']['label'])
            recovered.server_close()

    def test_location_move_resize_rename_retains_stock_identity(self):
        self.login()
        shelf=self.request('GET','/api/shelves/R01')[1]
        shelf.update(mode='complex',versionName='Original bin')
        shelf['matrix'][0][0]=dict(bin_data(),id='stable-bin')
        self.assertEqual(self.request('PUT','/api/shelves/R01',shelf)[0],200)
        created=self.mutation(action='save',item={'name':'Stable stock'},stock=dict(shelfId='R01',binId='stable-bin',tracking='exact',quantity='12',unit='each'))[1]
        stock_id=created['stockId'];before=(self.data/'inventory.json').read_bytes()
        shelf=self.request('GET','/api/shelves/R01')[1]
        bin=shelf['matrix'][0][0];shelf['matrix'][0][0]=None
        bin.update(name='Renamed bin',contents='Changed notes',w=3,h=1.5)
        shelf['matrix'][3][5]=bin;shelf['versionName']='Moved and resized'
        self.assertEqual(self.request('PUT','/api/shelves/R01',shelf)[0],200)
        lab=self.request('GET','/api/lab')[1]
        next(i for i in lab['items'] if i['id']=='R01').update(name='Renamed shelf',locationId='Edited label')
        self.assertEqual(self.request('PUT','/api/lab',lab)[0],200)
        doc=self.request('GET','/api/inventory')[1]
        self.assertEqual(doc['stocks'][stock_id]['binId'],'stable-bin')
        self.assertEqual(doc['stocks'][stock_id]['quantity'],'12')
        self.assertIn('Renamed shelf',doc['locations']['R01/stable-bin']['label'])
        self.assertIn('Renamed bin',doc['locations']['R01/stable-bin']['label'])
        self.assertIn('Edited label',doc['locations']['R01/stable-bin']['label'])
        self.assertEqual((self.data/'inventory.json').read_bytes(),before)

    def test_unknown_values_decimal_units_and_currencies(self):
        item=validate_item({'name':'M4 bolts'})
        self.assertIsNone(item['unitPrice'])
        items={'a':item};stock=validate_stock(dict(itemId='a',tracking='exact',quantity=None),items,{})
        self.assertIsNone(stock['quantity']);self.assertIsNone(estimated_value(item,stock))
        item.update(unitPrice='0.105',priceUnit='each',currency='USD');stock['quantity']='3'
        self.assertEqual(estimated_value(item,stock),dict(amount='0.32',currency='USD'))
        item['currency']='JPY';self.assertEqual(estimated_value(item,stock)['amount'],'0')
        stock['unit']='pack';self.assertIsNone(estimated_value(item,stock))
        for qty in ('-1','NaN','1e6',True):
            with self.assertRaises(ValueError):validate_stock(dict(itemId='a',tracking='exact',quantity=qty),items,{})

if __name__ == '__main__':
    unittest.main()
