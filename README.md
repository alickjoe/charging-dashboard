# Charging Dashboard

EV 充电桩数据看板 — 多数据源 PostgreSQL 数据库浏览器与图表展示。

## 技术栈

- **后端**: Python FastAPI + asyncpg
- **前端**: React 19 + TypeScript + Vite + Ant Design + Recharts
- **部署**: Docker Compose

## 快速开始

### 1. 环境配置

```bash
# 复制环境变量模板
cp .env.example .env

# 编辑 .env 填入数据库连接信息（QA/PROD）
# 本地开发数据库无需修改，由 Docker 自动启动
```

### 2. 启动

```bash
docker compose up -d
```

### 3. 访问

| 服务 | 地址 |
|------|------|
| 前端 | http://localhost:5173 |
| 后端 API | http://localhost:8000 |
| API 文档 | http://localhost:8000/docs |
| 本地 PostgreSQL | localhost:5432 |

## 项目结构

```
charging-dashboard/
├── docker-compose.yml          # Docker 编排
├── .env.example                # 环境变量模板
├── backend/
│   ├── Dockerfile
│   ├── requirements.txt
│   ├── config/databases.yaml   # 多数据库连接配置
│   ├── scripts/init-dev-db.sql # 开发数据库种子数据
│   └── app/
│       ├── main.py             # FastAPI 入口
│       ├── config.py           # YAML 配置解析
│       ├── database.py         # 连接池管理
│       ├── routers/            # API 路由
│       ├── schemas/            # Pydantic 模型
│       └── services/           # 业务逻辑
└── frontend/
    ├── Dockerfile
    ├── package.json
    ├── vite.config.ts
    └── src/
        ├── App.tsx
        ├── api/                # API 调用层
        ├── components/         # 公共组件
        ├── pages/              # 页面组件
        └── types/              # TypeScript 类型
```

## 数据库配置

编辑 `backend/config/databases.yaml` 添加数据源，支持 `${VAR:default}` 占位符从环境变量注入：

```yaml
connections:
  - name: qa_pg
    label: "QA 环境"
    host: ${QA_DB_HOST:localhost}
    port: ${QA_DB_PORT:5432}
    database: ${QA_DB_NAME:charging_qa}
    username: ${QA_DB_USER:reader}
    password: ${QA_DB_PASSWORD:}
```

## API 端点

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/v1/connections` | 连接列表及状态 |
| POST | `/api/v1/connections/{name}/test` | 测试连接 |
| GET | `/api/v1/connections/{name}/schemas` | Schema 列表 |
| GET | `/api/v1/connections/{name}/tables` | 表列表 |
| GET | `/api/v1/connections/{name}/tables/{t}/columns` | 列结构 |
| GET | `/api/v1/connections/{name}/tables/{t}/data` | 分页数据 |
| POST | `/api/v1/connections/{name}/tables/{t}/chart-data` | 图表数据 |
| GET | `/health` | 健康检查 |
