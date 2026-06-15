export interface ConnectionInfo {
  name: string;
  label: string;
  type: string;
  host: string;
  port: number;
  database: string;
  status: 'connected' | 'disconnected' | 'error';
  last_checked: string | null;
}

export interface DbConnectionConfig {
  name: string;
  label: string;
  host: string;
  port: number;
  database: string;
  username: string;
  password: string;
  ssl_mode: string;
  pool_min: number;
  pool_max: number;
  pool_idle: number;
  query_timeout: number;
}

export type CreateConnectionRequest = DbConnectionConfig;

export type UpdateConnectionRequest = Partial<DbConnectionConfig>;

export interface TestTempRequest {
  host: string;
  port: number;
  database: string;
  username: string;
  password: string;
  ssl_mode: string;
  query_timeout: number;
}

export interface TestTempResult {
  status: 'connected' | 'error';
  message: string;
  latency_ms: number;
}

export interface TestResult {
  name: string;
  status: 'connected' | 'error';
  message: string;
  latency_ms: number;
}

export interface TableInfo {
  table_name: string;
  schema: string;
  row_count_estimate: number;
  table_type: string;
}

export interface ColumnInfo {
  column_name: string;
  data_type: string;
  is_nullable: string;
  is_primary_key: boolean;
}

export interface TableDataResponse {
  page: number;
  page_size: number;
  total_rows: number;
  total_pages: number;
  columns: string[];
  rows: unknown[][];
}

export interface Annotation {
  id: number;
  connection_name: string;
  table_name: string;
  column_name: string | null;
  annotation: string;
  created_at: string;
  updated_at: string;
}

export interface AnnotationUpsert {
  table_name: string;
  column_name?: string;
  annotation: string;
}

export interface ChartDataRequest {
  x_column: string;
  y_column: string;
  chart_type: 'bar' | 'line';
  aggregation: 'sum' | 'avg' | 'count' | 'none';
  group_by: string;
  time_from?: string;
  time_to?: string;
  limit: number;
}

export interface ChartDataResponse {
  labels: string[];
  datasets: {
    label: string;
    data: number[];
  }[];
}

export interface LLMConfig {
  id: number;
  name: string;
  api_base: string;
  api_key_masked: string;
  model: string;
  temperature: number;
  max_tokens: number;
  is_default: boolean;
  created_at: string;
  updated_at: string;
}

export interface LLMConfigFormData {
  name: string;
  api_base: string;
  api_key: string;
  model: string;
  temperature: number;
  max_tokens: number;
  is_default: boolean;
}

export interface NLQueryRequest {
  connection_name: string;
  llm_config_id: number;
  question: string;
}

export interface NLQueryResponse {
  sql: string;
  columns: string[];
  rows: unknown[][];
  execution_time_ms: number;
  llm_call_time_ms: number;
  cannot_answer?: string;
}

export type SSEEventType = 'think' | 'sql' | 'result' | 'error' | 'done';

export interface SSEEvent {
  type: SSEEventType;
  content?: string;
  message?: string;
  columns?: string[];
  rows?: unknown[][];
  total_rows?: number;
  llm_time_ms?: number;
}
