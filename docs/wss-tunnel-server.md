# WSS 隧道（企业网络模式）服务端与客户端指南

适用于：公司网络/防火墙拦截 PostgreSQL 直连（TCP 握手通、协议数据被丢），
但 HTTPS/WSS 网页流量可正常通行的环境。

## 原理

```
应用 asyncpg → 127.0.0.1:<动态端口> (本地桥, 后端内置)
            → wss://<主机>:443/<路径>      ← 出网关时是标准加密网页流量
            → nginx (443, 按现有站点路由) → location /<路径> (WS 升级)
            → websockify (127.0.0.1:9445) → PostgreSQL (127.0.0.1:<PG端口>)
```

每条数据库连接对应一条独立 WSS 会话；加密由 WSS 通道承担，
连接的「SSL 模式」设置在隧道模式下被忽略。

## 服务端（一次配置）

在数据库所在的 VM/服务器上（Ubuntu/Debian + nginx + systemd）：

```bash
sudo bash deploy/wss-tunnel-server.sh --pg-port 5433 --path /pgwss            # 基础
sudo bash deploy/wss-tunnel-server.sh --pg-port 5433 --path /pgwss --auth     # + basic auth（推荐生产）
```

脚本输出一段 `location /<路径> { ... }` 配置，粘贴进 **443 站点的 server 块**
（即已能从客户端正常打开网页的那个 server 块），然后：

```bash
sudo nginx -t && sudo systemctl reload nginx
```

手工配置等价步骤：

1. `apt install websockify`
2. systemd 单元：`websockify 127.0.0.1:9445 127.0.0.1:<PG端口>`（只监听回环）
3. nginx 站点 server 块内：

```nginx
location /pgwss {
    proxy_pass http://127.0.0.1:9445;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_read_timeout 24h;   # 仪表盘/BI 长连接
    proxy_send_timeout 24h;
}
```

### 安全建议

- websockify 与 PG 均只监听 `127.0.0.1`，不直接暴露端口
- `/pgwss` 经由网站 443 对外可达，数据库密码是第一道门；
  生产建议 `--auth` 追加 nginx basic auth
- 可在 nginx 里追加 `allow <客户端出口IP>; deny all;` 进一步收口

## 客户端（零配置）

应用内新建/编辑连接：

1. 主机/端口/库名/用户名/密码：填数据库的**真实**信息
2. 打开「企业网络模式（WSS 隧道）」
3. 高级项：隧道路径（默认 `/pgwss`）、隧道端口（默认 443）、
   隧道账号/密码（服务端开了 `--auth` 才需要）
4. 「测试连接」→「保存」

SSL 模式设置在隧道模式下被忽略（加密由 WSS 通道承担）。
企业 TLS 解密网关会重签证书，应用对隧道会话不校验证书——
信任模型与同网关下正常使用浏览器网页一致。

## 排障

| 现象 | 处置 |
|---|---|
| 隧道连接失败（15 秒超时） | websockify 未运行（`systemctl status websockify-pg`）、nginx 片段未生效、路径不一致 |
| 浏览器能开网站但隧道失败 | location 是否粘贴进正确的 server 块（443 那个）；`nginx -t` |
| 认证失败(401/basic auth) | 隧道账号/密码与 htpasswd 不一致 |
| 连接经常断 | nginx `proxy_read_timeout` 是否 ≥ 24h；是否有中间设备掐空闲连接 |
