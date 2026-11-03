"""Disposable acceptance fixtures for concise search, panels and inventory focus."""
import json
import unittest
from pathlib import Path
import browser_features
from lab_server import write_json
from inventory import validate_item
from playwright.sync_api import expect

ARTIFACTS = Path('/tmp/itr-six-fixes')

class CompactInventory(unittest.TestCase):
    setUp = browser_features.Features.setUp
    tearDown = browser_features.Features.tearDown
    login = browser_features.Features.login

    def fixture(self):
        shelf = json.loads((self.data/'shelves/R01.json').read_text())
        shelf.update(name='Hardware Shelf', mode='complex', contents='Assembly notes', keywords='shelf-only-keyword')
        for col, bid, name in [(0,'motor','Motor Bin'),(3,'tetrix','Tetrix Channels'),(6,'gobilda','GoBilda Channels')]:
            shelf['matrix'][0][col] = dict(id=bid,name=name,w=2,h=2,background='#ffffff',color='#000000',fontSize=12,fontFamily='Arial',bold=False)
        write_json(self.data/'shelves/R01.json',shelf)
        doc=self.server.stock_document()
        for iid,name,sid,bid in [('motor','Motor','R01','motor'),('tetrix','Tetrix Channels','R01','tetrix'),('gobilda','GoBilda Channels','R01','gobilda'),('direct','Shelf stock','R01',None),('multi','Shared bolts','R01','motor'),('multi','Shared bolts','R01','tetrix')]:
            doc['items'][iid]=validate_item({'name':name})
            doc['stocks'][iid+(bid or '')]=dict(itemId=iid,shelfId=sid,binId=bid,tracking='presence',quantity=None,availability=None,unit='each',notes='',archived=False)
        doc['items']['motor']['description']='A real motor description'
        for i in range(95):
            iid=f'name-{i:02}'
            doc['items'][iid]=validate_item({'name':f'Part {i:02} fasteners'})
            doc['stocks'][iid]=dict(itemId=iid,shelfId='R02',binId=None,tracking='presence',quantity=None,availability=None,unit='each',notes='',archived=False)
        write_json(self.data/'inventory.json',doc)
        self.page.evaluate('refreshInventory()'); self.page.evaluate('refreshShelfIndex()')

    def capture(self, prefix):
        self.fixture();p=self.page
        p.locator('#plan [data-id="R01"]').click()
        p.screenshot(path=str(ARTIFACTS/f'{prefix}-panel.png'))
        p.goto(self.url+'/lab_inventory.html');p.wait_for_function('inventoryState !== null')
        for width in [1440,768,390]:
            p.set_viewport_size({'width':width,'height':900})
            p.screenshot(path=str(ARTIFACTS/f'{prefix}-inventory-{width}.png'))

    def test_search_exact_destination(self):
        self.fixture();p=self.page
        p.locator('#search').fill('motor')
        expect(p.locator('#explorerResults button')).to_have_text(['Hardware Shelf · Motor Bin'])
        p.locator('#explorerResults button').click()
        expect(p.locator('.readonly-bin[aria-pressed="true"]')).to_have_attribute('data-bin-id','motor')
        expect(p.locator('#explorerContent [data-stock-bin="motor"]')).to_contain_text('Motor')
        p.locator('#closeExplorer').click();expect(p.locator('#explorerPanel')).not_to_be_visible()
        p.locator('#search').fill('shelf-only-keyword')
        expect(p.locator('#explorerResults button')).to_have_text(['Hardware Shelf'])
        p.locator('#explorerResults button').click()
        expect(p.locator('.readonly-bin[aria-pressed="true"]')).to_have_count(0)

    def test_single_panel_and_compact_interactions(self):
        self.fixture();p=self.page
        p.locator('#plan [data-id="R01"]').click()
        host=p.locator('#explorerContent')
        expect(host.locator('.stock-panel')).to_have_count(1)
        expect(host.locator('.stock-panel')).to_contain_text('Shelf stock')
        expect(host.locator('.stock-panel')).to_contain_text('GoBilda Channels')
        expect(host.locator('.stock-panel h3')).to_have_text('Inventory')
        host.get_by_role('button',name='Motor',exact=True).click()
        expect(host.locator('.stock-panel h3')).to_have_text('Selected Inventory')
        expect(host.locator('.stock-details[open]')).to_contain_text('A real motor description')
        expect(host.locator('.stock-panel')).not_to_contain_text('GoBilda Channels')
        expect(host.locator('.readonly-bin[aria-pressed="true"]')).to_have_attribute('data-bin-id','motor')
        expect(host.locator('[data-inventory-item="multi"] details')).to_have_count(0)
        host.get_by_role('button',name='Clear bin',exact=True).click()
        host.get_by_role('button',name='Shared bolts',exact=True).click()
        expect(host.locator('.inventory-choice button')).to_have_count(2)
        expect(host.locator('.readonly-bin.inventory-match')).to_have_count(2)
        expect(host.locator('.readonly-bin[aria-pressed="true"]')).to_have_count(0)
        host.locator('.inventory-choice').get_by_role('button',name='Tetrix Channels',exact=True).click()
        expect(host.locator('.readonly-bin[aria-pressed="true"]')).to_have_attribute('data-bin-id','tetrix')
        p.screenshot(path=str(ARTIFACTS/'after-panel.png'))

    def test_density_details_and_edit_actions(self):
        self.fixture();p=self.page
        p.goto(self.url+'/lab_inventory.html');p.wait_for_function('inventoryState !== null')
        for width in [1440,768,390]:
            p.set_viewport_size({'width':width,'height':900})
            self.assertTrue(p.evaluate('document.documentElement.scrollWidth <= innerWidth'))
            expect(p.locator('[data-inventory-item="name-00"] details')).to_have_count(0)
            expect(p.locator('.inventory-pencil')).to_have_count(0)
            if width == 1440:
                visible=p.locator('#inventoryList .inventory-name').evaluate_all('(nodes)=>nodes.filter(n=>{const r=n.getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight}).length')
                self.assertGreaterEqual(visible,25)
                print('1440 × 900 visible compact names:',visible)
            p.screenshot(path=str(ARTIFACTS/f'after-inventory-{width}.png'))
        p.locator('[data-inventory-item="motor"] summary').click()
        expect(p.locator('[data-inventory-item="motor"] details')).to_have_attribute('open','')
        self.assertTrue(p.url.endswith('lab_inventory.html'))
        self.login()
        p.locator('[data-inventory-item="name-00"]').get_by_role('button',name='Edit Part 00 fasteners',exact=True).click()
        expect(p.locator('#inventoryEditor')).to_be_visible()
        expect(p.locator('#inv-item-name')).to_have_value('Part 00 fasteners')
        self.assertTrue(p.url.endswith('lab_inventory.html'))
        p.locator('#inv-cancel').click()
        p.evaluate("inventoryState.items['name-00'].unitPrice=0; renderInventoryList()")
        expect(p.locator('[data-inventory-item="name-00"] summary')).to_have_count(1)
        p.evaluate("inventoryState.items['name-00'].unitPrice=null;inventoryState.stocks['name-00'].quantity=0;renderInventoryList()")
        expect(p.locator('[data-inventory-item="name-00"] summary')).to_have_count(1)
        p.evaluate("inventoryState.stocks['name-00'].quantity=null;inventoryState.items['name-00'].description='No details.';renderInventoryList()")
        expect(p.locator('[data-inventory-item="name-00"] summary')).to_have_count(0)
        long_name='Long inventory name ' * 18
        p.evaluate("name=>{inventoryState.items['name-00'].name=name;renderInventoryList()}",long_name)
        for width in [1440,768,390]:
            p.set_viewport_size({'width':width,'height':900})
            name=p.locator('[data-inventory-item="name-00"] .inventory-name')
            expect(name).to_have_text(long_name.strip())
            self.assertTrue(name.evaluate('(node)=>node.scrollHeight <= node.clientHeight'))
            self.assertTrue(p.evaluate('document.documentElement.scrollWidth <= innerWidth'))
            pencil=p.locator('[data-inventory-item="name-00"] .inventory-pencil').bounding_box()
            box=name.bounding_box()
            self.assertTrue(pencil['x'] >= box['x']+box['width'] or pencil['y'] >= box['y']+box['height'])


    def test_navigation_exact_multiple_unmapped_and_clear(self):
        self.fixture();p=self.page
        p.evaluate("lab.highlightInventoryItem('motor')")
        expect(p.locator('#explorerPanel')).to_be_visible()
        expect(p.locator('.readonly-bin[aria-pressed="true"]')).to_have_attribute('data-bin-id','motor')
        self.assertGreaterEqual(p.evaluate('zoom'),1.5)
        box=p.locator('#plan [data-id="R01"]').bounding_box();drawer=p.locator('#explorerPanel').bounding_box()
        self.assertLess(box['x']+box['width'],drawer['x'])
        p.locator('#closeExplorer').click();expect(p.locator('#explorerPanel')).not_to_be_visible()
        p.evaluate("lab.highlightInventoryItem('multi')")
        expect(p.locator('#explorerPanel')).to_be_visible()
        expect(p.locator('.readonly-bin.inventory-match')).to_have_count(2)
        expect(p.locator('.readonly-bin[aria-pressed="true"]')).to_have_count(0)
        expect(p.locator('#inventoryHighlightBar .inventory-destination')).to_have_count(2)
        p.get_by_role('button',name='Clear highlighting').click()
        expect(p.locator('#plan .inventory-target')).to_have_count(0)
        p.evaluate("inventoryState.stocks['orphan']={itemId:'motor',shelfId:'missing',binId:null,archived:false}; delete inventoryState.stocks['motormotor']; lab.highlightInventoryItem('motor')")
        expect(p.locator('#status')).to_contain_text('no location on the current map')
        # A delayed earlier destination cannot reopen after a newer navigation.
        p.route('**/api/shelves/R01',lambda route: ( __import__('time').sleep(.2),route.continue_()))
        p.evaluate("Promise.all([lab.showInventoryLocation('R01','motor'),lab.showInventoryLocation('R02')])")
        expect(p.locator('#explorerContent h2')).not_to_have_text('Hardware Shelf')
        for width in [768,390]:
            p.set_viewport_size({'width':width,'height':900})
            p.evaluate("lab.showInventoryLocation('R01','motor')")
            expect(p.locator('.readonly-bin[aria-pressed="true"]')).to_have_attribute('data-bin-id','motor')
            self.assertTrue(p.evaluate('document.documentElement.scrollWidth <= innerWidth'))
            box=p.locator('#plan [data-id="R01"]').bounding_box();drawer=p.locator('#explorerPanel').bounding_box()
            self.assertLess(box['y']+box['height'],drawer['y'])
            p.screenshot(path=str(ARTIFACTS/f'after-navigation-{width}.png'))
            p.locator('#closeExplorer').click()

    def test_permanent_delete_confirmation_and_open_views(self):
        self.fixture();p=self.page;self.login()
        p.goto(self.url+'/lab_inventory.html');p.wait_for_function('inventoryState !== null && isAdmin')
        p.get_by_role('button',name='Edit Shared bolts',exact=True).click()
        seen=[]
        def cancel(dialog):
            seen.append(dialog.message);dialog.dismiss()
        p.once('dialog',cancel);p.get_by_role('button',name='Delete permanently',exact=True).click()
        self.assertIn('ALL',seen[0]);self.assertIn('2 location(s)',seen[0])
        self.assertIn('multi',self.server.stock_document()['items'])
        p.once('dialog',lambda dialog:dialog.accept())
        p.get_by_role('button',name='Delete permanently',exact=True).click()
        expect(p.locator('#inventoryEditor')).not_to_be_visible()
        expect(p.locator('[data-inventory-item="multi"]')).to_have_count(0)
        p.reload();p.wait_for_function('inventoryState !== null')
        expect(p.locator('[data-inventory-item="multi"]')).to_have_count(0)
        p.goto(self.url);p.wait_for_function('lab.data && inventoryState')
        p.locator('#auth').click();p.wait_for_function('!isAdmin')
        p.locator('#search').fill('Shared bolts')
        expect(p.locator('#explorerResults')).to_contain_text('No matching')

    def test_labels_create_copy_save_and_identity(self):
        p=self.page;self.login()
        p.locator('#newKind').select_option('shelf');p.locator('#add').click()
        p.wait_for_function("selected()?.kind === 'shelf' && /^S-[0-9]+$/.test(selected().locationId || '')")
        sid=p.evaluate('selected().id');label=p.evaluate('selected().locationId')
        copied=p.evaluate("async()=>{await lab.copySelection();await lab.pasteSelection();return {id:selected().id,label:selected().locationId}}")
        self.assertNotEqual(sid,copied['id']);self.assertNotEqual(label,copied['label'])
        p.locator('#name').fill('Renamed copied shelf');p.locator('#name').dispatch_event('change')
        self.assertEqual(p.evaluate('selected().locationId'),copied['label'])
        browser_features.Features.save(self,'Readable shelf labels')
        saved=self.server.stock_locations()[copied['id']]
        self.assertEqual(saved['locationId'],copied['label'])
        self.assertTrue((self.data/'shelves'/f"{copied['id']}.json").exists())
        p.reload();p.wait_for_function('lab.data && inventoryState')
        p.evaluate('id=>lab.showInventoryLocation(id)',copied['id'])
        expect(p.locator('#explorerContent')).to_contain_text(copied['label'])
        p.screenshot(path=str(ARTIFACTS/'after-location-label.png'))

    def test_non_shelf_multiple_shelves_and_association_counts(self):
        self.fixture();p=self.page
        table=next(i for i in p.evaluate('lab.data.items') if i['kind']=='table')
        doc=self.server.stock_document()
        doc['stocks']['unit-duplicate']=dict(doc['stocks']['motormotor'],unit='pack')
        write_json(self.data/'inventory.json',doc);p.evaluate('refreshInventory()')
        p.evaluate("lab.highlightInventoryItem('motor')")
        expect(p.locator('#inventoryHighlightBar')).to_contain_text('1 mapped locations')
        expect(p.locator('.readonly-bin[aria-pressed="true"]')).to_have_attribute('data-bin-id','motor')
        p.get_by_role('button',name='Clear highlighting').click()
        doc['items']['physical']=validate_item({'name':'Oscilloscope'})
        doc['stocks']['physical']=dict(doc['stocks']['direct'],itemId='physical',shelfId=table['id'])
        doc['stocks']['another-shelf']=dict(doc['stocks']['multimotor'],shelfId='R02',binId=None)
        write_json(self.data/'inventory.json',doc);p.evaluate('refreshInventory()')
        p.evaluate("lab.highlightInventoryItem('physical')")
        expect(p.locator('#explorerContent h2')).to_have_text(table['name'])
        expect(p.locator('#explorerContent .readonly-bin')).to_have_count(0)
        p.get_by_role('button',name='Clear highlighting').click()
        p.evaluate("lab.highlightInventoryItem('multi')")
        expect(p.locator('#explorerPanel')).not_to_be_visible()
        expect(p.locator('#plan .inventory-target')).to_have_count(2)
        expect(p.locator('#inventoryHighlightBar .inventory-destination')).to_have_count(3)
        view=p.locator('#viewport').bounding_box()
        for node in p.locator('#plan .inventory-target').all():
            box=node.bounding_box()
            self.assertGreaterEqual(box['x'],view['x'])
            self.assertLessEqual(box['x']+box['width'],view['x']+view['width'])
        p.get_by_role('button',name='Clear highlighting').click()
        p.locator('#search').fill('Oscilloscope')
        expect(p.locator('#explorerResults button')).to_have_text([table['name']])
        p.locator('#explorerResults button').click()
        expect(p.locator('#explorerContent h2')).to_have_text(table['name'])

    def test_remove_one_location_in_editor(self):
        self.fixture();p=self.page;self.login()
        p.evaluate("openInventoryEditor({stockId:'multimotor'})")
        p.once('dialog',lambda dialog:dialog.dismiss())
        p.get_by_role('button',name='Remove from this location',exact=True).click()
        self.assertIn('multimotor',self.server.stock_document()['stocks'])
        p.once('dialog',lambda dialog:dialog.accept())
        p.get_by_role('button',name='Remove from this location',exact=True).click()
        expect(p.locator('#inventoryEditor')).not_to_be_visible()
        doc=self.server.stock_document()
        self.assertIn('multi',doc['items']);self.assertIn('multitetrix',doc['stocks']);self.assertNotIn('multimotor',doc['stocks'])

if __name__=='__main__':unittest.main()
