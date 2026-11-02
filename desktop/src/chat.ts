import { isTauri } from '@tauri-apps/api/core';
import { fetch } from '@tauri-apps/plugin-http';

export async function sendChat(message: string, sessionId?: string, signal?: AbortSignal) {
  if (!isTauri()) throw new Error('Open the native desktop app to send messages.');
  const base = (import.meta.env.VITE_BACKEND_URL || 'http://127.0.0.1:8000').replace(/\/+$/, '');
  let response: Response;
  try {
    response = await fetch(`${base}/api/v1/chat`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, ...(sessionId ? { session_id: sessionId } : {}) }),
      connectTimeout: 5000, signal: AbortSignal.any([AbortSignal.timeout(130000), ...(signal ? [signal] : [])]),
    });
  } catch {
    throw new Error('Could not reach VISION or the request timed out. Check the backend and Ollama. The request may have completed; it was not retried.');
  }
  if (!response.ok) throw new Error(response.status === 502 ? 'The AI provider could not respond. Check Ollama and try again.' : `Chat failed (HTTP ${response.status}). Please check the backend.`);
  let data;
  try { data = await response.json(); } catch { throw new Error('The backend returned an invalid response.'); }
  if (typeof data?.response !== 'string' || !data.response.trim() || typeof data?.session_id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(data.session_id)) throw new Error('The backend returned an invalid chat response.');
  return data as { response: string; session_id: string };
}
