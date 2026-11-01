import { isTauri } from '@tauri-apps/api/core';
import { fetch } from '@tauri-apps/plugin-http';

export async function checkBackend(): Promise<boolean> {
  if (!isTauri()) {
    console.warn('VISION health: open with npm run desktop:dev; browser preview has no native HTTP client.');
    return false;
  }
  try {
    const base = (import.meta.env.VITE_BACKEND_URL || 'http://127.0.0.1:8000').replace(/\/+$/, '');
    const response = await fetch(`${base}/health`, { method: 'GET', connectTimeout: 5_000, signal: AbortSignal.timeout(5_000) });
    if (!response.ok) {
      console.warn('VISION health: backend returned HTTP status', response.status);
      return false;
    }
    const data = await response.json();
    const healthy = data?.status === 'healthy' && data?.service === 'vision-backend';
    if (!healthy) console.warn('VISION health: unexpected health response schema.');
    return healthy;
  } catch (error) {
    // Classify failures without logging raw errors, URLs, headers, or bodies.
    const message = String(error).toLowerCase();
    if (message.includes('allow') || message.includes('scope') || message.includes('permission')) {
      console.warn('VISION health: native HTTP permission denied; check main window capability and local health URL.');
    } else if (message.includes('abort') || message.includes('timeout')) {
      console.warn('VISION health: request exceeded the five-second deadline.');
    } else {
      console.warn('VISION health: request failed; verify the backend is running, URL configuration, and native HTTP permissions.');
    }
    return false;
  }
}
