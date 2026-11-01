import { useEffect, useState } from 'react';
import { checkBackend } from './backend';
import ParticleOrb, { type OrbState } from './components/orb/ParticleOrb';

type Status = 'checking' | 'connected' | 'disconnected';

export default function App() {
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
  return <main>
    <header><div className="wordmark">VISION</div><p>Your personal AI assistant</p></header>
    <ParticleOrb state={orbState} />
    <footer>
      <p className={`status ${status}`} role="status" aria-live="polite">
        <span className="dot" aria-hidden="true" />Backend {status}
      </p>
      {import.meta.env.DEV && <label className="state-selector">Preview state
        <select value={orbState} onChange={event => setOrbState(event.target.value as OrbState)}>
          {(['idle', 'listening', 'thinking', 'speaking'] as const).map(state => <option key={state} value={state}>{state}</option>)}
        </select>
      </label>}
    </footer>
  </main>;
}
