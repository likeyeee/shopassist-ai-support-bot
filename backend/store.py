import json
import sqlite3
from contextlib import contextmanager
from pathlib import Path


class Store:
    def __init__(self, path: Path):
        self.path = path
        path.parent.mkdir(parents=True, exist_ok=True)
        with self.connect() as db:
            db.executescript('''
                PRAGMA journal_mode=WAL;
                CREATE TABLE IF NOT EXISTS documents (
                    id TEXT PRIMARY KEY, name TEXT NOT NULL, digest TEXT UNIQUE NOT NULL,
                    chunks INTEGER NOT NULL, size INTEGER NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP
                );
                CREATE TABLE IF NOT EXISTS conversations (
                    id TEXT PRIMARY KEY, token_hash TEXT NOT NULL, title TEXT NOT NULL DEFAULT 'New conversation',
                    status TEXT NOT NULL DEFAULT 'active', created_at TEXT DEFAULT CURRENT_TIMESTAMP
                );
                CREATE TABLE IF NOT EXISTS messages (
                    id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL REFERENCES conversations(id),
                    role TEXT NOT NULL, content TEXT NOT NULL, citations TEXT NOT NULL DEFAULT '[]',
                    feedback INTEGER, mode TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP
                );
                CREATE TABLE IF NOT EXISTS tickets (
                    id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL REFERENCES conversations(id),
                    reason TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open',
                    note TEXT NOT NULL DEFAULT '', created_at TEXT DEFAULT CURRENT_TIMESTAMP
                );
                CREATE INDEX IF NOT EXISTS message_conversation ON messages(conversation_id);
                CREATE INDEX IF NOT EXISTS ticket_conversation ON tickets(conversation_id);
            ''')

    @contextmanager
    def connect(self):
        db = sqlite3.connect(self.path, timeout=20)
        db.row_factory = sqlite3.Row
        db.execute('PRAGMA foreign_keys=ON')
        try:
            yield db
            db.commit()
        except Exception:
            db.rollback()
            raise
        finally:
            db.close()

    def rows(self, sql, params=()):
        with self.connect() as db:
            return [dict(row) for row in db.execute(sql, params).fetchall()]

    def execute(self, sql, params=()):
        with self.connect() as db:
            return db.execute(sql, params).rowcount

    def messages(self, conversation_id):
        rows = self.rows('SELECT * FROM messages WHERE conversation_id=? ORDER BY rowid', (conversation_id,))
        for row in rows:
            row['citations'] = json.loads(row['citations'])
        return rows
