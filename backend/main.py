import hashlib
import json
import re
import secrets
import threading
import time
import uuid
from collections import defaultdict, deque
from contextlib import asynccontextmanager
from pathlib import Path
from fastapi import Depends, FastAPI, File, Header, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from starlette.concurrency import run_in_threadpool
from .config import Settings
from .documents import MAX_BYTES, chunk_pages, extract_pages
from .rag import Answerer, VectorIndex
from .store import Store


class ChatInput(BaseModel):
    conversation_id: str = Field(min_length=1, max_length=64)
    message: str = Field(min_length=1, max_length=2000)


class FeedbackInput(BaseModel):
    value: int = Field(ge=-1, le=1)


class TicketInput(BaseModel):
    status: str = Field(pattern='^(open|resolved)$')
    note: str = Field(default='', max_length=2000)


class Limiter:
    def __init__(self):
        self.hits = defaultdict(deque)
        self.lock = threading.Lock()

    def check(self, key, limit):
        now = time.monotonic()
        with self.lock:
            for old in list(self.hits):
                if not self.hits[old] or self.hits[old][-1] < now - 60:
                    del self.hits[old]
            hits = self.hits[key]
            while hits and hits[0] < now - 60:
                hits.popleft()
            if len(hits) >= limit:
                raise HTTPException(429, 'Too many requests. Try again in a minute.', headers={'Retry-After': '60'})
            hits.append(now)


