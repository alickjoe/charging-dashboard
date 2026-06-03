# Charging Dashboard — 原型开发计划

## Context

EV 充电桩数据看板原型。需要连接多个 PostgreSQL 数据源（QA/PROD），展示数据库表和数据，支持后续扩展动态图表和时间筛选。技术栈：Python FastAPI 后端 + React TypeScript 前端，Docker Compose 部署。

## 技术选型

| 层 | 选型 | 理由 |
|---|---|---|
| 后端框架 | FastAPI | 现代 Python 异步框架，性能优秀 |
| 数据库驱动 | asyncpg | 异步 PostgreSQL 驱动，连接池内置，比 psycopg2 快 |
| 前端框架 | React 19 + Vite + TypeScript | 按用户要求 |
| UI 组件库 | Ant Design 5 | Table/Form/DatePicker 开箱即用 |
| 图表库 | Recharts | 声明式 React 图表，轻量 |
| 状态管理 | TanStack Query + Zustand | 服务端缓存 + 客户端状态 |
| 配置 | YAML + 环境变量占位符 | 多数据源配置清晰 |

## 项目结构

```
charging-dashboard/
├── docker-compose.yml
├── .env.example
├── backend/
│   ├── Dockerfile
│   ├── requirements.txt
│   ├── config/databases.yaml      # 多数据源配置
│   └── app/
│       ├── main.py                # FastAPI 入口
│       ├── config.py              # YAML 配置加载
│       ├── database.py            # 多连接池管理
│       ├── routers/
│       │   ├── connections.py     # 连接管理 API
│       │   ├── databases.py       # 数据库浏览 API
│       │   └── charts.py         # 图表聚合 API
│       ├── schemas/               # Pydantic 模型
│       └── services/              # 业务逻辑
└── frontend/
    ├── Dockerfile
    ├── package.json
    ├── vite.config.ts
    └── src/
        ├── App.tsx
        ├── api/                   # Axios API 调用
        ├── pages/
        │   ├── ConnectionListPage.tsx
        │   ├── DatabaseExplorerPage.tsx
        │   └── ChartViewPage.tsx
        ├── components/
        │   ├── Layout.tsx
        │   ├── ConnectionCard.tsx
        │   ├── DataTable.tsx
        │   ├── TimeFilter.tsx
        │   └── ChartRenderer.tsx
        └── types/
```

## API 端点

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/v1/connections` | 列出所有配置连接及状态 |
| POST | `/api/v1/connections/{name}/test` | 测试指定连接 |
| GET | `/api/v1/connections/{name}/schemas` | 列出 Schema |
| GET | `/api/v1/connections/{name}/tables` | 列出表（含估算行数） |
| GET | `/api/v1/connections/{name}/tables/{table}/columns` | 列出列结构 |
| GET | `/api/v1/connections/{name}/tables/{table}/data` | 分页数据（支持时间筛选） |
| POST | `/api/v1/connections/{name}/tables/{table}/chart-data` | 图表聚合数据 |
| GET | `/health` | 健康检查 |

## 数据库配置方案

`backend/config/databases.yaml` 中使用 `${VAR:default}` 占位符语法，运行时从环境变量替换：

```yaml
connections:
  - name: qa_pg
    label: "QA 环境"
    host: ${QA_DB_HOST:localhost}
    port: ${QA_DB_PORT:5432}
    database: ${QA_DB_NAME:charging_qa}
    username: ${QA_DB_USER:reader}
    password: ${QA_DB_PASSWORD:}
  - name: prod_pg
    label: "PROD 环境"
    host: ${PROD_DB_HOST:localhost}
    port: ${PROD_DB_PORT:5432}
    database: ${PROD_DB_NAME:charging_prod}
    username: ${PROD_DB_USER:readonly}
    password: ${PROD_DB_PASSWORD:}
```

## 开发任务（按优先级）

### Task 1：项目脚手架搭建
- Vite 创建 React + TypeScript 前端项目
- 搭建 FastAPI 后端基础结构（`/health` 端点）
- 编写 `docker-compose.yml`（frontend + backend + postgres-dev）
- 配置 `.env.example` 和 `.gitignore`
- **验证**：`docker compose up` 后前端 :5173 和后端 :8000 均可访问

### Task 2：后端 — 多数据库连接管理
- 实现 `config.py`：解析 YAML，替换环境变量占位符
- 实现 `database.py`：启动时创建 asyncpg 连接池字典
- 实现 `routers/connections.py`：连接列表 + 测试 API
- **验证**：`curl localhost:8000/api/v1/connections` 返回连接列表及状态

### Task 3：后端 — 数据库浏览器 API
- 实现 `db_explorer_service.py`：查询 information_schema 获取表/列
- 实现分页数据查询（参数化 SQL，支持 time_from/time_to）
- 实现 `routers/databases.py`
- **验证**：通过 API 可列出表、查看列结构、分页获取数据

### Task 4：后端 — 图表聚合 API
- 实现 `chart_service.py`：SUM/AVG/COUNT 聚合，date_trunc 分组
- 列名白名单校验（基于 information_schema.columns 结果）
- 实现 `routers/charts.py`
- **验证**：POST 请求返回 labels + datasets 格式数据

### Task 5：前端 — 全局 Layout + 连接管理页
- 搭建 Layout 组件（侧边栏 + 内容区）
- 实现 Axios client + 连接 API 调用
- 实现 `ConnectionListPage` + `ConnectionCard`（展示连接、测试按钮）
- **验证**：页面展示配置的连接，点击测试按钮返回状态

### Task 6：前端 — 数据库浏览器页
- 实现 `DatabaseExplorerPage`：Schema 选择 → 表列表 → 数据面板
- 实现 `DataTable`（Ant Design Table 分页）+ `TimeFilter`（DatePicker）
- **验证**：选择连接后可浏览表、查看分页数据

### Task 7：前端 — 图表展示页
- 实现 `ChartViewPage`：X/Y 列选择 + 聚合方式 + 图表类型
- React Query 管理图表数据缓存
- Recharts BarChart / LineChart 渲染
- **验证**：选择表 → 选列 → 渲染图表

### Task 8：收尾完善
- 后端 CORS 中间件配置
- 全局错误处理 + loading 状态
- 创建示例种子 SQL 脚本（充电桩数据）
- README 启动说明

## 验证方式

1. `docker compose up` 启动全部服务
2. 浏览器访问 `http://localhost:5173` 看到连接管理页
3. 配置 `.env` 中的数据库连接信息
4. 测试连接 → 浏览表 → 查看数据 → 生成图表