"""Vercel serverless API backed by Neon Postgres.

This intentionally owns accounts, projects, and treasury data.  Map/inventory
file persistence remains local-only until its separate migration is complete.
"""
import hashlib
import json
import os
import secrets
import copy
from decimal import Decimal
from datetime import datetime, timezone
from pathlib import Path

from fastapi import Body, Cookie, FastAPI, Header, HTTPException, Response
from fastapi.responses import FileResponse
from pydantic import BaseModel

from neon_accounts import AccountError, NeonAccounts
from projects import validate_project
from lab_server import validate_lab, validate_shelf
from inventory import validate_item, validate_stock
from inventory import decimal_value
from location_labels import assign_labels

app = FastAPI()
ACCOUNTS = NeonAccounts(os.environ["DATABASE_URL"])
ROOT = Path(__file__).resolve().parents[1]
STATIC_FILES = {path.name for path in ROOT.glob('*.html')} | {path.name for path in ROOT.glob('*.js')} | {path.name for path in ROOT.glob('*.css')}


@app.middleware('http')
async def vercel_api_prefix(request, call_next):
    """Vercel may mount api/index.py at /api and strip that path segment."""
    path = request.scope['path']
    roots = ('/session', '/account', '/logout', '/projects', '/treasury', '/lab', '/inventory', '/shelves', '/reports', '/location-labels', '/admin')
    if not path.startswith('/api/') and path in roots or (not path.startswith('/api/') and path.startswith(tuple(root + '/' for root in roots))):
        request.scope['path'] = '/api' + path
    return await call_next(request)


def setup():
    with ACCOUNTS.connection() as conn, conn.cursor() as cur:
        cur.execute('''
          CREATE TABLE IF NOT EXISTS itr_projects (
            id TEXT PRIMARY KEY, owner_id UUID NOT NULL REFERENCES itr_users(id),
            project JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
          );
          CREATE TABLE IF NOT EXISTS itr_project_operations (
            operation_id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES itr_projects(id) ON DELETE CASCADE,
            fingerprint TEXT NOT NULL
          );
          CREATE TABLE IF NOT EXISTS itr_treasury_records (
            project_id TEXT PRIMARY KEY REFERENCES itr_projects(id) ON DELETE CASCADE,
            record JSONB NOT NULL, revision INTEGER NOT NULL DEFAULT 0
          );
          CREATE TABLE IF NOT EXISTS itr_documents (
            document_key TEXT PRIMARY KEY, document JSONB NOT NULL,
            revision INTEGER NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
          );
          CREATE TABLE IF NOT EXISTS itr_document_history (
            document_key TEXT NOT NULL, revision INTEGER NOT NULL, document JSONB NOT NULL,
            saved_at TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY (document_key, revision)
          );
          CREATE TABLE IF NOT EXISTS itr_drafts (
            owner_id UUID NOT NULL REFERENCES itr_users(id) ON DELETE CASCADE,
            draft_key TEXT NOT NULL, draft JSONB NOT NULL,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY (owner_id, draft_key)
          );
        ''')
setup()


def read_document(key, fallback):
    with ACCOUNTS.connection() as conn, conn.cursor() as cur:
        cur.execute('SELECT document FROM itr_documents WHERE document_key=%s', (key,)); row = cur.fetchone()
    return row[0] if row else fallback()


def read_shelf_documents():
    with ACCOUNTS.connection() as conn, conn.cursor() as cur:
        cur.execute("SELECT document_key,document FROM itr_documents WHERE document_key LIKE 'shelves/%'")
        return {key.split('/', 1)[1]: document for key, document in cur.fetchall()}


def save_document(key, document, validator):
    validator(document) if key == 'lab' else validator(document, key.split('/', 1)[1])
    with ACCOUNTS.connection() as conn, conn.cursor() as cur:
        cur.execute('SELECT revision FROM itr_documents WHERE document_key=%s FOR UPDATE', (key,)); row = cur.fetchone()
        current = row[0] if row else 0
        if document.get('revision') != current: raise HTTPException(409, 'This document changed. Reload and try again.')
        saved = dict(document); saved['revision'] = current + 1
        cur.execute('INSERT INTO itr_documents VALUES (%s,%s,%s,now()) ON CONFLICT (document_key) DO UPDATE SET document=EXCLUDED.document,revision=EXCLUDED.revision,updated_at=now()', (key, json.dumps(saved), current+1))
        cur.execute('INSERT INTO itr_document_history VALUES (%s,%s,%s,now())', (key, current+1, json.dumps(saved)))
    return {'revision': current + 1}


