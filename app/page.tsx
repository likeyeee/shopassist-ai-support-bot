'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, BookOpen, Check, CheckCheck, ChevronDown, ChevronRight, CircleHelp, Clock3, FileText, Headphones, Inbox, LoaderCircle, LogOut, Menu, MessageCircle, Package, Plus, Search, ShieldCheck, ShoppingBag, Sparkles, ThumbsDown, ThumbsUp, Trash2, Upload, X } from 'lucide-react';
import { api, adminToken, clearSession, getSession, IS_DEMO, setAdminToken } from '@/lib/api';
import { demo, sampleDocuments } from '@/lib/demo';
import type { Citation, Conversation, DocumentRecord, Message, Stats, Ticket } from '@/lib/types';

type View = 'assistant' | 'knowledge' | 'conversations' | 'inbox';
const titles: Record<View, string> = { assistant: 'Assistant', knowledge: 'Knowledge base', conversations: 'Conversations', inbox: 'Human inbox' };
const prompts = [
  { icon: Package, title: 'Shipping & delivery', question: 'How long does shipping to the US take?' },
  { icon: ArrowLeft, title: 'Returns & exchanges', question: 'What is your return policy?' },
  { icon: ShoppingBag, title: 'Find my size', question: 'How do I choose the right size?' },
];
const formatDate = (value?: string) => value ? new Date(value.endsWith('Z') ? value : value.replace(' ', 'T') + 'Z').toLocaleDateString('en', { month: 'short', day: 'numeric' }) : 'Just now';
const errorMessage = (error: unknown) => error instanceof Error ? error.message : 'Something went wrong. Please try again.';

function Mark({ small = false }: { small?: boolean }) { return <span className={`brand-mark ${small ? 'small' : ''}`}><ShoppingBag size={small ? 17 : 22} strokeWidth={1.6} /></span>; }
function Badge({ status }: { status: string }) { return <span className={`badge ${status}`}><span />{status === 'handoff' ? 'Needs a human' : status === 'active' ? 'AI assisted' : status === 'open' ? 'Open' : 'Resolved'}</span>; }

