import json,unittest
import browser_features
from lab_server import write_json
from playwright.sync_api import expect

class EmptyBinsBrowser(unittest.TestCase):
    setUp=browser_features.Features.setUp
    tearDown=browser_features.Features.tearDown
    login=browser_features.Features.login

    def test_empty_label_touch_selection_and_populated_placeholder(self):
        shelf=json.loads((self.data/'shelves/R01.json').read_text());shelf['mode']='complex'
        shelf['matrix'][0][0]=dict(id='empty',name='New bin',contents='',keywords='',w=3,h=2,background='#ffaaaa',color='#000000',fontSize=12,fontFamily='Arial',bold=True)
        shelf['matrix'][0][4]=dict(shelf['matrix'][0][0],id='custom',name='New bin of tools')
        write_json(self.data/'shelves/R01.json',shelf)
        p=self.page;self.login();p.set_viewport_size({'width':390,'height':850});p.locator('[data-id="R01"]').click()
        expect(p.locator('#mapStockPanel [data-bin-id="empty"]')).to_have_text('empty')
        expect(p.locator('#mapStockPanel [data-bin-id="custom"]')).to_have_text('New bin of tools')
        p.locator('#mapStockPanel [data-bin-id="empty"]').dispatch_event('click')
        field=p.locator('#mapStockPanel .selected-bin-panel input');field.fill('Added');field.press('Enter');expect(field).to_have_value('')
        p.locator('#auth').click();p.wait_for_function('!isAdmin');p.locator('[data-id="R01"]').click()
        expect(p.locator('#explorerContent [data-bin-id="empty"]')).to_have_text('New bin')
        self.assertEqual(json.loads((self.data/'shelves/R01.json').read_text())['matrix'][0][0]['name'],'New bin')
        self.assertTrue(p.evaluate('document.documentElement.scrollWidth<=innerWidth'))

if __name__=='__main__':unittest.main()
