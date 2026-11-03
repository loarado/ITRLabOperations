import json, unittest
import browser_features
from lab_server import write_json
from playwright.sync_api import expect

class ShelfPreview(unittest.TestCase):
    setUp=browser_features.Features.setUp
    tearDown=browser_features.Features.tearDown
    login=browser_features.Features.login

    def test_inline_bin_keyboard_readonly_and_direct_stock(self):
        doc=json.loads((self.data/'shelves/R01.json').read_text());doc['mode']='complex'
        doc['matrix'][0][0]=dict(id='bin-a',name='Parts',contents='',keywords='',w=2,h=2,background='#ffffff',color='#000000',fontSize=12,fontFamily='Arial',bold=False)
        doc['matrix'][0][3]=dict(doc['matrix'][0][0],id='bin-b',name='Other')
        write_json(self.data/'shelves/R01.json',doc)
        p=self.page;self.login();p.locator('[data-id="R01"]').click()
        expect(p.locator('#mapStockPanel .readonly-bin')).to_have_count(2)
        p.locator('#mapStockPanel [data-bin-id="bin-a"]').focus();p.keyboard.press('Enter')
        field=p.locator('#mapStockPanel .selected-bin-panel input')
        field.fill('Servo');field.press('Enter');expect(field).to_have_value('');expect(field).to_be_focused()
        expect(p.locator('#mapStockPanel .selected-bin-panel')).to_contain_text('Servo')
        expect(p.locator('#mapStockPanel > .stock-panel')).to_have_count(1)
        expect(p.locator('#mapStockPanel .bin-card')).to_have_count(0)
        p.locator('#mapStockPanel').get_by_role('button',name='Clear bin').click()
        p.locator('#mapStockPanel > .stock-panel input').fill('Shelf tool');p.locator('#mapStockPanel > .stock-panel input').press('Enter')
        expect(p.locator('#mapStockPanel > .stock-panel')).to_contain_text('Shelf tool')
        self.assertEqual(len(self.server.stock_document()['stocks']),2)
        p.locator('#auth').click();p.wait_for_function('!isAdmin');p.locator('[data-id="R01"]').click()
        p.locator('#explorerContent [data-bin-id="bin-a"]').click()
        expect(p.locator('#explorerContent .selected-bin-panel')).to_contain_text('Servo')
        expect(p.locator('#explorerContent input')).to_have_count(0)
        touch=self.browser.new_context(viewport={'width':390,'height':850},has_touch=True,is_mobile=True)
        mobile=touch.new_page();mobile.on('pageerror',lambda error:self.errors.append(str(error)))
        mobile.goto(self.url);mobile.wait_for_function('lab.data && inventoryState')
        mobile.locator('[data-id="R01"]').tap()
        mobile.locator('#explorerContent [data-bin-id="bin-a"]').tap()
        expect(mobile.locator('#explorerContent .selected-bin-panel')).to_contain_text('Servo')
        touch.close()

if __name__=='__main__': unittest.main()