class AccountBody(BaseModel):
    name: str = ''
    email: str
    password: str

class ProjectBody(BaseModel):
    project: dict
    operationId: str


def cookie(response, token):
    response.set_cookie('itr_session', token, max_age=28800, httponly=True, samesite='strict', secure=True)


def user(token):
    value = ACCOUNTS.session_user(token or '')
    if not value:
        raise HTTPException(401, 'Member login required.')
    return value


def treasurer(token):
    value = user(token)
    allowed = {email.strip().lower() for email in os.environ.get('ITR_TREASURER_EMAILS', '').split(',') if email.strip()}
    if value['email'].lower() not in allowed:
        raise HTTPException(403, 'Treasurer login required.')
    return value


@app.get('/session')
@app.get('/api/session')
def session(itr_session: str | None = Cookie(None)):
    value = ACCOUNTS.session_user(itr_session or '')
    is_treasurer = bool(value and value['email'].lower() in {email.strip().lower() for email in os.environ.get('ITR_TREASURER_EMAILS', '').split(',')})
    return {'member': bool(value), 'user': value, 'username': value['name'] if value else '',
            'role': 'treasurer' if is_treasurer else ('member' if value else 'visitor'),
            'admin': is_treasurer, 'treasurer': is_treasurer}


@app.get('/recovery-context')
@app.get('/api/recovery-context')
def recovery_context(itr_session: str | None = Cookie(None)):
    lab = read_document('lab', lambda: json.loads((ROOT / 'data/lab.json').read_text()))
    token_scope = hashlib.sha256((itr_session or 'visitor').encode()).hexdigest()[:24]
    return {'scope': 'itr-neon:' + token_scope, 'labRevision': lab.get('revision', 0)}


def draft_owner(token):
    return ACCOUNTS.session_user(token or '')


@app.get('/drafts/{draft_key:path}')
@app.get('/api/drafts/{draft_key:path}')
def get_draft(draft_key: str, itr_session: str | None = Cookie(None)):
    owner = draft_owner(itr_session)
    if not owner: return None
    if draft_key != 'lab' and not draft_key.startswith('shelves/'): raise HTTPException(404, 'Draft not found.')
    with ACCOUNTS.connection() as conn, conn.cursor() as cur:
        cur.execute('SELECT draft FROM itr_drafts WHERE owner_id=%s AND draft_key=%s', (owner['id'], draft_key)); row = cur.fetchone()
    return row[0] if row else None


@app.put('/drafts/{draft_key:path}')
@app.put('/api/drafts/{draft_key:path}')
def put_draft(draft_key: str, draft: dict, itr_session: str | None = Cookie(None)):
    owner = treasurer(itr_session)
    if draft_key != 'lab' and not draft_key.startswith('shelves/'): raise HTTPException(404, 'Draft not found.')
    if not isinstance(draft.get('data'), dict) or not isinstance(draft.get('history'), list) or not isinstance(draft.get('future'), list): raise HTTPException(400, 'Invalid draft.')
    with ACCOUNTS.connection() as conn, conn.cursor() as cur:
        cur.execute('INSERT INTO itr_drafts (owner_id,draft_key,draft) VALUES (%s,%s,%s) ON CONFLICT (owner_id,draft_key) DO UPDATE SET draft=EXCLUDED.draft,updated_at=now()', (owner['id'], draft_key, json.dumps(draft)))
    return {'cached': True}


@app.post('/api/account/signup')
def signup(body: AccountBody, response: Response):
    try: value = ACCOUNTS.create_user(body.name, body.email, body.password)
    except AccountError as error: raise HTTPException(400, str(error))
    cookie(response, ACCOUNTS.create_session(value)); return {'member': True, 'user': value}


@app.post('/api/account/login')
def login(body: AccountBody, response: Response):
    try: value = ACCOUNTS.authenticate(body.email, body.password)
    except AccountError as error: raise HTTPException(401, str(error))
    cookie(response, ACCOUNTS.create_session(value)); return {'member': True, 'user': value}


@app.post('/api/logout')
def logout(response: Response, itr_session: str | None = Cookie(None)):
    ACCOUNTS.delete_session(itr_session or ''); response.delete_cookie('itr_session'); return {'member': False}


