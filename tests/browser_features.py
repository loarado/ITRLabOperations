"""Feature and regression browser checks against isolated fixture data."""
import json, shutil, sys, tempfile, threading, unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from lab_server import ROOT, LabServer, blank_shelf, write_json
from playwright.sync_api import sync_playwright, expect

class Features(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.data=Path(self.temp.name)/'data';(self.data/'shelves').mkdir(parents=True)
        shutil.copy(ROOT/'defaults/lab.json',self.data/'lab.json')
        for item in json.loads((self.data/'lab.json').read_text())['items']:
            if item['kind']=='shelf':write_json(self.data/'shelves'/f"{item['id']}.json",blank_shelf(item['id']))
        self.server=LabServer(('127.0.0.1',0),self.data,'itr');self.thread=threading.Thread(target=self.server.serve_forever,daemon=True);self.thread.start()
        self.p=sync_playwright().start();self.browser=self.p.chromium.launch();self.context=self.browser.new_context(viewport={'width':1440,'height':1000});self.page=self.context.new_page();self.errors=[]
        self.page.on('pageerror',lambda e:self.errors.append(str(e)));self.page.on('console',lambda m:self.errors.append(m.text) if m.type=='error' else None);self.url=f'http://127.0.0.1:{self.server.server_port}'
        self.page.goto(self.url);self.page.wait_for_function('typeof lab!=="undefined" && lab.data!==null')
    def tearDown(self):
        self.browser.close();self.p.stop();self.server.shutdown();self.server.server_close();self.thread.join();self.temp.cleanup();self.assertEqual(self.errors,[])
    def login(self):
        self.page.locator('#auth').click();self.page.locator('#password').fill('itr');self.page.get_by_role('button',name='Sign in',exact=True).click();self.page.wait_for_function('isAdmin')
    def save(self,name='Verified layout'):
        self.page.locator('#save').click();self.page.locator('#versionName').fill(name);self.page.locator('#saveVersionDialog button[value="save"]').click();expect(self.page.locator('#status')).to_contain_text('Saved “')
    def test_complete_modes_workflow(self):
        page=self.page;expect(page.locator('h1')).to_have_text('Lab Explorer')
        for control in ['sectionsVisible','routes']:
            page.locator('#'+control).uncheck();page.locator('#'+control).check()
        page.locator('#plan [data-section-id="Z10"]').click();expect(page.locator('#explorerContent')).to_contain_text('Room 1');page.locator('#closeExplorer').click();expect(page.locator('#explorerPanel')).not_to_be_visible()
        self.login();page.locator('#newKind').select_option('table');page.locator('#add').click();page.locator('#name').fill('Workflow table');page.locator('#name').press('Tab')
        page.locator('#newKind').select_option('shelf');page.locator('#add').click();shelf_id=page.evaluate('selected().id');self.save('Workflow items');page.locator('#openShelf').click();page.wait_for_function('typeof shelf!=="undefined" && shelf.data!==null')
        page.locator('#shelfName').fill('Assembly store');page.locator('#shelfName').press('Tab');page.locator('#shelfContents').fill('Workflow components');page.locator('#shelfContents').press('Tab');self.save('Simple inventory')
        page.locator('#shelfMode').select_option('complex');page.locator('#applyShelfMode').click();page.get_by_role('button',name='Empty cell, row 1, column 1',exact=True).click();page.locator('#addBin').click();page.locator('#name').fill('Workflow bolts');page.locator('#name').press('Tab');page.locator('#shelfKeywords').fill('workflow-bins');page.locator('#shelfKeywords').press('Tab');self.save('Detailed inventory')
        page.locator('#back').click();page.wait_for_function('typeof lab!=="undefined" && lab.data!==null');page.locator('#search').fill('workflow-bins');expect(page.locator(f'#directory [data-item-id="{shelf_id}"]')).to_have_count(1);page.locator('#search').fill('')
        page.locator('#mapMode').click();page.locator('[data-vertex="1"]').click();page.keyboard.press('ArrowLeft');page.locator('#mapSectionsDirectory [data-section-id="Z01"]').click();page.locator('#name').fill('Robotics workshop');page.locator('#name').press('Tab');page.locator('#background').fill('#aaddaa');page.locator('#background').dispatch_event('change');page.locator('#routeDirectory button').first.click();page.locator('#routePoints').fill('38, 2\n38, 12');page.locator('#applyRoute').click();self.save('Workflow map')
        saved=json.loads((self.data/'lab.json').read_text());self.assertEqual(saved['outline'][1],[36,18]);self.assertEqual(saved['routes'][0],[[38,2],[38,12]])
        page.locator('#mapMode').click();before=page.evaluate('JSON.stringify(lab.data)');page.evaluate('moveVertex(1,0);moveRoute(1,0)');self.assertEqual(page.evaluate('JSON.stringify(lab.data)'),before);expect(page.locator('.outline-vertex')).to_have_count(0)
        page.locator('#auth').click();page.wait_for_function('!isAdmin');expect(page.locator('h1')).to_have_text('Lab Explorer');expect(page.locator('aside')).to_be_hidden();self.assertEqual(page.evaluate('lab.data.outline[1]'),[36,18]);page.locator('#search').fill('workflow-bins');expect(page.locator('#explorerResults button')).to_have_count(1);page.locator('#explorerResults button').click();expect(page.locator('#explorerContent')).to_contain_text('Workflow bolts');page.locator('#closeExplorer').click();expect(page.locator('#explorerPanel')).not_to_be_visible();page.locator('#search').fill('')
        page.locator('#plan [data-section-id="Z01"]').focus();page.keyboard.press('Enter');expect(page.locator('#explorerContent')).to_contain_text('Robotics workshop')

    def test_responsive_polish(self):
        page=self.page;page.screenshot(path='/tmp/itr-explorer-desktop.png',full_page=True)
        for width in [1440,768,390]:
            page.set_viewport_size({'width':width,'height':900});self.assertTrue(page.evaluate('document.documentElement.scrollWidth<=innerWidth'))
            expect(page.locator('#auth')).to_be_visible();page.locator('#search').fill('Computer shelf 1');expect(page.locator('#explorerResults button')).to_have_count(1);page.locator('#explorerResults button').click();expect(page.locator('#explorerPanel')).to_be_visible();self.assertLessEqual(page.locator('#explorerPanel').bounding_box()['width'],width);page.locator('#closeExplorer').click();expect(page.locator('#explorerPanel')).not_to_be_visible()
        page.screenshot(path='/tmp/itr-explorer-mobile.png',full_page=True);page.locator('#search').fill('');self.login();self.assertTrue(page.evaluate('document.documentElement.scrollWidth<=innerWidth'));page.set_viewport_size({'width':1440,'height':1000});page.screenshot(path='/tmp/itr-admin-desktop.png',full_page=True)
        page.locator('#mapMode').click();page.locator('[data-vertex="1"]').click();page.screenshot(path='/tmp/itr-map-editor.png',full_page=True)

    def test_themes(self):
        page=self.page;before=page.evaluate('JSON.stringify(lab.data)');red=page.locator('body').evaluate('(el)=>getComputedStyle(el).backgroundColor');self.assertEqual(red,'rgb(24, 15, 20)')
        item=page.locator('[data-id="R01"]').evaluate('(el)=>getComputedStyle(el).backgroundColor')
        self.login();blue=page.locator('body').evaluate('(el)=>getComputedStyle(el).backgroundColor');self.assertNotEqual(blue,red);self.assertEqual(page.locator('[data-id="R01"]').evaluate('(el)=>getComputedStyle(el).backgroundColor'),item)
        page.locator('#mapMode').click();self.assertEqual(page.locator('body').evaluate('(el)=>getComputedStyle(el).backgroundColor'),blue);page.locator('#mapMode').click();page.locator('#auth').click();page.wait_for_function('!isAdmin');self.assertEqual(page.locator('body').evaluate('(el)=>getComputedStyle(el).backgroundColor'),red);self.assertEqual(page.evaluate('JSON.stringify(lab.data)'),before)

    def test_explorer_sections(self):
        page=self.page;before=page.evaluate('JSON.stringify(lab.data)')
        page.locator('#plan [data-section-id="Z10"]').click();expect(page.locator('#explorerContent')).to_contain_text('Room 1');expect(page.locator('#explorerContent')).to_contain_text('No access');page.keyboard.press('Escape');expect(page.locator('#explorerPanel')).not_to_be_visible()
        page.locator('#sectionsVisible').uncheck();expect(page.locator('#plan [data-section-id]')).to_have_count(0);page.locator('#sectionsVisible').check()
        page.locator('#plan [data-section-id="Z09"]').focus();page.keyboard.press('Enter');expect(page.locator('#explorerContent')).to_contain_text('Office');page.locator('#closeExplorer').click();expect(page.locator('#explorerPanel')).not_to_be_visible();self.assertEqual(page.evaluate('JSON.stringify(lab.data)'),before)

    def test_explorer_shelves(self):
        simple=json.loads((self.data/'shelves/R01.json').read_text());simple.update(name='Hardware',contents='Washers',keywords='threaded');write_json(self.data/'shelves/R01.json',simple)
        complex=json.loads((self.data/'shelves/R02.json').read_text());complex['mode']='complex';complex['matrix'][0][0]={'name':'M3 bolts','contents':'Steel','keywords':'metric','w':2,'h':2,'background':'#dc4545','color':'#ffffff','fontSize':14,'fontFamily':'system-ui','bold':True};write_json(self.data/'shelves/R02.json',complex)
        page=self.page;page.evaluate('refreshShelfIndex()');before=page.evaluate('JSON.stringify(lab.data)');page.locator('[data-id="R01"]').click();expect(page.locator('#explorerPanel')).to_be_visible();expect(page.locator('#explorerContent')).to_contain_text('Washers');expect(page.locator('#explorerContent input')).to_have_count(0)
        page.locator('#closeExplorer').click();expect(page.locator('#explorerPanel')).not_to_be_visible();page.locator('[data-id="R02"]').click();expect(page.locator('#explorerContent')).to_contain_text('M3 bolts');expect(page.locator('#explorerContent .bin-card')).to_have_count(0);page.keyboard.press('Escape');expect(page.locator('#explorerPanel')).not_to_be_visible();self.assertEqual(page.evaluate('JSON.stringify(lab.data)'),before)
        page.locator('#search').fill('M3 bolts');expect(page.locator('#explorerResults button')).to_have_count(1);page.locator('#explorerResults button').click();expect(page.locator('#explorerContent')).to_contain_text('M3 bolts')

    def test_explorer_layout(self):
        page=self.page;expect(page.locator('h1')).to_have_text('Lab Explorer');expect(page.locator('#access')).to_have_text('View Only');expect(page.locator('#auth')).to_be_visible()
        for selector in ['aside','#versionHistory','#save','#mapMode']:
            expect(page.locator(selector)).to_be_hidden()
        self.login();expect(page.locator('h1')).to_have_text('Lab Editor');expect(page.locator('aside')).to_be_visible();expect(page.locator('#export')).to_be_visible()
        before=page.evaluate('JSON.stringify(lab.data)');page.locator('#auth').click();page.wait_for_function('!isAdmin');expect(page.locator('h1')).to_have_text('Lab Explorer');self.assertEqual(page.evaluate('JSON.stringify(lab.data)'),before)

    def test_shelf_search(self):
        self.login()
        simple=json.loads((self.data/'shelves/R01.json').read_text());simple.update(name='Hardware cupboard',contents='Washers',keywords='threaded');write_json(self.data/'shelves/R01.json',simple)
        complex=json.loads((self.data/'shelves/R02.json').read_text());complex.update(mode='complex',name='Precision parts',contents='Assembly stock',keywords='robotics')
        complex['matrix'][0][0]={'name':'M3 bolts','contents':'Stainless fasteners','keywords':'metric','w':2,'h':2,'background':'#dc4545','color':'#ffffff','fontSize':14,'fontFamily':'system-ui','bold':True};write_json(self.data/'shelves/R02.json',complex)
        page=self.page;page.evaluate('refreshShelfIndex()')
        for query,id in [('hardware','R01'),('WASHERS','R01'),('thread','R01'),('precision','R02'),('assembly','R02'),('robotics','R02'),('M3 bolts','R02')]:
            page.locator('#search').fill(query);expect(page.locator(f'#directory [data-item-id="{id}"]')).to_have_count(1)
        page.locator('#search').fill('Fastener table');expect(page.locator('#directory [data-item-id="F06"]')).to_have_count(1)
        self.assertFalse(page.evaluate('dirty'))

    def test_complex_mode_preserves(self):
        self.login();page=self.page;page.locator('[data-id="R01"]').click();page.locator('#openShelf').click();page.wait_for_function('typeof shelf!=="undefined" && shelf.data!==null')
        page.locator('#shelfName').fill('Hardware');page.locator('#shelfName').press('Tab');page.locator('#shelfMode').select_option('complex');expect(page.locator('.shelf-viewport')).to_be_visible();expect(page.locator('.shelf-bin')).to_have_count(0);page.locator('#applyShelfMode').click();expect(page.locator('.shelf-viewport')).to_be_visible()
        page.get_by_role('button',name='Empty cell, row 1, column 1',exact=True).click();page.locator('#addBin').click();page.locator('#name').fill('M3 bolts');page.locator('#name').press('Tab')
        matrix=page.evaluate('JSON.stringify(shelf.data.matrix)')
        page.locator('#shelfMode').select_option('simple');page.locator('#applyShelfMode').click();expect(page.locator('.shelf-viewport')).to_be_visible();expect(page.locator('.shelf-bin')).to_have_count(0);self.save('Simple with retained bins');page.reload();page.wait_for_function('typeof shelf!=="undefined" && shelf.data!==null');self.assertEqual(page.evaluate('JSON.stringify(shelf.data.matrix)'),matrix)
        page.locator('#shelfMode').select_option('complex');page.locator('#applyShelfMode').click();self.save('Complex shelf');page.reload();page.wait_for_function('typeof shelf!=="undefined" && shelf.data!==null')
        expect(page.locator('#shelfName')).to_have_value('Hardware');self.assertEqual(page.evaluate('JSON.stringify(shelf.data.matrix)'),matrix);self.assertEqual(page.evaluate('shelf.data.mode'),'complex')
        saved=json.loads((self.data/'shelves/R01.json').read_text());self.assertNotIn('keywords',saved['matrix'][0][0]);self.assertEqual(saved['matrix'][0][0]['name'],'M3 bolts')

    def test_simple_shelf(self):
        self.login();page=self.page;page.locator('[data-id="R01"]').click();page.locator('#openShelf').click();page.wait_for_function('typeof shelf!=="undefined" && shelf.data!==null')
        expect(page.locator('.shelf-viewport')).to_be_visible();expect(page.locator('.shelf-bin')).to_have_count(0);self.assertEqual(page.evaluate('shelf.data.mode'),'simple')
        page.locator('#shelfName').fill('Fasteners');page.locator('#shelfName').press('Tab');page.locator('#shelfContents').fill('Bolts and washers');page.locator('#shelfContents').press('Tab');page.locator('#shelfKeywords').fill('hardware');page.locator('#shelfKeywords').press('Tab');self.save('Simple shelf')
        page.reload();page.wait_for_function('typeof shelf!=="undefined" && shelf.data!==null');expect(page.locator('#shelfName')).to_have_value('Fasteners');expect(page.locator('#shelfContents')).to_have_value('Bolts and washers');expect(page.locator('#shelfKeywords')).to_have_value('hardware')
        saved=json.loads((self.data/'shelves/R01.json').read_text());self.assertEqual(saved['mode'],'simple');self.assertEqual(saved['name'],'Fasteners')

    def test_outline_delete(self):
        self.login();page=self.page;page.locator('#mapMode').click();page.locator('[data-vertex="1"]').click();count=page.evaluate('lab.data.outline.length');page.keyboard.press('Delete');self.assertEqual(page.evaluate('lab.data.outline.length'),count-1)
        page.locator('#outline').fill('0, 0\n20, 0\n20, 20');page.locator('#applyOutline').click();self.assertEqual(page.evaluate('lab.data.outline.length'),3)
        page.locator('[data-vertex="1"]').click();page.locator('#deleteVertex').click();expect(page.locator('#status')).to_contain_text('at least three');self.assertEqual(page.evaluate('lab.data.outline.length'),3)
        page.locator('#insertVertex').click();self.assertEqual(page.evaluate('lab.data.outline.length'),4)
        page.locator('#mapMode').click();page.evaluate('deleteVertex()');self.assertEqual(page.evaluate('lab.data.outline.length'),4)

    def test_outline_keyboard(self):
        self.login();page=self.page;page.locator('#mapMode').click();page.locator('[data-vertex="1"]').click();page.keyboard.press('ArrowLeft')
        self.assertEqual(page.evaluate('lab.data.outline[1]'),[36,18]);expect(page.locator('#vertexX')).to_have_value('36')
        page.locator('#vertexX').fill('35');page.locator('#vertexX').press('Tab');self.assertEqual(page.evaluate('lab.data.outline[1]'),[35,18])
        before=page.evaluate('JSON.stringify(lab.data.outline)');page.locator('#outline').focus();page.keyboard.press('ArrowDown');self.assertEqual(page.evaluate('JSON.stringify(lab.data.outline)'),before)
        page.locator('#mapMode').click();page.keyboard.press('ArrowRight');self.assertEqual(page.evaluate('JSON.stringify(lab.data.outline)'),before)

    def test_outline_drag(self):
        self.login();page=self.page;page.locator('#mapMode').click();rect=page.locator('#plan').bounding_box();point=page.locator('[data-vertex="1"]').bounding_box()
        x=point['x']+point['width']/2;y=point['y']+point['height']/2
        page.mouse.move(x,y);page.mouse.down();page.mouse.move(x-rect['width']/100,y,steps=6);page.mouse.up()
        self.assertEqual(page.evaluate('lab.data.outline[1]'),[36,18]);self.assertIn('36, 18',page.locator('#outline').input_value())
        self.save();self.assertEqual(json.loads((self.data/'lab.json').read_text())['outline'][1],[36,18])
        page.locator('#mapMode').click();before=page.evaluate('JSON.stringify(lab.data.outline)');page.evaluate('commitOutline([[1,1],[2,1],[2,2]])');self.assertEqual(page.evaluate('JSON.stringify(lab.data.outline)'),before)

    def test_outline_selection(self):
        self.login();page=self.page;expect(page.locator('.outline-vertex')).to_have_count(0)
        page.locator('#mapMode').click();self.assertEqual(page.locator('.outline-vertex').count(),page.evaluate('lab.data.outline.length'))
        page.locator('[data-vertex="0"]').click();expect(page.locator('.outline-vertex.chosen')).to_have_count(1);expect(page.locator('#selectedPoint')).to_contain_text('Point 1:')
        page.locator('[data-vertex="1"]').click();expect(page.locator('.outline-vertex.chosen')).to_have_count(1);expect(page.locator('#selectedPoint')).to_contain_text('Point 2:')
        page.locator('#mapMode').click();expect(page.locator('.outline-vertex')).to_have_count(0)

    def test_map_sections_arrows(self):
        self.login();page=self.page;before=page.evaluate('lab.data.items.length')
        expect(page.locator('#newKind option[value="section"]')).to_have_count(0)
        page.locator('#mapMode').click();page.locator('#addSection').click()
        self.assertEqual(page.evaluate('selected().kind'),'section')
        page.locator('#name').fill('Test section');page.locator('#name').press('Tab')
        page.locator('#background').fill('#88ffaa');page.locator('#background').dispatch_event('change')
        self.assertEqual(page.evaluate('selected().background'),'#88ffaa')
        page.locator('#delete').click();self.assertEqual(page.evaluate('lab.data.items.length'),before)
        count=page.evaluate('lab.data.routes.length');page.locator('#addRoute').click();self.assertEqual(page.evaluate('lab.data.routes.length'),count+1)
        page.locator('#deleteRoute').click();self.assertEqual(page.evaluate('lab.data.routes.length'),count)
        page.locator('#mapMode').click();before=page.evaluate('JSON.stringify(lab.data)')
        page.evaluate("addLabItem('section');chooseRoute(0);moveRoute(1,0)");self.assertEqual(page.evaluate('JSON.stringify(lab.data)'),before)

    def test_map_mode(self):
        self.login();page=self.page;before=page.evaluate('JSON.stringify(lab.data)')
        expect(page.locator('#mapPanel')).to_be_hidden();expect(page.locator('.route-hit')).to_have_count(0)
        page.evaluate('chooseRoute(0);moveRoute(1,0)');self.assertEqual(page.evaluate('JSON.stringify(lab.data)'),before)
        page.locator('#mapMode').click();expect(page.locator('#mapPanel')).to_be_visible();expect(page.locator('#addPanel')).to_be_hidden();expect(page.locator('#directoryPanel')).to_be_hidden()
        self.assertGreater(page.locator('.route-hit').count(),0)
        page.locator('#mapMode').click();expect(page.locator('#addPanel')).to_be_visible();expect(page.locator('.route-hit')).to_have_count(0)
        page.locator('[data-id="R01"]').click();expect(page.locator('#details')).to_be_visible()
        self.assertEqual(page.evaluate('JSON.stringify(lab.data)'),before)

    def test_editor_collapses(self):
        self.login();page=self.page
        page.locator('#group-addPanel').click();expect(page.locator('#group-addPanel')).to_have_attribute('aria-expanded','false')
        self.assertTrue(page.locator('#addPanel .group-content').first.evaluate('(el)=>el.inert'))
        expect(page.locator('#group-directoryPanel')).to_have_attribute('aria-expanded','true')
        page.locator('#group-addPanel').click();page.locator('#add').click();self.assertIsNotNone(page.evaluate('selected()'))

    def test_add_top(self):
        self.login();page=self.page
        self.assertLess(page.locator('#addPanel').bounding_box()['y'],page.locator('#empty').bounding_box()['y'])
        count=page.evaluate('lab.data.items.length')
        for kind in ['shelf','table','cart','machine','wall','text']:
            page.locator('#newKind').select_option(kind);page.locator('#add').click()
            self.assertEqual(page.evaluate('selected().kind'),kind)
        self.assertEqual(page.evaluate('lab.data.items.length'),count+6)
        self.assertEqual(json.loads((self.data/'lab.json').read_text())['revision'],0)

    def test_sections_separate(self):
        expect(self.page.locator('#directory [data-group="items-section"]')).to_have_count(0)
        expect(self.page.locator('#mapSectionsDirectory button')).to_have_count(13)
        self.assertEqual(self.page.evaluate("lab.data.items.filter(i=>i.kind==='section').length"),13)

    def test_directory_groups(self):
        self.login();page=self.page
        self.assertGreater(page.locator('#directory .editor-group').count(),3)
        shelf=page.locator('#group-items-shelf');table=page.locator('#group-items-table')
        shelf.click();expect(shelf).to_have_attribute('aria-expanded','false');expect(table).to_have_attribute('aria-expanded','true')
        page.locator('#search').fill('Computer shelf 1');expect(page.locator('#directory .directory-item')).to_have_count(1)
        expect(page.locator('#group-items-shelf')).to_have_attribute('aria-expanded','true')
        page.locator('#search').fill('');expect(page.locator('#group-items-shelf')).to_have_attribute('aria-expanded','false')
        self.assertFalse(page.evaluate('dirty'))

    def test_map_editor_name(self):
        self.assertGreater(self.page.get_by_text('Lab Map Editor',exact=True).count(),0)
        self.assertNotIn('Lab footprint',self.page.locator('body').inner_text())

    def test_visibility(self):
        page=self.page;before=page.evaluate('JSON.stringify(lab.data)');n=page.locator('.grid-item.section').count();self.assertGreater(n,0)
        page.locator('#sectionsVisible').uncheck();expect(page.locator('.grid-item.section')).to_have_count(0);self.assertGreater(page.locator('.traffic-layer').count(),0)
        page.locator('#routes').uncheck();expect(page.locator('.traffic-layer')).to_have_count(0)
        page.locator('#sectionsVisible').check();expect(page.locator('.grid-item.section')).to_have_count(n);expect(page.locator('.traffic-layer')).to_have_count(0)
        page.locator('#routes').check();self.assertEqual(page.evaluate('JSON.stringify(lab.data)'),before);self.assertFalse(page.evaluate('dirty'))

if __name__=='__main__':unittest.main()
