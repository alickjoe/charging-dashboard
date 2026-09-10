export interface ConnectionInfo {
  name: string;
  label: string;
  type: string;
  host: string;
  port: number;
  database: string;
  status: 'connected' | 'disconnected' | 'error';
  last_checked: string | null;
  ssl_mode: string;
  pool_min: number;
  pool_max: number;
  pool_idle: number;
  query_timeout: number;
  tunnel_mode: boolean;
  tunnel_path: string;
  tunnel_port: number;
  tunnel_auth_user: string | null;
  has_tunnel_auth: boolean;
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
  tunnel_mode?: boolean;
  tunnel_path?: string;
  tunnel_port?: number;
  tunnel_auth_user?: string;
  tunnel_auth_password?: string;
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
  tunnel_mode?: boolean;
  tunnel_path?: string;
  tunnel_port?: number;
  tunnel_auth_user?: string;
  tunnel_auth_password?: string;
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

export interface ConnectionSchemaSelection {
  connection_name: string;
  schemas: string[];  // empty = all schemas of that connection
}

export interface NLQueryRequest {
  connection_name?: string;
  connection_schemas?: ConnectionSchemaSelection[];
  llm_config_id: number;
  question: string;
  conversation_id?: number;
  language?: string;
  skill_ids?: number[];
}

export interface NLQueryResponse {
  sql: string;
  columns: string[];
  rows: unknown[][];
  execution_time_ms: number;
  llm_call_time_ms: number;
  cannot_answer?: string;
}

export type SSEEventType = 'conversation' | 'think' | 'sql' | 'result' | 'error' | 'done';

export interface SSEEvent {
  type: SSEEventType;
  content?: string;
  message?: string;
  columns?: string[];
  rows?: unknown[][];
  total_rows?: number;
  llm_time_ms?: number;
  conversation_id?: number;
}

// ─── Conversations ─────────────────────────────────────────────

export interface Conversation {
  id: number;
  title: string;
  connection_name: string;
  llm_config_id: number;
  connection_schemas: ConnectionSchemaSelection[];
  message_count: number;
  skill_ids: number[];
  created_at: string;
  updated_at: string;
}

export interface ConversationMessage {
  id: number;
  conversation_id: number;
  role: 'user' | 'assistant';
  question: string;
  answer_blocks: string;  // JSON string of StreamBlock[]
  llm_time_ms: number | null;
  raw_messages: string;
  skill_ids: string;  // JSON string of int[], e.g. "[1,2]"
  created_at: string;
}

export interface ConversationDetail extends Conversation {
  messages: ConversationMessage[];
}

// ─── Custom Query ───────────────────────────────────────────────

export interface CustomQueryRequest {
  sql: string;
}

export interface CustomQueryResponse {
  columns: string[];
  rows: unknown[][];
  execution_time_ms: number;
}

export interface SavedQuery {
  id: number;
  connection_name: string;
  name: string;
  sql_text: string;
  created_at: string;
  updated_at: string;
}

export interface SavedQueryCreate {
  name: string;
  sql_text: string;
}

export interface SavedQueryUpdate {
  name: string;
  sql_text: string;
}

export interface AutocompleteSuggestion {
  text: string;
  type: 'schema' | 'table' | 'column' | 'keyword';
}

export interface AutocompleteResponse {
  suggestions: AutocompleteSuggestion[];
}

// ─── Skills ────────────────────────────────────────────────────

export interface Skill {
  id: number;
  name: string;
  description: string;
  system_prompt: string;
  user_prompt_template: string;
  source_questions: string;
  created_at: string;
  updated_at: string;
}

export interface SkillFormData {
  name: string;
  description: string;
  system_prompt: string;
  user_prompt_template: string;
  source_questions: string;
}

export interface UserQuestion {
  id: number;
  question: string;
  conversation_id: number;
  created_at: string;
}

export interface EnhancePromptResponse {
  enhanced_prompt: string;
}
