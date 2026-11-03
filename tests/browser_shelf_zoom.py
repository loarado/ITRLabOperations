"""Read-only shelf fit and zoom in both viewer entry points."""
import json, unittest
from browser_features import Features
from lab_server import write_json
from playwright.sync_api import expect

class ShelfZoom(Features):
    def test_fit_zoom_and_resize(self):
        doc=json.loads((self.data/'shelves/R01.json').read_text());doc.update(mode='complex',rows=60,cols=60,matrix=[[None]*60 for _ in range(60)])
        for r,c in [(0,0),(58,58)]:doc['matrix'][r][c]=dict(name='Corner bin',contents='Visible inventory',keywords='parts',w=1.5,h=1.5,background='#ffffff',color='#000000',fontSize=14,fontFamily='Arial',bold=False)
        write_json(self.data/'shelves/R01.json',doc);before=(self.data/'shelves/R01.json').read_bytes();p=self.page
        for direct in (False,True):
            if direct:p.goto(self.url+'/shelf_editor.html?id=R01')
            else:p.locator('[data-id="R01"]').click()
            expect(p.locator('.readonly-grid')).to_be_visible()
            def fits():
                p.wait_for_function("()=>{const v=document.querySelector('.readonly-shelf-viewport'),s=document.querySelector('.readonly-shelf-stage');return s?.style.width&&v.scrollWidth<=v.clientWidth+1&&v.scrollHeight<=v.clientHeight+1;}")
            fits();initial=p.locator('[aria-label="Shelf zoom level"]').inner_text();self.assertLess(int(initial[:-1]),100)
            expect(p.get_by_role('button',name='Zoom shelf out',exact=True)).to_be_disabled()
            for _ in range(7):p.get_by_role('button',name='Zoom shelf in',exact=True).click()
            self.assertGreater(int(p.locator('[aria-label="Shelf zoom level"]').inner_text()[:-1]),int(initial[:-1]));self.assertTrue(p.locator('.readonly-shelf-viewport').evaluate('(v)=>v.scrollHeight>v.clientHeight||v.scrollWidth>v.clientWidth'))
            p.locator('.readonly-bin').last.hover();expect(p.locator('.bin-tooltip')).to_contain_text('Select to view inventory');expect(p.locator('.bin-tooltip')).to_be_visible()
            p.get_by_role('button',name='Fit shelf',exact=True).click();fits();p.set_viewport_size({'width':390,'height':844});fits();p.locator('.readonly-bin').last.focus();expect(p.locator('.bin-tooltip')).to_be_visible()
            self.assertEqual((self.data/'shelves/R01.json').read_bytes(),before)
            p.set_viewport_size({'width':1440,'height':1000})
            if not direct:p.locator('#closeExplorer').click();expect(p.locator('#explorerPanel')).not_to_be_visible()

if __name__=='__main__':unittest.main()
