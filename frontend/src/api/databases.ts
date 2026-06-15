import api from './client';
import type { TableInfo, ColumnInfo, TableDataResponse, Annotation, AnnotationUpsert } from '../types';

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
  table: string,
  schema?: string
): Promise<ColumnInfo[]> {
  const { data } = await api.get<{ columns: ColumnInfo[] }>(
    `/connections/${connectionName}/tables/${table}/columns`,
    { params: { schema } }
  );
  return data.columns;
}

export async function fetchTableData(
  connectionName: string,
  table: string,
  params: {
    schema?: string;
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

// ─── Annotations ──────────────────────────────────────────────────

export async function fetchAnnotations(connectionName: string): Promise<Annotation[]> {
  const { data } = await api.get<Annotation[]>(
    `/connections/${connectionName}/annotations`
  );
  return data;
}

export async function upsertAnnotation(
  connectionName: string,
  body: AnnotationUpsert
): Promise<Annotation> {
  const { data } = await api.put<Annotation>(
    `/connections/${connectionName}/annotations`,
    body
  );
  return data;
}

export async function deleteAnnotation(
  connectionName: string,
  tableName: string,
  columnName?: string
): Promise<void> {
  await api.delete(`/connections/${connectionName}/annotations`, {
    params: { table_name: tableName, column_name: columnName },
  });
}