export default function Home() {
  const [view, setView] = useState<View>('assistant');
  const [menu, setMenu] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [authenticated, setAuthenticated] = useState(IS_DEMO);
  const [loginToken, setLoginToken] = useState('');
  const [loginBusy, setLoginBusy] = useState(false);
  const [notice, setNotice] = useState<{ text: string; error?: boolean } | null>(null);
  const [source, setSource] = useState<Citation | null>(null);
  const [documents, setDocuments] = useState<DocumentRecord[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [detail, setDetail] = useState<Conversation | null>(null);
  const [editingTicket, setEditingTicket] = useState<Ticket | null>(null);
  const [ticketNote, setTicketNote] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<DocumentRecord | null>(null);
  const [saving, setSaving] = useState(false);
  const bottom = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const toast = useCallback((text: string, error = false) => setNotice({ text, error }), []);
  const refresh = useCallback(async () => {
    if (!IS_DEMO && !adminToken()) return;
    setLoading(true);
    try { const [d, c, t, s] = await Promise.all([api.documents(), api.conversations(), api.tickets(), api.stats()]); setDocuments(d); setConversations(c); setTickets(t); setStats(s); }
    catch (error) { toast(errorMessage(error), true); }
    finally { setLoading(false); }
  }, [toast]);

  useEffect(() => {
    setAuthenticated(IS_DEMO || !!adminToken());
    const session = getSession();
    if (session) api.history(session.id).then(c => { if (c) setMessages(c.messages || []); else clearSession(); }).catch(() => clearSession()).finally(() => setReady(true));
    else setReady(true);
    const logout = () => setAuthenticated(false);
    window.addEventListener('shopassist:logout', logout);
    return () => window.removeEventListener('shopassist:logout', logout);
  }, []);
  useEffect(() => { if (authenticated) void refresh(); }, [authenticated, view, refresh]);
  useEffect(() => { if (messages.length) bottom.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }); }, [messages, busy]);
  useEffect(() => { if (!notice) return; const timer = setTimeout(() => setNotice(null), 6000); return () => clearTimeout(timer); }, [notice]);
  useEffect(() => { function escape(event: KeyboardEvent) { if (event.key === 'Escape') { setSource(null); setDetail(null); setEditingTicket(null); setDeleteTarget(null); setMenu(false); } } window.addEventListener('keydown', escape); return () => window.removeEventListener('keydown', escape); }, []);

  function navigate(next: View) { setView(next); setSearch(''); setFilter('all'); setMenu(false); }
  function newChat() { if (busy) return; clearSession(); setMessages([]); setDraft(''); setSource(null); navigate('assistant'); input.current?.focus(); }
  async function send(text: string) {
    const question = text.trim(); if (!question || busy || !ready) return;
    if (question.length > 2000) { toast('Keep your message under 2,000 characters.', true); return; }
    setView('assistant'); setDraft(''); setBusy(true); setSource(null);
    const pending: Message = { id: crypto.randomUUID(), role: 'user', content: question, citations: [] };
    setMessages(old => [...old, pending]);
    try { const answer = await api.chat(question); setMessages(old => [...old, answer]); if (authenticated) void refresh(); }
    catch (error) {
      setMessages(old => old.filter(m => m.id !== pending.id)); setDraft(question); toast(errorMessage(error), true);
      const session = getSession(); if (session) { try { const history = await api.history(session.id); if (history) setMessages(history.messages || []); } catch { clearSession(); } }
    } finally { setBusy(false); input.current?.focus(); }
  }
  async function vote(message: Message, value: number) {
    const next = message.feedback === value ? 0 : value;
    try { await api.feedback(message.id, next); setMessages(old => old.map(m => m.id === message.id ? { ...m, feedback: next } : m)); if (authenticated) void refresh(); }
    catch (error) { toast(errorMessage(error), true); }
  }
  async function upload(files: FileList | File[]) {
    setUploading(true);
    try { for (const file of Array.from(files)) await api.upload(file); toast('Knowledge base updated.'); }
    catch (error) { toast(errorMessage(error), true); }
    finally { setUploading(false); if (fileInput.current) fileInput.current.value = ''; await refresh(); }
  }
  async function openConversation(id: string) {
    try { const c = await api.conversation(id); if (c) setDetail(c); }
    catch (error) { toast(errorMessage(error), true); }
  }
  async function resolveTicket() {
    if (!editingTicket) return;
    setSaving(true);
    try { await api.updateTicket(editingTicket.id, editingTicket.status === 'resolved' ? 'open' : 'resolved', ticketNote); setEditingTicket(null); toast('Ticket updated.'); await refresh(); }
    catch (error) { toast(errorMessage(error), true); } finally { setSaving(false); }
  }
  const renderedMessages = (items: Message[], readonly = false) => items.map(message => <div className={`message ${message.role}`} key={message.id}>
    {message.role === 'assistant' && <Mark small />}
    <div className="message-body">
      {message.role === 'assistant' && <div className="message-author">ShopAssist <span>{message.mode === 'handoff' ? 'Support queue' : message.mode === 'sandbox' ? 'Source excerpt' : 'Assistant'}</span></div>}
      <div className="message-text">{message.content}</div>
      {!!message.citations?.length && <div className="citations">{message.citations.map((citation, i) => <button className="citation" key={`${citation.id}-${i}`} onClick={() => setSource(citation)}><FileText size={13} /><span>{citation.name.replace(/\.(md|pdf|markdown)$/i, '')}</span><span className="citation-number">{i + 1}</span></button>)}</div>}
      {message.role === 'assistant' && !readonly && <div className="message-actions"><span>{message.mode === 'handoff' ? <><Clock3 size={12} /> Waiting for support</> : <><ShieldCheck size={12} /> Based on store policies</>}</span><div><button aria-label="Helpful answer" aria-pressed={message.feedback === 1} className={message.feedback === 1 ? 'voted' : ''} onClick={() => void vote(message, 1)}><ThumbsUp size={14} /></button><button aria-label="Unhelpful answer" aria-pressed={message.feedback === -1} className={message.feedback === -1 ? 'voted' : ''} onClick={() => void vote(message, -1)}><ThumbsDown size={14} /></button></div></div>}
    </div>
  </div>);

  return <div className="workspace">
    {menu && <button className="sidebar-scrim" aria-label="Close navigation" onClick={() => setMenu(false)} />}
    <aside className={`sidebar ${menu ? 'is-open' : ''}`}>
      <button className="brand" onClick={() => navigate('assistant')} aria-label="ShopAssist home"><Mark /><span>ShopAssist<span className="brand-dot">.</span></span></button>
      <div className="store-switch"><span className="store-avatar">n.</span><div><strong>Northline</strong><span>Support workspace</span></div><ChevronDown size={14} /></div>
      <button className="new-chat" onClick={newChat} disabled={busy}><Plus size={17} /> New conversation <span>↗</span></button>
      <div className="nav-label">WORKSPACE</div>
      <nav aria-label="Main navigation">
        {([{ id: 'assistant', icon: Sparkles }, { id: 'knowledge', icon: BookOpen }, { id: 'conversations', icon: MessageCircle }, { id: 'inbox', icon: Inbox }] as const).map(item => <button className={view === item.id ? 'active' : ''} key={item.id} onClick={() => navigate(item.id)}><item.icon size={18} strokeWidth={1.7} /><span>{titles[item.id]}</span>{item.id === 'inbox' && !!stats?.handoffs && <span className="nav-count">{stats.handoffs}</span>}</button>)}
      </nav>
      <div className="sidebar-note"><span className="status-dot" />Support, around the clock</div>
      <div className="sidebar-bottom"><div className="workspace-plan"><span className="small-caps">{IS_DEMO ? 'INTERACTIVE SANDBOX' : 'SELF-HOSTED WORKSPACE'}</span><div><span>{IS_DEMO ? 'Local browser data' : 'DeepSeek · Qdrant'}</span><ShieldCheck size={15} /></div></div><div className="profile"><span className="profile-avatar">N</span><div><strong>Northline store</strong><span>{IS_DEMO ? 'Demo workspace' : authenticated ? 'Administrator' : 'Customer support'}</span></div>{authenticated && !IS_DEMO ? <button title="Sign out of admin" aria-label="Sign out of admin" onClick={() => { setAdminToken(''); setAuthenticated(false); setStats(null); navigate('assistant'); }}><LogOut size={16} /></button> : <span className="profile-dot" />}</div></div>
    </aside>

    <div className="main-shell">
      <header className="topbar"><div className="breadcrumb"><button className="mobile-menu icon-button" aria-label="Open navigation" onClick={() => setMenu(true)}><Menu size={20} /></button><span>Workspace</span><ChevronRight size={13} /><strong>{titles[view]}</strong></div><div className="topbar-right"><span className="mode-label"><span className="status-dot" />{IS_DEMO ? 'Sandbox' : 'Live workspace'}</span><span className="divider" /><span className="store-mini">Northline <span>N</span></span></div></header>
      {view === 'assistant' ? <div className="assistant-layout">
        <main className={`chat-panel ${messages.length ? 'has-messages' : ''}`}>
          <div className="chat-topline"><span><span className="status-dot" /> Northline support</span><button className="text-button" onClick={() => void send('I would like to speak to a human.')} disabled={busy || !ready}><Headphones size={15} /> Talk to a person</button></div>
          {IS_DEMO && <div className="sandbox-note"><span>Sandbox</span> Answers are source excerpts. Data stays in this browser.</div>}
          <div className="chat-scroll">
            {!messages.length ? <div className="welcome"><div className="welcome-symbol"><Sparkles size={35} strokeWidth={1.2} /></div><span className="eyebrow">HERE TO HELP</span><h1>How can I help<br />you today?</h1><div className="suggestions">{prompts.map(prompt => <button onClick={() => void send(prompt.question)} disabled={busy || !ready} key={prompt.title}><prompt.icon size={20} strokeWidth={1.5} /><span>{prompt.title}</span><ArrowUp size={14} className="diagonal" /></button>)}</div></div> : <div className="message-list">{renderedMessages(messages)}{busy && <div className="message assistant"><Mark small /><div className="thinking" role="status"><span /><span /><span /><small>Checking store policies</small></div></div>}<div ref={bottom} /></div>}
          </div>
          <div className="composer-area"><form className="composer" onSubmit={event => { event.preventDefault(); void send(draft); }}><textarea ref={input} aria-label="Your question" placeholder="Ask about your order, returns, or sizing…" value={draft} maxLength={2000} rows={2} onChange={event => setDraft(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void send(draft); } }} /><div className="composer-bottom"><span><Sparkles size={13} /> ShopAssist <span className="composer-model">{IS_DEMO ? 'Sandbox' : 'DeepSeek'}</span></span><button className="send-button" type="submit" aria-label="Send message" disabled={!draft.trim() || busy || !ready}>{busy ? <LoaderCircle size={17} className="spin" /> : <ArrowUp size={18} />}</button></div></form><div className="composer-caption"><ShieldCheck size={12} /> Answers grounded in store policies <span>↵ to send</span></div></div>
        </main>
        <aside className="context-panel"><div className="context-heading"><span className="small-caps">YOUR STORE, IN CONTEXT</span><BookOpen size={16} /></div><div className="context-store"><div className="northline-logo">n.</div><h2>Northline</h2><span>Everyday essentials</span></div><div className="context-section"><h3>What can we help with?</h3>{prompts.map((p, i) => <button className="topic-row" key={p.title} onClick={() => void send(p.question)} disabled={busy || !ready}><span className={`topic-icon topic-${i}`}><p.icon size={16} strokeWidth={1.5} /></span><span>{p.title}</span><ChevronRight size={14} /></button>)}</div><div className="trust-card"><div><ShieldCheck size={19} /><span>Every answer has a source.</span></div><p>Open any citation to check the original store policy.</p><span className="trust-line"><span className="status-dot" /> Sources you can verify</span></div><div className="context-footer"><Headphones size={23} strokeWidth={1.3} /><h3>A person, when you need one.</h3><button className="text-button" disabled={busy || !ready} onClick={() => void send('Please connect me with a human agent.')}>Contact support <ArrowRight size={14} /></button></div></aside>
      </div> : <main className="admin-main">
        {!authenticated ? <div className="login-card"><span className="login-icon"><ShieldCheck size={27} strokeWidth={1.5} /></span><span className="eyebrow">MERCHANT ACCESS</span><h1>Your support workspace</h1><form onSubmit={async event => { event.preventDefault(); setLoginBusy(true); try { await api.login(loginToken); setAuthenticated(true); setLoginToken(''); } catch (error) { toast(errorMessage(error), true); } finally { setLoginBusy(false); } }}><label htmlFor="admin-token">Admin token</label><input id="admin-token" type="password" autoComplete="current-password" value={loginToken} onChange={event => setLoginToken(event.target.value)} required /><button className="primary-button" disabled={loginBusy}>{loginBusy ? <LoaderCircle className="spin" size={16} /> : <ArrowRight size={16} />} Open workspace</button></form></div> : <>
          <div className="admin-heading"><div><span className="eyebrow">NORTHLINE / WORKSPACE</span><h1>{titles[view]}</h1></div>{view === 'knowledge' ? <button className="primary-button" onClick={() => fileInput.current?.click()} disabled={uploading}><Plus size={16} /> Add documents</button> : <button className="secondary-button" onClick={() => void refresh()} disabled={loading}><ArrowDown size={15} /> Refresh</button>}</div>
          <div className="stats-grid">{(view === 'knowledge' ? [{ label: 'Documents', value: stats?.documents, icon: FileText }, { label: 'Searchable chunks', value: stats?.chunks, icon: BookOpen }, { label: 'Source types', value: 'PDF + Markdown', icon: CheckCheck }] : [{ label: 'Conversations', value: stats?.conversations, icon: MessageCircle }, { label: 'Helpful / not helpful', value: `${stats?.positive || 0} / ${stats?.negative || 0}`, icon: ThumbsUp }, { label: 'Awaiting a human', value: stats?.handoffs, icon: Headphones }]).map(stat => <div className="stat" key={stat.label}><span>{stat.label}<stat.icon size={17} /></span><strong>{stat.value ?? '—'}</strong></div>)}</div>
          {view === 'knowledge' && <><input ref={fileInput} type="file" multiple accept=".pdf,.md,.markdown" aria-label="Upload documents" className="hidden" onChange={event => { if (event.target.files) void upload(event.target.files); }} /><button className={`upload-zone ${uploading ? 'uploading' : ''}`} disabled={uploading} onClick={() => fileInput.current?.click()} onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); if (!uploading) void upload(event.dataTransfer.files); }}><span className="upload-icon">{uploading ? <LoaderCircle className="spin" size={24} /> : <Upload size={24} strokeWidth={1.5} />}</span><strong>{uploading ? 'Reading and indexing documents…' : 'Drop your store policies here'}</strong><span>PDF or Markdown · Up to 5 MB per file</span></button>{documents.length === 0 && <button className="text-button sample-button" disabled={uploading} onClick={() => void upload(sampleDocuments.map(d => new File([d.text || ''], d.name, { type: 'text/markdown' })))}>Load sample store policies <ArrowRight size={14} /></button>}</>}
          <div className="table-card"><div className="table-toolbar"><div className="table-tabs">{view === 'knowledge' ? <strong>All documents <span>{documents.length}</span></strong> : ['all', ...(view === 'inbox' ? ['open', 'resolved'] : ['active', 'handoff', 'resolved'])].map(f => <button className={filter === f ? 'selected' : ''} onClick={() => setFilter(f)} key={f}>{f === 'all' ? 'All' : f === 'handoff' ? 'Needs a human' : f[0].toUpperCase() + f.slice(1)}</button>)}</div><label className="search-box"><Search size={15} /><input aria-label="Search records" placeholder="Search…" value={search} onChange={event => setSearch(event.target.value)} /></label></div>
            {loading && <div className="loading-line" role="status"><LoaderCircle size={14} className="spin" /> Updating workspace</div>}
            {view === 'knowledge' ? <div className="table-scroll"><table><thead><tr><th>Document</th><th>Chunks</th><th>Status</th><th>Added</th><th><span className="sr-only">Actions</span></th></tr></thead><tbody>{documents.filter(d => d.name.toLowerCase().includes(search.toLowerCase())).map(d => <tr key={d.id}><td><div className="document-name"><span className="document-icon"><FileText size={19} /></span><div><strong>{d.name}</strong><small>{(d.size / 1024).toFixed(1)} KB · {/\.pdf$/i.test(d.name) ? 'PDF' : 'Markdown'}</small></div></div></td><td>{d.chunks}</td><td><span className="indexed"><Check size={12} /> {IS_DEMO ? 'Available' : 'Indexed'}</span></td><td>{formatDate(d.created_at)}</td><td><button className="icon-button delete-button" aria-label={`Delete ${d.name}`} onClick={() => setDeleteTarget(d)}><Trash2 size={16} /></button></td></tr>)}</tbody></table>{!documents.filter(d => d.name.toLowerCase().includes(search.toLowerCase())).length && <div className="empty-state"><BookOpen size={28} /><h3>{search ? 'No matching documents' : 'Your knowledge base starts here'}</h3><span>{search ? 'Try a different search.' : 'Upload a policy to give your assistant a source.'}</span></div>}</div> : view === 'conversations' ? <div className="record-list">{conversations.filter(c => (filter === 'all' || c.status === filter) && c.title.toLowerCase().includes(search.toLowerCase())).map(c => <button className="conversation-row" key={c.id} onClick={() => void openConversation(c.id)}><span className="record-icon"><MessageCircle size={19} /></span><div><strong>{c.title}</strong><small>{c.message_count} messages · {formatDate(c.created_at)} <span className="feedback-summary">{c.feedback ? c.feedback > 0 ? '↑ Helpful' : '↓ Needs improvement' : ''}</span></small></div><Badge status={c.status} /><ChevronRight size={17} /></button>)}{!conversations.filter(c => (filter === 'all' || c.status === filter) && c.title.toLowerCase().includes(search.toLowerCase())).length && <div className="empty-state"><MessageCircle size={28} /><h3>No conversations yet</h3><button className="text-button" onClick={() => navigate('assistant')}>Start a conversation <ArrowRight size={14} /></button></div>}</div> : <div className="record-list">{tickets.filter(t => (filter === 'all' || t.status === filter) && `${t.title} ${t.reason}`.toLowerCase().includes(search.toLowerCase())).map(t => <div className="ticket-row" key={t.id}><span className={`record-icon ${t.status === 'open' ? 'warm' : ''}`}><Headphones size={19} /></span><div className="ticket-text"><button onClick={() => void openConversation(t.conversation_id)}>{t.title}</button><small>#{t.id.slice(0, 8).toUpperCase()} · {t.reason}</small>{t.note && <p>{t.note}</p>}</div><Badge status={t.status} /><button className="secondary-button" onClick={() => { setEditingTicket(t); setTicketNote(t.note); }}>{t.status === 'open' ? 'Resolve' : 'Reopen'}</button></div>)}{!tickets.filter(t => (filter === 'all' || t.status === filter) && `${t.title} ${t.reason}`.toLowerCase().includes(search.toLowerCase())).length && <div className="empty-state"><CheckCheck size={30} /><h3>You’re all caught up</h3><span>Conversations that need a person will appear here.</span></div>}</div>}
          </div><div className="admin-footer"><ShieldCheck size={13} /> {IS_DEMO ? 'Sandbox · Changes are saved in this browser only.' : 'Private workspace · Only authenticated administrators can access these records.'}</div>
        </>}
      </main>}
    </div>

    {detail && <div className="modal-overlay" onClick={() => setDetail(null)}><section className="dialog conversation-dialog" role="dialog" aria-modal="true" aria-label="Conversation detail" onClick={event => event.stopPropagation()}><div className="dialog-header"><div><span className="eyebrow">CONVERSATION</span><h2>{detail.title}</h2></div><button autoFocus className="icon-button" aria-label="Close conversation" onClick={() => setDetail(null)}><X size={20} /></button></div><div className="dialog-messages">{renderedMessages(detail.messages || [], true)}</div></section></div>}
    {source && <div className="modal-overlay source-overlay" onClick={() => setSource(null)}><section className="dialog source-dialog" role="dialog" aria-modal="true" aria-label="Source citation" onClick={event => event.stopPropagation()}><div className="dialog-header"><span className="eyebrow">VERIFIED SOURCE</span><button autoFocus className="icon-button" aria-label="Close source" onClick={() => setSource(null)}><X size={20} /></button></div><span className="source-file-icon"><FileText size={26} /></span><h2>{source.name}</h2><div className="source-meta">{IS_DEMO ? 'Document excerpt' : `Page ${source.page}`} <span>•</span> Store knowledge</div><blockquote>{source.excerpt}</blockquote><div className="source-footer"><ShieldCheck size={15} /> {IS_DEMO ? 'Sandbox source excerpt' : 'Quote checked against the source document'}</div></section></div>}
    {editingTicket && <div className="modal-overlay"><section className="dialog small-dialog" role="dialog" aria-modal="true" aria-label="Update ticket"><div className="dialog-header"><h2>{editingTicket.status === 'open' ? 'Resolve ticket' : 'Reopen ticket'}</h2><button className="icon-button" aria-label="Close ticket" onClick={() => setEditingTicket(null)}><X size={20} /></button></div><label htmlFor="ticket-note">Internal note</label><textarea autoFocus id="ticket-note" value={ticketNote} maxLength={2000} rows={4} onChange={event => setTicketNote(event.target.value)} placeholder="Add context for your team…" /><p className="field-hint">Internal only. No message is sent to the customer.</p><button className="primary-button" disabled={saving} onClick={() => void resolveTicket()}><Check size={16} /> {saving ? 'Saving…' : 'Save ticket'}</button></section></div>}
    {deleteTarget && <div className="modal-overlay"><section className="dialog small-dialog" role="dialog" aria-modal="true" aria-label="Delete document"><h2>Remove this document?</h2><p>{deleteTarget.name}</p><p className="field-hint">Future answers will no longer use this source. Existing conversation citations are kept.</p><div className="dialog-buttons"><button autoFocus className="secondary-button" onClick={() => setDeleteTarget(null)}>Cancel</button><button className="danger-button" disabled={saving} onClick={async () => { setSaving(true); try { await api.removeDocument(deleteTarget.id); setDeleteTarget(null); await refresh(); toast('Document removed.'); } catch (error) { toast(errorMessage(error), true); } finally { setSaving(false); } }}>{saving ? 'Removing…' : 'Remove document'}</button></div></section></div>}
    {notice && <div className={`toast ${notice.error ? 'error' : ''}`} role={notice.error ? 'alert' : 'status'}>{notice.error ? <CircleHelp size={17} /> : <Check size={17} />}<span>{notice.text}</span><button aria-label="Dismiss notification" onClick={() => setNotice(null)}><X size={15} /></button></div>}
  </div>;
}
