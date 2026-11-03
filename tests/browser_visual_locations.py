import json, unittest
import browser_features
from playwright.sync_api import expect
from lab_server import write_json

class VisualLocations(unittest.TestCase):
    setUp=browser_features.Features.setUp
    tearDown=browser_features.Features.tearDown
    login=browser_features.Features.login

    def test_picker_draft_destinations_physical_and_two_views(self):
        shelf=json.loads((self.data/'shelves/R02.json').read_text());shelf['mode']='complex'
        shelf['matrix'][0][0]=dict(id='bin-v',name='Motors',contents='',keywords='',w=2,h=2,background='#ffffff',color='#000000',fontSize=12,fontFamily='Arial',bold=False)
        write_json(self.data/'shelves/R02.json',shelf)
        self.login();p=self.page;p.goto(self.url+'/lab_inventory.html');p.wait_for_function('inventoryState && isAdmin')
        p.locator('#inventoryAdd').click();p.locator('#inv-item-name').fill('Visual motor')
        p.locator('.inventory-optional summary').click();p.locator('#inv-item-vendor').fill('Preserved draft')
        p.locator('#inv-map [data-location-object="R02"]').click();expect(p.locator('#inv-map .readonly-bin')).to_have_count(1)
        p.locator('#inv-map [data-bin-id="bin-v"]').click();expect(p.locator('#inv-destination')).to_contain_text('Motors')
        p.get_by_role('button',name='Back to lab map').click();p.locator('#inv-map [data-location-object="R01"]').click()
        expect(p.locator('#inv-item-name')).to_have_value('Visual motor');expect(p.locator('#inv-item-vendor')).to_have_value('Preserved draft')
        for kind in ['table','machine','cart']:
            item=next(i for i in json.loads((self.data/'lab.json').read_text())['items'] if i['kind']==kind)
            p.locator('#inv-map [data-location-object="'+item['id']+'"]').click();expect(p.locator('#inv-destination')).to_contain_text(item['name'])
        p.locator('#inv-save').click();expect(p.locator('#inventoryEditor')).not_to_be_visible();expect(p.locator('#inventoryList')).to_contain_text('Visual motor')
        self.assertEqual(next(iter(self.server.stock_document()['stocks'].values()))['shelfId'],item['id'])
        p.goto(self.url);p.wait_for_function('lab.data && isAdmin && inventoryState');p.locator('[data-id="'+item['id']+'"]').click()
        expect(p.locator('#mapStockPanel')).to_contain_text('Visual motor')
        p.locator('#mapStockPanel input').fill('Cart quick');p.locator('#mapStockPanel input').press('Enter');expect(p.locator('#mapStockPanel input')).to_have_value('')
        self.assertEqual(len(self.server.stock_document()['stocks']),2)
        p.locator('#auth').click();p.wait_for_function('!isAdmin');p.locator('[data-id="'+item['id']+'"]').click()
        expect(p.locator('#explorerContent')).to_contain_text('Cart quick');expect(p.locator('#explorerContent input')).to_have_count(0)
        p.set_viewport_size({'width':390,'height':850});self.assertTrue(p.evaluate('document.documentElement.scrollWidth<=innerWidth'))

if __name__=='__main__': unittest.main()
