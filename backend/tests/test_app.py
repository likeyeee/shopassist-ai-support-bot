import io
import json
from pathlib import Path
import httpx
import pytest
from fastapi.testclient import TestClient
from reportlab.pdfgen.canvas import Canvas
from backend.config import Settings
from backend.documents import chunk_pages, extract_pages
from backend.main import create_app
from backend.rag import Answerer, VectorIndex

TOKEN = 'test-admin-token-with-at-least-24-characters'
HEADERS = {'Authorization': 'Bearer ' + TOKEN}


class TestEmbeddings:
    """Tiny deterministic vectors isolate transport/storage tests from model downloads."""
    def embed(self, texts):
        for text in texts:
            words = text.lower()
            yield [float('return' in words), float('shipping' in words), 0.01]


class GroundedAnswer:
    def answer(self, question, sources, history):
        if not sources:
            return {'reason': 'No relevant source'}
        s = sources[0]
        return {'content': s['text'], 'citations': [{'id': s['id'], 'document_id': s['document_id'], 'name': s['name'], 'page': s['page'], 'excerpt': s['text'], 'score': s['score']}], 'mode': 'deepseek'}


@pytest.fixture
def client(tmp_path):
    settings = Settings(data_dir=tmp_path, admin_token=TOKEN, api_key='', threshold=0.8)
    index = VectorIndex(settings, embedder=TestEmbeddings())
    with TestClient(create_app(settings, index, GroundedAnswer())) as client:
        yield client


def upload(client, content=b'# Returns\nReturn unworn items within 30 days.', name='returns.md'):
    return client.post('/api/admin/documents', files={'file': (name, content)}, headers=HEADERS)


def session(client):
    s = client.post('/api/sessions').json()
    return s['id'], {'X-Session-Token': s['token']}


def chat(client, conversation_id, headers, message='What is the return policy?'):
    return client.post('/api/chat', json={'conversation_id': conversation_id, 'message': message}, headers=headers)


def test_ingestion_cited_answer_feedback_history_and_delete(client):
    doc = upload(client)
    assert doc.status_code == 200, doc.text
    assert doc.json()['chunks'] > 0
    assert upload(client).status_code == 409
    conversation_id, headers = session(client)
    answer = chat(client, conversation_id, headers)
    assert answer.status_code == 200
    assert answer.json()['mode'] == 'deepseek'
    assert answer.json()['citations'][0]['document_id'] == doc.json()['id']
    assert client.post(f'/api/messages/{answer.json()["id"]}/feedback', json={'value': -1}, headers=headers).status_code == 200
    stats = client.get('/api/admin/stats', headers=HEADERS).json()
    assert stats['answers'] == 1 and stats['negative'] == 1
    history = client.get(f'/api/conversations/{conversation_id}', headers=headers).json()
    assert len(history['messages']) == 2
    assert 'token_hash' not in history
    assert client.delete(f'/api/admin/documents/{doc.json()["id"]}', headers=HEADERS).status_code == 200
    second, second_headers = session(client)
    assert chat(client, second, second_headers).json()['mode'] == 'handoff'


def test_admin_and_session_isolation(client):
    assert client.get('/api/admin/documents').status_code == 401
    assert client.post('/api/admin/login', headers={'Authorization': 'Bearer wrong'}).status_code == 401
    assert client.get('/api/admin/conversations').status_code == 401
    assert client.get('/api/admin/tickets').status_code == 401
    cid, headers = session(client)
    _, stranger = session(client)
    assert chat(client, cid, stranger).status_code == 404
    assert client.get(f'/api/conversations/{cid}', headers=stranger).status_code == 404
    answer = chat(client, cid, headers).json()
    assert client.post(f'/api/messages/{answer["id"]}/feedback', json={'value': 1}, headers=stranger).status_code == 404
    assert client.get('/api/admin/conversations', headers=HEADERS).status_code == 200


def test_unknown_question_handoff_and_ticket_lifecycle(client):
    cid, headers = session(client)
    result = chat(client, cid, headers, 'Can you make an exception for me?').json()
    assert result['mode'] == 'handoff'
    ticket_id = result['ticket_id']
    second = chat(client, cid, headers, 'Human please').json()
    assert second['ticket_id'] == ticket_id
    tickets = client.get('/api/admin/tickets', headers=HEADERS).json()
    assert len(tickets) == 1
    assert client.patch(f'/api/admin/tickets/{ticket_id}', json={'status': 'resolved', 'note': 'Handled manually'}, headers=HEADERS).status_code == 200
    assert client.get('/api/admin/stats', headers=HEADERS).json()['handoffs'] == 0
    assert client.get(f'/api/admin/conversations/{cid}', headers=HEADERS).json()['status'] == 'resolved'


