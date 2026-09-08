#!/usr/bin/env bash
# wss-tunnel-server.sh — 在 VM/服务器上一键配置 PostgreSQL 的 WSS 隧道后端
# （配合 aidbquery 客户端「企业网络模式」使用）
#
# 用法（root）:
#   bash wss-tunnel-server.sh [--pg-port 5433] [--path /pgwss] [--auth [user]]
#
# 行为:
#   1. 安装 websockify（WS↔TCP 桥）
#   2. 写入并启用 systemd 单元 websockify-pg.service（仅监听 127.0.0.1）
#   3. 打印需要粘贴进 nginx 站点 server 块的 location 片段（--auth 时含 basic auth）
#
# 本脚本不会自动修改/重载 nginx —— 输出片段由用户粘贴后自行
#   nginx -t && systemctl reload nginx
# 幂等：重复执行会覆盖自身生成的 unit / 提示片段。

set -euo pipefail

PG_PORT="5433"
WS_PATH="/pgwss"
AUTH_USER=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --pg-port) PG_PORT="$2"; shift 2 ;;
    --path)    WS_PATH="$2"; shift 2 ;;
    --auth)    AUTH_USER="${2:-aidbquery}"; shift $(( $# >= 2 ? 2 : 1 )) ;;
    *) echo "未知参数: $1" >&2; exit 1 ;;
  esac
done

BRIDGE_PORT="9445"

echo "== 1/3 安装 websockify =="
if ! command -v websockify >/dev/null 2>&1; then
  apt-get update -qq && apt-get install -y -qq websockify
fi

echo "== 2/3 写入 systemd 单元 websockify-pg.service (127.0.0.1:${BRIDGE_PORT} -> 127.0.0.1:${PG_PORT}) =="
cat > /etc/systemd/system/websockify-pg.service <<EOF
[Unit]
Description=TCP-over-WebSocket bridge for aidbquery (PG tunnel)
After=network.target

[Service]
ExecStart=/usr/bin/websockify --log-file=/var/log/websockify-pg.log 127.0.0.1:${BRIDGE_PORT} 127.0.0.1:${PG_PORT}
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable --now websockify-pg.service

echo "== 3/3 nginx 片段（粘贴进 443 站点的 server 块） =="
AUTH_BLOCK=""
if [[ -n "$AUTH_USER" ]]; then
  HTPASSWD="/etc/nginx/aidbquery-tunnel.htpasswd"
  echo "  -- 为 ${AUTH_USER} 生成 htpasswd（将提示输入密码） --"
  apt-get install -y -qq apache2-utils >/dev/null
  htpasswd -cB "$HTPASSWD" "$AUTH_USER"
  chmod 640 "$HTPASSWD" && chown root:www-data "$HTPASSWD" 2>/dev/null || true
  AUTH_BLOCK="        auth_basic \"aidbquery tunnel\";
        auth_basic_user_file ${HTPASSWD};
"
fi

cat <<EOF

# ── 粘贴开始 ─────────────────────────────────────────────
    location ${WS_PATH} {
        proxy_pass http://127.0.0.1:${BRIDGE_PORT};
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 24h;
        proxy_send_timeout 24h;
${AUTH_BLOCK}    }
# ── 粘贴结束 ─────────────────────────────────────────────

完成后执行:
    nginx -t && systemctl reload nginx

客户端 (aidbquery): 连接表单填 PG 真实地址/端口/库名/账密，
打开「企业网络模式」，隧道路径填 ${WS_PATH}，隧道端口填 443。
EOF
