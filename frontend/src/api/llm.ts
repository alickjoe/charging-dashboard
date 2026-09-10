import api from './client';
import type { LLMConfig, LLMConfigFormData, NLQueryRequest, NLQueryResponse, SSEEvent } from '../types';

export async function fetchLLMConfigs(): Promise<LLMConfig[]> {
  const { data } = await api.get<LLMConfig[]>('/llm-configs');
  return data;
}

export async function createLLMConfig(req: LLMConfigFormData): Promise<LLMConfig> {
  const { data } = await api.post<LLMConfig>('/llm-configs', req);
  return data;
}

export async function updateLLMConfig(id: number, req: Partial<LLMConfigFormData>): Promise<LLMConfig> {
  const { data } = await api.put<LLMConfig>(`/llm-configs/${id}`, req);
  return data;
}

export async function deleteLLMConfig(id: number): Promise<void> {
  await api.delete(`/llm-configs/${id}`);
}

export async function testLLMConfig(id: number): Promise<{ status: string; message: string; latency_ms: number }> {
  const { data } = await api.post(`/llm-configs/${id}/test`);
  return data;
}

export async function executeNLQuery(req: NLQueryRequest): Promise<NLQueryResponse> {
  const { data } = await api.post<NLQueryResponse>('/nl-query', req, { timeout: 120000 });
  return data;
}

/**
 * Execute NL query with SSE streaming (Agent mode).
 * Returns an abort function to cancel the stream.
 *
 * Robustness rules:
 * - If the stream ends BEFORE a `done` event arrives (proxy timeout, backend
 *   restart, network drop), this is reported via onError instead of failing
 *   silently.
 * - An inactivity watchdog aborts the request when no bytes arrive for
 *   INACTIVITY_TIMEOUT_MS, so a dead connection cannot hang the UI forever.
 */
export function executeNLQueryStream(
  req: NLQueryRequest,
  onEvent: (event: SSEEvent) => void,
  onError: (error: string) => void,
  onDone: () => void,
): AbortController {
  const controller = new AbortController();

  const INACTIVITY_TIMEOUT_MS = 240_000; // server gaps stay under ~120s (httpx read timeout + SQL timeout)

  const isElectron = typeof window !== 'undefined' && window.__ELECTRON__ === true;
  const url = isElectron
    ? 'http://localhost:8000/api/v1/nl-query-stream'
    : '/api/v1/nl-query-stream';

  let sawDone = false;
  let watchdogTimer: ReturnType<typeof setTimeout> | null = null;
  let reportedError = false;

  const reportError = (msg: string) => {
    if (reportedError) return;
    reportedError = true;
    onError(msg);
  };

  const clearWatchdog = () => {
    if (watchdogTimer) {
      clearTimeout(watchdogTimer);
      watchdogTimer = null;
    }
  };

  const resetWatchdog = () => {
    clearWatchdog();
    watchdogTimer = setTimeout(() => {
      controller.abort();
      reportError(
        `连接空闲超过 ${Math.round(INACTIVITY_TIMEOUT_MS / 1000)} 秒无数据，已中断，请重试` +
        ` (no data for ${Math.round(INACTIVITY_TIMEOUT_MS / 1000)}s, connection aborted)`,
      );
    }, INACTIVITY_TIMEOUT_MS);
  };

  fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
    signal: controller.signal,
  })
    .then(async (response) => {
      if (!response.ok) {
        const text = await response.text();
        reportError(`HTTP ${response.status}: ${text}`);
        onDone();
        return;
      }

      const reader = response.body?.getReader();
      if (!reader) {
        reportError('Unable to read response stream');
        onDone();
        return;
      }

      const decoder = new TextDecoder();
      let buffer = '';
      resetWatchdog();

      while (true) {
        const { done, value } = await reader.read();
        resetWatchdog(); // any bytes from the server prove the connection is alive
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // Parse complete SSE events from buffer
        const lines = buffer.split('\n\n');
        buffer = lines.pop() || '';  // Keep incomplete last chunk

        for (const block of lines) {
          for (const line of block.split('\n')) {
            if (line.startsWith('data: ')) {
              try {
                const event: SSEEvent = JSON.parse(line.slice(6));
                onEvent(event);
                if (event.type === 'done') {
                  sawDone = true;
                  clearWatchdog();
                  reader.cancel();
                  onDone();
                  return;
                }
              } catch {
                // Skip malformed JSON
              }
            }
          }
        }
      }

      // Stream closed before the `done` event — the query did NOT finish.
      clearWatchdog();
      if (!sawDone) {
        reportError(
          '连接在查询完成前中断，未收到完成事件，结果可能不完整' +
          ' (connection closed before the query finished)',
        );
      }
      onDone();
    })
    .catch((err: Error) => {
      clearWatchdog();
      if (err.name !== 'AbortError') {
        reportError(err.message || 'Network error');
      }
      // Manual stop or watchdog abort: watchdog already reported its own error.
      onDone();
    });

  return controller;
}
