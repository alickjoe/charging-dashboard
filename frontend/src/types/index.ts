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
