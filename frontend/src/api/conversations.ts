import api from './client';
import type { Conversation, ConversationDetail } from '../types';

export async function fetchConversations(): Promise<Conversation[]> {
  const { data } = await api.get<Conversation[]>('/conversations');
  return data;
}

export async function fetchConversationDetail(id: number): Promise<ConversationDetail> {
  const { data } = await api.get<ConversationDetail>(`/conversations/${id}`);
  return data;
}

export async function createConversation(
  connection_name: string,
  llm_config_id: number,
): Promise<Conversation> {
  const { data } = await api.post<Conversation>('/conversations', {
    connection_name,
    llm_config_id,
  });
  return data;
}

export async function deleteConversation(id: number): Promise<void> {
  await api.delete(`/conversations/${id}`);
}
