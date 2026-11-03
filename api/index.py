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

app = FastAPI()
ACCOUNTS = NeonAccounts(os.environ["DATABASE_URL"])
ROOT = Path(__file__).resolve().parents[1]
STATIC_FILES = {path.name for path in ROOT.glob('*.html')} | {path.name for path in ROOT.glob('*.js')} | {path.name for path in ROOT.glob('*.css')}


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
        ''')
setup()


def read_document(key, fallback):
    with ACCOUNTS.connection() as conn, conn.cursor() as cur:
        cur.execute('SELECT document FROM itr_documents WHERE document_key=%s', (key,)); row = cur.fetchone()
    return row[0] if row else fallback()


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


@app.get('/api/session')
def session(itr_session: str | None = Cookie(None)):
    value = ACCOUNTS.session_user(itr_session or '')
    is_treasurer = bool(value and value['email'].lower() in {email.strip().lower() for email in os.environ.get('ITR_TREASURER_EMAILS', '').split(',')})
    return {'member': bool(value), 'user': value, 'username': value['name'] if value else '',
            'role': 'treasurer' if is_treasurer else ('member' if value else 'visitor'),
            'admin': is_treasurer, 'treasurer': is_treasurer}


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


@app.get('/api/lab')
def lab_document():
    return read_document('lab', lambda: json.loads((ROOT / 'data/lab.json').read_text()))


@app.put('/api/lab')
def save_lab(document: dict, itr_session: str | None = Cookie(None)):
    treasurer(itr_session)
    return save_document('lab', document, validate_lab)


@app.get('/api/inventory')
def inventory_document():
    inventory = read_document('inventory', lambda: json.loads((ROOT / 'data/inventory.json').read_text()))
    lab = read_document('lab', lambda: json.loads((ROOT / 'data/lab.json').read_text()))
    locations = {}
    for item in lab.get('items', []):
        if item.get('kind') in ('table', 'cart', 'machine'):
            locations[item['id']] = {'shelfId': item['id'], 'binId': None, 'mapped': True, 'saved': True,
                'hidden': False, 'kind': item['kind'], 'label': item['name'] + ' · ' + (item.get('locationId') or item['id'])}
        if item.get('kind') != 'shelf': continue
        shelf_path = ROOT / 'data/shelves' / f"{item['id']}.json"
        shelf = read_document('shelves/' + item['id'], lambda: json.loads(shelf_path.read_text()) if shelf_path.exists() else {})
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
        else: raise ValueError('This inventory operation has not migrated yet.')
    except ValueError as error: raise HTTPException(400, str(error))
    doc['revision'] += 1; result['revision'] = doc['revision']; doc.setdefault('operations', {})[operation] = result
    with ACCOUNTS.connection() as conn, conn.cursor() as cur:
        cur.execute('UPDATE itr_documents SET document=%s,revision=%s,updated_at=now() WHERE document_key=%s AND revision=%s', (json.dumps(doc), doc['revision'], 'inventory', current['revision']))
        if not cur.rowcount: raise HTTPException(409, 'Inventory changed in another editor. Reload and try again.')
        cur.execute('INSERT INTO itr_document_history VALUES (%s,%s,%s,now())', ('inventory', doc['revision'], json.dumps(doc)))
    return result


@app.get('/api/shelves/{shelf_id}')
def shelf_document(shelf_id: str):
    if not shelf_id.replace('_','').replace('-','').isalnum(): raise HTTPException(404, 'Shelf not found.')
    path = ROOT / 'data/shelves' / f'{shelf_id}.json'
    if not path.exists(): raise HTTPException(404, 'Shelf not found.')
    return read_document('shelves/' + shelf_id, lambda: json.loads(path.read_text()))


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
