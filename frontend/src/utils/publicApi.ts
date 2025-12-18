export function resolvePublicApiBaseUrl(): string {
  const env = (import.meta as any)?.env || {};
  const fromEnv = String(env.VITE_PUBLIC_API_BASE_URL || env.VITE_BACKEND_URL || '').trim();
  const fromOrigin = typeof window !== 'undefined' ? String(window.location.origin || '').trim() : '';
  const raw = fromEnv || fromOrigin || '';
  return raw.replace(/\/+$/, '');
}

