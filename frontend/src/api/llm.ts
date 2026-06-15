import api from './client';
import type { LLMConfig, LLMConfigFormData, NLQueryRequest, NLQueryResponse } from '../types';

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
