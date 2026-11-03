import json
import unittest
import browser_features
from playwright.sync_api import expect
from lab_server import write_json
from inventory import empty_inventory, validate_item

class InventorySafety(unittest.TestCase):
    setUp = browser_features.Features.setUp
    tearDown = browser_features.Features.tearDown
    login = browser_features.Features.login
    save = browser_features.Features.save

    def test_copy_structure_and_remove_stocked_bin(self):
        p=self.page;self.login()
        p.goto(self.url+'/shelf_editor.html?id=R01');p.wait_for_function('isAdmin && recoveryReady')
        p.locator('#shelfMode').select_option('complex');p.locator('#applyShelfMode').click()
        p.get_by_role('button',name='Empty cell, row 1, column 1',exact=True).click();p.locator('#addBin').click()
        p.locator('#name').fill('Template bin');p.locator('#name').dispatch_event('change')
        p.locator('#addDecor').click();p.locator('.shelf-bin').click()
        self.save('Stock template')
        source_id=p.evaluate('binAt().id')
        inv=empty_inventory();inv['items']['bolts']=validate_item({'name':'M4 bolts'})
        inv['stocks']['s1']=dict(itemId='bolts',shelfId='R01',binId=source_id,tracking='exact',quantity='15',unit='each',archived=False)
        write_json(self.data/'inventory.json',inv)
        original=(self.data/'inventory.json').read_bytes()
        p.locator('.shelf-bin').focus();p.keyboard.press('Control+c');p.keyboard.press('Control+v')
        p.wait_for_function('shelfBins(shelf.data).length===2')
        self.assertNotEqual(p.evaluate('binAt().id'),source_id)
        self.assertEqual(p.evaluate('binAt().name'),'Template bin')
        self.assertEqual((self.data/'inventory.json').read_bytes(),original)
        p.locator('#back').click();p.wait_for_function('typeof lab!=="undefined" && isAdmin && recoveryReady')
        copied=p.evaluate("async()=>{choose('R01');await lab.copySelection();await lab.pasteSelection();return selected().id}")
        expect(p.locator('#status')).to_contain_text('inventory excluded')
        p.locator('#openShelf').click();p.wait_for_function('typeof shelf!=="undefined" && isAdmin && recoveryReady')
        ids=p.evaluate('shelfBins(shelf.data).map(p=>p.bin.id)')
        self.assertNotIn(source_id,ids)
        self.assertEqual(p.evaluate('shelf.data.decor.length'),1)
        self.assertEqual((self.data/'inventory.json').read_bytes(),original)
        self.save('Copied structure')
        self.assertEqual(len(json.loads((self.data/'inventory.json').read_text())['stocks']),1)
        p.goto(self.url+'/shelf_editor.html?id=R01');p.wait_for_function('isAdmin && recoveryReady')
        p.evaluate('id=>{const p=shelfBins(shelf.data).find(p=>p.bin.id===id);choose(p.r,p.c)}',source_id)
        prompts=[]
        def accept(dialog):
            prompts.append(dialog.message);dialog.accept()
        p.on('dialog',accept)
        p.locator('#delete').click();p.wait_for_function('shelfBins(shelf.data).length===1')
        self.assertIn('keeps all stock',prompts[-1])
        p.locator('#undo').click();p.locator('#redo').click()
        self.assertEqual((self.data/'inventory.json').read_bytes(),original)
        self.save('Removed location')
        self.assertEqual((self.data/'inventory.json').read_bytes(),original)

    def test_import_structure_retains_notes_and_never_imports_stock(self):
        p=self.page;self.login()
        p.goto(self.url+'/shelf_editor.html?id=R01');p.wait_for_function('isAdmin && recoveryReady')
        p.locator('#shelfMode').select_option('complex');p.locator('#applyShelfMode').click()
        p.get_by_role('button',name='Empty cell, row 1, column 1',exact=True).click();p.locator('#addBin').click()
        self.save('Before import')
        old_id=p.evaluate('binAt().id')
        inv=empty_inventory();inv['items']['bolts']=validate_item({'name':'Preserved stock'})
        inv['stocks']['stock']=dict(itemId='bolts',shelfId='R01',binId=old_id,tracking='exact',quantity='9',unit='each',archived=False,locationLabel='Prior bin')
        write_json(self.data/'inventory.json',inv);original=(self.data/'inventory.json').read_bytes()
        legacy=p.evaluate('shelf.data');legacy['matrix'][0][0].pop('id');legacy['matrix'][0][0]['contents']='Imported descriptive notes'
        legacy['stocks']={'fake':{'quantity':'1000'}};legacy['items']={'fake':{'name':'Never import me'}}
        p.on('dialog',lambda d:d.accept())
        p.locator('#import').set_input_files(dict(name='old-shelf.json',mimeType='application/json',buffer=json.dumps(legacy).encode()))
        p.wait_for_function('shelf.data.matrix[0][0].contents==="Imported descriptive notes"')
        new_id=p.evaluate('shelf.data.matrix[0][0].id');self.assertNotEqual(new_id,old_id)
        self.assertNotIn('stocks',p.evaluate('shelf.data'))
        self.save('Imported structure')
        self.assertEqual((self.data/'inventory.json').read_bytes(),original)
        p.evaluate('refreshInventory()')
        self.assertNotIn('R01/'+old_id,p.evaluate('inventoryState.locations'))
        self.assertEqual(p.evaluate('inventoryState.stocks.stock.quantity'),'9')
        p.locator('#undo').click()
        self.assertEqual(p.evaluate('shelf.data.matrix[0][0].id'),old_id)
        self.assertEqual((self.data/'inventory.json').read_bytes(),original)

if __name__=='__main__':unittest.main()
