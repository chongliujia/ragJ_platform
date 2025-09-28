export interface SSEOptions {
  retries?: number;
  retryDelayBaseMs?: number; // base delay for exponential backoff
}

export interface SSECallbacks {
  onEvent: (data: any) => void;
  onError: (err: any) => void;
  onComplete: () => void;
}

/**
 * Stream Server-Sent Events (SSE) via fetch and deliver parsed JSON data fields.
 * - Parses lines prefixed with `data: `, JSON-parse the payload
 * - Calls callbacks for event/error/complete
 * - Applies simple exponential backoff on transient failures
 */
export async function streamSSE(
  url: string,
  fetchInit: RequestInit,
  { onEvent, onError, onComplete }: SSECallbacks,
  { retries = 0, retryDelayBaseMs = 500 }: SSEOptions = {}
): Promise<void> {
  let attempt = 0;
  const controller = new AbortController();
  const baseHeaders = (fetchInit.headers || {}) as Record<string, string>;
  const init: RequestInit = {
    ...fetchInit,
    headers: {
      'Accept': 'text/event-stream',
      ...baseHeaders,
    },
    signal: controller.signal,
  };

  const doOnce = async (): Promise<void> => {
    const resp = await fetch(url, init);
    if (!resp.ok || !resp.body) {
      throw new Error(`HTTP ${resp.status}`);
    }
    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const data = line.slice(6).trim();
          if (data === '[DONE]') {
            onComplete();
            return;
          }
          try {
            const parsed = JSON.parse(data);
            onEvent(parsed);
          } catch (e) {
            // ignore bad lines
          }
        }
      }
      // EOF without [DONE]
      onComplete();
    } finally {
      try { reader.releaseLock(); } catch {}
    }
  };

  while (true) {
    try {
      await doOnce();
      return;
    } catch (err) {
      if (attempt >= retries) {
        onError(err);
        return;
      }
      const delay = retryDelayBaseMs * Math.pow(2, attempt);
      await new Promise((r) => setTimeout(r, delay));
      attempt += 1;
    }
  }
}

/**
 * Create a cancelable SSE stream.
 * Returns a cancel function and a promise resolved when stream completes/errors.
 */
export function streamSSECancelable(
  url: string,
  fetchInit: RequestInit,
  callbacks: SSECallbacks,
  options?: SSEOptions
): { cancel: () => void; promise: Promise<void> } {
  const controller = new AbortController();
  const init: RequestInit = { ...fetchInit, signal: controller.signal };
  const promise = streamSSE(url, init, callbacks, options);
  return {
    cancel: () => {
      try { controller.abort(); } catch {}
    },
    promise,
  };
}
