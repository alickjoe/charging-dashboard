# AI 查询会话历史功能

## Context

当前 `/nl-query` 页面每次查询都是独立的，没有历史记录，也无法基于之前的问答上下文继续追问。用户需要：
1. 像 ChatGPT 一样的多轮对话体验，LLM 能记住之前的上下文
2. 所有问答记录持久化保存，包括思考过程、SQL、查询结果
3. 左侧会话列表，可切换/新建/删除会话

## 数据模型设计

### 新增 SQLite 表

**conversations** — 会话表
| 列 | 类型 | 说明 |
|---|---|---|
| id | INTEGER PK AUTO | 会话ID |
| title | TEXT | 会话标题（取首条问题前30字） |
| connection_name | TEXT NOT NULL | 关联的数据库连接 |
| llm_config_id | INTEGER NOT NULL | 关联的LLM配置 |
| created_at | TEXT | 创建时间 |
| updated_at | TEXT | 更新时间 |

**conversation_messages** — 消息表
| 列 | 类型 | 说明 |
|---|---|---|
| id | INTEGER PK AUTO | 消息ID |
| conversation_id | INTEGER FK | 所属会话 |
| role | TEXT | user / assistant |
| question | TEXT | 用户问题（仅role=user时有值） |
| answer_blocks | TEXT (JSON) | AI回答的结构化内容（think/sql/result/error blocks） |
| llm_time_ms | REAL | LLM耗时 |
| raw_messages | TEXT (JSON) | OpenAI格式的完整消息数组快照（用于恢复上下文） |
| created_at | TEXT | 创建时间 |

## 后端实现

### 1. SQLite Store — 新增 `ConversationStore` 类 (`sqlite_store.py`)

DDL 新增两张表，Store 提供：`create`, `list_all`, `get_by_id`, `delete`, `add_message`, `get_messages`, `update_title`

### 2. Pydantic Schemas — 新增 (`schemas/conversation.py`)

- `ConversationResponse` — 会话摘要（不含消息）
- `ConversationDetailResponse` — 会话详情（含消息列表）
- `MessageResponse` — 单条消息
- `CreateConversationRequest` — 创建会话请求
- `NLQueryRequest` 扩展 — 新增可选字段 `conversation_id: Optional[int]`

### 3. API Router — 新增 (`routers/conversations.py`)

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/v1/conversations` | 列出所有会话 |
| GET | `/api/v1/conversations/{id}` | 获取会话详情+消息 |
| POST | `/api/v1/conversations` | 创建新会话 |
| DELETE | `/api/v1/conversations/{id}` | 删除会话及消息 |

注册到 `main.py`

### 4. 修改流式查询端点 (`routers/llm.py`)

- `nl_query_stream` 接受 `conversation_id` 可选参数
- 如果有 `conversation_id`：从 DB 加载 `raw_messages` 作为 messages 前缀，延续上下文
- 查询完成后：将新消息追加保存到 DB

### 5. 修改 Agent Service (`llm_agent_service.py`)

- `run_agent_stream` 增加可选参数 `conversation_id` 和 `history_messages`
- 当提供 `history_messages` 时，追加到 system prompt 之后
- 查询结束后返回最终的 `raw_messages` 供调用方保存

## 前端实现

### 6. 类型定义 — 扩展 (`types/index.ts`)

新增：
```ts
Conversation { id, title, connection_name, llm_config_id, message_count, created_at, updated_at }
ConversationMessage { id, role, question, answer_blocks, llm_time_ms, created_at }
```
修改 `NLQueryRequest` 增加 `conversation_id?: number`

### 7. API 函数 — 新增 (`api/conversations.ts`)

`fetchConversations`, `createConversation`, `fetchConversationDetail`, `deleteConversation`

### 8. NLQueryPage 重构 (`pages/NLQueryPage.tsx`)

重构为双栏布局：
- **左侧栏** (~300px 宽)：会话列表 + "新建会话"按钮
  - 列表项显示标题、消息数、更新时间
  - 支持点击切换、删除（Popconfirm）
  - 当前选中会话高亮
- **右侧区域**：聊天对话视图
  - 顶部：当前会话的数据库连接 + LLM 模型信息（只读显示）
  - 中间：消息气泡列表
    - 用户消息：右侧蓝色气泡
    - AI消息：左侧白色气泡，内含 think/sql/result/error blocks
  - 底部：输入框 + 发送/停止按钮

**流程**：
1. 用户点击"新建会话" → 创建空白会话（仅选择DB+模型，未发消息前无标题）
2. 用户输入第一个问题 → POST 创建会话(带conversation_id=null) → 后端创建会话并保存 → 流式返回
3. 后续追问 → POST 带 conversation_id → 后端加载历史消息 → 继续对话
4. 切换会话 → 从后端加载该会话的消息历史 → 展示

**状态管理**：
- `conversations` — 会话列表 (useQuery)
- `activeConversationId` — 当前活跃会话ID
- `messages` — 当前会话的消息列表 (会话切换时加载)
- 流式查询相关状态保持不变

### 9. 注册路由 (`App.tsx`)

无需改动，仍在 `/nl-query` 路径下。

## 关键注意点

- 流式响应期间 `messages` 状态与 SSE 事件同步更新
- 会话切换时需先取消进行中的查询（abort）
- `raw_messages` 存储 OpenAI 格式的完整消息历史，用于恢复 LLM 上下文（不含完整查询结果数据，仅含 tool result 摘要）
- 首次查询时自动用问题前30字作为会话标题
- 删除会话同时删除所有消息（级联）

## 验证方式

1. 启动前后端服务 (`docker-compose up`)
2. 进入 AI 查询页面 → 选择数据库和模型 → 输入问题并查询 → 确认结果正常显示
3. 在同一个会话中继续追问 → 确认 LLM 理解上下文
4. 新建第二个会话 → 确认能独立对话
5. 切换回第一个会话 → 确认历史消息完整加载
6. 删除会话 → 确认列表更新
7. 刷新页面 → 确认会话列表和历史消息都在
