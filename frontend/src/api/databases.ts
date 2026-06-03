import api from './client';
import type { TableInfo, ColumnInfo, TableDataResponse } from '../types';

export async function fetchSchemas(connectionName: string): Promise<string[]> {
  const { data } = await api.get<{ schemas: string[] }>(
    `/connections/${connectionName}/schemas`
  );
  return data.schemas;
}

export async function fetchTables(
  connectionName: string,
  schema: string
): Promise<TableInfo[]> {
  const { data } = await api.get<{ tables: TableInfo[] }>(
    `/connections/${connectionName}/tables`,
    { params: { schema } }
  );
  return data.tables;
}

export async function fetchColumns(
  connectionName: string,
  table: string
): Promise<ColumnInfo[]> {
  const { data } = await api.get<{ columns: ColumnInfo[] }>(
    `/connections/${connectionName}/tables/${table}/columns`
  );
  return data.columns;
}

export async function fetchTableData(
  connectionName: string,
  table: string,
  params: {
    page?: number;
    page_size?: number;
    order_by?: string;
    order_dir?: string;
    time_column?: string;
    time_from?: string;
    time_to?: string;
  }
): Promise<TableDataResponse> {
  const { data } = await api.get<TableDataResponse>(
    `/connections/${connectionName}/tables/${table}/data`,
    { params }
  );
  return data;
}