@app.post('/api/projects')
def create_project(body: ProjectBody, itr_session: str | None = Cookie(None)):
    owner = user(itr_session)
    try: project = validate_project(body.project)
    except ValueError as error: raise HTTPException(400, str(error))
    fingerprint = hashlib.sha256(str(sorted(project.items())).encode()).hexdigest()
    with ACCOUNTS.connection() as conn, conn.cursor() as cur:
        cur.execute('SELECT project_id, fingerprint FROM itr_project_operations WHERE operation_id=%s', (body.operationId,)); existing = cur.fetchone()
        if existing:
            if existing[1] != fingerprint: raise HTTPException(400, 'Submission ID already used.')
            return {'submitted': True, 'projectId': existing[0]}
        pid = 'PR-' + secrets.token_hex(16); stamp = datetime.now(timezone.utc).isoformat()
        project.update(id=pid, owner=owner, status='submitted', submittedAt=stamp, updatedAt=stamp)
        cur.execute('INSERT INTO itr_projects (id, owner_id, project) VALUES (%s,%s,%s)', (pid, owner['id'], __import__('json').dumps(project)))
        cur.execute('INSERT INTO itr_project_operations VALUES (%s,%s,%s)', (body.operationId, pid, fingerprint))
    return {'submitted': True, 'projectId': pid}


@app.get('/api/projects/mine')
def my_projects(itr_session: str | None = Cookie(None)):
    owner = user(itr_session)
    with ACCOUNTS.connection() as conn, conn.cursor() as cur:
        cur.execute('SELECT id,project FROM itr_projects WHERE owner_id=%s ORDER BY updated_at DESC', (owner['id'],))
        rows = [dict(projectId=project_id, **project) for project_id, project in cur.fetchall()]
    return {'projects': rows}


@app.get('/api/projects/{project_id}')
def get_project(project_id: str, itr_session: str | None = Cookie(None)):
    owner = user(itr_session)
    with ACCOUNTS.connection() as conn, conn.cursor() as cur:
        cur.execute('SELECT owner_id,project FROM itr_projects WHERE id=%s', (project_id,)); row = cur.fetchone()
    if not row: raise HTTPException(404, 'Project not found.')
    if str(row[0]) != owner['id'] and owner['email'].lower() not in {email.strip().lower() for email in os.environ.get('ITR_TREASURER_EMAILS','').split(',')}: raise HTTPException(403, 'Project access denied.')
    return row[1]


@app.put('/api/projects/{project_id}')
def update_project(project_id: str, body: dict, itr_session: str | None = Cookie(None)):
    owner = user(itr_session)
    try: submitted = validate_project(body.get('project'))
    except ValueError as error: raise HTTPException(400, str(error))
    with ACCOUNTS.connection() as conn, conn.cursor() as cur:
        cur.execute('SELECT owner_id,project FROM itr_projects WHERE id=%s FOR UPDATE', (project_id,)); row = cur.fetchone()
        if not row: raise HTTPException(404, 'Project not found.')
        if str(row[0]) != owner['id']: raise HTTPException(403, 'Only the project owner can edit this project.')
        previous = row[1]; submitted.update(id=project_id, owner=previous['owner'], status=previous['status'], submittedAt=previous['submittedAt'], updatedAt=datetime.now(timezone.utc).isoformat())
        cur.execute('UPDATE itr_projects SET project=%s,updated_at=now() WHERE id=%s', (json.dumps(submitted), project_id))
    return {'saved': True, 'project': submitted}


@app.get('/api/treasury/overview')
def treasury_overview(itr_session: str | None = Cookie(None)):
    treasurer(itr_session)
    with ACCOUNTS.connection() as conn, conn.cursor() as cur:
        cur.execute('''SELECT p.id,p.project,COALESCE(t.record,'{}'::jsonb),COALESCE(t.revision,0)
                       FROM itr_projects p LEFT JOIN itr_treasury_records t ON t.project_id=p.id
                       ORDER BY p.created_at DESC''')
        rows, totals, revision = [], {}, 0
        for pid, project, record, record_revision in cur.fetchall():
            currency, amount = project['estimate']['currency'], project['estimate']['amount']
            totals[currency] = str(Decimal(totals.get(currency, '0')) + Decimal(amount)); revision = max(revision, record_revision)
            rows.append(dict(projectId=pid, title=project['title'], lead=project['lead'], contact=project['contact'], stage=project['stage'], projectStatus=project['status'], estimate=project['estimate'], lineItems=project['lineItems'], nonItemCost=project.get('nonItemCost','0'), treasury=record, submittedAt=project['submittedAt'], updatedAt=project['updatedAt']))
    return {'projects': rows, 'totals': totals, 'revision': revision, 'projectsRevision': len(rows)}


