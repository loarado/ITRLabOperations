#!/usr/bin/env python3
"""ITR lab editor: static UI, authenticated JSON persistence, no dependencies."""
import argparse
import copy
from datetime import datetime, timezone
import hashlib
import hmac
import math
from http import cookies
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import mimetypes
import os
from pathlib import Path
import re
import secrets
import threading
import time
import tarfile
from inventory import identify_bins, empty_inventory, location_key, validate_item, validate_stock, decimal_value, estimated_value, retire_bin_fields, convert_bin_contents, bin_display_name
from reports import empty_reports, prepare_report
from projects import empty_projects, prepare_project, validate_projects, delete_project
from neon_accounts import NeonAccounts, AccountError
from treasury import empty_treasury, update_record, validate_treasury
from location_labels import assign_labels, empty_labels, GENERATED
from decimal import Decimal
from urllib.parse import urlsplit, unquote, parse_qs

ROOT = Path(__file__).resolve().parent
WEB_ROOT = ROOT / 'web'
WEB_FILES = {path.name: path for path in WEB_ROOT.rglob('*') if path.is_file()}
ID = re.compile(r'^[A-Za-z0-9_-]{1,64}$')
HEX = re.compile(r'^#[0-9a-fA-F]{6}$')
KINDS = {'section', 'shelf', 'table', 'cart', 'machine', 'wall', 'text', 'misc'}
INVENTORY_KINDS = {'shelf', 'table', 'cart', 'machine'}
FONTS = {'system-ui', 'Arial', 'Georgia', 'monospace'}
MAX_BODY = 4_000_000


def integer(value, low, high):
    return type(value) is int and low <= value <= high


def style(obj):
    return (HEX.fullmatch(str(obj.get('background', ''))) and
            HEX.fullmatch(str(obj.get('color', ''))) and
            integer(obj.get('fontSize'), 6, 96) and obj.get('fontFamily') in FONTS and
            type(obj.get('bold')) is bool)


def text(value, limit=500):
    return isinstance(value, str) and len(value) <= limit


def validate_lab(doc):
    if not isinstance(doc, dict) or not integer(doc.get('cols'), 10, 200) or not integer(doc.get('rows'), 10, 200):
        raise ValueError('Lab grid dimensions must be integers from 10 to 200.')
    items = doc.get('items')
    if not isinstance(items, list) or len(items) > 1000:
        raise ValueError('Invalid item list (maximum 1,000).')
    ids = set()
    for item in items:
        if not isinstance(item, dict) or not ID.fullmatch(str(item.get('id', ''))) or item['id'] in ids:
            raise ValueError('Every item needs a unique safe ID.')
        ids.add(item['id'])
        if not text(item.get('locationId', ''), 100):
            raise ValueError('Location ID must be text of at most 100 characters.')
        if (item.get('kind') not in KINDS or not text(item.get('name')) or not text(item.get('area', '')) or
                not style(item) or type(item.get('locked')) is not bool):
            raise ValueError('Invalid item type, label, or style.')
        for key, maximum in [('x', doc['cols']), ('w', doc['cols']), ('y', doc['rows']), ('h', doc['rows'])]:
            if not integer(item.get(key), 1, maximum):
                raise ValueError('Invalid grid coordinates.')
        if item['x'] + item['w'] - 1 > doc['cols'] or item['y'] + item['h'] - 1 > doc['rows']:
            raise ValueError('An item extends outside the grid.')
        if item['kind'] == 'misc':
            if not HEX.fullmatch(str(item.get('outlineColor', '#233748'))) or not integer(item.get('outlineWidth', 1), 0, 20):
                raise ValueError('Invalid Misc outline color or thickness.')
            if item.get('shape', 'square') not in ('square','line','triangle','circle') or type(item.get('showLabel', True)) is not bool:
                raise ValueError('Invalid Misc shape or label visibility.')
            if item.get('lineDirection','horizontal') not in ('horizontal','vertical','diagonal-down','diagonal-up') or not integer(item.get('lineWidth',4),1,20):
                raise ValueError('Invalid Misc line direction or thickness.')
        if item['kind'] == 'section' and (type(item.get('showLabel')) is not bool or type(item.get('restricted')) is not bool):
            raise ValueError('Invalid section settings.')
    def points(values, minimum):
        if not isinstance(values, list) or not minimum <= len(values) <= 500:
            return False
        return all(isinstance(p, list) and len(p) == 2 and all(type(v) in (int, float) for v in p)
                   and 0 <= p[0] <= doc['cols'] and 0 <= p[1] <= doc['rows'] for p in values)
    if not points(doc.get('outline'), 3):
        raise ValueError('Outline needs at least three valid grid points.')
    walls = doc.get('walls', [])
    if not isinstance(walls, list) or len(walls) > 500:
        raise ValueError('Invalid walls (maximum 500).')
    wall_ids = set()
    for wall in walls:
        if not isinstance(wall, dict) or not ID.fullmatch(str(wall.get('id',''))) or wall['id'] in wall_ids:
            raise ValueError('Walls require unique IDs.')
        wall_ids.add(wall['id'])
        ends = [wall.get('a'), wall.get('b')]
        if not points(ends, 2) or ends[0] == ends[1] or any(not all(type(n) is int for n in p) for p in ends):
            raise ValueError('Wall endpoints must be distinct integer grid points.')
        thickness = wall.get('thickness')
        if type(thickness) not in (int,float) or not .1 <= thickness <= 2:
            raise ValueError('Wall thickness must be between 0.1 and 2.')
    doors = doc.get('doors', [])
    if not isinstance(doors, list) or len(doors) > 500:
        raise ValueError('Invalid doors (maximum 500).')
    door_ids = set()
    for door in doors:
        if not isinstance(door, dict) or not ID.fullmatch(str(door.get('id',''))) or door['id'] in door_ids:
            raise ValueError('Doors require unique IDs.')
        door_ids.add(door['id'])
        orientation = door.get('orientation')
        if orientation not in ('NW','NE','SW','SE') or not integer(door.get('radius'),1,20):
            raise ValueError('Invalid door orientation or radius.')
        x,y,r = door.get('x'),door.get('y'),door['radius']
        if not integer(x,0,doc['cols']) or not integer(y,0,doc['rows']):
            raise ValueError('Door hinge must be on the grid.')
        if not 0 <= x+(r if 'E' in orientation else -r) <= doc['cols'] or not 0 <= y+(r if 'S' in orientation else -r) <= doc['rows']:
            raise ValueError('Door extends outside the grid.')
    routes = doc.get('routes')
    if not isinstance(routes, list) or len(routes) > 100 or not all(points(p, 2) for p in routes):
        raise ValueError('Invalid traffic paths.')


def validate_shelf(doc, shelf_id):
    if not isinstance(doc, dict) or doc.get('id') != shelf_id:
        raise ValueError('Shelf ID does not match the file.')
    if doc.get('mode', 'simple') not in ('simple', 'complex'):
        raise ValueError('Shelf mode must be simple or complex.')
    for field, limit in [('name', 500), ('contents', 10000), ('keywords', 2000)]:
        if not text(doc.get(field, ''), limit):
            raise ValueError('Invalid shelf metadata.')
    legacy = doc.get('legacyBinText', {})
    if not isinstance(legacy,dict) or len(legacy) > 3600:
        raise ValueError('Invalid preserved bin text.')
    for bid, records in legacy.items():
        if not ID.fullmatch(str(bid)) or not isinstance(records,list) or len(records) > 100:
            raise ValueError('Invalid preserved bin text.')
        for record in records:
            if (not isinstance(record,dict) or not text(record.get('contents',''),10000) or
                    not text(record.get('keywords',''),2000) or type(record.get('converted')) is not bool):
                raise ValueError('Invalid preserved bin text.')
    rows, cols = doc.get('rows'), doc.get('cols')
    if not integer(rows, 1, 60) or not integer(cols, 1, 60):
        raise ValueError('Shelf dimensions must be integers from 1 to 60.')
    decor = doc.get('decor', [])
    if not isinstance(decor, list) or len(decor) > 200:
        raise ValueError('Shelf Decor is limited to 200 shapes.')
    decor_ids = set()
    for shape in decor:
        if not isinstance(shape, dict) or not isinstance(shape.get('id'), str) or not ID.fullmatch(shape['id']) or shape['id'] in decor_ids:
            raise ValueError('Shelf Decor IDs must be unique.')
        decor_ids.add(shape['id'])
        if shape.get('shape') not in ('rectangle', 'ellipse', 'triangle') or not text(shape.get('text'), 500):
            raise ValueError('Invalid Shelf Decor shape or text.')
        geometry = [shape.get(k) for k in ('x', 'y', 'w', 'h')]
        if any(type(v) not in (int, float) or not math.isfinite(v) or v*4 != int(v*4) for v in geometry):
            raise ValueError('Shelf Decor uses quarter-cell increments.')
        x, y, w, h = geometry
        if x < 0 or y < 0 or w < .25 or h < .25 or x+w > cols or y+h > rows:
            raise ValueError('Shelf Decor extends outside the canvas or is too small.')
        if not integer(shape.get('outlineWidth'), 0, 20) or any(not isinstance(shape.get(k), str) or not re.fullmatch(r'#[0-9a-fA-F]{6}', shape[k]) for k in ('outlineColor', 'fillColor', 'textColor')):
            raise ValueError('Invalid Shelf Decor colors or outline.')
    matrix = doc.get('matrix')
    if not isinstance(matrix, list) or len(matrix) != rows:
        raise ValueError('Matrix row count does not match rows.')
    occupied = []
    bin_ids = set()
    for r, row in enumerate(matrix):
        if not isinstance(row, list) or len(row) != cols:
            raise ValueError('Every matrix row must match cols.')
        for c, cell in enumerate(row):
            if cell is None:
                continue
            if (not isinstance(cell, dict) or not style(cell) or not text(cell.get('name')) or
                    not text(cell.get('contents', ''), 10000) or not text(cell.get('keywords', ''), 2000)):
                raise ValueError('Invalid bin text or style.')
            if 'id' in cell:
                if not isinstance(cell['id'],str) or not ID.fullmatch(cell['id']) or cell['id'] in bin_ids:
                    raise ValueError('Bin IDs must be unique.')
                bin_ids.add(cell['id'])
            w, h = cell.get('w'), cell.get('h')
            ox, oy = cell.get('offsetX', 0), cell.get('offsetY', 0)
            if any(type(v) not in (int, float) or not math.isfinite(v) or v*2 != int(v*2) for v in (w,h,ox,oy)) or ox not in (0,.5) or oy not in (0,.5):
                raise ValueError('Bin geometry must use half-grid increments; offsets are 0 or 0.5.')
            x, y = c+ox, r+oy
            if w < 1 or h < 1 or x+w > cols or y+h > rows:
                raise ValueError('Bin extends outside the shelf or is smaller than one cell.')
            if any(x < xx+ww and x+w > xx and y < yy+hh and y+h > yy for xx,yy,ww,hh in occupied):
                raise ValueError('Shelf bins overlap.')
            occupied.append((x,y,w,h))


