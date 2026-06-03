import api from './client';
import type { ConnectionInfo, TestResult } from '../types';

export async function fetchConnections(): Promise<ConnectionInfo[]> {
  const { data } = await api.get<{ connections: ConnectionInfo[] }>('/connections');
  return data.connections;
}

export async function testConnection(name: string): Promise<TestResult> {
  const { data } = await api.post<TestResult>(`/connections/${name}/test`);
  return data;
}