@app.post('/api/treasury/projects/{project_id}')
def save_treasury(project_id: str, body: dict = Body(...), itr_session: str | None = Cookie(None)):
    actor = treasurer(itr_session); record = body.get('record')
    if not isinstance(record, dict): raise HTTPException(400, 'Invalid treasury record.')
    record = {key: str(record.get(key, '')).strip() for key in ('status','planningPeriod','approvedAmount','currency','fundingSource','notes')}
    record['history'] = [dict(actor=actor['name'], updatedAt=datetime.now(timezone.utc).isoformat())]
    with ACCOUNTS.connection() as conn, conn.cursor() as cur:
        cur.execute('SELECT 1 FROM itr_projects WHERE id=%s', (project_id,))
        if not cur.fetchone(): raise HTTPException(404, 'Project not found.')
        cur.execute('''INSERT INTO itr_treasury_records (project_id,record,revision) VALUES (%s,%s,1)
                       ON CONFLICT (project_id) DO UPDATE SET record=EXCLUDED.record,revision=itr_treasury_records.revision+1''', (project_id, json.dumps(record)))
    return {'saved': True}


@app.delete('/api/treasury/projects/{project_id}')
def delete_treasury_project(project_id: str, itr_session: str | None = Cookie(None)):
    treasurer(itr_session)
    with ACCOUNTS.connection() as conn, conn.cursor() as cur:
        cur.execute('DELETE FROM itr_projects WHERE id=%s', (project_id,))
        if not cur.rowcount: raise HTTPException(404, 'Project not found.')
    return {'deleted': True}


@app.get('/lab')
@app.get('/api/lab')
def lab_document():
    return read_document('lab', lambda: json.loads((ROOT / 'data/lab.json').read_text()))


@app.post('/api/location-labels')
def allocate_location_label(body: dict, itr_session: str | None = Cookie(None)):
    treasurer(itr_session)
    shelf_id = body.get('shelfId')
    if not isinstance(shelf_id, str): raise HTTPException(400, 'Invalid shelf ID.')
    labels = read_document('location-labels', lambda: json.loads((ROOT / 'data/location-labels.json').read_text()))
    updated = assign_labels({'items': [dict(id=shelf_id, kind='shelf')]}, labels)
    location_id = updated['labels'][shelf_id]
    if updated != labels:
        with ACCOUNTS.connection() as conn, conn.cursor() as cur:
            revision = labels.get('revision', 0) + 1; updated['revision'] = revision
            cur.execute('UPDATE itr_documents SET document=%s,revision=%s,updated_at=now() WHERE document_key=%s AND revision=%s', (json.dumps(updated), revision, 'location-labels', labels.get('revision', 0)))
            if not cur.rowcount: raise HTTPException(409, 'Location labels changed. Retry.')
            cur.execute('INSERT INTO itr_document_history VALUES (%s,%s,%s,now())', ('location-labels', revision, json.dumps(updated)))
    return {'locationId': location_id}


@app.put('/api/lab')
def save_lab(document: dict, itr_session: str | None = Cookie(None)):
    treasurer(itr_session)
    return save_document('lab', document, validate_lab)


@app.get('/api/lab/history')
def lab_history(itr_session: str | None = Cookie(None)):
    treasurer(itr_session)
    with ACCOUNTS.connection() as conn, conn.cursor() as cur:
        cur.execute('SELECT revision,saved_at FROM itr_document_history WHERE document_key=%s ORDER BY revision DESC', ('lab',))
        rows = cur.fetchall()
    current = read_document('lab', lambda: json.loads((ROOT / 'data/lab.json').read_text()))
    return {'currentRevision': current.get('revision', 0), 'versions': [{'version': str(revision), 'revision': revision, 'savedAt': saved_at.isoformat() if saved_at else None, 'reason': 'Saved layout', 'name': 'Saved layout'} for revision, saved_at in rows]}


@app.get('/api/lab/history/{revision}')
def lab_history_version(revision: int, itr_session: str | None = Cookie(None)):
    treasurer(itr_session)
    with ACCOUNTS.connection() as conn, conn.cursor() as cur:
        cur.execute('SELECT document FROM itr_document_history WHERE document_key=%s AND revision=%s', ('lab', revision)); row = cur.fetchone()
    if not row: raise HTTPException(404, 'Saved version not found.')
    return row[0]


