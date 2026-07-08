import api from './client';
import type { Skill, UserQuestion, EnhancePromptResponse } from '../types';

export async function fetchSkills(): Promise<Skill[]> {
  const { data } = await api.get<Skill[]>('/skills');
  return data;
}

export async function fetchSkill(id: number): Promise<Skill> {
  const { data } = await api.get<Skill>(`/skills/${id}`);
  return data;
}

export async function createSkill(skillData: {
  name: string;
  description: string;
  system_prompt: string;
  user_prompt_template: string;
  source_questions: string;
}): Promise<Skill> {
  const { data } = await api.post<Skill>('/skills', skillData);
  return data;
}

export async function updateSkill(
  id: number,
  skillData: Partial<{
    name: string;
    description: string;
    system_prompt: string;
    user_prompt_template: string;
    source_questions: string;
  }>,
): Promise<Skill> {
  const { data } = await api.put<Skill>(`/skills/${id}`, skillData);
  return data;
}

export async function deleteSkill(id: number): Promise<void> {
  await api.delete(`/skills/${id}`);
}

export async function fetchUserQuestions(): Promise<UserQuestion[]> {
  const { data } = await api.get<UserQuestion[]>('/conversations/user-questions');
  return data;
}

export async function enhancePrompt(
  rawPrompt: string,
  language: string = 'zh',
): Promise<EnhancePromptResponse> {
  const { data } = await api.post<EnhancePromptResponse>('/skills/enhance', {
    raw_prompt: rawPrompt,
    language,
  }, {
    timeout: 120000,  // 2 minutes for LLM enhancement
  });
  return data;
}
