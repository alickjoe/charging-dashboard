import api from './client';
import type {
  CustomQueryRequest,
  CustomQueryResponse,
  SavedQuery,
  SavedQueryCreate,
  SavedQueryUpdate,
  AutocompleteResponse,
} from '../types';

export async function executeCustomQuery(
  connectionName: string,
  body: CustomQueryRequest
): Promise<CustomQueryResponse> {
  const { data } = await api.post<CustomQueryResponse>(
    `/connections/${connectionName}/query`,
    body
  );
  return data;
}

export async function fetchSavedQueries(
  connectionName: string
): Promise<SavedQuery[]> {
  const { data } = await api.get<SavedQuery[]>(
    `/connections/${connectionName}/queries`
  );
  return data;
}

export async function createSavedQuery(
  connectionName: string,
  body: SavedQueryCreate
): Promise<SavedQuery> {
  const { data } = await api.post<SavedQuery>(
    `/connections/${connectionName}/queries`,
    body
  );
  return data;
}

export async function updateSavedQuery(
  connectionName: string,
  id: number,
  body: SavedQueryUpdate
): Promise<SavedQuery> {
  const { data } = await api.put<SavedQuery>(
    `/connections/${connectionName}/queries/${id}`,
    body
  );
  return data;
}

export async function deleteSavedQuery(
  connectionName: string,
  id: number
): Promise<void> {
  await api.delete(`/connections/${connectionName}/queries/${id}`);
}

export async function fetchAutocomplete(
  connectionName: string,
  prefix: string,
  sql?: string
): Promise<AutocompleteResponse> {
  const { data } = await api.get<AutocompleteResponse>(
    `/connections/${connectionName}/autocomplete`,
    { params: { prefix, sql } }
  );
  return data;
}