@app.get('/api/backup')
def neon_backup(itr_session: str | None = Cookie(None)):
    treasurer(itr_session)
    with ACCOUNTS.connection() as conn, conn.cursor() as cur:
        cur.execute('SELECT document_key,document FROM itr_documents ORDER BY document_key')
        documents = {key: document for key, document in cur.fetchall()}
        cur.execute('SELECT document_key,revision,document,saved_at FROM itr_document_history ORDER BY document_key,revision')
        history = [{'key': key, 'revision': revision, 'document': document, 'savedAt': saved_at.isoformat()} for key, revision, document, saved_at in cur.fetchall()]
    return {'format': 'itr-neon-backup', 'schemaVersion': 1, 'savedAt': datetime.now(timezone.utc).isoformat(), 'documents': documents, 'history': history}


@app.get('/inventory')
@app.get('/api/inventory')
def inventory_document():
    inventory = read_document('inventory', lambda: json.loads((ROOT / 'data/inventory.json').read_text()))
    lab = read_document('lab', lambda: json.loads((ROOT / 'data/lab.json').read_text()))
    saved_shelves = read_shelf_documents()
    locations = {}
    for item in lab.get('items', []):
        if item.get('kind') in ('table', 'cart', 'machine'):
            locations[item['id']] = {'shelfId': item['id'], 'binId': None, 'mapped': True, 'saved': True,
                'hidden': False, 'kind': item['kind'], 'label': item['name'] + ' · ' + (item.get('locationId') or item['id'])}
        if item.get('kind') != 'shelf': continue
        shelf = saved_shelves.get(item['id'], {})
        base = {'shelfId': item['id'], 'mapped': True, 'saved': True, 'shelfMode': shelf.get('mode', 'simple'), 'locationId': item.get('locationId') or item['id']}
        label = (shelf.get('name') or item.get('name') or item['id']) + ' · ' + base['locationId']
        locations[item['id']] = {**base, 'binId': None, 'label': label, 'hidden': False}
        seen = set()
        for row in shelf.get('matrix', []):
            for bin in row:
                if not bin or not bin.get('id') or bin['id'] in seen: continue
                seen.add(bin['id']); locations[item['id'] + '/' + bin['id']] = {**base, 'binId': bin['id'],
                    'label': label + ' / ' + (bin.get('name') or 'empty'), 'hidden': shelf.get('mode') == 'simple'}
    return {**inventory, 'locations': locations}


