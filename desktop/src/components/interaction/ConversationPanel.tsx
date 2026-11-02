import { useEffect, useRef, useState } from 'react';
export interface Message { id: number; role: 'user' | 'assistant'; text: string }
export default function ConversationPanel({ open, messages, disabled, onSend }: { open: boolean; messages: Message[]; disabled: boolean; onSend: (text: string) => void }) {
  const [draft, setDraft] = useState('');
  const log = useRef<HTMLDivElement>(null);
  useEffect(() => { if (log.current) log.current.scrollTop = log.current.scrollHeight; }, [messages, open]);
  return <aside className="conversation" id="conversation-content" inert={!open} aria-hidden={!open} aria-label="Conversation">
      <div className="panel-inner">
        <h2>Conversation</h2>
        <div className="message-log" ref={log} role="log" aria-label="Conversation messages" aria-live="polite" aria-relevant="additions">
          {!messages.length && <p className="empty-conversation">Your conversation will appear here.</p>}
          {messages.map(message => <article className={`message ${message.role}`} key={message.id}><strong>{message.role === 'user' ? 'You' : 'VISION'}</strong><p>{message.text}</p></article>)}
        </div>
        <form onSubmit={event => { event.preventDefault(); if (!disabled && draft.trim()) { onSend(draft.trim()); setDraft(''); } }}>
          <input aria-label="Message VISION" placeholder={disabled ? 'Typed conversations coming soon' : 'Try a mock message…'} value={draft} maxLength={2000} disabled={disabled} onChange={event => setDraft(event.target.value)} />
          <button type="submit" disabled={disabled || !draft.trim()}>Send</button>
        </form>
      </div>
  </aside>;
}
