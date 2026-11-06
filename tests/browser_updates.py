"""Incremental acceptance checks, using disposable data and real Chromium."""
import json, unittest
from browser_features import Features
from playwright.sync_api import expect

class Updates(Features):
    def test_project_readiness_guidance_is_live_and_nonblocking(self):
        p=self.page;p.goto(self.url+'/project_dashboard.html')
        expect(p.locator('#projectReadiness')).to_be_visible()
        expect(p.locator('#readinessRequired .pending')).to_have_count(4)
        expect(p.locator('#readinessRecommended')).to_contain_text('Purchase items can wait')
        for selector,value in [('#project-title','Robot arm'),('#project-lead','Ada'),('#project-contact','ada@example.test'),('#project-description','A test request with a clear enough description for a reviewer.'),('#estimate-amount','125'),('#estimate-basis','Comparable parts and shipping.')]:
            p.locator(selector).fill(value)
        expect(p.locator('#readinessRequired .ready')).to_have_count(4)
        p.locator('#project-stage').select_option('planned')
        expect(p.locator('#readinessRecommended')).to_contain_text('Add a purchase list')
        p.locator('#project-stage').select_option('procurement-ready')
        expect(p.locator('#readinessRequired')).to_contain_text('At least one complete purchase item')
        expect(p.locator('#readinessRequired .pending')).to_have_count(1)
        p.locator('#addItem').click()
        expect(p.locator('#readinessRequired .pending')).to_have_count(1)
        p.locator('.item-name').fill('Servo')
        p.locator('.item-price').fill('25')
        expect(p.locator('#readinessRequired .ready')).to_have_count(5)
        expect(p.locator('#readinessRecommended')).to_contain_text('For every purchase item')
        p.locator('.item-specification').fill('High torque servo')
        p.locator('.item-vendor').fill('Example vendor')
        expect(p.locator('#readinessRecommended .ready')).to_have_count(2)

    def test_selection_context(self):
        self.login();p=self.page;p.locator('#mapMode').click();p.locator('[data-vertex="1"]').click();outline=p.evaluate('JSON.stringify(lab.data.outline)');p.locator('#addSection').click();self.assertIsNone(p.evaluate('selectedVertex'));self.assertIsNone(p.evaluate('selectedGeometry'));x=p.evaluate('selected().x');p.locator('#plan .section.selected').focus();p.keyboard.press('ArrowRight');self.assertEqual(p.evaluate('selected().x'),x+1);self.assertEqual(p.evaluate('JSON.stringify(lab.data.outline)'),outline)
        p.locator('#addWall').click();count=p.evaluate('lab.data.items.length');p.locator('#wallDirectory button').first.focus();p.keyboard.press('Control+c');p.keyboard.press('Control+v');self.assertEqual(p.evaluate('lab.data.items.length'),count)
        p.locator('#addSection').click();self.assertIsNone(p.evaluate('selectedGeometry'));p.locator('#addRoute').click();self.assertIsNone(p.evaluate('selectedId'));self.assertIsNone(p.evaluate('selectedVertex'));self.assertIsNone(p.evaluate('selectedGeometry'))

    def test_workflow_a_inventory_versions_and_undo(self):
        self.login();p=self.page;p.locator('[data-id="R01"]').click();p.locator('#openShelf').click();p.wait_for_function('typeof shelf!=="undefined" && shelf.data!==null')
        p.locator('#shelfMode').select_option('complex');p.locator('#applyShelfMode').click();p.locator('#rows').fill('6');p.locator('#cols').fill('8');p.locator('#resize').click()
        for key,val in [('shelfName','Workflow inventory'),('shelfContents','Assembly parts'),('shelfKeywords','robotics')]:p.locator('#'+key).fill(val);p.locator('#'+key).press('Tab')
        for col,w,h,name in [(0,'2','2','Whole bin'),(3,'1.5','2','Half bin')]:
            p.evaluate('(c)=>choose(0,c)',col);p.locator('#addBin').click()
            for key,val in [('w',w),('h',h),('name',name)]:p.locator('#'+key).fill(val);p.locator('#'+key).press('Tab')
        p.locator('#y').fill('1.5');p.locator('#y').press('Tab');p.locator('.shelf-bin.selected').focus();p.keyboard.press('Control+c');p.keyboard.press('Control+v');p.wait_for_function('bins().length===3');p.locator('#name').fill('Copied fasteners');p.locator('#name').press('Tab');matrix=p.evaluate('JSON.stringify(shelf.data.matrix)');self.save('Shelf workflow')
        p.reload();p.wait_for_function('typeof shelf!=="undefined" && shelf.data!==null');self.assertEqual(p.evaluate('JSON.stringify(shelf.data.matrix)'),matrix);p.locator('#back').click();p.wait_for_function('typeof lab!=="undefined" && lab.data!==null');self.save('Lab workflow');p.locator('#auth').click();p.wait_for_function('!isAdmin');p.locator('[data-id="R01"]').click();expect(p.locator('.readonly-bin')).to_have_count(3)
        for el in p.locator('.readonly-bin').all():el.hover();expect(p.locator('.bin-tooltip')).to_be_visible();expect(p.locator('.bin-tooltip')).to_contain_text('Select to view inventory')
        p.locator('#closeExplorer').click();expect(p.locator('#explorerPanel')).not_to_be_visible();self.login();p.locator('[data-id="R01"]').click();p.locator('#openShelf').click();p.wait_for_function('typeof shelf!=="undefined" && shelf.data!==null');self.assertEqual(p.evaluate('JSON.stringify(shelf.data.matrix)'),matrix);p.locator('#shelfName').fill('Later inventory');p.locator('#shelfName').press('Tab');self.save('Later inventory');p.locator('#back').click();p.wait_for_function('typeof lab!=="undefined" && lab.data!==null')
        p.locator('#versionHistory').click();p.locator('#historyVersions').select_option('2');p.locator('#restoreVersion').click();expect(p.locator('#historyDialog')).not_to_be_visible();p.wait_for_function('shelfIndex.R01.name==="Workflow inventory"')
        p.locator('#versionHistory').focus();p.keyboard.press('Control+z');p.evaluate('cacheDraft()');p.wait_for_function('shelfIndex.R01.name==="Later inventory"');p.keyboard.press('Control+Shift+z');p.evaluate('cacheDraft()');p.wait_for_function('shelfIndex.R01.name==="Workflow inventory"');self.save('Restored inventory');self.assertNotIn('_inventoryState',json.loads((self.data/'lab.json').read_text()))

    def test_workflow_c_map_geometry(self):
        self.login();p=self.page;p.evaluate("()=>{lab.data.items=[{...defaults(),id:'t1',kind:'table',name:'Movable table',x:10,y:15,w:2,h:2,locked:false}];lab.data.outline=[[0,0],[100,0],[100,48],[0,48]];lab.data.routes=[];render();}");p.locator('#mapMode').click()
        for key,val in [('wallAX','20'),('wallAY','5'),('wallBX','20'),('wallBY','40')]:p.locator('#'+key).fill(val)
        p.locator('#addWall').click()
        for key,val in [('wallAX','65'),('wallAY','5'),('wallBX','80'),('wallBY','5')]:p.locator('#'+key).fill(val)
        p.locator('#addWall').click()
        for index,orientation in enumerate(('SE','NW','NE','SW')):
            for key,val in [('doorX',str(30 if index==0 else 55+index*8)),('doorY','14'),('doorRadius','4')]:p.locator('#'+key).fill(val)
            p.locator('#doorOrientation').select_option(orientation);p.locator('#addDoor').click()
        self.save('Walls and doors');p.locator('#mapMode').click();expect(p.locator('.geometry-hit')).to_have_count(0)
        for x,valid in [(24,True),(20,False),(36,True),(32,False)]:
            before=p.evaluate('lab.data.items[0].x');rect=p.locator('#plan').bounding_box();el=p.locator('[data-id="t1"]');el.scroll_into_view_if_needed();box=el.bounding_box();sx=box['x']+box['width']/2;sy=box['y']+box['height']/2;p.mouse.move(sx,sy);p.mouse.down();p.mouse.move(sx+(x-before)*rect['width']/100,sy);p.mouse.up();self.assertEqual(p.evaluate('lab.data.items[0].x'),x if valid else before)
        self.save('Safe placement');p.locator('#auth').click();p.wait_for_function('!isAdmin');p.reload();expect(p.locator('[data-wall]')).to_have_count(2);expect(p.locator('[data-door]')).to_have_count(4);expect(p.locator('.geometry-hit')).to_have_count(0)

    def test_delete_point_style(self):
        self.login();p=self.page;p.locator('#mapMode').click();expect(p.locator('#deleteVertex')).to_be_disabled();disabled=p.locator('#deleteVertex').evaluate('(e)=>getComputedStyle(e).backgroundColor');p.locator('[data-vertex="1"]').click();p.locator('#deleteVertex').hover();self.assertEqual(p.locator('#deleteVertex').evaluate('(e)=>getComputedStyle(e).backgroundColor'),'rgb(146, 26, 43)');self.assertEqual(p.locator('#deleteVertex').evaluate('(e)=>getComputedStyle(e).color'),'rgb(255, 255, 255)');self.assertNotEqual(disabled,'rgb(146, 26, 43)');count=p.evaluate('lab.data.outline.length');p.locator('#deleteVertex').click();self.assertEqual(p.evaluate('lab.data.outline.length'),count-1)

    def test_wall_door_collisions(self):
        self.login();p=self.page
        p.evaluate("()=>{lab.data.items=[{...defaults(),id:'t1',kind:'table',name:'Table',x:10,y:15,w:2,h:2,locked:false}];lab.data.outline=[[0,0],[100,0],[100,48],[0,48]];lab.data.walls=[{id:'w1',a:[20,5],b:[20,40],thickness:.3}];lab.data.doors=[{id:'d1',x:30,y:14,radius:4,orientation:'SE'}];render();setZoom(.75);}")
        def drag_to(x,y,valid):
            before=p.evaluate('clone(lab.data.items[0])');box=p.locator('#plan').bounding_box();el=p.locator('[data-id="t1"]');el.scroll_into_view_if_needed();item=el.bounding_box();sx=item['x']+item['width']/2;sy=item['y']+item['height']/2;p.mouse.move(sx,sy);p.mouse.down();p.mouse.move(sx+(x-before['x'])*box['width']/100,sy+(y-before['y'])*box['height']/48)
            self.assertNotEqual(el.evaluate('(e)=>e.style.transform'),'');p.mouse.up();self.assertEqual(p.evaluate('[lab.data.items[0].x,lab.data.items[0].y]'),[x,y] if valid else [before['x'],before['y']])
        drag_to(24,15,True);drag_to(20,15,False);drag_to(36,15,True);drag_to(32,15,False)
        # Exact rectangle/segment and quarter-disk geometry, including all quadrants.
        self.assertTrue(p.evaluate('wallIntersectsRectangle({a:[1,1],b:[5,5],thickness:.3},{x:3,y:3,w:1,h:1})'))
        self.assertFalse(p.evaluate('wallIntersectsRectangle({a:[1,1],b:[5,5],thickness:.3},{x:1,y:4,w:1,h:1})'))
        for orientation in ('NW','NE','SW','SE'):
            self.assertTrue(p.evaluate('(o)=>{const d={x:10,y:10,radius:4,orientation:o},[sx,sy]=doorSigns(d);return doorIntersectsRectangle(d,{x:sx>0?11:8,y:sy>0?11:8,w:1,h:1});}',orientation))
            self.assertFalse(p.evaluate('(o)=>{const d={x:10,y:10,radius:4,orientation:o},[sx,sy]=doorSigns(d);return doorIntersectsRectangle(d,{x:sx>0?13.5:5.5,y:sy>0?13.5:5.5,w:1,h:1});}',orientation))
        p.evaluate("()=>{lab.data.items[0].x=19;lab.data.items[0].y=42;lab.data.walls[0]={id:'w1',a:[20,40],b:[20,48],thickness:.3};choose('t1');}")
        p.locator('[data-id="t1"]').focus();p.keyboard.press('Control+c');p.keyboard.press('Control+v');p.wait_for_function('lab.data.items.length===2');self.assertTrue(p.evaluate('validPosition(selected())'));self.assertTrue(p.evaluate('clearOfMapGeometry(selected(),lab.data)'));self.save('Validated placement')

    def test_doors(self):
        self.login();p=self.page;p.locator('#mapMode').click()
        for index,orientation in enumerate(('NW','NE','SW','SE')):
            p.locator('#doorX').fill(str(42+index*6));p.locator('#doorOrientation').select_option(orientation);p.locator('#addDoor').click();self.assertEqual(p.evaluate('lab.data.doors.length'),index+1)
        self.assertEqual(p.locator('[data-door]').count(),4);self.assertEqual(len(set(p.locator('[data-door]>path:first-child').evaluate_all('(els)=>els.map(e=>e.getAttribute("d"))'))),4)
        p.locator('#zoomOut').click();p.locator('[data-door] .geometry-hit').last.focus();p.keyboard.press('ArrowDown');self.assertEqual(p.evaluate('lab.data.doors[3].y'),25)
        p.locator('#doorRadius').fill('4');p.locator('#doorOrientation').select_option('NE');p.locator('#applyDoor').click();self.assertEqual(p.evaluate('lab.data.doors[3].radius'),4)
        box=p.locator('#plan').bounding_box();p.mouse.move(box['x']+62*box['width']/100,box['y']+24*box['height']/48);p.mouse.down();p.mouse.move(box['x']+64*box['width']/100,box['y']+24*box['height']/48);p.mouse.up();self.assertEqual(p.evaluate('lab.data.doors[3].x'),62)
        self.save('Four doors');p.locator('#mapMode').click();expect(p.locator('.door-hit')).to_have_count(0);p.locator('#auth').click();p.wait_for_function('!isAdmin');p.reload();expect(p.locator('[data-door]')).to_have_count(4);expect(p.locator('.door-hit')).to_have_count(0)
        self.login();p.locator('#mapMode').click();p.locator('#doorDirectory button').last.click();p.locator('#deleteDoor').click();self.save('Door removed');p.reload();expect(p.locator('[data-door]')).to_have_count(3)

    def test_walls(self):
        self.login();p=self.page;p.locator('#mapMode').click();p.locator('#addWall').click();self.assertEqual(p.evaluate('lab.data.walls.length'),1);wid=p.evaluate('lab.data.walls[0].id');expect(p.locator('[data-wall] .geometry-handle')).to_have_count(2)
        p.locator('#wallBX').fill('52');p.locator('#applyWall').click();self.assertEqual(p.evaluate('lab.data.walls[0].b'),[52,24])
        p.locator('#zoomOut').click();p.locator('[data-wall] .geometry-hit').focus();p.keyboard.press('ArrowDown');self.assertEqual(p.evaluate('lab.data.walls[0].a'),[40,25])
        rect=p.locator('#plan').bounding_box();h=p.locator('[data-endpoint="b"]');h.scroll_into_view_if_needed();box=h.bounding_box();p.mouse.move(box['x']+box['width']/2,box['y']+box['height']/2);p.mouse.down();p.mouse.move(box['x']+box['width']/2+rect['width']/100,box['y']+box['height']/2);p.mouse.up();self.assertEqual(p.evaluate('lab.data.walls[0].b'),[53,25])
        self.save('Interior wall');p.locator('#mapMode').click();expect(p.locator('[data-wall]')).to_have_count(1);expect(p.locator('[data-wall] .geometry-hit')).to_have_count(0);p.locator('#auth').click();p.wait_for_function('!isAdmin');p.reload();expect(p.locator('[data-wall]')).to_have_count(1);expect(p.locator('.geometry-handle')).to_have_count(0)
        self.login();p.locator('#mapMode').click();p.locator('[data-wall-id="'+wid+'"]').click();p.locator('#deleteWall').click();expect(p.locator('[data-wall]')).to_have_count(0);self.save('Wall removed');p.reload();expect(p.locator('[data-wall]')).to_have_count(0)

    def test_category_visibility(self):
        p=self.page;expect(p.locator('.legend')).to_have_count(0)
        for admin in (False,True):
            if admin:self.login()
            before=p.evaluate('JSON.stringify(lab.data)')
            for kind in ('shelf','table','cart','machine'):
                ids=p.evaluate('(kind)=>lab.data.items.filter(i=>i.kind===kind).map(i=>i.id)',kind)
                total=p.locator('#plan [data-id]').count();p.locator('#'+kind+'Visible').uncheck();self.assertEqual(p.locator('#plan [data-id]').count(),total-len(ids))
                for id in ids:expect(p.locator(f'#plan [data-id="{id}"]')).to_have_count(0)
                p.locator('#search').fill('Computer shelf');self.assertIn('Computer shelf',p.locator('#directory' if admin else '#explorerResults').inner_text());p.locator('#search').fill('');p.locator('#'+kind+'Visible').check();self.assertEqual(p.locator('#plan [data-id]').count(),total)
            for key,selector in [('sectionsVisible','[data-section-id]'),('routes','.traffic-layer')]:
                p.locator('#'+key).uncheck();expect(p.locator('#plan '+selector)).to_have_count(0);p.locator('#'+key).check()
            self.assertEqual(p.evaluate('JSON.stringify(lab.data)'),before)
        self.save('Visibility preserves data');saved=json.loads((self.data/'lab.json').read_text());self.assertEqual(len(saved['items']),p.evaluate('lab.data.items.length'))

    def test_minimum_zoom(self):
        self.login();p=self.page
        p.evaluate("()=>{lab.data.items=[{...defaults(),id:'t1',kind:'table',name:'Table',x:10,y:10,w:4,h:3,locked:false}];lab.data.outline=[[0,0],[100,0],[100,48],[0,48]];render();}")
        before=p.locator('#plan').bounding_box()['width'];p.locator('#zoomOut').click();expect(p.locator('#zoomOut')).to_be_disabled();self.assertEqual(p.evaluate('zoom'),.75);box=p.locator('#plan').bounding_box();self.assertAlmostEqual(box['width'],before*.75,delta=1)
        el=p.locator('[data-id="t1"]');el.click();item=el.bounding_box();p.mouse.move(item['x']+item['width']/2,item['y']+item['height']/2);p.mouse.down();p.mouse.move(item['x']+item['width']/2+box['width']/100*3,item['y']+item['height']/2+box['height']/48*2);p.mouse.up();self.assertEqual(p.evaluate('[selected().x,selected().y]'),[13,12])
        p.locator('#mapMode').click();p.locator('[data-vertex="1"]').click();p.keyboard.press('ArrowLeft');self.assertEqual(p.evaluate('lab.data.outline[1]'),[99,0]);p.evaluate("()=>{lab.data.items.push({...defaults(),id:'zone',kind:'section',name:'Zoom section',x:40,y:20,w:10,h:10,locked:false,showLabel:false,restricted:false});lab.data.walls=[{id:'wall',a:[65,20],b:[70,20],thickness:.3}];lab.data.doors=[{id:'door',x:75,y:20,radius:3,orientation:'SE'}];render();}")
        p.locator('#plan [data-section-id="zone"]').click();expect(p.locator('#selectionTitle')).to_have_text('Zoom section');rect=p.locator('#plan').bounding_box();p.mouse.click(rect['x']+67.5*rect['width']/100,rect['y']+20*rect['height']/48);self.assertEqual(p.evaluate('selectedGeometry.type'),'walls');p.locator('[data-door] .geometry-hit').click();self.assertEqual(p.evaluate('selectedGeometry.type'),'doors');p.locator('#fit').click();self.assertEqual(p.evaluate('zoom'),1)
        p.locator('#zoomIn').click();self.assertEqual(p.evaluate('zoom'),1.25)

    def test_derived_area(self):
        self.login();p=self.page
        p.evaluate("()=>{lab.data.items=[{...defaults(),id:'s1',kind:'section',name:'Custom robotics',x:1,y:1,w:20,h:20,showLabel:true,restricted:false,locked:false},{...defaults(),id:'s2',kind:'section',name:'Tools',x:21,y:1,w:20,h:20,showLabel:true,restricted:false,locked:false},{...defaults(),id:'t1',kind:'table',name:'Table',x:3,y:3,w:2,h:2,locked:false,area:'Stale'}];lab.data.outline=[[0,0],[100,0],[100,48],[0,48]];choose('t1');}")
        expect(p.locator('#area')).to_have_value('Custom robotics');self.assertTrue(p.locator('#area').evaluate('(e)=>e.readOnly'))
        p.locator('#x').fill('24');p.locator('#x').press('Tab');expect(p.locator('#area')).to_have_value('Tools')
        p.evaluate("()=>{lab.data.items.find(i=>i.id==='s2').x=40;render();}");expect(p.locator('#area')).to_have_value('Lab')
        p.evaluate("()=>{lab.data.items.find(i=>i.id==='s1').w=30;render();}");expect(p.locator('#area')).to_have_value('Custom robotics')
        p.evaluate("()=>{lab.data.items.push({...lab.data.items[0],id:'s3',name:'Small section',x:23,y:2,w:5,h:5});render();}");expect(p.locator('#area')).to_have_value('Small section');p.locator('[data-id="t1"]').focus();p.keyboard.press('Control+c');p.keyboard.press('Control+v');p.wait_for_function('selectedId!=="t1"');expect(p.locator('#area')).to_have_value('Small section');self.save('Derived area');p.locator('#auth').click();p.wait_for_function('!isAdmin');p.evaluate("choose('t1')");expect(p.locator('#explorerContent')).to_contain_text('Small section')

    def test_item_clipboard(self):
        self.login();p=self.page
        p.evaluate("()=>{const i=lab.data.items.find(i=>i.kind==='cart');choose(i.id);}");original=p.evaluate('clone(selected())');p.locator('[data-id="'+original['id']+'"]').focus();p.keyboard.press('Control+c');p.keyboard.press('Control+v');p.wait_for_function('(id)=>selectedId!==id',arg=original['id']);copied=p.evaluate('clone(selected())');self.assertNotEqual(copied['id'],original['id']);self.assertEqual(copied['kind'],original['kind']);self.assertEqual(copied['background'],original['background']);self.assertTrue(p.evaluate('validPosition(selected())'))
        p.locator('#name').focus();p.keyboard.press('Control+c');p.keyboard.press('Control+v');self.assertEqual(p.evaluate('selectedId'),copied['id'])
        p.evaluate("()=>{const item=selected(),pos=nearbyPositions(item.x,item.y,item.w,item.h,lab.data.cols,lab.data.rows,1,1).find(p=>p.x>2&&p.x<70&&p.y>20&&p.y<38&&Math.abs(p.x-item.x)+Math.abs(p.y-item.y)>15&&validPosition({...item,...p}));checkpoint();Object.assign(item,pos);lab.data.items.push({...defaults(),id:'copy-zone',kind:'section',name:'Copied item area',x:item.x,y:item.y,w:item.w,h:item.h,locked:false,showLabel:false,restricted:false});render();changed();}");expect(p.locator('#area')).to_have_value('Copied item area')
        p.locator('[data-id="R01"]').click();p.locator('#openShelf').click();p.wait_for_function('typeof shelf!=="undefined" && shelf.data!==null');p.locator('#shelfContents').fill('Original inventory');p.locator('#shelfContents').press('Tab');p.locator('#back').click();p.wait_for_function('typeof lab!=="undefined" && lab.data!==null')
        p.locator('[data-id="R01"]').click();p.locator('[data-id="R01"]').focus();p.keyboard.press('Meta+c');p.keyboard.press('Meta+v');p.wait_for_function('selected()?.kind==="shelf" && selectedId!=="R01"');sid=p.evaluate('selectedId');p.locator('#openShelf').click();p.wait_for_function('typeof shelf!=="undefined" && shelf.data?.contents==="Original inventory"');p.locator('#shelfContents').fill('Independent copy');p.locator('#shelfContents').press('Tab');p.locator('#back').click();p.wait_for_function('typeof lab!=="undefined" && lab.data!==null');self.save('Independent shelves')
        p.locator('#auth').click();p.wait_for_function('!isAdmin');p.reload();p.wait_for_function('typeof lab!=="undefined" && lab.data!==null')
        self.assertEqual(p.evaluate('(id)=>lab.data.items.some(i=>i.id===id)',copied['id']),True)
        for id,value in [('R01','Original inventory'),(sid,'Independent copy')]:
            p.evaluate('(id)=>choose(id)',id);expect(p.locator('#explorerContent')).to_contain_text(value);p.locator('#closeExplorer').click();expect(p.locator('#explorerPanel')).not_to_be_visible()
        self.assertEqual(json.loads((self.data/f'shelves/{sid}.json').read_text())['id'],sid)
        p.locator('#search').fill('Independent copy');expect(p.locator('#explorerResults button')).to_have_count(1)

    def test_bin_clipboard(self):
        self.login();p=self.page;p.locator('[data-id="R01"]').click();p.locator('#openShelf').click();p.wait_for_function('typeof shelf!=="undefined" && shelf.data!==null')
        p.evaluate("()=>{shelf.data.mode='complex';shelf.data.cols=6;shelf.data.rows=2;shelf.data.matrix=[Array(6).fill(null),Array(6).fill(null)];setShelfBin(shelf.data,0,0,{...defaults(),name:'Bolts',contents:'Steel',keywords:'metric',w:1.5,h:2});choose(0,0);}")
        p.locator('.shelf-bin').focus();p.keyboard.press('Control+c');p.keyboard.press('Control+v');p.wait_for_function('bins().length===2');self.assertEqual(p.evaluate('bins()[1].c'),1.5)
        p.keyboard.press('Meta+c');p.keyboard.press('Meta+v');p.wait_for_function('bins().length===3');p.keyboard.press('Control+v');p.wait_for_function('bins().length===4');p.keyboard.press('Control+v');expect(p.locator('#status')).to_contain_text('No clear space')
        self.assertEqual(p.evaluate('new Set(bins().slice(1).map(p=>p.bin.id)).size'),3);self.assertEqual(p.evaluate('bins().map(p=>p.bin.contents)'),['Steel']*4);self.assertEqual(p.evaluate('bins().map(p=>p.c)'),[0,1.5,3,4.5])
        p.locator('#name').focus();p.keyboard.press('Control+c');p.keyboard.press('Control+v');self.assertEqual(p.evaluate('bins().length'),4)
        p.locator('.shelf-bin').first.focus();p.keyboard.press('Control+z');p.wait_for_function('bins().length===3');p.keyboard.press('Control+Shift+z');p.wait_for_function('bins().length===4');self.save('Copied bins')

    def test_fractional_bins(self):
        self.login();p=self.page;p.locator('[data-id="R01"]').click();p.locator('#openShelf').click();p.wait_for_function('typeof shelf!=="undefined" && shelf.data!==null')
        p.locator('#shelfMode').select_option('complex');p.locator('#applyShelfMode').click()
        p.locator('#rows').fill('4');p.locator('#cols').fill('6');p.locator('#resize').click()
        for c in (0,1.5,3,4.5):
            p.evaluate('(c)=>choose(0,c)',c);p.locator('#addBin').click()
            for key,val in [('w','1.5'),('h','1.5')]:p.locator('#'+key).fill(val);p.locator('#'+key).press('Tab')
        self.assertEqual(p.evaluate('bins().map(p=>p.c)'),[0,1.5,3,4.5]);self.assertEqual(p.evaluate('bins().map(p=>p.bin.w)'),[1.5]*4)
        self.assertFalse(p.evaluate('fits(binAt(),0,1.25)'));p.locator('#w').fill('.5');p.locator('#w').press('Tab');expect(p.locator('#w')).to_have_value('1.5')
        self.assertTrue(p.evaluate('fits({...binAt(),w:2,h:1.5},2,0,null)'));self.assertTrue(p.evaluate('fits({...binAt(),w:1.5,h:2},2,0,null)'))
        el=p.locator('.shelf-bin').last;el.scroll_into_view_if_needed();box=el.bounding_box();p.mouse.move(box['x']+10,box['y']+10);p.mouse.down();p.mouse.move(box['x']+10,box['y']+21.5);p.mouse.up();self.assertEqual(p.evaluate('selection.r'),.5)
        p.locator('#back').click();p.wait_for_function('typeof lab!=="undefined" && lab.data!==null');self.save('Half-grid inventory');p.locator('#auth').click();p.wait_for_function('!isAdmin');p.locator('[data-id="R01"]').click();expect(p.locator('.readonly-bin')).to_have_count(4)
        widths=p.locator('.readonly-bin').evaluate_all('(els)=>els.map(e=>e.getBoundingClientRect().width)');self.assertTrue(all(abs(w-widths[0])<.1 for w in widths));self.assertAlmostEqual(widths[0],33.5,delta=.1)
        saved=json.loads((self.data/'shelves/R01.json').read_text());self.assertEqual(saved['matrix'][0][4]['offsetX'],.5);self.assertEqual(saved['matrix'][0][4]['offsetY'],.5)
        for el in p.locator('.readonly-bin').all():el.hover();expect(p.locator('.bin-tooltip')).to_be_visible()

    def test_readonly_grid(self):
        from lab_server import write_json
        for count in (0,1,3):
            doc=json.loads((self.data/'shelves/R01.json').read_text());doc['mode']='complex'
            for c in range(count):doc['matrix'][0][c*3]=dict(name=f'Bin {c}',contents=f'Contents {c}',keywords=f'Key {c}',w=c+1,h=2,background='#ffffff',color='#000000',fontSize=14,fontFamily='Arial',bold=False)
            write_json(self.data/'shelves/R01.json',doc)
            p=self.page;p.goto(self.url+'/shelf_editor.html?id=R01');expect(p.locator('.readonly-grid')).to_be_visible();expect(p.locator('.readonly-bin')).to_have_count(count)
            before=p.evaluate('JSON.stringify(shelf.data)')
            for c in range(count):
                el=p.locator('.readonly-bin').nth(c);el.hover();expect(p.locator('.bin-tooltip')).to_contain_text('Select to view inventory');expect(p.locator('.bin-tooltip')).to_be_visible();el.focus();p.keyboard.press('Delete');p.keyboard.press('ArrowRight')
                self.assertEqual(el.evaluate('(e)=>getComputedStyle(e).gridColumnEnd'),f'span {(c+1)*2}')
            p.locator('h1').hover();p.locator('#back').focus();expect(p.locator('.bin-tooltip')).to_be_hidden();self.assertEqual(p.evaluate('JSON.stringify(shelf.data)'),before);expect(p.locator('.readonly-grid input')).to_have_count(0)

    def test_lab_inventory_commit(self):
        self.login();p=self.page
        for label in ('Inventory A', 'Inventory B'):
            for sid in ('R01','R02'):
                p.locator(f'[data-id="{sid}"]').click();p.locator('#openShelf').click();p.wait_for_function('typeof shelf!=="undefined" && shelf.data!==null')
                p.locator('#shelfName').fill(label);p.locator('#shelfName').press('Tab')
                p.locator('#shelfContents').fill(label+' contents');p.locator('#shelfContents').press('Tab')
                p.locator('#shelfKeywords').fill(label+' keys');p.locator('#shelfKeywords').press('Tab')
                if sid=='R02':
                    p.locator('#shelfMode').select_option('complex');p.locator('#applyShelfMode').click()
                    p.evaluate("()=>{if(!shelf.data.matrix[1][2]){choose(1,2);$('#addBin').click();}else choose(1,2);}")
                    for key,value in [('name',label+' bin'),('w','3'),('h','2')]:
                        p.locator('#'+key).fill(value);p.locator('#'+key).press('Tab')
                p.evaluate('cacheDraft()');p.reload();p.wait_for_function('typeof shelf!=="undefined" && shelf.data?.name.startsWith("Inventory")');expect(p.locator('#shelfName')).to_have_value(label)
                p.locator('#back').click();p.wait_for_function('typeof lab!=="undefined" && lab.data!==null')
            self.save(label);p.reload();p.wait_for_function('typeof lab!=="undefined" && lab.data!==null');p.locator('#auth').click();p.wait_for_function('!isAdmin')
            for sid in ('R01','R02'):
                p.locator(f'[data-id="{sid}"]').click();expect(p.locator('#explorerContent')).to_contain_text(label+' contents');expect(p.locator('#explorerContent')).to_contain_text(label+' keys')
                if sid=='R02':expect(p.locator('#explorerContent')).to_contain_text(label+' bin')
                p.locator('#closeExplorer').click();expect(p.locator('#explorerPanel')).not_to_be_visible()
            self.login()
        for rev,label in [('1','Inventory A'),('2','Inventory B')]:
            p.locator('#versionHistory').click();p.locator('#historyVersions').select_option(rev);p.locator('#restoreVersion').click();expect(p.locator('#historyDialog')).not_to_be_visible()
            p.locator('[data-id="R02"]').click();p.locator('#openShelf').click();p.wait_for_function('typeof shelf!=="undefined" && shelf.data!==null');expect(p.locator('#shelfName')).to_have_value(label);self.assertEqual(p.evaluate('shelf.data.matrix[1][2].name'),label+' bin')
            p.locator('#back').click();p.wait_for_function('typeof lab!=="undefined" && lab.data!==null')

if __name__=='__main__': unittest.main()