@app.post('/api/inventory')
def save_inventory(body: dict, itr_session: str | None = Cookie(None)):
    treasurer(itr_session)
    current = read_document('inventory', lambda: json.loads((ROOT / 'data/inventory.json').read_text()))
    if body.get('revision') != current.get('revision'):
        raise HTTPException(409, 'Inventory changed in another editor. Reload and try again.')
    action, operation = body.get('action'), body.get('operationId')
    if not isinstance(operation, str) or not operation: raise HTTPException(400, 'A unique operation ID is required.')
    if operation in current.get('operations', {}): return current['operations'][operation]
    doc, result = copy.deepcopy(current), {}
    locations = inventory_document()['locations']
    try:
        if action == 'quick':
            item = validate_item(body.get('item')); destination = body.get('stock') or {}
            matches = [(sid, stock) for sid, stock in doc['stocks'].items() if not stock.get('archived') and stock.get('shelfId') == destination.get('shelfId') and stock.get('binId') == destination.get('binId') and doc['items'][stock['itemId']]['name'] == item['name']]
            if len(matches) > 1: raise ValueError('Several distinct items here have this name.')
            if matches:
                sid, stock = matches[0]; return {'itemId': stock['itemId'], 'stockId': sid, 'revision': current['revision'], 'existing': True}
            body = {**body, 'action': 'save', 'item': item, 'stock': {**destination, 'tracking': 'presence', 'quantity': None}}; action = 'save'
        if action == 'save':
            item_id = body.get('itemId')
            if 'item' in body:
                item_id = item_id or 'I-' + secrets.token_hex(16); doc['items'][item_id] = validate_item(body['item'])
            if item_id not in doc['items']: raise ValueError('Choose an item or enter its name.')
            result['itemId'] = item_id
            if 'stock' in body:
                stock_id = body.get('stockId') or 'ST-' + secrets.token_hex(16); previous = doc['stocks'].get(stock_id)
                stock = validate_stock({**body['stock'], 'itemId': item_id}, doc['items'], locations, previous)
                doc['stocks'][stock_id] = stock; result['stockId'] = stock_id
        elif action in ('archive', 'reactivate'):
            stock = doc['stocks'].get(body.get('stockId'))
            if not stock: raise ValueError('Stock entry not found.')
            stock['archived'] = action == 'archive'; result['stockId'] = body['stockId']
        elif action == 'delete-item':
            item_id = body.get('itemId')
            if item_id not in doc['items']: raise ValueError('Item no longer exists.')
            doc.setdefault('deletedItems', {})[item_id] = {'name': doc['items'][item_id]['name'], 'deletedAt': datetime.now(timezone.utc).isoformat(), 'revision': current['revision'] + 1}
            del doc['items'][item_id]; doc['stocks'] = {sid: stock for sid, stock in doc['stocks'].items() if stock['itemId'] != item_id}; result['deletedItemId'] = item_id
        elif action == 'remove-location':
            source = doc['stocks'].get(body.get('stockId'))
            if not source: raise ValueError('Stock entry no longer exists.')
            doc['stocks'] = {sid: stock for sid, stock in doc['stocks'].items() if any(stock.get(key) != source.get(key) for key in ('itemId','shelfId','binId'))}; result['removedLocation'] = source.get('shelfId') or ''
        elif action == 'transfer':
            source = doc['stocks'].get(body.get('stockId'))
            if not source or source.get('archived') or source.get('tracking') != 'exact' or source.get('quantity') is None: raise ValueError('Partial transfers require active stock with a known exact quantity.')
            amount = Decimal(decimal_value(body.get('amount'), 'Transfer amount', optional=False))
            if amount <= 0 or amount > Decimal(source['quantity']): raise ValueError('Transfer amount must be positive and cannot exceed the source quantity.')
            target = validate_stock({**source, 'shelfId': body.get('shelfId'), 'binId': body.get('binId'), 'quantity': format(amount, 'f')}, doc['items'], locations)
            if (target['shelfId'], target['binId']) == (source['shelfId'], source['binId']): raise ValueError('Choose a different destination.')
            destination = next((stock for stock in doc['stocks'].values() if not stock.get('archived') and all(stock.get(key) == target.get(key) for key in ('itemId','shelfId','binId','unit'))), None)
            if destination:
                if destination['tracking'] != 'exact' or destination['quantity'] is None: raise ValueError('Destination stock needs a known exact quantity before merging.')
                destination['quantity'] = decimal_value(format(Decimal(destination['quantity']) + amount, 'f'), 'Destination quantity')
            else: doc['stocks']['ST-' + secrets.token_hex(16)] = target
            source['quantity'] = format(Decimal(source['quantity']) - amount, 'f')
        else: raise ValueError('This inventory operation has not migrated yet.')
    except ValueError as error: raise HTTPException(400, str(error))
    doc['revision'] += 1; result['revision'] = doc['revision']; doc.setdefault('operations', {})[operation] = result
    with ACCOUNTS.connection() as conn, conn.cursor() as cur:
        cur.execute('UPDATE itr_documents SET document=%s,revision=%s,updated_at=now() WHERE document_key=%s AND revision=%s', (json.dumps(doc), doc['revision'], 'inventory', current['revision']))
        if not cur.rowcount: raise HTTPException(409, 'Inventory changed in another editor. Reload and try again.')
        cur.execute('INSERT INTO itr_document_history VALUES (%s,%s,%s,now())', ('inventory', doc['revision'], json.dumps(doc)))
    return result


@app.get('/api/inventory/suggestions')
def inventory_suggestions(q: str = ''):
    query = q.strip().casefold()
    if len(query) < 2 or len(query) > 500: raise HTTPException(400, 'Enter at least two characters to search inventory.')
    inventory = inventory_document(); results = []
    for item_id, item in inventory['items'].items():
        searchable = ' '.join(str(item.get(key, '')) for key in ('name','category','keywords','description')).casefold()
        if query not in searchable: continue
        stocks = [dict(label=inventory['locations'].get((stock.get('shelfId') or '') + (('/' + stock['binId']) if stock.get('binId') else ''), {}).get('label', stock.get('locationLabel','Unassigned')), tracking=stock['tracking'], quantity=stock.get('quantity'), unit=stock.get('unit'), availability=stock.get('availability'), mapped=True) for stock in inventory['stocks'].values() if stock['itemId'] == item_id and not stock.get('archived')]
        results.append(dict(itemId=item_id, name=item['name'], category=item.get('category',''), stocks=stocks))
    return {'results': sorted(results, key=lambda row: row['name'].casefold())[:8], 'revision': inventory['revision']}


