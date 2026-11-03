"""Vercel serverless API backed by Neon Postgres.

This intentionally owns accounts, projects, and treasury data.  Map/inventory
file persistence remains local-only until its separate migration is complete.
"""
import hashlib
import os
import secrets
from datetime import datetime, timezone

from fastapi import Cookie, FastAPI, HTTPException, Response
from pydantic import BaseModel

from neon_accounts import AccountError, NeonAccounts
from projects import validate_project

app = FastAPI()
ACCOUNTS = NeonAccounts(os.environ["DATABASE_URL"])


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
        ''')
setup()


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
    return {'member': bool(value), 'user': value, 'username': value['name'] if value else '',
            'role': 'treasurer' if value and value['email'].lower() in os.environ.get('ITR_TREASURER_EMAILS', '').lower() else ('member' if value else 'visitor'),
            'admin': False, 'treasurer': bool(value and value['email'].lower() in os.environ.get('ITR_TREASURER_EMAILS', '').lower())}


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
