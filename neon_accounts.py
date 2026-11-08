"""Neon/Postgres-backed member accounts and durable login sessions.

The driver is imported only when DATABASE_URL is set, so local development and
the existing test suite do not require a Postgres installation.
"""
import hashlib
import hmac
import os
import re
import secrets
import time
import uuid

EMAIL = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")


class AccountError(ValueError):
    pass


class NeonAccounts:
    def __init__(self, url):
        try:
            import psycopg
        except ImportError as error:
            raise RuntimeError('DATABASE_URL is set but psycopg is not installed. Run pip install -r requirements-local.txt.') from error
        self.psycopg = psycopg
        self.url = url
        self.ensure_schema()

    def connection(self):
        return self.psycopg.connect(self.url)

    def ensure_schema(self):
        with self.connection() as conn, conn.cursor() as cur:
            cur.execute('''
                CREATE TABLE IF NOT EXISTS itr_users (
                  id UUID PRIMARY KEY,
                  name VARCHAR(120) NOT NULL,
                  email VARCHAR(254) NOT NULL UNIQUE,
                  password_hash BYTEA NOT NULL,
                  password_salt BYTEA NOT NULL,
                  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
                );
                CREATE TABLE IF NOT EXISTS itr_sessions (
                  token_hash CHAR(64) PRIMARY KEY,
                  user_id UUID NOT NULL REFERENCES itr_users(id) ON DELETE CASCADE,
                  expires_at TIMESTAMPTZ NOT NULL
                );
                CREATE INDEX IF NOT EXISTS itr_sessions_expires_idx ON itr_sessions (expires_at);
            ''')

    @staticmethod
    def validate_password(password):
        if not isinstance(password, str) or len(password) < 12 or len(password) > 256:
            raise AccountError('Use a password between 12 and 256 characters.')
        return password

    @classmethod
    def validate(cls, name, email, password):
        name, email = name.strip(), email.strip().lower()
        if not 1 <= len(name) <= 120:
            raise AccountError('Enter a name between 1 and 120 characters.')
        if not EMAIL.fullmatch(email) or len(email) > 254:
            raise AccountError('Enter a valid email address.')
        return name, email, cls.validate_password(password)

    @staticmethod
    def password_hash(password, salt):
        return hashlib.pbkdf2_hmac('sha256', password.encode(), salt, 600_000)

    def create_user(self, name, email, password):
        name, email = self.validate(name, email, password)
        salt = secrets.token_bytes(16)
        digest = self.password_hash(password, salt)
        user_id = str(uuid.uuid4())
        try:
            with self.connection() as conn, conn.cursor() as cur:
                cur.execute('INSERT INTO itr_users (id, name, email, password_hash, password_salt) VALUES (%s, %s, %s, %s, %s)', (user_id, name, email, digest, salt))
                return dict(id=user_id, name=name, email=email)
        except self.psycopg.errors.UniqueViolation as error:
            raise AccountError('An account already exists for that email address.') from error

    def authenticate(self, email, password):
        if not isinstance(email, str) or not isinstance(password, str):
            raise AccountError('Invalid email or password.')
        with self.connection() as conn, conn.cursor() as cur:
            cur.execute('SELECT id, name, email, password_hash, password_salt FROM itr_users WHERE email = %s', (email.strip().lower(),))
            row = cur.fetchone()
        if not row or not hmac.compare_digest(self.password_hash(password, bytes(row[4])), bytes(row[3])):
            raise AccountError('Incorrect email or password.')
        return dict(id=str(row[0]), name=row[1], email=row[2])

    def create_session(self, user):
        token = secrets.token_urlsafe(32)
        token_hash = hashlib.sha256(token.encode()).hexdigest()
        with self.connection() as conn, conn.cursor() as cur:
            cur.execute('DELETE FROM itr_sessions WHERE expires_at <= now()')
            cur.execute("INSERT INTO itr_sessions (token_hash, user_id, expires_at) VALUES (%s, %s, now() + interval '8 hours')", (token_hash, user['id']))
        return token

    def session_user(self, token):
        if not token:
            return None
        with self.connection() as conn, conn.cursor() as cur:
            cur.execute('''SELECT u.id, u.name, u.email FROM itr_sessions s
                           JOIN itr_users u ON u.id = s.user_id
                           WHERE s.token_hash = %s AND s.expires_at > now()''', (hashlib.sha256(token.encode()).hexdigest(),))
            row = cur.fetchone()
        return dict(id=str(row[0]), name=row[1], email=row[2]) if row else None

    def delete_session(self, token):
        if token:
            with self.connection() as conn, conn.cursor() as cur:
                cur.execute('DELETE FROM itr_sessions WHERE token_hash = %s', (hashlib.sha256(token.encode()).hexdigest(),))

    def change_password(self, user_id, current_password, new_password):
        new_password = self.validate_password(new_password)
        if not isinstance(current_password, str):
            raise AccountError('Enter your current password.')
        with self.connection() as conn, conn.cursor() as cur:
            cur.execute('SELECT password_hash,password_salt FROM itr_users WHERE id=%s FOR UPDATE', (user_id,))
            row = cur.fetchone()
            if not row or not hmac.compare_digest(self.password_hash(current_password, bytes(row[1])), bytes(row[0])):
                raise AccountError('Current password is incorrect.')
            if hmac.compare_digest(self.password_hash(new_password, bytes(row[1])), bytes(row[0])):
                raise AccountError('Choose a new password that differs from your current password.')
            salt = secrets.token_bytes(16)
            cur.execute('UPDATE itr_users SET password_hash=%s,password_salt=%s WHERE id=%s',
                        (self.password_hash(new_password, salt), salt, user_id))
            # Ending every session ensures a stolen or previously shared session
            # cannot survive a password change.
            cur.execute('DELETE FROM itr_sessions WHERE user_id=%s', (user_id,))