@app.get('/shelves/{shelf_id}')
@app.get('/api/shelves/{shelf_id}')
def shelf_document(shelf_id: str):
    if not shelf_id.replace('_','').replace('-','').isalnum(): raise HTTPException(404, 'Shelf not found.')
    path = ROOT / 'data/shelves' / f'{shelf_id}.json'
    if not path.exists(): raise HTTPException(404, 'Shelf not found.')
    return read_document('shelves/' + shelf_id, lambda: json.loads(path.read_text()))


@app.get('/shelf-index')
@app.get('/api/shelf-index')
def shelf_index():
    lab = lab_document(); inventory = inventory_document(); saved_shelves = read_shelf_documents(); index = {}
    for item in lab.get('items', []):
        if item.get('kind') != 'shelf': continue
        shelf_id = item['id']; doc = saved_shelves.get(shelf_id, {})
        destinations = [dict(binId=None, name=doc.get('name') or item.get('name', shelf_id), searchText=' '.join(str(value) for value in (item.get('name',''), item.get('locationId',''), doc.get('name',''), doc.get('contents',''), doc.get('keywords',''))).lower())]
        bins, terms = {}, [doc.get(key,'') for key in ('name','contents','keywords')]
        if doc.get('mode') == 'complex':
            for row in doc.get('matrix', []):
                for bin in row:
                    if bin and bin.get('id') and bin['id'] not in bins:
                        bins[bin['id']] = bin; destinations.append(dict(binId=bin['id'], name=bin.get('name') or 'empty', searchText=bin.get('name','').lower())); terms.append(bin.get('name',''))
        structured = []
        for stock in inventory['stocks'].values():
            if stock.get('shelfId') != shelf_id or stock.get('archived'): continue
            record = inventory['items'].get(stock['itemId'], {}); structured.append(record.get('name','')); terms.extend(record.get(key,'') for key in ('name','category','keywords','description','vendor','notes'))
        index[shelf_id] = dict(name=doc.get('name') or item.get('name',''), mode=doc.get('mode','simple'), contents=doc.get('contents',''), keywords=doc.get('keywords',''), destinations=destinations, structuredItems=sorted(set(structured)), searchText=' '.join(str(term) for term in terms).lower(), draftDirty=False)
    return index


@app.get('/api/reports')
def get_reports(itr_session: str | None = Cookie(None)):
    treasurer(itr_session)
    return read_document('reports', lambda: json.loads((ROOT / 'data/reports.json').read_text()))


@app.post('/api/reports')
def create_report(body: dict):
    current = read_document('reports', lambda: json.loads((ROOT / 'data/reports.json').read_text()))
    text = str(body.get('text', '')).strip()
    if not text or len(text) > 2000: raise HTTPException(400, 'Report text is required and limited to 2,000 characters.')
    doc = copy.deepcopy(current); report_id = 'RPT-' + secrets.token_hex(16)
    doc.setdefault('reports', {})[report_id] = {'id': report_id, 'shelfId': body.get('shelfId',''), 'shelfLabel': str(body.get('shelfLabel',''))[:500], 'binId': body.get('binId'), 'text': text, 'status': 'pending', 'submittedAt': datetime.now(timezone.utc).isoformat(), 'updatedAt': datetime.now(timezone.utc).isoformat()}
    doc['revision'] = current.get('revision', 0) + 1
    with ACCOUNTS.connection() as conn, conn.cursor() as cur:
        cur.execute('UPDATE itr_documents SET document=%s,revision=%s,updated_at=now() WHERE document_key=%s AND revision=%s', (json.dumps(doc), doc['revision'], 'reports', current.get('revision', 0)))
        if not cur.rowcount: raise HTTPException(409, 'Reports changed. Retry your submission.')
        cur.execute('INSERT INTO itr_document_history VALUES (%s,%s,%s,now())', ('reports', doc['revision'], json.dumps(doc)))
    return {'submitted': True, 'reportId': report_id, 'revision': doc['revision']}


