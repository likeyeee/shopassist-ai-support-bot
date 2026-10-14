import type { Conversation, DocumentRecord, Message, Stats, Ticket } from './types';

const now = () => new Date().toISOString();
const id = () => crypto.randomUUID();
export const sampleDocuments: DocumentRecord[] = [
  { id: 'shipping', name: 'Shipping & delivery.md', chunks: 2, size: 1230, text: 'Shipping & delivery\nOrders are processed within 1–2 business days. Standard shipping to the United States takes 5–8 business days after dispatch. Express shipping takes 2–3 business days. Shipping is free on orders over $75; otherwise standard shipping costs $6.95.\n\nInternational shipping\nWe ship to the United States, Canada, the United Kingdom, Australia, and the European Union. International delivery takes 7–14 business days. Customs duties are paid by the recipient. Tracking is emailed when your order ships. If tracking has not updated for 5 business days, contact support.' },
  { id: 'returns', name: 'Returns & exchanges.md', chunks: 2, size: 1140, text: 'Returns & exchanges\nYou can return unworn, unwashed items with their original tags within 30 days of delivery. Start a return by contacting support with your order number. Final-sale items and gift cards cannot be returned.\n\nRefunds\nRefunds are issued to the original payment method within 5–7 business days after we receive and inspect the return. Original shipping fees are non-refundable. US customers receive a prepaid return label. International customers cover return shipping. Size exchanges are free for US orders, subject to stock availability.' },
  { id: 'sizing', name: 'Size guide.md', chunks: 2, size: 890, text: 'Size guide\nOur everyday collection uses US unisex sizing and has a relaxed fit. If you are between sizes, choose the smaller size for a closer fit or the larger size for a looser fit.\n\nMeasurements\nMeasure around the fullest part of your chest. Size S: 34–36 inches. Size M: 38–40 inches. Size L: 42–44 inches. Size XL: 46–48 inches. Measurements refer to body measurements, not garment dimensions. Wash cold and air dry to maintain the fit.' },
];

type State = { documents: DocumentRecord[]; conversations: Conversation[]; tickets: Ticket[] };
const key = 'shopassist.sandbox.v1';
function read(): State {
  try { const saved = localStorage.getItem(key); if (saved) return JSON.parse(saved); } catch { /* recover from invalid browser data */ }
  return { documents: sampleDocuments.map(d => ({ ...d, created_at: now() })), conversations: [], tickets: [] };
}
function write(state: State) { localStorage.setItem(key, JSON.stringify(state)); }
const tokens = (text: string) => (text.toLowerCase().match(/[a-z]{3,}|[\u4e00-\u9fff]/g) || []).filter(t => !['the', 'you', 'your', 'what', 'can', 'how', 'for', 'are', 'and', 'with', 'this', 'does', 'have', 'our', 'about'].includes(t));

