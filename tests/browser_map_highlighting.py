import json,unittest
import browser_features
from lab_server import write_json
from inventory import validate_item
from playwright.sync_api import expect

class Highlighting(unittest.TestCase):
    setUp=browser_features.Features.setUp
    tearDown=browser_features.Features.tearDown
    login=browser_features.Features.login

    def test_all_locations_ids_filters_clear_and_matching_bins(self):
        p=self.page
        shelf=json.loads((self.data/'shelves/R01.json').read_text());shelf['mode']='complex'
        shelf['matrix'][0][0]=dict(id='match-a',name='A',contents='',keywords='',w=2,h=2,background='#ffffff',color='#000000',fontSize=12,fontFamily='Arial',bold=False)
        shelf['matrix'][0][3]=dict(shelf['matrix'][0][0],id='match-b',name='B')
        write_json(self.data/'shelves/R01.json',shelf)
        table=next(i for i in json.loads((self.data/'lab.json').read_text())['items'] if i['kind']=='table')
        doc=self.server.stock_document();doc['items']['target']=validate_item({'name':'Same name'});doc['items']['unrelated']=validate_item({'name':'Same name'})
        for key,sid,bid,itemid in [('a','R01','match-a','target'),('b','R01','match-b','target'),('c',table['id'],None,'target'),('d','R02',None,'unrelated')]:
            doc['stocks'][key]=dict(itemId=itemid,shelfId=sid,binId=bid,tracking='presence',quantity=None,unit='each',archived=False,notes='')
        write_json(self.data/'inventory.json',doc)
        p.evaluate('refreshInventory()');p.locator('#shelfVisible').uncheck();p.locator('#tableVisible').uncheck()
        saved=(self.data/'lab.json').read_bytes()
        p.evaluate("lab.highlightInventoryItem('target')")
        expect(p.locator('#plan .inventory-target')).to_have_count(2);expect(p.locator('#explorerPanel')).not_to_be_visible()
        expect(p.locator('#shelfVisible')).not_to_be_checked();expect(p.locator('#tableVisible')).not_to_be_checked()
        p.locator('#plan [data-id="R01"]').click();expect(p.locator('#explorerContent .inventory-match')).to_have_count(2)
        expect(p.locator('#explorerContent')).to_contain_text('Select a bin')
        expect(p.locator('#explorerContent .readonly-bin[aria-pressed="true"]')).to_have_count(0)
        p.locator('#closeExplorer').click();expect(p.locator('#explorerPanel')).not_to_be_visible()
        p.locator('#tableVisible').check()
        p.get_by_role('button',name='Clear highlighting').click();expect(p.locator('#plan .inventory-target')).to_have_count(0)
        expect(p.locator('#plan [data-id="R01"]')).to_have_count(0);self.assertEqual((self.data/'lab.json').read_bytes(),saved)
        # One match selects its bin; same item can also live directly on the shelf.
        doc['stocks'].pop('b');write_json(self.data/'inventory.json',doc);p.evaluate('refreshInventory()');p.evaluate("lab.highlightInventoryItem('target')")
        p.locator('#plan [data-id="R01"]').click();expect(p.locator('#explorerContent .selected-bin-panel')).to_contain_text('A')

if __name__=='__main__':unittest.main()
