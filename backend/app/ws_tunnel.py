"""In-process TCP⇄WebSocket bridge for corporate-network (WSS tunnel) connections.

Some corporate egress gateways (e.g. TLS-decrypting proxies) silently drop raw
PostgreSQL protocol traffic on any port, while standard HTTPS/WSS traffic passes
normally.  For connections flagged ``tunnel_mode`` the backend therefore pipes
every asyncpg connection through a local TCP listener whose bytes travel inside
a dedicated WebSocket session (``wss://host:port/path``) — indistinguishable
from ordinary web traffic on the wire.

Verified end-to-end against a Volvo IT SSL-decrypt gateway (2026-09-08).

The manager keeps one listener per connection (keyed by connection name).
Each incoming TCP connection maps to its own WebSocket session, so pool
connections run naturally in parallel.  Listeners are rebound automatically
when a connection's tunnel parameters change, and are torn down when the
connection is deleted or the backend shuts down.
"""

import asyncio
import base64
import logging
import ssl

import websockets

logger = logging.getLogger(__name__)

WS_OPEN_TIMEOUT = 15  # must stay well under CONNECTION_TIMEOUT (10s) budget + margin


def _no_verify_ssl() -> ssl.SSLContext:
    """TLS context without verification.

    Corporate decrypting gateways re-sign every session with their own CA, so
    certificate verification would always fail.  Trust model is identical to
    the user's normal browser session behind the same gateway.
    """
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    return ctx


class TunnelManager:
    """Owns one local TCP⇄WSS listener per tunnelled connection."""

    def __init__(self) -> None:
        self._listeners: dict[str, dict] = {}
        self._lock = asyncio.Lock()

    async def ensure(
        self,
        key: str,
        host: str,
        port: int,
        path: str,
        auth_user: str | None = None,
        auth_password: str | None = None,
    ) -> int:
        """Return the local port of a live bridge for ``key``, (re)building it
        when missing or when the tunnel parameters changed.

        A probe WebSocket handshake validates tunnel reachability eagerly so
        callers get a clear "tunnel" error instead of an opaque asyncpg reset.
        """
        params = (host, int(port), path, auth_user or "", auth_password or "")
        async with self._lock:
            existing = self._listeners.get(key)
            if existing and existing["params"] == params:
                return existing["port"]
            if existing:
                await self._stop_locked(key)

            await self._probe(params)

            server = await asyncio.start_server(
                lambda r, w: self._pipe(r, w, params), "127.0.0.1", 0
            )
            local_port = server.sockets[0].getsockname()[1]
            self._listeners[key] = {
                "server": server,
                "port": local_port,
                "params": params,
            }
            logger.info(
                "WSS tunnel bridge '%s': 127.0.0.1:%s -> wss://%s:%s%s",
                key, local_port, host, port, path,
            )
            return local_port

    async def stop(self, key: str) -> None:
        async with self._lock:
            await self._stop_locked(key)

    async def stop_all(self) -> None:
        async with self._lock:
            for key in list(self._listeners):
                await self._stop_locked(key)

    async def _stop_locked(self, key: str) -> None:
        entry = self._listeners.pop(key, None)
        if entry is None:
            return
        entry["server"].close()
        try:
            await entry["server"].wait_closed()
        except Exception:  # noqa: BLE001
            pass
        logger.info("WSS tunnel bridge stopped: %s", key)

    async def _probe(self, params: tuple) -> None:
        host, port, path, auth_user, auth_password = params
        try:
            async with websockets.connect(
                self._ws_url(host, port, path),
                ssl=_no_verify_ssl(),
                additional_headers=self._auth_headers(auth_user, auth_password),
                subprotocols=["binary"],
                max_size=None,
                compression=None,
                open_timeout=WS_OPEN_TIMEOUT,
            ):
                pass  # handshake OK — close immediately
        except Exception as e:
            await self._raise_tunnel_error(e)

    @staticmethod
    def _ws_url(host: str, port: int, path: str) -> str:
        if not path.startswith("/"):
            path = "/" + path
        return f"wss://{host}:{port}{path}"

    @staticmethod
    def _auth_headers(user: str, password: str) -> dict:
        if not user:
            return {}
        token = base64.b64encode(f"{user}:{password}".encode()).decode()
        return {"Authorization": f"Basic {token}"}

    @staticmethod
    async def _raise_tunnel_error(original: Exception) -> None:
        raise RuntimeError(
            "隧道连接失败: 无法在 "
            f"{WS_OPEN_TIMEOUT} 秒内建立 WSS 隧道"
            "（请检查企业网络、隧道路径与隧道服务是否可用）"
        ) from original

    async def _pipe(self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter,
                    params: tuple) -> None:
        host, port, path, auth_user, auth_password = params
        peer = writer.get_extra_info("peername")
        try:
            async with websockets.connect(
                self._ws_url(host, port, path),
                ssl=_no_verify_ssl(),
                additional_headers=self._auth_headers(auth_user, auth_password),
                subprotocols=["binary"],
                max_size=None,
                compression=None,
                open_timeout=WS_OPEN_TIMEOUT,
                ping_interval=30,
                ping_timeout=20,
            ) as ws:
                logger.debug("tunnel %s: wss session established", peer)

                async def tcp2ws() -> None:
                    while True:
                        data = await reader.read(65536)
                        if not data:
                            break
                        await ws.send(data)

                async def ws2tcp() -> None:
                    async for data in ws:
                        if isinstance(data, str):
                            data = data.encode()
                        writer.write(data)
                        await writer.drain()

                done, pending = await asyncio.wait(
                    [asyncio.create_task(tcp2ws()), asyncio.create_task(ws2tcp())],
                    return_when=asyncio.FIRST_COMPLETED,
                )
                for t in pending:
                    t.cancel()
                for t in done:
                    exc = t.exception()
                    if exc and not isinstance(exc, (asyncio.CancelledError, EOFError)):
                        logger.debug("tunnel %s: pipe ended: %r", peer, exc)
        except Exception as e:  # noqa: BLE001 — mid-session failures close the pipe
            logger.warning("tunnel %s: %s: %s", peer, type(e).__name__, e)
        finally:
            try:
                writer.close()
                await writer.wait_closed()
            except Exception:  # noqa: BLE001
                pass
            logger.debug("tunnel %s: client disconnected", peer)


tunnel_manager = TunnelManager()