@app.post('/api/reports/{report_id}')
def update_report(report_id: str, body: dict, itr_session: str | None = Cookie(None)):
    treasurer(itr_session)
    current = read_document('reports', lambda: json.loads((ROOT / 'data/reports.json').read_text()))
    if body.get('revision') != current.get('revision'): raise HTTPException(409, 'Reports changed. Refresh and try again.')
    status = body.get('status')
    if status not in ('pending', 'resolved', 'dismissed'): raise HTTPException(400, 'Choose pending, resolved, or dismissed.')
    if report_id not in current.get('reports', {}): raise HTTPException(404, 'Report not found.')
    doc = copy.deepcopy(current); doc['reports'][report_id].update(status=status, updatedAt=datetime.now(timezone.utc).isoformat()); doc['revision'] += 1
    with ACCOUNTS.connection() as conn, conn.cursor() as cur:
        cur.execute('UPDATE itr_documents SET document=%s,revision=%s,updated_at=now() WHERE document_key=%s AND revision=%s', (json.dumps(doc), doc['revision'], 'reports', current['revision']))
        if not cur.rowcount: raise HTTPException(409, 'Reports changed. Refresh and try again.')
        cur.execute('INSERT INTO itr_document_history VALUES (%s,%s,%s,now())', ('reports', doc['revision'], json.dumps(doc)))
    return {'saved': True, 'revision': doc['revision']}


@app.put('/api/shelves/{shelf_id}')
def save_shelf(shelf_id: str, document: dict, itr_session: str | None = Cookie(None)):
    treasurer(itr_session)
    if not shelf_id.replace('_','').replace('-','').isalnum(): raise HTTPException(404, 'Shelf not found.')
    return save_document('shelves/' + shelf_id, document, validate_shelf)


@app.post('/api/admin/import-json')
def import_json(x_itr_migration_secret: str | None = Header(None)):
    expected = os.environ.get('ITR_MIGRATION_SECRET')
    if not expected or not secrets.compare_digest(x_itr_migration_secret or '', expected):
        raise HTTPException(403, 'Migration authorization failed.')
    sources = {'lab': ROOT / 'data/lab.json', 'inventory': ROOT / 'data/inventory.json', 'reports': ROOT / 'data/reports.json', 'location-labels': ROOT / 'data/location-labels.json'}
    sources.update({'shelves/' + path.stem: path for path in (ROOT / 'data/shelves').glob('*.json')})
    with ACCOUNTS.connection() as conn, conn.cursor() as cur:
        for key, path in sources.items():
            document = json.loads(path.read_text()); revision = int(document.get('revision', 0))
            cur.execute('INSERT INTO itr_documents VALUES (%s,%s,%s,now()) ON CONFLICT (document_key) DO NOTHING', (key, json.dumps(document), revision))
            cur.execute('INSERT INTO itr_document_history VALUES (%s,%s,%s,now()) ON CONFLICT DO NOTHING', (key, revision, json.dumps(document)))
        history_roots = {'lab': ROOT / 'data/history/lab', 'inventory': ROOT / 'data/history/inventory', 'projects': ROOT / 'data/history/projects', 'treasury': ROOT / 'data/history/treasury'}
        for key, directory in history_roots.items():
            for path in directory.glob('*.json') if directory.exists() else []:
                document = json.loads(path.read_text()); revision = int(document.get('revision', path.stem))
                cur.execute('INSERT INTO itr_document_history VALUES (%s,%s,%s,now()) ON CONFLICT DO NOTHING', (key, revision, json.dumps(document)))
    return {'imported': len(sources), 'status': 'safe-no-overwrite'}


@app.get('/api/admin/migration-status')
def migration_status(x_itr_migration_secret: str | None = Header(None)):
    expected = os.environ.get('ITR_MIGRATION_SECRET')
    if not expected or not secrets.compare_digest(x_itr_migration_secret or '', expected):
        raise HTTPException(403, 'Migration authorization failed.')
    with ACCOUNTS.connection() as conn, conn.cursor() as cur:
        cur.execute('SELECT document_key,revision FROM itr_documents ORDER BY document_key'); documents = dict(cur.fetchall())
        cur.execute('SELECT document_key,count(*) FROM itr_document_history GROUP BY document_key ORDER BY document_key'); history = dict(cur.fetchall())
    return {'documents': documents, 'historyCounts': history, 'ready': all(key in documents for key in ('lab','inventory','location-labels','reports'))}


@app.get('/{asset_path:path}', include_in_schema=False)
def frontend(asset_path: str):
    """Serve only explicitly allowlisted frontend assets from this function."""
    name = 'project_dashboard.html' if not asset_path else asset_path
    if '/' in name or name not in STATIC_FILES:
        raise HTTPException(404, 'Not found.')
    return FileResponse(ROOT / name)