def create_app(settings=None, vector_index=None, answerer=None):
    settings = settings or Settings()
    limiter = Limiter()
    ingestion_lock = threading.Lock()
    # Striped locks bound memory while serializing turns within each conversation.
    chat_locks = [threading.Lock() for _ in range(64)]

    @asynccontextmanager
    async def lifespan(app):
        if len(settings.admin_token) < 24:
            raise RuntimeError('Set ADMIN_TOKEN to a random value of at least 24 characters in .env.')
        settings.data_dir.mkdir(parents=True, exist_ok=True)
        app.state.store = Store(settings.data_dir / 'shopassist.db')
        app.state.index = vector_index or VectorIndex(settings)
        app.state.answerer = answerer or Answerer(settings)
        yield
        app.state.index.close()

    app = FastAPI(title='ShopAssist API', version='1.0.0', lifespan=lifespan)
    app.add_middleware(CORSMiddleware, allow_origins=settings.origins, allow_methods=['GET', 'POST', 'PATCH', 'DELETE'], allow_headers=['Content-Type', 'Authorization', 'X-Session-Token'])

    @app.middleware('http')
    async def headers(request, call_next):
        response = await call_next(request)
        response.headers['X-Content-Type-Options'] = 'nosniff'
        response.headers['Referrer-Policy'] = 'same-origin'
        if request.url.path.startswith('/api/'):
            response.headers['Cache-Control'] = 'no-store'
        return response

    def rate(request, bucket, limit):
        limiter.check((request.client.host if request.client else 'unknown', bucket), limit)

    def admin(request: Request, authorization: str = Header(default='')):
        rate(request, 'admin', 120)
        supplied = authorization.removeprefix('Bearer ')
        if not secrets.compare_digest(supplied, settings.admin_token):
            raise HTTPException(401, 'Enter a valid admin token.')

    def own(conversation_id: str, token: str):
        rows = app.state.store.rows('SELECT * FROM conversations WHERE id=?', (conversation_id,))
        if not rows or not secrets.compare_digest(rows[0]['token_hash'], hashlib.sha256(token.encode()).hexdigest()):
            raise HTTPException(404, 'Conversation not found.')
        return rows[0]

    @app.get('/api/health')
    def health():
        return {'status': 'ok', 'provider': 'deepseek', 'configured': bool(settings.api_key), 'model': settings.model}

    @app.post('/api/admin/login', dependencies=[Depends(admin)])
    def login():
        return {'ok': True}

    @app.post('/api/sessions')
    def session(request: Request):
        rate(request, 'session', 20)
        conversation_id, token = str(uuid.uuid4()), secrets.token_urlsafe(32)
        app.state.store.execute('INSERT INTO conversations (id, token_hash) VALUES (?, ?)', (conversation_id, hashlib.sha256(token.encode()).hexdigest()))
        return {'id': conversation_id, 'token': token}

    @app.get('/api/conversations/{conversation_id}')
    def conversation(conversation_id: str, x_session_token: str = Header(default='')):
        row = own(conversation_id, x_session_token)
        return {**{k: v for k, v in row.items() if k != 'token_hash'}, 'messages': app.state.store.messages(conversation_id)}

    def handoff(conversation_id, reason, question):
        store = app.state.store
        tickets = store.rows("SELECT id FROM tickets WHERE conversation_id=? AND status='open'", (conversation_id,))
        ticket_id = tickets[0]['id'] if tickets else str(uuid.uuid4())
        if not tickets:
            store.execute('INSERT INTO tickets (id, conversation_id, reason) VALUES (?, ?, ?)', (ticket_id, conversation_id, reason))
        store.execute("UPDATE conversations SET status='handoff' WHERE id=?", (conversation_id,))
        chinese = bool(re.search(r'[\u4e00-\u9fff]', question))
        content = f'这个问题需要人工确认。我已将对话加入客服队列。工单 #{ticket_id[:8].upper()}。' if chinese else f'This needs a human touch. I’ve added this conversation to the support queue. Your ticket is #{ticket_id[:8].upper()}.'
        return {'content': content, 'citations': [], 'mode': 'handoff', 'ticket_id': ticket_id, 'reason': reason}

    @app.post('/api/chat')
    def chat(body: ChatInput, request: Request, x_session_token: str = Header(default='')):
        rate(request, 'chat', 30)
        own(body.conversation_id, x_session_token)
        question = body.message.strip()
        if not question:
            raise HTTPException(422, 'Message cannot be empty.')
        store = app.state.store
        lock = chat_locks[hash(body.conversation_id) % len(chat_locks)]
        with lock:
            history = store.messages(body.conversation_id)
            if len(history) >= 200:
                raise HTTPException(422, 'Start a new conversation to continue.')
            store.execute('INSERT INTO messages (id, conversation_id, role, content) VALUES (?, ?, ?, ?)', (str(uuid.uuid4()), body.conversation_id, 'user', question))
            if not history:
                store.execute('UPDATE conversations SET title=? WHERE id=?', (question[:80], body.conversation_id))
            open_ticket = store.rows("SELECT id FROM tickets WHERE conversation_id=? AND status='open'", (body.conversation_id,))
            if open_ticket:
                result = handoff(body.conversation_id, 'Conversation already in support queue', question)
            elif re.search(r'\b(human|agent|person|representative)\b|人工|真人', question, re.I):
                result = handoff(body.conversation_id, 'Customer requested a human', question)
            else:
                try:
                    previous = next((m['content'] for m in reversed(history) if m['role'] == 'user'), '')
                    query = f'{previous}\n{question}' if len(question) < 45 and previous else question
                    sources = app.state.index.search(query)
                    active = {row['id'] for row in store.rows('SELECT id FROM documents')}
                    sources = [s for s in sources if s['document_id'] in active]
                    result = app.state.answerer.answer(question, sources, history)
                except Exception:
                    # Keep provider internals and credentials out of public error responses.
                    result = {'reason': 'Knowledge service unavailable'}
                if 'reason' in result:
                    result = handoff(body.conversation_id, result['reason'], question)
            message_id = str(uuid.uuid4())
            store.execute('INSERT INTO messages (id, conversation_id, role, content, citations, mode) VALUES (?, ?, ?, ?, ?, ?)', (message_id, body.conversation_id, 'assistant', result['content'], json.dumps(result['citations']), result['mode']))
            return {'id': message_id, 'role': 'assistant', 'feedback': None, **result}

    @app.post('/api/messages/{message_id}/feedback')
    def feedback(message_id: str, body: FeedbackInput, x_session_token: str = Header(default='')):
        rows = app.state.store.rows("SELECT conversation_id FROM messages WHERE id=? AND role='assistant'", (message_id,))
        if not rows:
            raise HTTPException(404, 'Message not found.')
        own(rows[0]['conversation_id'], x_session_token)
        app.state.store.execute('UPDATE messages SET feedback=? WHERE id=?', (body.value or None, message_id))
        return {'ok': True}

    @app.get('/api/admin/documents', dependencies=[Depends(admin)])
    def documents():
        return app.state.store.rows('SELECT id, name, chunks, size, created_at FROM documents ORDER BY created_at DESC')

    def ingest(name, data):
        pages = extract_pages(name, data)
        chunks = chunk_pages(pages)
        digest = hashlib.sha256(data).hexdigest()
        store = app.state.store
        with ingestion_lock:
            if store.rows('SELECT id FROM documents WHERE digest=?', (digest,)):
                raise HTTPException(409, 'This document is already in your knowledge base.')
            document_id = str(uuid.uuid4())
            try:
                app.state.index.add(document_id, name, chunks)
                store.execute('INSERT INTO documents (id, name, digest, chunks, size) VALUES (?, ?, ?, ?, ?)', (document_id, name, digest, len(chunks), len(data)))
            except Exception:
                app.state.index.remove(document_id)
                raise
        return {'id': document_id, 'name': name, 'chunks': len(chunks), 'size': len(data)}

    @app.post('/api/admin/documents', dependencies=[Depends(admin)])
    async def upload(file: UploadFile = File(...)):
        data = await file.read(MAX_BYTES + 1)
        await file.close()
        name = (file.filename or 'document').replace('\\', '/').split('/')[-1][:160]
        try:
            return await run_in_threadpool(ingest, name, data)
        except ValueError as exc:
            raise HTTPException(422, str(exc)) from exc
        except HTTPException:
            raise
        except Exception as exc:
            raise HTTPException(503, 'Indexing unavailable. Check the embedding model and vector service.') from exc

    @app.delete('/api/admin/documents/{document_id}', dependencies=[Depends(admin)])
    def delete_document(document_id: str):
        with ingestion_lock:
            if not app.state.store.rows('SELECT id FROM documents WHERE id=?', (document_id,)):
                raise HTTPException(404, 'Document not found.')
            app.state.index.remove(document_id)
            app.state.store.execute('DELETE FROM documents WHERE id=?', (document_id,))
        return {'ok': True}

    @app.get('/api/admin/conversations', dependencies=[Depends(admin)])
    def conversations():
        return app.state.store.rows('''SELECT c.id, c.title, c.status, c.created_at,
            (SELECT count(*) FROM messages m WHERE m.conversation_id=c.id) AS message_count,
            (SELECT coalesce(sum(feedback), 0) FROM messages m WHERE m.conversation_id=c.id) AS feedback
            FROM conversations c WHERE EXISTS (SELECT 1 FROM messages m WHERE m.conversation_id=c.id)
            ORDER BY c.created_at DESC LIMIT 500''')

    @app.get('/api/admin/conversations/{conversation_id}', dependencies=[Depends(admin)])
    def admin_conversation(conversation_id: str):
        rows = app.state.store.rows('SELECT id, title, status, created_at FROM conversations WHERE id=?', (conversation_id,))
        if not rows:
            raise HTTPException(404, 'Conversation not found.')
        return {**rows[0], 'messages': app.state.store.messages(conversation_id)}

    @app.get('/api/admin/tickets', dependencies=[Depends(admin)])
    def tickets():
        return app.state.store.rows('''SELECT t.*, c.title FROM tickets t JOIN conversations c ON t.conversation_id=c.id ORDER BY t.created_at DESC LIMIT 500''')

    @app.patch('/api/admin/tickets/{ticket_id}', dependencies=[Depends(admin)])
    def update_ticket(ticket_id: str, body: TicketInput):
        store = app.state.store
        rows = store.rows('SELECT conversation_id FROM tickets WHERE id=?', (ticket_id,))
        if not rows:
            raise HTTPException(404, 'Ticket not found.')
        with store.connect() as db:
            db.execute('UPDATE tickets SET status=?, note=? WHERE id=?', (body.status, body.note, ticket_id))
            db.execute('UPDATE conversations SET status=? WHERE id=?', ('resolved' if body.status == 'resolved' else 'handoff', rows[0]['conversation_id']))
        return {'ok': True}

    @app.get('/api/admin/stats', dependencies=[Depends(admin)])
    def stats():
        store = app.state.store
        scalar = lambda query: next(iter(store.rows(query)[0].values()))
        return {
            'conversations': scalar("SELECT count(*) FROM conversations WHERE EXISTS (SELECT 1 FROM messages WHERE conversation_id=conversations.id)"),
            'answers': scalar("SELECT count(*) FROM messages WHERE mode='deepseek'"),
            'handoffs': scalar("SELECT count(*) FROM tickets WHERE status='open'"),
            'positive': scalar('SELECT count(*) FROM messages WHERE feedback=1'),
            'negative': scalar('SELECT count(*) FROM messages WHERE feedback=-1'),
            'documents': scalar('SELECT count(*) FROM documents'),
            'chunks': scalar('SELECT coalesce(sum(chunks), 0) FROM documents'),
        }

    static_dir = Path(__file__).resolve().parents[1] / 'out'

    @app.get('/{path:path}', include_in_schema=False)
    def static(path: str):
        if path == 'api' or path.startswith('api/'):
            raise HTTPException(404)
        target = (static_dir / (path or 'index.html')).resolve()
        if not target.is_relative_to(static_dir.resolve()) or not target.is_file():
            raise HTTPException(404)
        return FileResponse(target)

    return app


app = create_app()
