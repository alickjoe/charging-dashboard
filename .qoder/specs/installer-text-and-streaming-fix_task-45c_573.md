# 修复计划

## 问题 1：安装界面中文乱码 → 文字缺失

**根因**：`scripts/write_installer.ps1` 通过 Write 工具创建时，嵌入的中文字符编码不一致，导致输出的 `installer.nsi` 中 LangString 中文呈现乱码（mojibake），NSIS 解析失败后部分标准 UI 文字无法渲染。

**修复**：
- 用 `Bash` + `Set-Content -Encoding UTF8` 重新创建 `scripts/write_installer.ps1`（与 test.bat 成功的策略一致）
- .ps1 内部保持 `@'...'@` heredoc 语法
- 执行时通过 `[System.IO.File]::WriteAllText` 以 UTF-8 BOM 输出 `installer.nsi`
- 在 `scripts/write_build.ps1` 步骤 7 之前加入 `powershell -File scripts/write_installer.ps1`

## 问题 2：AI 查询无 streaming，全程加载动画后一次性刷新

**根因**：`frontend/server.py` 中 `_proxy_request` 方法两处缺陷：
1. `self.wfile.write(resp.read())` — `resp.read()` 无参数阻塞读取整个响应体后才写入客户端
2. 过滤了 `transfer-encoding` 响应头，浏览器无法识别分块传输

**修复**（仅 `frontend/server.py` 第 82-88 行）：
- 将 `resp.read()` 改为 chunk 循环读取写入，每次 `flush()`
- 移除对 `transfer-encoding` 头的过滤

## 涉及文件
- `scripts/write_installer.ps1` — 重建（Bash+PowerShell 保证 UTF-8 编码）
- `scripts/write_build.ps1` — 步骤 7 前加入自动生成 installer.nsi 的调用
- `frontend/server.py` — 修改 `_proxy_request` 方法，改为 chunk 流式转发

## 不影响 Docker Compose
Docker 部署使用 Vite dev server 内置代理，完全不加载 `server.py`。`vite.config.ts` 和 `docker-compose.yml` 无需改动。