def normalize_shelf(doc, name=''):
    """Read legacy matrices without rewriting files or dropping dormant bins."""
    result = identify_bins(doc)
    result.setdefault('schemaVersion', 2)
    result.setdefault('mode', 'complex' if any(cell is not None for row in doc.get('matrix', []) for cell in row) else 'simple')
    result.setdefault('name', name)
    result.setdefault('contents', '')
    result.setdefault('keywords', '')
    return retire_bin_fields(result)


def blank_shelf(shelf_id, name=''):
    return normalize_shelf(dict(id=shelf_id, revision=0, rows=34, cols=30, matrix=[[None]*30 for _ in range(34)]), name)


def write_json(path, doc):
    path.parent.mkdir(parents=True, exist_ok=True)
    # One matrix row per line keeps shelf files easy to hand-edit.
    if 'matrix' in doc:
        header = {k: v for k, v in doc.items() if k != 'matrix'}
        payload = json.dumps(header, indent=2)[:-2] + ',\n  "matrix": [\n' + ',\n'.join(
            '    ' + json.dumps(row, ensure_ascii=False) for row in doc['matrix']) + '\n  ]\n}\n'
    else:
        payload = json.dumps(doc, indent=2, ensure_ascii=False) + '\n'
    temporary = path.with_suffix('.tmp')
    with temporary.open('w') as f:
        f.write(payload)
        f.flush()
        os.fsync(f.fileno())
    os.replace(temporary, path)


class RevisionConflict(ValueError):
    pass


