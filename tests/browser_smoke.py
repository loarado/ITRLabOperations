"""Optional end-to-end checks; run with Playwright installed. Uses temporary data."""
from pathlib import Path
import json
import re
import shutil
import sys
import tempfile
import threading
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from lab_server import blank_shelf, write_json, LabServer, ROOT
from playwright.sync_api import sync_playwright, expect

def save_version(page, name='Test arrangement'):
    page.locator('#save').click()
    page.locator('#versionName').fill(name)
    page.locator('#saveVersionDialog button[value="save"]').click()

with tempfile.TemporaryDirectory() as temp:
    data = Path(temp)/'data'
    (data/'shelves').mkdir(parents=True)
    shutil.copy(ROOT/'defaults/lab.json', data/'lab.json')
    for item in json.loads((data/'lab.json').read_text())['items']:
        if item['kind']=='shelf': write_json(data/'shelves'/f"{item['id']}.json", blank_shelf(item['id']))
    server = LabServer(('127.0.0.1', 0), data, 'itr')
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    url = f'http://127.0.0.1:{server.server_port}'
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch()
            context = browser.new_context(viewport={'width':1440,'height':1000})
            page = context.new_page()
            errors=[]
            page.on('pageerror', lambda e: errors.append(str(e)))
            page.goto(url)
            expect(page.locator('#status')).to_have_text(re.compile('Loaded from server|Recovered editor instance|Recovered unsaved instance draft'))
            expect(page.locator('#save')).to_be_hidden()
            assert page.locator('.grid-item:not(.section)').count() == 71
            page.screenshot(path='/tmp/itr-lab-editor.png', full_page=True)
            # Ensure no section label occupies any fixture's rectangle.
            assert page.evaluate('''() => {
                const rect=e=>e.getBoundingClientRect();
                return [...document.querySelectorAll('.section-label')].every(label=>
                  [...document.querySelectorAll('.grid-item:not(.section)')].every(item=>{
                    const a=rect(label),b=rect(item);return !(a.left<b.right-.5&&a.right>b.left+.5&&a.top<b.bottom-.5&&a.bottom>b.top+.5);
                  }));
            }''')
            page.locator('#auth').click();page.locator('#password').fill('wrong');page.get_by_role('button',name='Sign in',exact=True).click()
            expect(page.locator('#loginError')).to_have_text('Incorrect password.')
            page.locator('#password').fill('itr');page.get_by_role('button',name='Sign in',exact=True).click()
            expect(page.locator('#access')).to_have_text('Admin · editing enabled')
            # Change an item style and prove disk persistence and undo/redo.
            page.locator('[data-id="R01"]').click()
            page.locator('#name').fill('Computer components');page.locator('#name').press('Tab')
            page.locator('#background').fill('#ffdd88');page.locator('#background').dispatch_event('change')
            save_version(page);expect(page.locator('#status')).to_contain_text('Saved “')
            assert next(i for i in json.loads((data/'lab.json').read_text())['items'] if i['id']=='R01')['name']=='Computer components'
            page.locator('#undo').click();page.locator('#redo').click()
            # Add a section, style it, then undo it to keep footprint comparisons simple.
            page.locator('#mapMode').click();page.locator('#addSection').click()
            expect(page.locator('#selectionTitle')).to_have_text('New section')
            page.locator('#name').fill('Communal project area');page.locator('#name').press('Tab')
            page.locator('#color').fill('#14532d');page.locator('#color').dispatch_event('change')
            page.locator('#delete').click()
            page.locator('#mapMode').click()
            # Move a table with coordinates, then move by actual pointer drag.
            page.locator('[data-id="F17"]').click()
            old_x=page.locator('#x').input_value()
            # Find a valid free target programmatically, then exercise the UI input.
            target=page.evaluate('''() => { const i=selected(); for(let y=25;y<43;y++) for(let x=36;x<52;x++) if(validPosition({...i,x,y})&&(x!==i.x||y!==i.y))return {x,y}; }''')
            assert target, 'Expected a free destination for table dragging'
            if target:
                # Change together through keyboard if possible; use drag to avoid intermediate blocked positions.
                box=page.locator('[data-id="F17"]').bounding_box();rect=page.locator('#plan').bounding_box()
                current=page.evaluate('() => ({x:selected().x,y:selected().y})')
                page.mouse.move(box['x']+box['width']/2,box['y']+box['height']/2);page.mouse.down()
                page.mouse.move(box['x']+box['width']/2+(target['x']-current['x'])*rect['width']/100,box['y']+box['height']/2+(target['y']-current['y'])*rect['height']/48,steps=8);page.mouse.up()
                expect(page.locator('#x')).to_have_value(str(target['x']))
            # The footprint is actually editable, and adding a shelf creates its own file.
            page.locator('#mapMode').click()
            outline=page.locator('#outline').input_value().replace('0, 18', '0, 17', 1)
            page.locator('#outline').fill(outline);page.locator('#applyOutline').click()
            save_version(page);expect(page.locator('#status')).to_contain_text('Saved “')
            assert json.loads((data/'lab.json').read_text())['outline'][0]==[0,17]
            page.locator('#mapMode').click()
            page.locator('#newKind').select_option('shelf');page.locator('#add').click()
            new_id=page.locator('#selectionId').text_content().split(' / ')[0]
            save_version(page);expect(page.locator('#status')).to_contain_text('Saved “')
            assert (data/'shelves'/f'{new_id}.json').exists()
            page.locator('#delete').click()
            # Open a specific shelf, add a bin, customize it, and reload.
            page.locator('[data-id="R01"]').click();page.locator('#openShelf').click()
            expect(page).to_have_url(url+'/shelf_editor.html?id=R01')
            expect(page.locator('#status')).to_have_text(re.compile('Loaded from server|Recovered editor instance|Recovered unsaved instance draft'))
            page.locator('#shelfMode').select_option('complex');page.locator('#applyShelfMode').click()
            page.get_by_role('button',name='Empty cell, row 1, column 1',exact=True).click();page.locator('#addBin').click()
            page.locator('#name').fill('M4 bolts');page.locator('#name').press('Tab')
            page.locator('#shelfContents').fill('Stainless steel');page.locator('#shelfContents').press('Tab')
            save_version(page);expect(page.locator('#status')).to_contain_text('Saved “')
            page.reload();expect(page.locator('#status')).to_have_text(re.compile('Loaded from server|Recovered editor instance|Recovered unsaved instance draft'))
            page.get_by_role('button',name='M4 bolts, row 1, column 1',exact=True).click()
            expect(page.locator('#shelfContents')).to_have_value('Stainless steel')
            # Resize cannot erase a bin; moving and a valid resize persist.
            page.locator('#rows').fill('1');page.locator('#resize').click()
            expect(page.locator('#status')).to_contain_text('Nothing was removed')
            page.locator('#x').fill('4');page.locator('#x').press('Tab')
            page.locator('#rows').fill('12');page.locator('#cols').fill('12');page.locator('#resize').click()
            save_version(page);expect(page.locator('#status')).to_contain_text('Saved “')
            assert json.loads((data/'shelves/R01.json').read_text())['matrix'][0][3]['name']=='M4 bolts'
            assert all(c is None for row in json.loads((data/'shelves/R02.json').read_text())['matrix'] for c in row)
            page.screenshot(path='/tmp/itr-shelf-editor.png',full_page=True)
            # Another browser is a viewer but sees the saved contents.
            viewer=browser.new_context(viewport={'width':390,'height':844})
            other=viewer.new_page();other.goto(url+'/shelf_editor.html?id=R01')
            expect(other.locator('#status')).to_have_text(re.compile('Loaded from server|Recovered editor instance|Recovered unsaved instance draft'))
            expect(other.locator('#save')).to_be_hidden()
            expect(other.locator('#shelfReadOnly')).to_contain_text('M4 bolts')
            other.goto(url);expect(other.locator('#status')).to_have_text(re.compile('Loaded from server|Recovered editor instance|Recovered unsaved instance draft'))
            assert other.evaluate('document.documentElement.scrollWidth <= innerWidth')
            # Traffic routes: coordinates, pointer translation, endpoints, undo, and restore.
            page.goto(url);expect(page.locator('#status')).to_have_text(re.compile('Loaded from server|Recovered editor instance|Recovered unsaved instance draft'))
            disk_before_draft=(data/'lab.json').read_bytes()
            versions_before_draft=len(list((data/'history/lab').glob('*.json')))
            if not page.evaluate('mapEditing'):page.locator('#mapMode').click()
            page.locator('#routeDirectory button').first.click()
            page.locator('#routePoints').fill('38, 2\n38, 12\n40, 12')
            page.locator('#applyRoute').click()
            before=page.evaluate('clone(lab.data.routes[0])')
            page.keyboard.press('Control+z')
            assert page.evaluate('lab.data.routes[0]')!=before
            page.keyboard.press('Control+Shift+z')
            assert page.evaluate('lab.data.routes[0]')==before
            assert page.evaluate('cacheDraft()')
            assert (data/'lab.json').read_bytes()==disk_before_draft
            assert len(list((data/'history/lab').glob('*.json')))==versions_before_draft
            page.once('dialog',lambda dialog: dialog.accept())
            page.reload();expect(page.locator('#status')).to_have_text('Recovered unsaved instance draft')
            assert page.evaluate('lab.data.routes[0]')==before
            assert page.evaluate('history.length')>0
            isolated=context.new_page();isolated.goto(url)
            expect(isolated.locator('#status')).to_have_text('Loaded from server')
            assert isolated.evaluate('lab.data.routes[0]')!=before
            isolated.close()
            if not page.evaluate('mapEditing'):page.locator('#mapMode').click()
            page.locator('#routeDirectory button').first.click()
            # Drag the first segment by one cell horizontally.
            rect=page.locator('#plan').bounding_box()
            sx=rect['x']+38/100*rect['width'];sy=rect['y']+6/48*rect['height']
            page.mouse.move(sx,sy);page.mouse.down();page.mouse.move(sx+rect['width']/100,sy,steps=5);page.mouse.up()
            after=page.evaluate('clone(lab.data.routes[0])')
            assert after==[[x+1,y] for x,y in before], (before,after)
            handle=page.locator('[data-route="0"] .route-handle').first.bounding_box()
            hx=handle['x']+handle['width']/2;hy=handle['y']+handle['height']/2
            page.mouse.move(hx,hy);page.mouse.down();page.mouse.move(hx,hy+rect['height']/48,steps=5);page.mouse.up()
            assert page.evaluate('lab.data.routes[0][0][1]')==3
            page.locator('#reverseRoute').click()
            save_version(page);expect(page.locator('#status')).to_contain_text('Saved “')
            edited_revision=page.evaluate('lab.data.revision')
            edited_routes=page.evaluate('clone(lab.data.routes)')
            saved_before_restore=(data/'lab.json').read_bytes()
            history_before_restore=len(list((data/'history/lab').glob('*.json')))
            page.locator('#versionHistory').click()
            expect(page.locator('#restoreVersion')).to_be_enabled()
            page.locator('#historyVersions').select_option('original');page.locator('#restoreVersion').click()
            expect(page.locator('#historyDialog')).not_to_be_visible()
            assert page.evaluate('lab.data.routes')==json.loads((ROOT/'defaults/lab.json').read_text())['routes']
            assert json.loads((data/'shelves/R01.json').read_text())['matrix'][0][3]['name']=='M4 bolts'
            page.locator('#versionHistory').click();expect(page.locator('#restoreVersion')).to_be_enabled()
            page.locator('#historyVersions').select_option(str(edited_revision));page.locator('#restoreVersion').click()
            expect(page.locator('#historyDialog')).not_to_be_visible()
            assert page.evaluate('lab.data.routes')==edited_routes
            assert (data/'lab.json').read_bytes()==saved_before_restore
            assert len(list((data/'history/lab').glob('*.json')))==history_before_restore
            page.locator('#addRoute').click();page.locator('#deleteRoute').click();page.locator('#undo').click()
            assert page.evaluate('lab.data.routes.length')==len(edited_routes)+1
            save_version(page);expect(page.locator('#status')).to_contain_text('Saved “')
            page.reload();expect(page.locator('#status')).to_have_text(re.compile('Loaded from server|Recovered editor instance|Recovered unsaved instance draft'))
            assert page.evaluate('lab.data.routes.length')==len(edited_routes)+1
            assert not errors, errors
            browser.close()
        print('PASS: browser login, permissions, lab editing/drag, styles, labels, shelf routing, named saves, cached drafts, Ctrl+Z/redo, reload, matrix resizing, shelf isolation, mobile layout, arrow dragging/reshaping, and original/saved-version restore.')
    finally:
        server.shutdown();server.server_close();thread.join()
