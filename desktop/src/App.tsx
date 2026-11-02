import { useEffect, useRef, useState } from 'react';
import MicrophoneButton from './components/interaction/MicrophoneButton';
import ConversationPanel, { type Message } from './components/interaction/ConversationPanel';
import { recordVoice, transcribeVoice, speakVoice } from './voice';
import { sendChat } from './chat';
import { checkBackend } from './backend';
import ParticleOrb, { type OrbState } from './components/orb/ParticleOrb';

type Status = 'checking' | 'connected' | 'disconnected';

export default function App() {
  const [panelOpen, setPanelOpen] = useState(true);
  const [recording, setRecording] = useState(false);
  const [disabled, setDisabled] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const session = useRef<string | undefined>(undefined);
  const inFlight = useRef<AbortController | null>(null);
  useEffect(() => () => { inFlight.current?.abort(); }, []);
  const submit = async (text: string, voice = false) => {
    if (inFlight.current) return;
    const controller = new AbortController();
    inFlight.current = controller;
    setPending(true); setError(''); setPanelOpen(true);
    try {
      if (voice) {
        setRecording(true); setOrbState('listening');
        const audio = await recordVoice(controller.signal);
        setRecording(false); setOrbState('thinking');
        text = await transcribeVoice(audio, controller.signal);
      }
      controller.signal.throwIfAborted();
      setOrbState('thinking');
      setMessages(previous => [...previous, { id: previous.length, role: 'user', text }]);
      const answer = await sendChat(text, session.current, controller.signal);
      if (controller.signal.aborted) return;
      session.current = answer.session_id;
      setMessages(previous => [...previous, { id: previous.length, role: 'assistant', text: answer.response }]);
      if (voice) { setOrbState('speaking'); await speakVoice(answer.response, controller.signal); }
    } catch (failure) {
      if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : 'Chat request failed.');
    } finally {
      inFlight.current = null;
      if (!controller.signal.aborted) { setRecording(false); setPending(false); setOrbState('idle'); }
    }
  };
  const [orbState, setOrbState] = useState<OrbState>('idle');
  const [status, setStatus] = useState<Status>('checking');
  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const check = async () => {
      const connected = await checkBackend();
      if (active) {
        setStatus(connected ? 'connected' : 'disconnected');
        timer = setTimeout(check, 10_000);
      }
    };
    void check();
    return () => { active = false; clearTimeout(timer); };
  }, []);
  return <div className={`desktop-layout ${panelOpen ? 'panel-open' : ''}`}>
    <main>
    <button className="conversation-toggle" aria-expanded={panelOpen} aria-controls="conversation-content" onClick={() => setPanelOpen(!panelOpen)}>{panelOpen ? 'Hide conversation' : 'Show conversation'}</button>
    <header><div className="wordmark">VISION</div><p>Your personal AI assistant</p></header>
    <ParticleOrb state={orbState} />
    <div className="interaction-controls">
      <MicrophoneButton recording={recording} disabled={disabled || pending} onClick={() => { void submit('', true); }} />
      <p className="preview-note">{recording ? 'Allow microphone access if prompted, then speak for five seconds.' : 'Click to record a five-second voice turn.'}</p>
    </div>
    <footer>
      <p className={`status ${status}`} role="status" aria-live="polite">
        <span className="dot" aria-hidden="true" />Backend {status}
      </p>
      {import.meta.env.DEV && <label className="state-selector">Preview state
        <select disabled={pending} value={orbState} onChange={event => { setRecording(false); setOrbState(event.target.value as OrbState); }}>
          {(['idle', 'listening', 'thinking', 'speaking'] as const).map(state => <option key={state} value={state}>{state}</option>)}
        </select>
      </label>}
      {import.meta.env.DEV && <label className="state-selector"><input type="checkbox" disabled={pending} checked={disabled} onChange={event => { setDisabled(event.target.checked); setRecording(false); setOrbState('idle'); }} />Disable controls</label>}
    </footer>
  </main>
    <ConversationPanel open={panelOpen} messages={messages} disabled={disabled || recording || pending} pending={pending} pendingLabel={recording ? 'Listening for five seconds…' : orbState === 'speaking' ? 'VISION is speaking…' : 'VISION is thinking…'} error={error} onSend={text => { void submit(text); }} />
  </div>;
}
