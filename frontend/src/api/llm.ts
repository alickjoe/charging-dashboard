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
 */
export function executeNLQueryStream(
  req: NLQueryRequest,
  onEvent: (event: SSEEvent) => void,
  onError: (error: string) => void,
  onDone: () => void,
): AbortController {
  const controller = new AbortController();

  fetch('/api/v1/nl-query-stream', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
    signal: controller.signal,
  })
    .then(async (response) => {
      if (!response.ok) {
        const text = await response.text();
        onError(`HTTP ${response.status}: ${text}`);
        onDone();
        return;
      }

      const reader = response.body?.getReader();
      if (!reader) {
        onError('Unable to read response stream');
        onDone();
        return;
      }

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
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

      onDone();
    })
    .catch((err: Error) => {
      if (err.name !== 'AbortError') {
        onError(err.message || 'Network error');
      }
      onDone();
    });

  return controller;
}
