export default function MicrophoneButton({ recording, disabled, onClick }: { recording: boolean; disabled: boolean; onClick: () => void }) {
  return <button className={`microphone ${recording ? 'recording' : ''}`} disabled={disabled} onClick={onClick}
    aria-label={recording ? 'Stop mock recording' : 'Start mock recording'} aria-pressed={recording}>
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3M8 22h8"/></svg>
    <span>{disabled ? 'Microphone unavailable' : recording ? 'Stop recording' : 'Start talking'}</span>
  </button>;
}
