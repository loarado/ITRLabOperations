import json
import unittest
import browser_features
from playwright.sync_api import expect
from lab_server import write_json
from inventory import empty_inventory, validate_item

class InventoryNavigation(unittest.TestCase):
    setUp = browser_features.Features.setUp
    tearDown = browser_features.Features.tearDown
    login = browser_features.Features.login
    save = browser_features.Features.save

    def seed(self):
        for sid in ('R01','R02'):
            shelf=json.loads((self.data/'shelves'/f'{sid}.json').read_text())
            shelf['mode']='complex';shelf['matrix'][0][0]=dict(id='shared-bin',name='Same bin name',contents='Legacy note',keywords='',w=2,h=2,background='#ffffff',color='#000000',fontSize=12,fontFamily='Arial',bold=False)
            write_json(self.data/'shelves'/f'{sid}.json',shelf)
        inventory=empty_inventory();inventory['items']['bolts']=validate_item(dict(name='M4 bolts',vendor='Acme fasteners',keywords='metric'))
        for sid in ('R01','R02'):
            inventory['stocks'][sid]=dict(itemId='bolts',shelfId=sid,binId='shared-bin',tracking='exact',quantity='8',availability=None,unit='each',notes='',archived=False,locationLabel=sid)
        write_json(self.data/'inventory.json',inventory)

    def test_inventory_search_exact_navigation_and_filter_reveal(self):
        self.seed();p=self.page
        p.get_by_role('link',name='LAB INVENTORY',exact=True).click()
        p.wait_for_function('typeof inventoryState!=="undefined" && inventoryState?.items.bolts')
        p.locator('#inventorySearch').fill('M4 bolts')
        p.locator('#inventoryList summary').click()
        expect(p.locator('#inventoryList')).to_contain_text('R01');expect(p.locator('#inventoryList')).to_contain_text('R02')
        p.locator('#inventoryList').get_by_role('button',name='M4 bolts',exact=True).click()
        p.wait_for_function('typeof lab!=="undefined" && lab.data')
        expect(p.locator('#explorerPanel')).not_to_be_visible();expect(p.locator('#plan .inventory-target')).to_have_count(2)
        p.locator('#plan [data-id="R02"]').click()
        expect(p.locator('#plan [data-id="R02"]')).to_have_class(__import__('re').compile('inventory-target'))
        expect(p.locator('.readonly-bin.inventory-target')).to_have_attribute('data-bin-id','shared-bin')
        expect(p.locator('#explorerContent')).to_contain_text('M4 bolts')
        p.locator('#closeExplorer').click()
        p.locator('#shelfVisible').uncheck()
        p.evaluate("lab.showInventoryLocation('R01','shared-bin')")
        expect(p.locator('#shelfVisible')).not_to_be_checked()
        expect(p.locator('#explorerPanel')).to_be_visible()
        self.assertEqual(p.evaluate('inventoryMapFocusId'),'R01')
        p.locator('#explorerContent .selected-bin-panel').get_by_role('button',name='M4 bolts',exact=True).click()
        p.locator('#explorerContent').get_by_role('button',name='All locations',exact=True).click()
        expect(p.locator('#inventoryDetailContent')).to_contain_text('R01');expect(p.locator('#inventoryDetailContent')).to_contain_text('R02')
        p.locator('#inventoryDetailClose').click();p.locator('#closeExplorer').click();expect(p.locator('#explorerPanel')).not_to_be_visible()
        p.locator('#search').fill('M4 bolts');expect(p.locator('#explorerResults')).to_contain_text('Same bin name')
        p.get_by_role('link',name='LAB INVENTORY',exact=True).click();p.wait_for_function('typeof inventoryState!=="undefined" && inventoryState?.items.bolts')
        p.locator('#inventorySearch').fill('Acme');expect(p.locator('[data-inventory-item="bolts"]')).to_be_visible()
        p.set_viewport_size({'width':390,'height':844})
        self.assertTrue(p.evaluate('document.documentElement.scrollWidth<=innerWidth'))
        p.screenshot(path='/tmp/itr-inventory-mobile.png',full_page=True)
        self.login()
        p.locator('#inventoryAdd').click();expect(p.locator('#inventoryEditor')).to_be_visible()
        self.assertTrue(p.evaluate('document.documentElement.scrollWidth<=innerWidth'))
        p.locator('#inv-cancel').click()

    def test_inventory_list_writes_update_map_and_list_without_reload(self):
        p=self.page;p.get_by_role('link',name='LAB INVENTORY',exact=True).click()
        p.wait_for_function('typeof inventoryState!=="undefined" && inventoryState')
        expect(p.locator('#inventoryList')).to_contain_text('No inventory recorded')
        self.login()
        p.locator('#inventoryAdd').click();p.locator('#inv-item-name').fill('List-entered washers')
        p.locator('#inv-map [data-location-object="R02"]').click();p.locator('#inv-save').click()
        expect(p.locator('#inventoryEditor')).not_to_be_visible()
        expect(p.locator('#inventoryList')).to_contain_text('List-entered washers')
        p.locator('#inventoryList').get_by_role('button',name='List-entered washers',exact=True).click()
        expect(p.locator('#explorerPanel')).to_be_visible()
        p.locator('#explorerContent').get_by_role('button',name='Edit List-entered washers',exact=True).click()
        p.get_by_role('button',name='Manage locations',exact=True).click()
        p.get_by_role('button',name='Edit stock / relocate',exact=True).click();p.locator('.inventory-optional summary').click()
        p.locator('#inv-stock-tracking').select_option('availability');p.locator('#inv-stock-availability').select_option('low')
        p.locator('#inv-save').click();expect(p.locator('#inventoryEditor')).not_to_be_visible()
        expect(p.locator('#inventoryDetailContent')).to_contain_text('low')
        p.locator('#inventoryDetailClose').click()
        expect(p.locator('#explorerContent')).to_contain_text('low')
        p.locator('#closeExplorer').click();expect(p.locator('#explorerPanel')).not_to_be_visible()
        p.get_by_role('link',name='LAB INVENTORY',exact=True).click();p.wait_for_function('typeof inventoryState!=="undefined" && inventoryState')
        p.locator('#inventoryList summary').click()
        expect(p.locator('#inventoryList')).to_contain_text('low')
        self.assertEqual(json.loads((self.data/'lab.json').read_text())['revision'],0)

    def test_admin_shelf_editor_exposes_retained_target_bin_without_mode_change(self):
        self.seed()
        shelf=json.loads((self.data/'shelves/R01.json').read_text());shelf['mode']='simple';write_json(self.data/'shelves/R01.json',shelf)
        self.login();p=self.page
        p.goto(self.url+'/shelf_editor.html?id=R01&bin=shared-bin')
        p.wait_for_function('typeof shelf!=="undefined" && isAdmin && inventoryState')
        expect(p.locator('#shelfReadOnly')).to_be_visible()
        expect(p.locator('#shelfReadOnly .readonly-bin.inventory-target')).to_have_attribute('data-bin-id','shared-bin')
        expect(p.locator('#shelfReadOnly .selected-bin-panel')).to_contain_text('M4 bolts')
        self.assertEqual(p.evaluate('shelf.data.mode'),'simple')
        p.locator('#shelfName').fill('Updated name');p.locator('#shelfName').dispatch_event('change')
        expect(p.locator('#shelfReadOnly')).to_be_visible()
        expect(p.locator('#shelfReadOnly .selected-bin-panel')).to_contain_text('M4 bolts')
        self.assertEqual(p.evaluate('shelf.data.mode'),'simple')

    def test_hidden_and_unmapped_stock_stays_discoverable(self):
        self.seed()
        shelf=json.loads((self.data/'shelves/R01.json').read_text());shelf['mode']='simple';write_json(self.data/'shelves/R01.json',shelf)
        shelf=json.loads((self.data/'shelves/R02.json').read_text());shelf['matrix'][0][0]=None;write_json(self.data/'shelves/R02.json',shelf)
        p=self.page;p.get_by_role('link',name='LAB INVENTORY',exact=True).click();p.wait_for_function('typeof inventoryState!=="undefined" && inventoryState?.items.bolts')
        p.locator('#inventoryList summary').click()
        expect(p.locator('#inventoryList')).to_contain_text('hidden by Simple mode')
        expect(p.locator('#inventoryList')).to_contain_text('Unmapped')
        p.locator('#inventoryList').get_by_role('button',name='M4 bolts',exact=True).click()
        p.locator('#inventoryHighlightBar .inventory-destination').click()
        expect(p.locator('.readonly-bin.inventory-target')).to_be_visible()
        expect(p.locator('#explorerContent .selected-bin-panel')).to_contain_text('M4 bolts')
        self.assertEqual(json.loads((self.data/'shelves/R01.json').read_text())['mode'],'simple')
        p.locator('#closeExplorer').click();p.get_by_role('link',name='LAB INVENTORY',exact=True).click();p.wait_for_function('typeof inventoryState!=="undefined" && inventoryState?.items.bolts')
        p.locator('#inventoryFilter').select_option('unmapped');expect(p.locator('#inventoryList')).to_contain_text('M4 bolts')
        self.assertEqual(p.locator('.inventory-location-row').filter(has_text='R02').get_by_role('button',name='Show on map',exact=True).count(),0)
        self.login()
        p.locator('#inventoryList summary').click()
        p.locator('#inventoryList').get_by_role('button',name='All locations',exact=True).click()
        p.locator('#inventoryDetailContent .inventory-card').filter(has_text='R02').get_by_role('button',name='Edit stock / relocate',exact=True).click();p.locator('.inventory-optional summary').click()
        p.locator('#inv-location').select_option('')
        p.locator('#inv-save').click();expect(p.locator('#inventoryEditor')).not_to_be_visible()
        expect(p.locator('#inventoryDetailContent')).to_contain_text('Unassigned')
        self.assertEqual(json.loads((self.data/'inventory.json').read_text())['stocks']['R02']['quantity'],'8')
        self.assertIsNone(json.loads((self.data/'inventory.json').read_text())['stocks']['R02']['shelfId'])

if __name__=='__main__':unittest.main()