export const demo = {
  documents: () => read().documents,
  conversations: () => read().conversations.filter(c => c.messages?.length).map(c => ({ ...c, message_count: c.messages?.length, feedback: c.messages?.reduce((sum, m) => sum + (m.feedback || 0), 0) })),
  conversation: (conversationId: string) => read().conversations.find(c => c.id === conversationId),
  tickets: () => read().tickets,
  stats: (): Stats => { const s = read(); const messages = s.conversations.flatMap(c => c.messages || []); return { conversations: s.conversations.filter(c => c.messages?.length).length, answers: messages.filter(m => m.mode === 'sandbox').length, handoffs: s.tickets.filter(t => t.status === 'open').length, positive: messages.filter(m => m.feedback === 1).length, negative: messages.filter(m => m.feedback === -1).length, documents: s.documents.length, chunks: s.documents.reduce((n, d) => n + d.chunks, 0) }; },
  newSession: () => { const state = read(); const session = { id: id(), token: 'sandbox' }; state.conversations.unshift({ id: session.id, title: 'New conversation', status: 'active', created_at: now(), messages: [] }); write(state); return session; },
  async chat(conversationId: string, question: string): Promise<Message> {
    const state = read(); const conversation = state.conversations.find(c => c.id === conversationId);
    if (!conversation) throw new Error('Start a new conversation.');
    const history = conversation.messages || [];
    if (!history.length) conversation.title = question.slice(0, 80);
    const previous = [...history].reverse().find(m => m.role === 'user')?.content || '';
    history.push({ id: id(), role: 'user', content: question, citations: [], created_at: now() });
    let query = question;
    if (/shipping|delivery|arrive|ship|物流|运费|快递/i.test(question)) query += ' shipping delivery';
    if (/return|refund|exchange|退|换货/i.test(question)) query += ' returns refunds';
    if (/size|sizing|fit|尺码|尺寸/i.test(question)) query += ' size sizing fit';
    if (question.length < 25 && previous && /it|that|those|them|how long/i.test(question)) query += ` ${previous}`;
    const terms = tokens(query);
    const candidates = state.documents.flatMap(doc => (doc.text || '').split(/\n\n+/).map(text => ({ doc, text, score: terms.reduce((n, term) => n + (text.toLowerCase().includes(term) ? 1 : 0), 0) }))).sort((a, b) => b.score - a.score);
    const best = candidates[0];
    const personal = /\b(human|agent|person|representative|order\s*#|cancel|approve|exception|weather|bitcoin)\b|人工|真人|我的订单/i.test(question);
    let message: Message;
    if (personal || !best || best.score < 2 || state.tickets.some(t => t.conversation_id === conversationId && t.status === 'open')) {
      let ticket = state.tickets.find(t => t.conversation_id === conversationId && t.status === 'open');
      if (!ticket) { ticket = { id: id(), conversation_id: conversationId, title: question, reason: personal ? 'Customer needs a human' : 'No matching source in sandbox', status: 'open', note: '', created_at: now() }; state.tickets.unshift(ticket); }
      conversation.status = 'handoff';
      message = { id: id(), role: 'assistant', content: `This needs a human touch. I’ve added this conversation to the support queue. Your ticket is #${ticket.id.slice(0, 8).toUpperCase()}.`, citations: [], mode: 'handoff', created_at: now() };
    } else {
      message = { id: id(), role: 'assistant', content: best.text.replace(/^[^\n]+\n/, ''), citations: [{ id: '1', document_id: best.doc.id, name: best.doc.name, page: 1, excerpt: best.text, score: 0 }], mode: 'sandbox', created_at: now() };
    }
    history.push(message); conversation.messages = history; write(state);
    return message;
  },
  feedback: (messageId: string, value: number) => { const state = read(); for (const c of state.conversations) for (const m of c.messages || []) if (m.id === messageId) m.feedback = value || null; write(state); },
  async upload(file: File) {
    if (file.size > 5 * 1024 * 1024) throw new Error('Files must be 5 MB or smaller.');
    let text = '';
    if (/\.md$|\.markdown$/i.test(file.name)) text = await file.text();
    else if (/\.pdf$/i.test(file.name)) {
      const pdfjs = await import('pdfjs-dist');
      pdfjs.GlobalWorkerOptions.workerSrc = `${process.env.NEXT_PUBLIC_BASE_PATH || ''}/pdf.worker.min.mjs`;
      const task = pdfjs.getDocument({ data: await file.arrayBuffer() });
      const pdf = await task.promise;
      try {
        if (pdf.numPages > 100) throw new Error('PDFs must contain at most 100 pages.');
        for (let p = 1; p <= pdf.numPages; p++) { const page = await pdf.getPage(p); const content = await page.getTextContent(); text += content.items.map(item => 'str' in item ? item.str : '').join(' ') + '\n\n'; }
      } finally { await task.destroy(); }
    } else throw new Error('Upload a PDF or Markdown file.');
    if (!text.trim()) throw new Error('No readable text. Scanned PDFs need OCR first.');
    if (text.length > 150000) throw new Error('Document is too long.');
    const state = read();
    if (state.documents.some(d => d.text === text)) throw new Error('This document is already in your knowledge base.');
    const doc = { id: id(), name: file.name, size: file.size, chunks: Math.max(1, Math.ceil(text.length / 710)), text, created_at: now() };
    state.documents.unshift(doc); write(state); return doc;
  },
  removeDocument: (documentId: string) => { const state = read(); state.documents = state.documents.filter(d => d.id !== documentId); write(state); },
  updateTicket: (ticketId: string, status: string, note: string) => { const state = read(); const t = state.tickets.find(t => t.id === ticketId); if (t) { t.status = status; t.note = note; const c = state.conversations.find(c => c.id === t.conversation_id); if (c) c.status = status === 'resolved' ? 'resolved' : 'handoff'; } write(state); },
  reset: () => localStorage.removeItem(key),
};
