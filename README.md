# AI DB Query

AI 数据库查询工具 — 多数据源 PostgreSQL 数据库浏览器与图表展示。

## 技术栈

- **后端**: Python FastAPI + asyncpg
- **前端**: React 19 + TypeScript + Vite + Ant Design + Recharts
- **部署**: Docker Compose / Windows exe 安装包 / npm 桌面版（独立窗口）

## 快速开始

### 方式 A：npm 桌面版（Windows 11 桌面用户，推荐）

无需安装 Python / Node / 管理员权限，一行命令装好并启动独立窗口（非浏览器）：

```powershell
irm https://raw.githubusercontent.com/alickjoe/charging-dashboard/main/scripts/install-aidbquery.ps1 | iex
```

已有 Node.js 18+ 时也可以直接：

```bash
npm install -g aidbquery
adq          # 启动桌面窗口
```

常用命令：

| 命令 | 说明 |
|------|------|
| `adq` | 启动桌面应用（后端端口 8000 被占时自动顺延） |
| `adq doctor` | 环境自检 |
| `adq stop` | 清理残留后端进程 |
| `npm update -g aidbquery` | 升级 |
| `npm uninstall -g aidbquery` | 卸载（数据保留在 `%APPDATA%\aidbquery`） |

数据与日志位于 `%APPDATA%\aidbquery\`（用户级，与 Docker / exe 版互不影响）。

### 方式 B：Docker Compose

#### 1. 环境配置

```bash
# 复制环境变量模板（可选，仅用于预设 LLM 默认配置）
cp .env.example .env
```

> 无需准备外部数据库：应用自身的配置与会话数据存放在 SQLite 文件 `backend/data/config.db` 中，后端启动时自动建表并初始化；业务数据源（PostgreSQL）通过前端"连接管理"界面添加，不在 `.env` 中配置。

#### 2. 启动

```bash
docker compose up -d
```

仅启动两个容器服务（`frontend`、`backend`），不依赖任何外部数据库服务。

#### 3. 访问

| 服务 | 地址 |
|------|------|
| 前端 | http://localhost:5173 |
| 后端 API | http://localhost:8000 |
| API 文档 | http://localhost:8000/docs |

## 项目结构

```
charging-dashboard/
├── docker-compose.yml          # Docker 编排
├── .env.example                # 环境变量模板
├── desktop/                    # npm 桌面版（aidbquery 包，命令 adq）
├── scripts/                    # 构建与安装脚本（exe 安装包 / npm 运行时 / 用户引导）
├── backend/
│   ├── Dockerfile
│   ├── requirements.txt
│   ├── data/                   # SQLite 数据文件（config.db，启动时自动初始化）
│   └── app/
│       ├── main.py             # FastAPI 入口
│       ├── database.py         # asyncpg 连接池管理
│       ├── sqlite_store.py     # SQLite 配置/会话存储
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

应用自身配置（数据库连接、LLM 配置、会话、标注、技能等）存储在 SQLite 文件 `backend/data/config.db`，由后端启动时自动初始化（`sqlite_store.py`），无需手动建库或执行迁移。

业务数据源（PostgreSQL）在应用内管理：打开"连接管理"页面添加数据源（主机、端口、库名、账号、密码等），凭据加密后入库；后端启动时按需为已配置的数据源建立连接池。

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
