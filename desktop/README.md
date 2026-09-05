# aidbquery — npm 桌面版

`npm install -g aidbquery` 后通过 `adq` 命令启动的桌面版：Electron 独立窗口 +
内置 FastAPI 后端（便携 Python），无需系统安装 Python 或任何编译工具。

本目录是 **npm 包的源码**；`vendor/`（前端 dist + 后端源码副本）与
`runtime-build/`（Windows 运行时组包产物）为构建产物，不入库。

## 目录结构

```
desktop/
├── package.json            # npm 包 aidbquery（bin: adq）
├── bin/adq.js              # 命令入口
├── launcher/
│   ├── cli.js              # adq start/--check/doctor/stop
│   ├── electron-main.js    # Electron 主进程（后端生命周期 + 窗口）
│   ├── preload.js          # 注入 __ELECTRON__ / __AIDB_API_BASE__
│   ├── backend.js          # 后端进程管理（端口、健康检查、停止）
│   ├── runtime.js          # 运行时组件定位
│   ├── logs.js             # 日志（append + 5MB 轮转）
│   └── env.js              # 用户级路径与常量
└── scripts/pack.js         # 组 vendor/ + npm pack 主包
```

配套文件（仓库其他位置）：

- `scripts/build-runtime.ps1` — 组 `aidbquery-runtime-win32-x64` 包
  （python-build-standalone + site-packages + electron，全部 SHA-256 校验）
- `scripts/install-aidbquery.ps1` — 无 Node 用户的引导安装脚本
- `.github/workflows/npm-release.yml` — tag `npm-v*` 触发构建/冒烟/发布

## 本地开发（Windows 或 macOS/Linux）

不装运行时包也能开发，用环境变量把各组件指到本地：

```bash
cd frontend && npm ci && npm run build          # 前端（VITE_ELECTRON_BUILD 可不设）

cd desktop && npm install                        # 拉 devDependency: electron

# 后端组件（以本地 venv 为例）
export AIDB_PYTHON=/path/to/venv/bin/python     # Windows: ...\venv\Scripts\python.exe
export AIDB_SITE_PACKAGES=/path/to/venv/lib/python3.12/site-packages
export AIDB_BACKEND_DIR=$(pwd)/../backend
export AIDB_FRONTEND_DIST=$(pwd)/../frontend/dist

node bin/adq.js doctor                           # 自检
node bin/adq.js                                  # 启动窗口
node bin/adq.js --check                          # 无窗口冒烟
```

数据目录默认 `%APPDATA%\aidbquery`（可用 `AIDB_DATA_DIR` 覆盖）。

## 本地组包

```bash
node desktop/scripts/pack.js                     # 前端构建 + vendor 组装 + npm pack
powershell -File scripts/build-runtime.ps1       # Windows 上组运行时包
```

## 发布

```bash
git tag npm-v1.2.3 && git push origin npm-v1.2.3
```

CI 自动：构建 → 全局安装冒烟（`adq --check` + `adq doctor`）→ `npm publish`
→ GitHub Release 附 tarball。前置条件：repo secrets 配置 `NPM_TOKEN`。
