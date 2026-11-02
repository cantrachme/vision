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
  const [duration, setDuration] = useState(0);
  const [silenceDetection, setSilenceDetection] = useState(false);
  const stopRecording = useRef<(() => void) | null>(null);
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
        setDuration(0); setOrbState('listening');
        const audio = await recordVoice(controller.signal, { silenceDetection, onReady: stop => { stopRecording.current = stop; setRecording(true); }, onDuration: setDuration });
        stopRecording.current = null;
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
      stopRecording.current = null;
      inFlight.current = null;
      setRecording(false); setPending(false); setOrbState('idle');
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
      <MicrophoneButton recording={recording} disabled={disabled || (pending && !recording)} onClick={() => { if (recording) stopRecording.current?.(); else void submit('', true); }} />
      <p className="preview-note" role="status">{recording ? `Recording ${duration}s / 60s · click Stop to process` : pending && orbState === 'listening' ? 'Preparing microphone… allow access if prompted.' : 'Click Start talking, then Stop to send.'}</p>
      {pending && orbState === 'listening' && <button onClick={() => inFlight.current?.abort()}>Cancel recording</button>}
      <label className="state-selector"><input type="checkbox" checked={silenceDetection} disabled={pending} onChange={event => setSilenceDetection(event.target.checked)} />Stop after silence (experimental)</label>
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
    <ConversationPanel open={panelOpen} messages={messages} disabled={disabled || recording || pending} pending={pending} pendingLabel={recording ? `Listening · ${duration}s / 60s`  : orbState === 'speaking' ? 'VISION is speaking…' : 'VISION is thinking…'} error={error} onSend={text => { void submit(text); }} />
  </div>;
}
