export type Citation = { id: string; document_id: string; name: string; page: number; excerpt: string; score: number };
export type Message = { id: string; role: 'user' | 'assistant'; content: string; citations: Citation[]; feedback?: number | null; mode?: string; created_at?: string };
export type DocumentRecord = { id: string; name: string; chunks: number; size: number; created_at?: string; text?: string };
export type Conversation = { id: string; title: string; status: string; created_at: string; messages?: Message[]; message_count?: number; feedback?: number };
export type Ticket = { id: string; conversation_id: string; title: string; reason: string; status: string; note: string; created_at: string };
export type Stats = { conversations: number; answers: number; handoffs: number; positive: number; negative: number; documents: number; chunks: number };
