import api from './client';

export interface SetupStatus {
  needs_setup: boolean;
}

export async function fetchSetupStatus(): Promise<SetupStatus> {
  const { data } = await api.get<SetupStatus>('/setup/status');
  return data;
}