def test_human_request_skips_generation(client):
    upload(client)
    cid, headers = session(client)
    result = chat(client, cid, headers, '请帮我转人工').json()
    assert result['mode'] == 'handoff'
    assert '客服队列' in result['content']


def test_pdf_markdown_validation_and_page_provenance(client):
    buffer = io.BytesIO()
    canvas = Canvas(buffer)
    canvas.drawString(60, 760, 'Shipping takes 5-8 business days.')
    canvas.showPage()
    canvas.drawString(60, 760, 'Returns are accepted within 30 days.')
    canvas.save()
    data = buffer.getvalue()
    pages = extract_pages('policy.pdf', data)
    assert [p for p, _ in pages] == [1, 2]
    assert {c['page'] for c in chunk_pages(pages)} == {1, 2}
    assert upload(client, data, 'policy.pdf').status_code == 200
    assert upload(client, b'not a pdf', 'bad.pdf').status_code == 422
    assert upload(client, b' ', 'empty.md').status_code == 422
    assert upload(client, b'hello', 'wrong.exe').status_code == 422
    assert upload(client, b'x' * (5 * 1024 * 1024 + 1)).status_code == 422
    assert upload(client, b'\xff\xfe', 'broken.md').status_code == 422


def test_chunking_keeps_tail_and_respects_limits():
    text = ('Some policy sentences about returns. ' * 100) + 'IMPORTANT END'
    chunks = chunk_pages([(3, text)])
    assert len(chunks) > 1 and all(len(c['text']) <= 850 for c in chunks)
    assert chunks[-1]['text'].endswith('IMPORTANT END')
    assert all(c['page'] == 3 for c in chunks)


@pytest.mark.parametrize('result,reason', [
    ({'answerable': False, 'answer': '', 'evidence': []}, 'Sources do not answer'),
    ({'answerable': True, 'answer': '30 days.', 'evidence': []}, 'Missing supporting citation'),
    ({'answerable': True, 'answer': '30 days.', 'evidence': [{'source_id': '99', 'quote': 'Returns are accepted within 30 days.'}]}, 'Unverifiable citation'),
    ({'answerable': True, 'answer': '90 days.', 'evidence': [{'source_id': '1', 'quote': 'Returns are accepted within 90 days.'}]}, 'Unverifiable citation'),
])
def test_unverifiable_model_responses_are_rejected(monkeypatch, result, reason):
    class Client:
        def __init__(self, **kwargs): pass
        def __enter__(self): return self
        def __exit__(self, *args): pass
        def post(self, *args, **kwargs):
            return httpx.Response(200, json={'choices': [{'message': {'content': json.dumps(result)}}]}, request=httpx.Request('POST', 'https://api.deepseek.com/chat/completions'))
    monkeypatch.setattr('backend.rag.httpx.Client', Client)
    answer = Answerer(Settings(api_key='unit-test-only')).answer('Returns?', [{'id': '1', 'text': 'Returns are accepted within 30 days.'}], [])
    assert reason in answer['reason']


def test_provider_failure_and_missing_key_handoff(monkeypatch):
    sources = [{'id': '1', 'text': 'Returns are accepted within 30 days.'}]
    assert Answerer(Settings(api_key='')).answer('Returns?', sources, [])['reason'] == 'AI provider not configured'
    class FailedClient:
        def __init__(self, **kwargs): pass
        def __enter__(self): raise httpx.ConnectError('Provider unreachable')
        def __exit__(self, *args): pass
    monkeypatch.setattr('backend.rag.httpx.Client', FailedClient)
    assert Answerer(Settings(api_key='test')).answer('Returns?', sources, [])['reason'] == 'AI provider unavailable'


def test_blank_questions_and_invalid_feedback(client):
    cid, headers = session(client)
    assert chat(client, cid, headers, '   ').status_code == 422
    assert chat(client, cid, headers, 'x' * 2001).status_code == 422
    msg = chat(client, cid, headers).json()
    assert client.post(f'/api/messages/{msg["id"]}/feedback', json={'value': 2}, headers=headers).status_code == 422


def test_rate_limit(client):
    for _ in range(20):
        assert client.post('/api/sessions').status_code == 200
    response = client.post('/api/sessions')
    assert response.status_code == 429
    assert response.headers['Retry-After'] == '60'
