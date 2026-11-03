import copy, json, pathlib, shutil, tempfile, unittest
from inventory import convert_bin_contents, validate_item, identify_bins, empty_inventory, bin_display_name
from lab_server import LabServer, write_json, normalize_shelf
import test_inventory
from test_inventory import bin_data

class BinMigration(unittest.TestCase):
    setUp=test_inventory.InventoryTests.setUp
    tearDown=test_inventory.InventoryTests.tearDown
    request=test_inventory.InventoryTests.request
    login=test_inventory.InventoryTests.login
    restart=test_inventory.InventoryTests.restart
    mutation=test_inventory.InventoryTests.mutation

    def test_unconverted_review_text_keeps_placeholder_meaningful(self):
        shelf=json.loads((self.data/'shelves/R01.json').read_text())
        shelf['matrix'][0][0]=dict(bin_data(),id='review-bin',name='New bin',contents='x'*501)
        doc, shelves, report=convert_bin_contents(empty_inventory(),{'R01':shelf})
        self.assertEqual((report['converted'],report['needsReview']),(0,1))
        retired=shelves['R01']
        self.assertFalse(retired['legacyBinText']['review-bin'][0]['converted'])
        self.assertEqual(bin_display_name(retired['matrix'][0][0],'R01',doc,retired),'New bin')

    def test_current_dormant_unplaced_duplicates_details_and_rerun(self):
        shelf=json.loads((self.data/'shelves/R01.json').read_text());shelf['mode']='simple'
        shelf['matrix'][0][0]=dict(bin_data(),id='legacy-bin',contents=' shirts, clothing, drone kit, , shirts, Detailed, Ambiguous ',keywords='Do not convert keyword')
        write_json(self.data/'shelves/R01.json',shelf)
        unplaced=copy.deepcopy(shelf);unplaced['id']='unplaced';write_json(self.data/'shelves/unplaced.json',unplaced)
        doc=self.server.stock_document()
        for item_id in ['detailed','ambiguous-one','ambiguous-two']:
            doc['items'][item_id]=validate_item(dict(name='Detailed' if item_id=='detailed' else 'Ambiguous',vendor='Preserve',unitPrice='7.5',currency='USD',priceUnit='each'))
            doc['stocks'][item_id]=dict(itemId=item_id,shelfId='R01',binId='legacy-bin',tracking='exact',quantity='42',availability=None,unit='each',archived=False,notes='Keep all details')
        write_json(self.data/'inventory.json',doc)
        history=self.data/'history/lab/0.json';write_json(history,dict(layout=self.request('GET','/api/lab')[1],shelves={'R01':shelf}));history_bytes=history.read_bytes()
        (self.data/'bin-contents-migration.json').unlink() # Simulate first upgrade on disposable data only.
        self.restart()
        report=json.loads((self.data/'bin-contents-migration.json').read_text())
        self.assertEqual((report['converted'],report['skippedDuplicates'],report['needsReview']),(8,3,1))
        self.assertEqual(report['sources'][0]['contents'],shelf['matrix'][0][0]['contents'])
        self.assertEqual(self.server.stock_document()['stocks']['detailed'],doc['stocks']['detailed'])
        self.assertEqual(self.server.stock_document()['items']['detailed'],doc['items']['detailed'])
        retired=json.loads((self.data/'shelves/R01.json').read_text())
        self.assertNotIn('contents',retired['matrix'][0][0]);self.assertNotIn('keywords',retired['matrix'][0][0])
        self.assertEqual(retired['matrix'][0][0]['w'],shelf['matrix'][0][0]['w'])
        self.assertFalse(self.server.stock_locations()['unplaced/legacy-bin']['mapped'])
        self.assertTrue(self.server.stock_locations()['R01/legacy-bin']['hidden'])
        before={str(p.relative_to(self.data)):p.read_bytes() for p in self.data.rglob('*.json')}
        self.restart();self.assertEqual(before,{str(p.relative_to(self.data)):p.read_bytes() for p in self.data.rglob('*.json')})
        self.assertEqual(history.read_bytes(),history_bytes)
        self.assertEqual(self.request('GET','/api/inventory/migration')[0],403)
        self.login();self.assertEqual(self.request('GET','/api/inventory/migration')[0],200)
        # Saving a pre-upgrade layout never touches live stock; prose is retained only for review.
        saved=self.server.stock_document()
        old=normalize_shelf(shelf);old['revision']=retired['revision']
        self.assertEqual(self.request('PUT','/api/shelves/R01',old)[0],200)
        self.restart();self.assertEqual(self.server.stock_document(),saved)
        self.assertNotIn('contents',self.request('GET','/api/shelves/R01')[1]['matrix'][0][0])

    def test_interruption_and_recoverable_originals(self):
        from unittest.mock import patch
        shelf=json.loads((self.data/'shelves/R01.json').read_text());shelf['matrix'][0][0]=dict(bin_data(),contents='one, two',id='interrupt')
        write_json(self.data/'shelves/R01.json',shelf);(self.data/'bin-contents-migration.json').unlink()
        with patch.object(self.server,'finish_transaction',side_effect=OSError('disk unavailable')):
            with self.assertRaises(OSError):self.server.migrate_bin_contents()
        self.assertTrue((self.data/'pending-save.json').exists())
        self.restart();self.assertEqual(len(self.server.stock_document()['stocks']),2)
        report=json.loads((self.data/'bin-contents-migration.json').read_text());self.assertEqual(report['sources'][0]['contents'],'one, two')
        self.restart();self.assertEqual(len(self.server.stock_document()['stocks']),2)

    def test_populated_repository_copy_preserves_stock_geometry_history(self):
        root=pathlib.Path(__file__).resolve().parents[1]
        with tempfile.TemporaryDirectory() as temp:
            target=pathlib.Path(temp)/'data';shutil.copytree(root/'data',target)
            inventory=json.loads((target/'inventory.json').read_text());history={str(p.relative_to(target)):p.read_bytes() for p in (target/'history').rglob('*.json') if 'inventory' not in str(p)}
            original={p.stem:json.loads(p.read_text()) for p in (target/'shelves').glob('*.json')}
            server=LabServer(('127.0.0.1',0),target,'fixture')
            try:
                new=server.stock_document()
                for key,stock in inventory['stocks'].items():self.assertEqual(new['stocks'][key],stock)
                for key,item in inventory['items'].items():self.assertEqual(new['items'][key],item)
                for sid,doc in original.items():
                    after=json.loads((target/'shelves'/f'{sid}.json').read_text())
                    for key in doc:
                        if key!='matrix':self.assertEqual(after[key],doc[key])
                    for oldrow,newrow in zip(identify_bins(doc)['matrix'],after['matrix']):
                        for old,updated in zip(oldrow,newrow):
                            if old:
                                self.assertEqual({k:v for k,v in old.items() if k not in ('contents','keywords','hasLegacyDescription')},{k:v for k,v in updated.items() if k not in ('contents','keywords','hasLegacyDescription')})
                self.assertEqual(history,{name:(target/name).read_bytes() for name in history})
                report=json.loads((target/'bin-contents-migration.json').read_text())
                print('Populated COPY migration:',{k:report[k] for k in ('converted','skippedDuplicates','needsReview')})
            finally:server.server_close()