class LabServer(ThreadingHTTPServer):
    def __init__(self, address, data_dir, password, defaults_dir=None, treasurer_username=None, treasurer_password=None, admin_username=None):
        super().__init__(address, LocalRequestHandler)
        self.data_dir = Path(data_dir)
        self.defaults_dir = Path(defaults_dir) if defaults_dir else ROOT / 'defaults'
        self.password_hash = hashlib.sha256(password.encode()).digest()
        self.admin_username = admin_username or os.environ.get('ITR_ADMIN_USERNAME', 'admin')
        self.treasurer_username = treasurer_username or os.environ.get('ITR_TREASURER_USERNAME', 'treasurer')
        self.treasurer_password_hash = hashlib.sha256((treasurer_password or os.environ.get('ITR_TREASURER_PASSWORD', 'treasury')).encode()).digest()
        self.sessions = {}
        self.accounts = NeonAccounts(os.environ['DATABASE_URL']) if os.environ.get('DATABASE_URL') else None
        self.attempts = {}
        self.report_attempts = {}
        self.project_attempts = {}
        self.lock = threading.RLock()
        self.drafts = {}
        self.draft_epochs = {}
        self.inventory_states = {}
        # Roll forward a fully validated, explicitly saved transaction after interruption.
        self.finish_transaction()
        self.migrate_locations()
        self.migrate_bin_contents()
        self.migrate_location_labels()
        self.ensure_dashboard_documents()

    def ensure_dashboard_documents(self):
        """Create independent dashboard stores without coupling them to lab geometry."""
        writes = {}
        if not (self.data_dir / 'projects.json').exists():
            writes['projects.json'] = empty_projects()
        if not (self.data_dir / 'treasury.json').exists():
            writes['treasury.json'] = empty_treasury()
        if writes:
            write_json(self.data_dir / 'pending-save.json', writes)
            self.finish_transaction()

    def projects_document(self):
        return json.loads((self.data_dir / 'projects.json').read_text())

    def treasury_document(self):
        return json.loads((self.data_dir / 'treasury.json').read_text())

    def inventory_suggestions(self, query):
        query = query.strip().casefold()
        if len(query) < 2 or len(query) > 500:
            raise ValueError('Enter at least two characters to search inventory.')
        inventory = self.stock_document()
        locations = self.stock_locations()
        results = []
        for item_id, item in inventory['items'].items():
            name = item['name'].casefold()
            searchable = ' '.join(str(item.get(key, '')) for key in ('name', 'category', 'keywords', 'description')).casefold()
            if name == query:
                rank = 0
            elif name.startswith(query):
                rank = 1
            elif query in name:
                rank = 2
            elif query in searchable:
                rank = 3
            else:
                continue
            stocks = []
            for stock in inventory['stocks'].values():
                if stock['itemId'] != item_id or stock.get('archived'):
                    continue
                key = location_key(stock.get('shelfId'), stock.get('binId')) if stock.get('shelfId') else ''
                stocks.append(dict(label=locations.get(key, {}).get('label', stock.get('locationLabel', 'Unassigned')),
                    tracking=stock['tracking'], quantity=stock.get('quantity'), unit=stock.get('unit'),
                    availability=stock.get('availability'), mapped=bool(locations.get(key, {}).get('mapped'))))
            results.append((rank, item['name'].casefold(), dict(itemId=item_id, name=item['name'], category=item.get('category', ''), stocks=stocks)))
        return {'results': [entry[2] for entry in sorted(results)[:8]], 'revision': inventory['revision']}

    def label_registry(self):
        path = self.data_dir / 'location-labels.json'
        return json.loads(path.read_text()) if path.exists() else empty_labels()

    def migrate_location_labels(self):
        """Reserve retained labels and backfill only current location presentation."""
        path = self.data_dir / 'lab.json'
        original = json.loads(path.read_text())
        registry = self.label_registry()
        previous = copy.deepcopy(registry)
        layouts = [original]
        for file in sorted((self.data_dir/'history/lab').glob('*.json')):
            layouts.append(json.loads(file.read_text())['layout'])
        identities = {item['id'] for layout in layouts for item in layout['items'] if item['kind']=='shelf'}
        # Preserve readable labels before allocating any generated ones.
        for layout in layouts:
            for item in layout['items']:
                if item['kind'] != 'shelf':
                    continue
                sid = item['id']
                label = (item.get('locationId') or sid).strip()
                if GENERATED.fullmatch(label):
                    continue
                if registry['reserved'].get(label.casefold(),sid) == sid:
                    registry['reserved'][label.casefold()] = sid
                    registry['labels'].setdefault(sid,label)
        for file in sorted((self.data_dir/'shelves').glob('*.json')):
            sid = file.stem
            identities.add(sid)
            if not GENERATED.fullmatch(sid):
                registry['reserved'].setdefault(sid.casefold(),sid)
                registry['labels'].setdefault(sid,sid)
        layout = copy.deepcopy(original)
        registry = assign_labels(layout, registry, repair=True)
        for sid in sorted(identities - set(registry['labels'])):
            registry = assign_labels({'items':[dict(id=sid,kind='shelf')]},registry,repair=True)
        writes = {}
        if layout != original: writes['lab.json'] = layout
        if registry != previous or not (self.data_dir/'location-labels.json').exists(): writes['location-labels.json'] = registry
        if not writes: return
        backup_dir = self.data_dir.parent / '.itr-backups'
        backup_dir.mkdir(parents=True, exist_ok=True)
        backup = backup_dir / ('before-location-labels-' + datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S') + '-' + secrets.token_hex(4) + '.tar.gz')
        with tarfile.open(backup,'w:gz') as archive:
            archive.add(self.data_dir,arcname='data'); archive.add(self.defaults_dir,arcname='defaults')
        write_json(self.data_dir/'pending-save.json',writes)
        self.finish_transaction()

    def reserve_labels(self, layout, repair=False):
        previous = self.label_registry()
        registry = assign_labels(layout, previous, repair=repair)
        if registry != previous:
            write_json(self.data_dir/'pending-save.json',{'location-labels.json':registry})
            self.finish_transaction()
        return {item['id']:item['locationId'] for item in layout['items'] if item['kind']=='shelf'}

    def migrate_locations(self):
        """Checkpoint first; migrate current files only, including unplaced shelves."""
        writes = {}
        for path in sorted((self.data_dir / "shelves").glob("*.json")):
            source = json.loads(path.read_text())
            identified = identify_bins(source)
            validate_shelf(identified, path.stem)
            if identified != source:
                writes["shelves/" + path.name] = identified
        if not (self.data_dir / "inventory.json").exists():
            writes["inventory.json"] = empty_inventory()
        if not writes:
            return
        backup_dir = self.data_dir.parent / ".itr-backups"
        backup_dir.mkdir(exist_ok=True)
        backup = backup_dir / ("before-locations-" + datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S") + "-" + secrets.token_hex(4) + ".tar.gz")
        with tarfile.open(backup, "w:gz") as archive:
            archive.add(self.data_dir, arcname="data")
            archive.add(self.defaults_dir, arcname="defaults")
        write_json(self.data_dir / "pending-save.json", writes)
        self.finish_transaction()

    def migrate_bin_contents(self):
        marker = self.data_dir / 'bin-contents-migration.json'
        if marker.exists():
            return
        current = self.stock_document()
        sources = {p.stem: json.loads(p.read_text()) for p in sorted((self.data_dir/'shelves').glob('*.json'))}
        doc, shelves, report = convert_bin_contents(current, sources)
        for sid, shelf in shelves.items():
            validate_shelf(shelf, sid)
        backup_dir = self.data_dir.parent / '.itr-backups'
        backup_dir.mkdir(exist_ok=True)
        backup = backup_dir / ('before-bin-contents-' + datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S') + '-' + secrets.token_hex(4) + '.tar.gz')
        with tarfile.open(backup, 'w:gz') as archive:
            archive.add(self.data_dir, arcname='data')
            archive.add(self.defaults_dir, arcname='defaults')
        report.update(savedAt=datetime.now(timezone.utc).isoformat(), backup=backup.name)
        writes = {'bin-contents-migration.json': report}
        for sid, shelf in shelves.items():
            if shelf != sources[sid]:
                writes['shelves/'+sid+'.json'] = shelf
        if report['converted']:
            doc['revision'] += 1
            doc['lastChange'] = dict(savedAt=report['savedAt'], action='migration', reason='Legacy bin contents converted to presence inventory')
            writes.update({'inventory.json':doc, f"history/inventory/{doc['revision']}.json":doc})
            if not (self.data_dir/f"history/inventory/{current['revision']}.json").exists():
                writes[f"history/inventory/{current['revision']}.json"] = current
        write_json(self.data_dir/'pending-save.json', writes)
        self.finish_transaction()

    def finish_transaction(self):
        journal = self.data_dir / 'pending-save.json'
        if journal.exists():
            for name, doc in json.loads(journal.read_text()).items():
                write_json(self.data_dir / name, doc)
            journal.unlink()

    def shelf_snapshot(self, lab):
        result = {}
        for item in lab['items']:
            if item['kind'] == 'shelf':
                path = self.data_dir / 'shelves' / (item['id'] + '.json')
                result[item['id']] = normalize_shelf(json.loads(path.read_text()), item['name']) if path.exists() else blank_shelf(item['id'], item['name'])
        return result

    def stock_document(self):
        return json.loads((self.data_dir / 'inventory.json').read_text())

    def commit_stock(self, body):
        if not isinstance(body, dict):
            raise ValueError('Invalid inventory request.')
        current = self.stock_document()
        operation = body.get('operationId')
        if not isinstance(operation, str) or not ID.fullmatch(operation):
            raise ValueError('A unique operation ID is required.')
        if operation in current.get('operations', {}):
            result = current['operations'][operation]
            if result.get('itemId') in current.get('deletedItems', {}):
                raise ValueError('This item was permanently deleted. Refresh inventory.')
            if result.get('stockId') and result['stockId'] not in current['stocks']:
                raise ValueError('This location assignment was removed. Refresh inventory.')
            return result
        if type(body.get('revision')) is not int or body['revision'] != current['revision']:
            raise RevisionConflict('Inventory changed in another editor. Your entry is kept open; reload inventory and reconcile before saving.')
        doc = copy.deepcopy(current)
        locations = self.stock_locations()
        result = {}
        action = body.get('action')
        quick_entry = action == 'quick'
        if action == 'quick':
            item = validate_item(body.get('item'))
            destination = body.get('stock', {})
            if not isinstance(destination,dict):
                raise ValueError('Invalid inventory destination.')
            matches = [(sid, stock) for sid, stock in doc['stocks'].items()
                       if not stock.get('archived') and stock.get('shelfId') == destination.get('shelfId')
                       and stock.get('binId') == destination.get('binId')
                       and doc['items'][stock['itemId']]['name'] == item['name']]
            if len(matches) > 1:
                raise ValueError('Several distinct items here have this name. Open their details to choose the correct identity.')
            if matches:
                sid, stock = matches[0]
                return dict(itemId=stock['itemId'], stockId=sid, revision=current['revision'], existing=True)
            body = dict(body, item=item, stock=dict(destination, tracking='presence', quantity=None), action='save')
            action = 'save'
        if action == 'save':
            item_id = body.get('itemId')
            if item_id and item_id not in doc['items']:
                raise ValueError('Item no longer exists.')
            if 'item' in body:
                item_id = item_id or 'I-' + secrets.token_hex(16)
                doc['items'][item_id] = validate_item(body['item'])
            if not item_id:
                raise ValueError('Choose an item or enter its name.')
            result['itemId'] = item_id
            if 'stock' in body:
                stock_id = body.get('stockId') or 'ST-' + secrets.token_hex(16)
                if body.get('stockId') and stock_id not in doc['stocks']:
                    raise ValueError('Stock entry no longer exists.')
                previous = doc['stocks'].get(stock_id)
                if previous and previous['itemId'] != item_id:
                    raise ValueError('Editing stock cannot change its item identity.')
                stock = validate_stock(dict(body['stock'], itemId=item_id), doc['items'], locations, previous)
                for sid, other in doc['stocks'].items():
                    if sid != stock_id and not other.get('archived') and not stock['archived'] and all(other.get(k) == stock.get(k) for k in ('itemId','shelfId','binId','unit')):
                        raise ValueError('This item already has stock at that location in that unit. Edit its existing entry instead.')
                doc['stocks'][stock_id] = stock
                result['stockId'] = stock_id
                if quick_entry:
                    result.update(item=doc['items'][item_id],stock=stock)
        elif action == 'delete-item':
            item_id = body.get('itemId')
            if item_id not in doc['items']:
                raise ValueError('Item no longer exists.')
            doc.setdefault('deletedItems', {})[item_id] = dict(name=doc['items'][item_id]['name'],
                deletedAt=datetime.now(timezone.utc).isoformat(), revision=current['revision']+1)
            del doc['items'][item_id]
            doc['stocks'] = {sid: stock for sid, stock in doc['stocks'].items() if stock['itemId'] != item_id}
            result['deletedItemId'] = item_id
        elif action == 'remove-location':
            source = doc['stocks'].get(body.get('stockId'))
            if not source:
                raise ValueError('Stock entry no longer exists.')
            doc['stocks'] = {sid: stock for sid, stock in doc['stocks'].items()
                if any(stock.get(k) != source.get(k) for k in ('itemId','shelfId','binId'))}
            result['removedLocation'] = location_key(source['shelfId'],source.get('binId')) if source.get('shelfId') else ''
        elif action in ('archive', 'reactivate'):
            stock = doc['stocks'].get(body.get('stockId'))
            if not stock:
                raise ValueError('Stock entry not found.')
            if action == 'reactivate' and any(not other.get('archived') and other is not stock and all(other.get(k) == stock.get(k) for k in ('itemId','shelfId','binId','unit')) for other in doc['stocks'].values()):
                raise ValueError('An active entry already exists at this location. Reconcile stock first.')
            stock['archived'] = action == 'archive'
        elif action == 'transfer':
            source = doc['stocks'].get(body.get('stockId'))
            if not source or source.get('archived') or source['tracking'] != 'exact' or source['quantity'] is None:
                raise ValueError('Partial transfers require active stock with a known exact quantity. Use Edit stock to relocate other tracking types.')
            amount = Decimal(decimal_value(body.get('amount'), 'Transfer amount', optional=False))
            if amount <= 0 or amount > Decimal(source['quantity']):
                raise ValueError('Transfer amount must be positive and cannot exceed the source quantity.')
            target = validate_stock(dict(source, shelfId=body.get('shelfId'), binId=body.get('binId'), quantity=format(amount,'f')), doc['items'], locations)
            if (target['shelfId'],target['binId']) == (source['shelfId'],source['binId']):
                raise ValueError('Choose a different destination.')
            destination = next((stock for stock in doc['stocks'].values() if not stock.get('archived') and all(stock[k] == target[k] for k in ('itemId','shelfId','binId','unit'))), None)
            if destination:
                if destination['tracking'] != 'exact' or destination['quantity'] is None:
                    raise ValueError('Destination stock needs a known exact quantity before merging a transfer.')
                destination['quantity'] = decimal_value(format(Decimal(destination['quantity'])+amount,'f'), 'Destination quantity')
            else:
                doc['stocks']['ST-' + secrets.token_hex(16)] = target
            source['quantity'] = format(Decimal(source['quantity'])-amount,'f')
        else:
            raise ValueError('Unknown inventory operation.')
        doc['revision'] += 1
        result['revision'] = doc['revision']
        doc.setdefault('operations', {})[operation] = result
        doc['lastChange'] = dict(savedAt=datetime.now(timezone.utc).isoformat(), action=action,
                                reason=body.get('reason', 'Inventory ' + action), operationId=operation)
        if not text(doc['lastChange']['reason'], 500):
            raise ValueError('Correction note is limited to 500 characters.')
        if action in ('delete-item', 'remove-location'):
            backup_dir = self.data_dir.parent / '.itr-backups'
            backup_dir.mkdir(parents=True, exist_ok=True)
            backup = backup_dir / ('before-inventory-delete-' + datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S') + '-' + secrets.token_hex(4) + '.tar.gz')
            with tarfile.open(backup, 'w:gz') as archive:
                archive.add(self.data_dir, arcname='data')
                archive.add(self.defaults_dir, arcname='defaults')
        writes = {'inventory.json':doc}
        # Audit snapshots are independent of map versions and include before/after.
        for state in (current, doc):
            writes[f"history/inventory/{state['revision']}.json"] = state
        write_json(self.data_dir / 'pending-save.json', writes)
        self.finish_transaction()
        return result

    def stock_locations(self, prefix=None):
        """Resolve identities from current geometry, retaining stock in absent locations."""
        self.prune_drafts()
        lab = json.loads((self.data_dir / 'lab.json').read_text())
        saved_shelves = {i['id'] for i in lab['items'] if i['kind'] == 'shelf'}
        cached_lab = self.drafts.get((*prefix, 'lab')) if prefix else None
        if cached_lab:
            lab = cached_lab['state']['data']
        mapped = {i['id']: i for i in lab['items'] if i['kind'] == 'shelf'}
        ids = {p.stem for p in (self.data_dir / 'shelves').glob('*.json')} | set(mapped)
        locations = {}
        inventory = self.stock_document()
        saved_objects = {i['id'] for i in json.loads((self.data_dir / 'lab.json').read_text())['items'] if i['kind'] in INVENTORY_KINDS}
        for item in lab['items']:
            if item['kind'] in INVENTORY_KINDS - {'shelf'}:
                locations[item['id']] = dict(shelfId=item['id'], binId=None, mapped=True,
                    saved=item['id'] in saved_objects, hidden=False, kind=item['kind'],
                    label=item['name'] + ' · ' + (item.get('locationId') or item['id']))
        for sid in sorted(ids):
            path = self.data_dir / 'shelves' / (sid + '.json')
            persisted = normalize_shelf(json.loads(path.read_text())) if path.exists() else blank_shelf(sid)
            saved_bins = {b['id'] for row in persisted['matrix'] for b in row if b}
            cached = self.drafts.get((*prefix, 'shelves/' + sid)) if prefix else None
            shelf = normalize_shelf(cached['state']['data']) if cached else persisted
            item = mapped.get(sid, {})
            location_label = item.get('locationId') or self.label_registry()['labels'].get(sid) or sid
            label = location_label
            label = (shelf['name'] or item.get('name', sid)) + ' · ' + label
            common = dict(shelfId=sid, mapped=sid in mapped, saved=sid in saved_shelves, shelfMode=shelf['mode'], locationId=location_label)
            locations[sid] = dict(common, binId=None, label=label, hidden=False)
            for row in shelf['matrix']:
                for bin in row:
                    if bin:
                        key = location_key(sid, bin['id'])
                        locations[key] = dict(common, binId=bin['id'], label=label + ' / ' + bin_display_name(bin,sid,inventory,shelf),
                                              hidden=shelf['mode'] == 'simple', saved=sid in saved_shelves and bin['id'] in saved_bins)
        return locations

    def prune_drafts(self):
        now = time.time()
        active = lambda token: self.sessions.get(token, {}).get('expires', 0) > now
        self.draft_epochs = {k:v for k,v in self.draft_epochs.items() if active(k[0])}
        self.inventory_states = {k:v for k,v in self.inventory_states.items() if active(k[0])}
        self.drafts = {k:v for k,v in self.drafts.items()
                       if v['expires'] > now and active(k[0])}

    def remember_inventory(self, prefix, shelves):
        reference = secrets.token_hex(16)
        self.inventory_states[(*prefix, reference)] = copy.deepcopy(shelves)
        return reference

    def apply_inventory(self, prefix, shelves):
        for sid, shelf in shelves.items():
            validate_shelf(shelf, sid)
        for sid, shelf in shelves.items():
            target = self.data_dir / 'shelves' / (sid+'.json')
            restored = normalize_shelf(shelf)
            restored['revision'] = json.loads(target.read_text())['revision'] if target.exists() else 0
            key = (*prefix, 'shelves/'+sid)
            previous = self.drafts.get(key)
            history = [previous['state']['data']] if previous else []
            self.drafts[key] = {'expires': time.time()+8*3600, 'state': dict(data=restored, history=history, future=[], dirty=True)}

    def archive_lab(self, doc, reason='Saved layout', replace=False, shelves=None):
        path = self.data_dir / 'history' / 'lab' / f"{doc['revision']}.json"
        if replace or not path.exists():
            write_json(path, {'savedAt': datetime.now(timezone.utc).isoformat(),
                              'reason': reason, 'layout': doc, 'shelves': shelves if shelves is not None else self.shelf_snapshot(doc)})

    def persist_lab(self, doc, reason, shelves):
        doc = {key:value for key,value in doc.items() if key not in ('_inventoryState','_previousInventoryState')}
        current = json.loads((self.data_dir / 'lab.json').read_text())
        self.archive_lab(current)
        writes = {f'shelves/{sid}.json': shelf for sid, shelf in shelves.items()}
        writes[f"history/lab/{doc['revision']}.json"] = {
            'savedAt': datetime.now(timezone.utc).isoformat(), 'reason': reason,
            'layout': doc, 'shelves': shelves}
        writes['lab.json'] = doc
        writes['location-labels.json'] = assign_labels(doc, self.label_registry())
        write_json(self.data_dir / 'pending-save.json', writes)
        self.finish_transaction()

    def commit_version(self, doc, prefix, overrides=None):
        self.prune_drafts()
        assign_labels(doc, self.label_registry())
        shelves = self.shelf_snapshot(doc)
        overrides = overrides or {}
        updated = []
        for sid, persisted in shelves.items():
            cached = self.drafts.get((*prefix, 'shelves/'+sid))
            if sid in overrides:
                shelves[sid] = overrides[sid]
                if cached:
                    updated.append((cached, overrides[sid]))
            elif cached and cached['state']['dirty']:
                draft = copy.deepcopy(cached['state']['data'])
                draft = normalize_shelf(draft)
                validate_shelf(draft, sid)
                if draft.get('revision') != persisted['revision']:
                    raise RevisionConflict(f'Shelf {sid} changed on the server. Reload that shelf before saving the lab.')
                draft['revision'] += 1
                draft['versionName'] = doc['versionName']
                shelves[sid] = draft
                updated.append((cached, draft))
        shelves.update(overrides)
        previous = json.loads((self.data_dir/'lab.json').read_text())
        old_names = {item['id']: item['name'] for item in previous['items'] if item['kind'] == 'shelf'}
        for item in doc['items']:
            sid = item['id']
            if item['kind'] != 'shelf' or old_names.get(sid) == item['name']:
                continue
            shelf = shelves[sid]
            if shelf['name'] != item['name']:
                shelf['name'] = item['name']
                if not any(draft is shelf for _, draft in updated) and sid not in overrides:
                    shelf['revision'] += 1
                    shelf['versionName'] = doc['versionName']
                    cached = self.drafts.get((*prefix, 'shelves/'+sid))
                    if cached:
                        updated.append((cached, shelf))
        self.persist_lab(doc, doc['versionName'], shelves)
        for cached, draft in updated:
            cached['state']['data'] = draft
            cached['state']['dirty'] = False


class LocalRequestHandler(BaseHTTPRequestHandler):
    def json_response(self, code, data, cookie=None, headers=None):
        raw = json.dumps(data).encode()
        self.send_response(code)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Content-Length', str(len(raw)))
        if cookie:
            self.send_header('Set-Cookie', cookie)
        for name, value in (headers or {}).items():
            self.send_header(name, str(value))
        self.end_headers()
        try:
            self.wfile.write(raw)
        except (BrokenPipeError, ConnectionResetError):
            pass  # A client may navigate away while a read is in flight.

    def token(self):
        jar = cookies.SimpleCookie()
        try:
            jar.load(self.headers.get('Cookie', ''))
            return jar['itr_session'].value if 'itr_session' in jar else ''
        except cookies.CookieError:
            return ''

    def admin(self):
        session = self.server.sessions.get(self.token(), {})
        return session.get('expires', 0) > time.time() and session.get('role') == 'admin'

    def treasurer(self):
        session = self.server.sessions.get(self.token(), {})
        return session.get('expires', 0) > time.time() and session.get('role') in ('admin', 'treasurer')

    def member(self):
        return bool(self.member_user())

    def member_user(self):
        return self.server.accounts.session_user(self.token()) if self.server.accounts else None

    def session_info(self):
        member = self.member_user()
        if member:
            return dict(admin=False, treasurer=False, member=True, username=member['name'], role='member', user=member)
        session = self.server.sessions.get(self.token(), {})
        if session.get('expires', 0) <= time.time():
            return dict(admin=False, treasurer=False, member=False, username='', role='visitor')
        role = session.get('role', 'visitor')
        return dict(admin=role == 'admin', treasurer=role in ('admin', 'treasurer'),
                    member=False, username=session.get('username', ''), role=role)

    def read_body(self):
        length = int(self.headers.get('Content-Length', '0'))
        if not 0 < length <= MAX_BODY:
            raise ValueError('Missing or oversized request body.')
        return json.loads(self.rfile.read(length))

    def same_origin(self):
        # Cookies alone are insufficient: reject cross-origin mutations.
        origin = self.headers.get('Origin')
        if self.headers.get('Sec-Fetch-Site') == 'cross-site':
            return False
        host = self.headers.get('Host', '')
        return not origin or origin in ('http://' + host, 'https://' + host)

    def session_cookie(self, token):
        secure = '; Secure' if self.headers.get('X-Forwarded-Proto', '').split(',')[0] == 'https' else ''
        return f'itr_session={token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=28800{secure}'

    def resource(self):
        path = urlsplit(self.path).path
        if path == '/api/lab':
            return self.server.data_dir / 'lab.json', None
        match = re.fullmatch(r'/api/shelves/([A-Za-z0-9_-]{1,64})', path)
        if match:
            return self.server.data_dir / 'shelves' / (match[1] + '.json'), match[1]
        return None, None

    def draft_key(self):
        path = urlsplit(self.path).path
        match = re.fullmatch(r'/api/drafts/(lab|shelves/[A-Za-z0-9_-]{1,64})', path)
        instance = self.headers.get('X-Editor-Instance', '')
        if not match or not ID.fullmatch(instance):
            raise ValueError('A valid editor instance is required.')
        return self.token(), instance, match[1]

    def draft_has_shelf(self, shelf_id):
        key = (self.token(), self.headers.get('X-Editor-Instance', ''), 'lab')
        cached = self.server.drafts.get(key)
        return self.admin() and cached and cached['expires'] > time.time() and any(
            item['id'] == shelf_id and item['kind'] == 'shelf'
            for item in cached['state']['data']['items'])

    def shelf_name(self, shelf_id):
        cached = self.server.drafts.get((self.token(), self.headers.get('X-Editor-Instance', ''), 'lab')) if self.admin() else None
        lab = cached['state']['data'] if cached else json.loads((self.server.data_dir / 'lab.json').read_text())
        return next((i['name'] for i in lab['items'] if i['id'] == shelf_id), shelf_id)

    def draft_request(self, write=False):
        if not self.admin() or (write and not self.same_origin()):
            return self.json_response(403, {'error': 'Admin login required for draft memory.'})
        with self.server.lock:
            try:
                key = self.draft_key()
                self.server.prune_drafts()
                epoch = self.server.draft_epochs.get(key, 0)
                response_headers = {'X-Draft-Epoch': epoch}
                if write:
                    supplied = self.headers.get('X-Draft-Epoch')
                    if supplied is not None and supplied != str(epoch):
                        return self.json_response(409, {'error': 'This working copy was deleted. Load the saved state before editing again.', 'code': 'draft_deleted'})
                    body = self.read_body()
                    if not isinstance(body, dict) or type(body.get('dirty')) is not bool:
                        raise ValueError('Invalid draft.')
                    for stack in ('history', 'future'):
                        if not isinstance(body.get(stack), list) or len(body[stack]) > 40:
                            raise ValueError('Draft history is limited to 40 steps.')
                    for doc in [body.get('data')] + body['history'] + body['future']:
                        if key[2] == 'lab':
                            validate_lab(doc)
                            if doc.get('_inventoryState') is not None and (not isinstance(doc['_inventoryState'],str) or (*key[:2], doc['_inventoryState']) not in self.server.inventory_states):
                                raise ValueError('Inventory undo memory has expired. Reload the saved version.')
                        else:
                            validate_shelf(doc, key[2].split('/')[1])
                            doc.update(normalize_shelf(doc))
                    if key not in self.server.drafts and len(self.server.drafts) >= 100:
                        raise ValueError('Draft cache is full. Close unused sessions and try again.')
                    location_labels = self.server.reserve_labels(body['data']) if key[2] == 'lab' else {}
                    inventory_changed = False
                    if key[2] == 'lab':
                        reference = body['data'].get('_inventoryState')
                        previous = self.server.drafts.get(key)
                        if reference and (not previous or reference != previous['state']['data'].get('_inventoryState')):
                            self.server.apply_inventory(key[:2], self.server.inventory_states[(*key[:2], reference)])
                            inventory_changed = True
                        else:
                            old_lab = previous['state']['data'] if previous else json.loads((self.server.data_dir/'lab.json').read_text())
                            old_names = {item['id']: item['name'] for item in old_lab['items'] if item['kind'] == 'shelf'}
                            for item in body['data']['items']:
                                if item['kind'] != 'shelf' or old_names.get(item['id']) == item['name']:
                                    continue
                                shelf_key = (*key[:2], 'shelves/'+item['id'])
                                cached = self.server.drafts.get(shelf_key)
                                if cached:
                                    state = copy.deepcopy(cached['state'])
                                else:
                                    file = self.server.data_dir/'shelves'/(item['id']+'.json')
                                    shelf = normalize_shelf(json.loads(file.read_text()), item['name']) if file.exists() else blank_shelf(item['id'], item['name'])
                                    state = dict(data=shelf, history=[], future=[], dirty=False)
                                if state['data']['name'] != item['name']:
                                    state['data']['name'] = item['name']
                                    state['dirty'] = True
                                    self.server.drafts[shelf_key] = dict(expires=time.time()+8*3600, state=state)
                                    inventory_changed = True
                    self.server.drafts[key] = {'expires': time.time()+8*3600, 'state': body}
                    return self.json_response(200, {'cached': True, 'inventoryChanged': inventory_changed, 'locationLabels':location_labels}, headers=response_headers)
                cached = self.server.drafts.get(key)
                return self.json_response(200, cached['state'] if cached else None, headers=response_headers)
            except (ValueError, UnicodeDecodeError) as error:
                return self.json_response(400, {'error': str(error)})

    def consistent_request(self, callback, recover=False):
        # Keep the journal check and the complete request under the same lock.
        # GET never changes saved data or silently completes a pending save.
        with self.server.lock:
            pending = (self.server.data_dir / 'pending-save.json').exists()
            if pending and (not recover or not self.treasurer() or not self.same_origin()):
                return self.json_response(503, {'error':'An explicitly saved transaction is pending disk recovery. Retry the same save when storage is available, or restart the server after protecting active drafts.'})
            if recover:
                try:
                    self.server.finish_transaction()
                except OSError:
                    return self.json_response(503, {'error':'A saved transaction is pending disk recovery. Retry the same save when storage is available.'})
            return callback()

    def do_GET(self):
        return self.consistent_request(self.request_get)

    def do_POST(self):
        return self.consistent_request(self.request_post, recover=True)

    def do_PUT(self):
        return self.consistent_request(self.request_put, recover=True)

    def do_DELETE(self):
        return self.consistent_request(self.request_delete, recover=True)

    def request_get(self):
        path = urlsplit(self.path).path
        if path == '/api/inventory/suggestions':
            try:
                return self.json_response(200, self.server.inventory_suggestions(parse_qs(urlsplit(self.path).query).get('q', [''])[0]))
            except ValueError as error:
                return self.json_response(400, {'error': str(error)})
        if path == '/api/projects':
            if not self.treasurer():
                return self.json_response(403, {'error': 'Treasurer login required to review projects.'})
            try:
                return self.json_response(200, self.server.projects_document())
            except (OSError, ValueError, KeyError):
                return self.json_response(500, {'error': 'Could not read project requests.'})
        if path == '/api/treasury/overview':
            if not self.treasurer():
                return self.json_response(403, {'error': 'Treasurer login required.'})
            try:
                projects = self.server.projects_document()
                treasury = self.server.treasury_document()
                rows = []
                totals = {}
                for project_id, project in projects['projects'].items():
                    record = treasury['records'].get(project_id, {})
                    currency = project['estimate']['currency']
                    amount = project['estimate']['amount']
                    totals[currency] = str(Decimal(totals.get(currency, '0')) + Decimal(amount))
                    rows.append(dict(projectId=project_id, title=project['title'], lead=project['lead'], contact=project['contact'],
                        stage=project['stage'], projectStatus=project['status'], estimate=project['estimate'],
                        lineItems=project['lineItems'], nonItemCost=project.get('nonItemCost', '0'), treasury=record,
                        submittedAt=project['submittedAt'], updatedAt=project['updatedAt']))
                return self.json_response(200, dict(projects=rows, totals=totals, revision=treasury['revision'], projectsRevision=projects['revision']))
            except (OSError, ValueError, KeyError):
                return self.json_response(500, {'error': 'Could not read treasury dashboard.'})
        match = re.fullmatch(r'/api/treasury/projects/([A-Za-z0-9_-]{1,64})', path)
        if match:
            if not self.treasurer():
                return self.json_response(403, {'error': 'Treasurer login required.'})
            projects = self.server.projects_document()
            project = projects['projects'].get(match[1])
            if not project:
                return self.json_response(404, {'error': 'Project not found.'})
            treasury = self.server.treasury_document()
            return self.json_response(200, dict(project=project, record=treasury['records'].get(match[1]), revision=treasury['revision']))
        if path == '/api/backup' or path.startswith('/api/inventory/history'):
            if not self.admin():
                return self.json_response(403, {'error': 'Admin login required.'})
            with self.server.lock:
                try:
                    if path == '/api/backup':
                        files = {str(p.relative_to(self.server.data_dir)): json.loads(p.read_text())
                                 for p in self.server.data_dir.rglob('*.json') if p.name != 'pending-save.json'}
                        return self.json_response(200, dict(format='itr-full-backup', schemaVersion=1,
                            savedAt=datetime.now(timezone.utc).isoformat(), data=files,
                            defaults={'lab.json':json.loads((self.server.defaults_dir / 'lab.json').read_text())}))
                    if path == '/api/inventory/history':
                        entries = []
                        for p in (self.server.data_dir / 'history/inventory').glob('*.json'):
                            state = json.loads(p.read_text())
                            entries.append(dict(revision=state['revision'], **state.get('lastChange', {})))
                        return self.json_response(200, sorted(entries, key=lambda e:e['revision'], reverse=True))
                    match = re.fullmatch(r'/api/inventory/history/(\d{1,12})', path)
                    if match:
                        p = self.server.data_dir / 'history/inventory' / (str(int(match[1]))+'.json')
                        if p.exists():
                            return self.json_response(200, json.loads(p.read_text()))
                    return self.json_response(404, {'error':'Audit snapshot not found.'})
                except (OSError, ValueError, KeyError):
                    return self.json_response(500, {'error':'Could not read backup or audit history.'})
        if path == '/api/reports':
            if not self.admin():
                return self.json_response(403, {'error':'Admin login required to review reports.'})
            file = self.server.data_dir/'reports.json'
            doc = json.loads(file.read_text()) if file.exists() else empty_reports()
            locations = self.server.stock_locations()
            for report in doc['reports'].values():
                location = locations.get(report['shelfId'])
                report['currentLocation'] = location['label'] if location else report['shelfLabel']
                report['mapped'] = bool(location and location['mapped'])
            return self.json_response(200,doc)
        if path == '/api/inventory/migration':
            if not self.admin():
                return self.json_response(403, {'error':'Admin login required.'})
            return self.json_response(200, json.loads((self.server.data_dir/'bin-contents-migration.json').read_text()))
        if path == '/api/inventory':
            with self.server.lock:
                try:
                    doc = self.server.stock_document()
                    for stock in doc['stocks'].values():
                        stock['estimatedValue'] = estimated_value(doc['items'][stock['itemId']], stock)
                    prefix = (self.token(), self.headers.get('X-Editor-Instance', '')) if self.admin() else None
                    return self.json_response(200, dict(doc, locations=self.server.stock_locations(prefix)))
                except (OSError, ValueError, KeyError):
                    return self.json_response(500, {'error': 'Could not read inventory.'})
        if path == '/api/session':
            return self.json_response(200, self.session_info())
        if path == '/api/recovery-context':
            if not self.admin():
                return self.json_response(403, {'error': 'Admin login required.'})
            with self.server.lock:
                lab = json.loads((self.server.data_dir/'lab.json').read_text())
                project = hashlib.sha256(str(self.server.data_dir.resolve()).encode()).hexdigest()[:24]
                session = hashlib.sha256(self.token().encode()).hexdigest()[:24]
                return self.json_response(200, {'scope': project+':'+session, 'labRevision': lab['revision']})
        if path == '/api/drafts':
            if not self.admin():
                return self.json_response(403, {'error': 'Admin login required.'})
            with self.server.lock:
                self.server.prune_drafts()
                drafts = []
                for key, cached in self.server.drafts.items():
                    if key[0] == self.token():
                        state = cached['state']
                        drafts.append(dict(instance=key[1], resource=key[2], name=state['data'].get('name') or ('Lab layout' if key[2]=='lab' else key[2]), dirty=state['dirty'], epoch=self.server.draft_epochs.get(key, 0)))
                return self.json_response(200, {'drafts': drafts})
        if path.startswith('/api/drafts/'):
            return self.draft_request()
        if path == '/api/shelf-index':
            with self.server.lock:
                try:
                    self.server.prune_drafts()
                    prefix = (self.token(), self.headers.get('X-Editor-Instance', ''))
                    cached_lab = self.server.drafts.get((*prefix, 'lab')) if self.admin() else None
                    lab = cached_lab['state']['data'] if cached_lab else json.loads((self.server.data_dir/'lab.json').read_text())
                    index = {}
                    inventory = self.server.stock_document()
                    for item in lab['items']:
                        if item['kind'] != 'shelf':
                            continue
                        cached = self.server.drafts.get((*prefix, 'shelves/'+item['id'])) if self.admin() else None
                        file = self.server.data_dir/'shelves'/f"{item['id']}.json"
                        doc = cached['state']['data'] if cached else json.loads(file.read_text()) if file.exists() else blank_shelf(item['id'], item['name'])
                        doc = normalize_shelf(doc, item['name'])
                        terms = [doc['name'], doc['contents'], doc['keywords']]
                        if doc['mode'] == 'complex':
                            for row in doc['matrix']:
                                for bin in row:
                                    if bin:
                                        terms.append(bin['name'])
                        structured = [inventory['items'][stock['itemId']] for stock in inventory['stocks'].values() if stock.get('shelfId') == item['id'] and not stock.get('archived')]
                        terms.extend(' '.join(str(record.get(k, '')) for k in ('name','category','keywords','description','vendor','notes')) for record in structured)
                        index[item['id']] = {key: doc[key] for key in ('name', 'mode', 'contents', 'keywords')}
                        destinations = {None: dict(binId=None, name=doc['name'], searchText=' '.join([item['name'], item.get('locationId',''), doc['name'], doc['contents'], doc['keywords']]).lower())}
                        for row in doc['matrix']:
                            for bin in row:
                                if bin and doc['mode'] == 'complex':
                                    destinations[bin['id']] = dict(binId=bin['id'], name=bin_display_name(bin,item['id'],inventory,doc), searchText=bin['name'].lower())
                        for stock in inventory['stocks'].values():
                            if stock.get('shelfId') != item['id'] or stock.get('archived'):
                                continue
                            bid = stock.get('binId')
                            if bid not in destinations:
                                bin = next((cell for row in doc['matrix'] for cell in row if cell and cell['id'] == bid), None)
                                if not bin:
                                    continue
                                destinations[bid] = dict(binId=bid,name=bin_display_name(bin,item['id'],inventory,doc),searchText=bin['name'].lower())
                            record = inventory['items'][stock['itemId']]
                            destinations[bid]['searchText'] += ' ' + ' '.join(str(record.get(k) or '') for k in ('name','category','keywords','description','vendor','notes','productLink')).lower() + ' ' + stock.get('notes','').lower()
                        index[item['id']]['destinations'] = list(destinations.values())
                        index[item['id']]['structuredItems'] = list({record['name'] for record in structured})
                        index[item['id']]['searchText'] = ' '.join(terms).lower()
                        index[item['id']]['draftDirty'] = bool(cached and cached['state']['dirty'])
                    return self.json_response(200, index)
                except (OSError, ValueError, KeyError, TypeError):
                    return self.json_response(500, {'error': 'Could not index shelf files. Check their JSON.'})
        if path == '/api/lab/history':
            with self.server.lock:
                try:
                    current = json.loads((self.server.data_dir / 'lab.json').read_text())
                    versions = []
                    for file in (self.server.data_dir / 'history' / 'lab').glob('*.json'):
                        record = json.loads(file.read_text())
                        revision = record['layout']['revision']
                        if revision <= current['revision']:
                            versions.append({'version': str(revision), 'revision': revision,
                                             'savedAt': record['savedAt'], 'reason': record['reason'],
                                             'name': record['layout'].get('versionName', record['reason'])})
                    if not any(v['revision'] == current['revision'] for v in versions):
                        versions.append({'version': str(current['revision']), 'revision': current['revision'],
                                         'savedAt': None, 'reason': 'Current saved layout',
                                         'name': current.get('versionName', 'Current saved layout')})
                    versions.sort(key=lambda v: v['revision'], reverse=True)
                    return self.json_response(200, {'currentRevision': current['revision'], 'versions': versions})
                except (OSError, ValueError, KeyError):
                    return self.json_response(500, {'error': 'Could not read layout history.'})
        file, shelf_id = self.resource()
        if file:
            with self.server.lock:
                if not file.exists():
                    if shelf_id and self.draft_has_shelf(shelf_id):
                        return self.json_response(200, blank_shelf(shelf_id, self.shelf_name(shelf_id)))
                    return self.json_response(404, {'error': 'Shelf not found.'})
                try:
                    doc = json.loads(file.read_text())
                    return self.json_response(200, normalize_shelf(doc, self.shelf_name(shelf_id)) if shelf_id else doc)
                except (OSError, ValueError):
                    return self.json_response(500, {'error': 'Cannot read data file. Check its JSON.'})
        name = unquote(path).lstrip('/') or 'lab_overview.html'
        asset = WEB_FILES.get(name)
        if not asset:
            return self.json_response(404, {'error': 'Not found.'})
        try:
            raw = asset.read_bytes()
        except OSError:
            return self.json_response(404, {'error': 'Not found.'})
        self.send_response(200)
        self.send_header('Content-Type', mimetypes.guess_type(name)[0] or 'application/octet-stream')
        self.send_header('Content-Length', str(len(raw)))
        self.send_header('Cache-Control', 'no-cache')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.end_headers()
        try:
            self.wfile.write(raw)
        except (BrokenPipeError, ConnectionResetError):
            pass  # A client may navigate away while a read is in flight.

    def request_post(self):
        if not self.same_origin():
            return self.json_response(403, {'error': 'Cross-origin requests are not allowed.'})
        path = urlsplit(self.path).path
        with self.server.lock:
            if path == '/api/projects':
                try:
                    owner = self.member_user()
                    if not owner:
                        return self.json_response(401, {'error': 'Sign in with a member account before submitting a project.'})
                    current = self.server.projects_document()
                    doc, result = prepare_project(self.read_body(), current, self.server.stock_document(),
                                                  self.server.project_attempts, self.client_address[0], owner)
                    if doc is not None:
                        writes = {'projects.json': doc,
                                  f"history/projects/{doc['revision']}.json": doc}
                        if not (self.server.data_dir / f"history/projects/{current['revision']}.json").exists():
                            writes[f"history/projects/{current['revision']}.json"] = current
                        write_json(self.server.data_dir / 'pending-save.json', writes)
                        self.server.finish_transaction()
                    return self.json_response(200, result)
                except OverflowError as error:
                    return self.json_response(429, {'error': str(error)})
                except (ValueError, KeyError, TypeError, UnicodeDecodeError) as error:
                    return self.json_response(400, {'error': str(error)})
                except OSError:
                    return self.json_response(500, {'error': 'Could not save project. Your submission is still open; retry it.'})
            match = re.fullmatch(r'/api/treasury/projects/([A-Za-z0-9_-]{1,64})', path)
            if match:
                if not self.treasurer():
                    return self.json_response(403, {'error': 'Treasurer login required.'})
                try:
                    body = self.read_body()
                    body['projectId'] = match[1]
                    current = self.server.treasury_document()
                    doc, result = update_record(body, current, self.server.projects_document()['projects'], self.session_info()['username'])
                    if doc is not current:
                        writes = {'treasury.json': doc,
                                  f"history/treasury/{doc['revision']}.json": doc}
                        if not (self.server.data_dir / f"history/treasury/{current['revision']}.json").exists():
                            writes[f"history/treasury/{current['revision']}.json"] = current
                        write_json(self.server.data_dir / 'pending-save.json', writes)
                        self.server.finish_transaction()
                    return self.json_response(200, result)
                except (ValueError, KeyError, TypeError, UnicodeDecodeError) as error:
                    return self.json_response(400, {'error': str(error)})
                except OSError:
                    return self.json_response(500, {'error': 'Could not save treasury review. Retry the same review.'})
            if path == '/api/reports' or path.startswith('/api/reports/'):
                resolving = path != '/api/reports'
                if resolving and not self.admin():
                    return self.json_response(403, {'error':'Admin login required to resolve reports.'})
                try:
                    file = self.server.data_dir/'reports.json'
                    current = json.loads(file.read_text()) if file.exists() else empty_reports()
                    body = self.read_body()
                    if resolving:
                        if not isinstance(body,dict) or body.get('status') not in ('resolved','dismissed','pending'):
                            raise ValueError('Choose resolved, dismissed or pending.')
                        rid = path.rsplit('/',1)[1]
                        if rid not in current['reports']:
                            return self.json_response(404, {'error':'Report not found.'})
                        if body.get('revision') != current['revision']:
                            raise RevisionConflict('Reports changed. Refresh the review list and try again.')
                        doc = copy.deepcopy(current)
                        doc['reports'][rid].update(status=body['status'],updatedAt=datetime.now(timezone.utc).isoformat())
                        doc['revision'] += 1
                        result = dict(saved=True,revision=doc['revision'])
                    else:
                        doc,result = prepare_report(body,current,self.server.stock_locations(),self.server.stock_document(),
                                                    self.server.report_attempts,self.client_address[0])
                    if doc is not None:
                        write_json(self.server.data_dir/'pending-save.json', {'reports.json':doc})
                        self.server.finish_transaction()
                    return self.json_response(200,result)
                except RevisionConflict as error:
                    return self.json_response(409, {'error':str(error)})
                except OverflowError as error:
                    return self.json_response(429, {'error':str(error)})
                except (ValueError,KeyError,TypeError,UnicodeDecodeError) as error:
                    return self.json_response(400, {'error':str(error)})
                except OSError:
                    return self.json_response(500, {'error':'Could not save report. Your text is retained; retry the same submission.'})
            if path == '/api/location-labels':
                if not self.admin():
                    return self.json_response(403, {'error':'Admin login required to allocate location labels.'})
                try:
                    body = self.read_body()
                    sid = body.get('shelfId')
                    if not isinstance(sid,str) or not ID.fullmatch(sid):
                        raise ValueError('Invalid shelf ID.')
                    labels = self.server.reserve_labels({'items':[dict(id=sid,kind='shelf')]})
                    return self.json_response(200, {'locationId':labels[sid]})
                except (ValueError,TypeError,KeyError) as error:
                    return self.json_response(400, {'error':str(error)})
            if path == '/api/inventory':
                if not self.admin():
                    return self.json_response(403, {'error':'Admin login required to edit inventory.'})
                try:
                    return self.json_response(200, self.server.commit_stock(self.read_body()))
                except RevisionConflict as error:
                    return self.json_response(409, {'error':str(error)})
                except (ValueError, KeyError, TypeError, UnicodeDecodeError) as error:
                    return self.json_response(400, {'error':str(error)})
                except OSError:
                    return self.json_response(500, {'error':'Could not complete inventory save. Your entry is still open. Retry the same operation to check whether it committed.'})
            if path == '/api/lab/restore':
                if not self.admin():
                    return self.json_response(403, {'error': 'Admin login required to restore a layout.'})
                try:
                    body = self.read_body()
                    if not isinstance(body, dict):
                        raise ValueError('Invalid restore request.')
                    current = json.loads((self.server.data_dir / 'lab.json').read_text())
                    if type(body.get('revision')) is not int or body['revision'] != current['revision']:
                        return self.json_response(409, {'error': 'The lab changed. Reload saved before restoring a version.'})
                    version = str(body.get('version', ''))
                    restored_shelves = None
                    if version == 'original':
                        doc = json.loads((self.server.defaults_dir / 'lab.json').read_text())
                    elif re.fullmatch(r'\d{1,12}', version) and int(version) <= current['revision']:
                        file = self.server.data_dir / 'history' / 'lab' / f'{int(version)}.json'
                        if file.exists():
                            record = json.loads(file.read_text())
                            doc = record['layout']
                            restored_shelves = record.get('shelves')
                        elif int(version) == current['revision']:
                            doc = current.copy()
                        elif not file.exists():
                            return self.json_response(404, {'error': 'Saved version not found.'})
                        else:
                            doc = json.loads(file.read_text())['layout']
                    else:
                        raise ValueError('Invalid saved version.')
                    validate_lab(doc)
                    self.server.reserve_labels(doc, repair=True)
                    instance = self.headers.get('X-Editor-Instance', '')
                    if restored_shelves is not None and ID.fullmatch(instance):
                        prefix = (self.token(), instance)
                        cached_lab = self.server.drafts.get((*prefix, 'lab'))
                        before = self.server.shelf_snapshot(cached_lab['state']['data'] if cached_lab else current)
                        for key, cached in self.server.drafts.items():
                            if key[:2] == prefix and key[2].startswith('shelves/'):
                                before[key[2].split('/')[1]] = cached['state']['data']
                        doc['_previousInventoryState'] = self.server.remember_inventory(prefix, before)
                        doc['_inventoryState'] = self.server.remember_inventory(prefix, restored_shelves)
                        self.server.apply_inventory(prefix, restored_shelves)
                    # Restoring loads a draft. Only an explicit named PUT commits it.
                    doc['revision'] = current['revision']
                    return self.json_response(200, doc)
                except (ValueError, KeyError, UnicodeDecodeError) as error:
                    return self.json_response(400, {'error': str(error)})
                except OSError:
                    return self.json_response(500, {'error': 'Could not load the saved layout.'})
            if path == '/api/logout':
                self.server.sessions.pop(self.token(), None)
                if self.server.accounts:
                    self.server.accounts.delete_session(self.token())
                self.server.prune_drafts()
                return self.json_response(200, {'admin': False}, 'itr_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0')
            if path in ('/api/account/signup', '/api/account/login'):
                if not self.server.accounts:
                    return self.json_response(503, {'error': 'Member accounts require DATABASE_URL to be configured.'})
                try:
                    data = self.read_body()
                    if not isinstance(data, dict):
                        raise AccountError('Invalid account request.')
                    if path.endswith('signup'):
                        user = self.server.accounts.create_user(data.get('name', ''), data.get('email', ''), data.get('password', ''))
                    else:
                        user = self.server.accounts.authenticate(data.get('email', ''), data.get('password', ''))
                    token = self.server.accounts.create_session(user)
                    return self.json_response(200, dict(member=True, admin=False, treasurer=False, role='member', username=user['name'], user=user), self.session_cookie(token))
                except (AccountError, ValueError, UnicodeDecodeError) as error:
                    return self.json_response(400 if path.endswith('signup') else 401, {'error': str(error)})
                except Exception:
                    return self.json_response(503, {'error': 'Account service is temporarily unavailable. Try again shortly.'})
            if path != '/api/login':
                return self.json_response(404, {'error': 'Not found.'})
            now = time.time()
            ip = self.client_address[0]
            attempts = [t for t in self.server.attempts.get(ip, []) if t > now-60]
            if len(attempts) >= 10:
                return self.json_response(429, {'error': 'Too many attempts. Try again in a minute.'})
            try:
                data = self.read_body()
                password = data.get('password', '') if isinstance(data, dict) else ''
                username = data.get('username', '') if isinstance(data, dict) else ''
                if not isinstance(password, str) or not isinstance(username, str):
                    raise ValueError('Invalid login request.')
            except (ValueError, UnicodeDecodeError):
                return self.json_response(400, {'error': 'Invalid login request.'})
            # Empty username is retained for existing Admin Login dialogs.
            role = 'treasurer' if username == self.server.treasurer_username else 'admin'
            expected = self.server.treasurer_password_hash if role == 'treasurer' else self.server.password_hash
            valid_username = role == 'treasurer' or not username or username == self.server.admin_username
            if not valid_username or not hmac.compare_digest(hashlib.sha256(password.encode()).digest(), expected):
                self.server.attempts[ip] = attempts + [now]
                return self.json_response(401, {'error': 'Incorrect username or password.'})
            self.server.attempts.pop(ip, None)
            self.server.sessions = {k:v for k,v in self.server.sessions.items() if v.get('expires', 0) > now}
            token = secrets.token_urlsafe(32)
            self.server.sessions[token] = dict(expires=now + 8*3600, role=role,
                                                username=username or self.server.admin_username)
            return self.json_response(200, dict(admin=role == 'admin', treasurer=True, role=role,
                username=username or self.server.admin_username), self.session_cookie(token))

    def request_delete(self):
        path = urlsplit(self.path).path
        project = re.fullmatch(r'/api/treasury/projects/([A-Za-z0-9_-]{1,64})', path)
        if project:
            if not self.treasurer() or not self.same_origin():
                return self.json_response(403, {'error': 'Treasurer login required.'})
            try:
                body = self.read_body()
                projects = self.server.projects_document()
                treasury = self.server.treasury_document()
                if not isinstance(body, dict) or body.get('projectsRevision') != projects['revision'] or body.get('treasuryRevision') != treasury['revision']:
                    return self.json_response(409, {'error': 'Project data changed. Refresh and try again.'})
                updated_projects = delete_project(projects, project[1])
                updated_treasury = copy.deepcopy(treasury)
                updated_treasury['records'].pop(project[1], None)
                updated_treasury['revision'] += 1
                writes = {'projects.json': updated_projects, 'treasury.json': updated_treasury,
                          f"history/projects/{updated_projects['revision']}.json": updated_projects,
                          f"history/treasury/{updated_treasury['revision']}.json": updated_treasury}
                write_json(self.server.data_dir / 'pending-save.json', writes)
                self.server.finish_transaction()
                return self.json_response(200, {'deleted': True})
            except KeyError:
                return self.json_response(404, {'error': 'Project not found.'})
            except (ValueError, TypeError, UnicodeDecodeError) as error:
                return self.json_response(400, {'error': str(error)})
            except OSError:
                return self.json_response(500, {'error': 'Could not delete project. Retry the same request.'})
        if not self.admin() or not self.same_origin():
            return self.json_response(403, {'error': 'Admin login required.'})
        with self.server.lock:
            try:
                key = self.draft_key()
                self.server.prune_drafts()
                epoch = self.server.draft_epochs.get(key, 0)
                if self.headers.get('X-Draft-Epoch', str(epoch)) != str(epoch):
                    return self.json_response(409, {'error': 'The draft changed. Refresh the draft list.'})
                self.server.drafts.pop(key, None)
                self.server.draft_epochs[key] = epoch+1
                # Inventory undo snapshots must not resurrect an explicitly deleted shelf draft.
                if key[2].startswith('shelves/'):
                    for ref, shelves in self.server.inventory_states.items():
                        if ref[:2] == key[:2]:
                            shelves.pop(key[2].split('/')[1], None)
                return self.json_response(200, {'deleted': True}, headers={'X-Draft-Epoch': epoch+1})
            except ValueError as error:
                return self.json_response(400, {'error': str(error)})

    def request_put(self):
        if urlsplit(self.path).path.startswith('/api/drafts/'):
            return self.draft_request(write=True)
        if not self.same_origin() or not self.admin():
            return self.json_response(403, {'error': 'Admin login required to save changes.'})
        file, shelf_id = self.resource()
        if not file:
            return self.json_response(404, {'error': 'Not found.'})
        with self.server.lock:
            try:
                if not file.exists() and not (shelf_id and self.draft_has_shelf(shelf_id)):
                    return self.json_response(404, {'error': 'Shelf not found.'})
                doc = self.read_body()
                if not isinstance(doc, dict) or not text(doc.get('versionName'), 120) or not doc['versionName'].strip():
                    raise ValueError('Enter a version name (1–120 characters) before saving.')
                doc['versionName'] = doc['versionName'].strip()
                requested_labels = {i['id']:i.get('locationId') for i in doc.get('items',[]) if i.get('kind')=='shelf'}
                if shelf_id:
                    doc = normalize_shelf(doc, self.shelf_name(shelf_id))
                    validate_shelf(doc, shelf_id)
                else:
                    validate_lab(doc)
                current = json.loads(file.read_text()) if file.exists() else blank_shelf(shelf_id)
                if type(doc.get('revision')) is not int or doc['revision'] != current['revision']:
                    return self.json_response(409, {'error': 'Another admin saved changes. Export your draft, then reload before editing again.'})
                doc['revision'] += 1
                prefix = (self.token(), self.headers.get('X-Editor-Instance', ''))
                if not shelf_id:
                    self.server.commit_version(doc, prefix)
                else:
                    # Save from either editor commits one coherent named lab version.
                    current_lab = json.loads((self.server.data_dir/'lab.json').read_text())
                    cached_lab = self.server.drafts.get((*prefix, 'lab'))
                    lab_doc = copy.deepcopy(cached_lab['state']['data'] if cached_lab else current_lab)
                    if lab_doc['revision'] != current_lab['revision']:
                        raise RevisionConflict('The lab changed on the server. Reload the lab before saving this instance.')
                    lab_doc.update(revision=current_lab['revision']+1, versionName=doc['versionName'])
                    validate_lab(lab_doc)
                    self.server.commit_version(lab_doc, prefix, {shelf_id: doc})
                    if cached_lab:
                        cached_lab['state']['data'] = lab_doc
                        cached_lab['state']['dirty'] = False
                result = {'revision':doc['revision']}
                if not shelf_id:
                    changed_labels = {i['id']:i['locationId'] for i in doc['items'] if i['kind']=='shelf' and i['locationId'] != requested_labels.get(i['id'])}
                    if changed_labels: result['locationLabels'] = changed_labels
                return self.json_response(200, result, headers={'X-Lab-Revision': lab_doc['revision'] if shelf_id else doc['revision']})
            except RevisionConflict as error:
                return self.json_response(409, {'error': str(error)})
            except (ValueError, UnicodeDecodeError) as error:
                return self.json_response(400, {'error': str(error)})
            except OSError:
                return self.json_response(500, {'error': 'Could not save to disk. Your local draft is still open.'})


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--port', type=int, default=8000)
    parser.add_argument('--host', default='127.0.0.1')
    parser.add_argument('--data-dir', default=str(ROOT / 'data'))
    parser.add_argument('--defaults-dir', default=str(ROOT / 'defaults'))
    args = parser.parse_args()
    try:
        server = LabServer((args.host, args.port), args.data_dir, os.environ.get('ITR_ADMIN_PASSWORD', 'itr'), args.defaults_dir,
                           os.environ.get('ITR_TREASURER_USERNAME', 'treasurer'),
                           os.environ.get('ITR_TREASURER_PASSWORD', 'treasury'),
                           os.environ.get('ITR_ADMIN_USERNAME', 'admin'))
    except OSError as error:
        parser.exit(1, f'Could not start server: {error}\nStop the old server with Ctrl+C, or choose --port 8001.\n')
    host = 'localhost' if args.host in ('127.0.0.1', '0.0.0.0') else args.host
    print(f'Lab editor: http://{host}:{args.port}/\nPress Ctrl+C to stop.', flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == '__main__':
    main()
