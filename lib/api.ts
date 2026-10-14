import { demo } from './demo';
import type { Conversation, DocumentRecord, Message, Stats, Ticket } from './types';

export const IS_DEMO = process.env.NEXT_PUBLIC_DEMO_MODE === 'true';
const BASE = process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:8000/api';
type Session = { id: string; token: string };
const sessionKey = IS_DEMO ? 'shopassist.demo.session' : 'shopassist.live.session';

export function adminToken() { return typeof window !== 'undefined' ? sessionStorage.getItem('shopassist.admin') || '' : ''; }
export function setAdminToken(token: string) { if (token) sessionStorage.setItem('shopassist.admin', token); else sessionStorage.removeItem('shopassist.admin'); }
export function getSession(): Session | null { try { return JSON.parse(localStorage.getItem(sessionKey) || 'null'); } catch { return null; } }
export function clearSession() { localStorage.removeItem(sessionKey); }

async function request<T>(path: string, options: RequestInit = {}, admin = false): Promise<T> {
  const headers = new Headers(options.headers);
  if (!(options.body instanceof FormData)) headers.set('Content-Type', 'application/json');
  if (admin) headers.set('Authorization', `Bearer ${adminToken()}`);
  const session = getSession();
  if (session) headers.set('X-Session-Token', session.token);
  const response = await fetch(`${BASE}${path}`, { ...options, headers, signal: AbortSignal.timeout(120000) });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    if (response.status === 401 && admin) { setAdminToken(''); window.dispatchEvent(new Event('shopassist:logout')); }
    throw new Error(typeof payload.detail === 'string' ? payload.detail : `Request failed (${response.status}).`);
  }
  return response.json();
}

export const api = {
  async session() { let session = getSession(); if (!session) { session = IS_DEMO ? demo.newSession() : await request<Session>('/sessions', { method: 'POST' }); localStorage.setItem(sessionKey, JSON.stringify(session)); } return session; },
  async history(id: string) { return IS_DEMO ? demo.conversation(id) : request<Conversation>(`/conversations/${id}`); },
  async chat(text: string) { const session = await api.session(); return IS_DEMO ? demo.chat(session.id, text) : request<Message>('/chat', { method: 'POST', body: JSON.stringify({ conversation_id: session.id, message: text }) }); },
  async feedback(id: string, value: number) { if (IS_DEMO) return demo.feedback(id, value); return request(`/messages/${id}/feedback`, { method: 'POST', body: JSON.stringify({ value }) }); },
  async login(token: string) { setAdminToken(token); if (!IS_DEMO) { try { await request('/admin/login', { method: 'POST' }, true); } catch (error) { setAdminToken(''); throw error; } } },
  async documents() { return IS_DEMO ? demo.documents() : request<DocumentRecord[]>('/admin/documents', {}, true); },
  async upload(file: File) { if (IS_DEMO) return demo.upload(file); const body = new FormData(); body.append('file', file); return request<DocumentRecord>('/admin/documents', { method: 'POST', body }, true); },
  async removeDocument(id: string) { if (IS_DEMO) return demo.removeDocument(id); return request(`/admin/documents/${id}`, { method: 'DELETE' }, true); },
  async conversations() { return IS_DEMO ? demo.conversations() : request<Conversation[]>('/admin/conversations', {}, true); },
  async conversation(id: string) { return IS_DEMO ? demo.conversation(id) : request<Conversation>(`/admin/conversations/${id}`, {}, true); },
  async tickets() { return IS_DEMO ? demo.tickets() : request<Ticket[]>('/admin/tickets', {}, true); },
  async updateTicket(id: string, status: string, note: string) { if (IS_DEMO) return demo.updateTicket(id, status, note); return request(`/admin/tickets/${id}`, { method: 'PATCH', body: JSON.stringify({ status, note }) }, true); },
  async stats() { return IS_DEMO ? demo.stats() : request<Stats>('/admin/stats', {}, true); },
};
