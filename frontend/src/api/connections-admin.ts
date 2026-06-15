import api from './client';
import type { ConnectionInfo, CreateConnectionRequest, UpdateConnectionRequest, TestTempRequest, TestTempResult } from '../types';

export async function createConnection(req: CreateConnectionRequest): Promise<ConnectionInfo> {
  const { data } = await api.post<ConnectionInfo>('/connections', req);
  return data;
}

export async function updateConnection(name: string, req: UpdateConnectionRequest): Promise<ConnectionInfo> {
  const { data } = await api.put<ConnectionInfo>(`/connections/${name}`, req);
  return data;
}

export async function deleteConnection(name: string): Promise<void> {
  await api.delete(`/connections/${name}`);
}

export async function testTempConnection(req: TestTempRequest): Promise<TestTempResult> {
  const { data } = await api.post<TestTempResult>('/connections/test', req);
  return data;
}
