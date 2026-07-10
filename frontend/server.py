"""Lightweight HTTP server for serving frontend static files and proxying API requests.

Serves the Vite-built ``dist/`` directory and forwards ``/api/*`` requests to the
FastAPI backend running on localhost:8000.  Designed to be bundled with PyInstaller
for the Windows installer; falls back gracefully when running from source.
"""

import http.server
import json
import logging
import mimetypes
import os
import sys
import urllib.request
import urllib.error
from pathlib import Path

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [frontend] %(levelname)s %(message)s",
)
logger = logging.getLogger("frontend-server")

BACKEND_URL = "http://127.0.0.1:8000"
LISTEN_HOST = "0.0.0.0"
LISTEN_PORT = 5173


def _get_dist_dir() -> Path:
    """Resolve the ``dist/`` directory containing built frontend assets.

    When running inside PyInstaller the files are extracted to ``sys._MEIPASS``;
    otherwise we look relative to this script's location.
    """
    if getattr(sys, "frozen", False):
        base = Path(sys._MEIPASS)
    else:
        base = Path(__file__).resolve().parent
    return base / "dist"


DIST_DIR = _get_dist_dir()


class ProxyHandler(http.server.SimpleHTTPRequestHandler):
    """Handler that serves static files and proxies /api/* to the backend."""

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(DIST_DIR), **kwargs)

    # ---- proxy helpers -------------------------------------------------------

    def _proxy_request(self) -> None:
        """Forward the current request to the backend and write the response."""
        target_url = BACKEND_URL + self.path
        body = None
        content_length = self.headers.get("Content-Length")
        if content_length:
            try:
                body = self.rfile.read(int(content_length))
            except Exception:
                body = None

        req = urllib.request.Request(
            target_url,
            data=body,
            method=self.command,
        )
        # Copy relevant headers
        forward_headers = [
            "content-type",
            "accept",
            "authorization",
            "x-requested-with",
        ]
        for h in forward_headers:
            val = self.headers.get(h)
            if val:
                req.add_header(h, val)

        try:
            with urllib.request.urlopen(req, timeout=300) as resp:
                self.send_response(resp.status)
                for key, val in resp.getheaders():
                    if key.lower() not in ("connection",):
                        self.send_header(key, val)
                self.end_headers()
                # Stream chunks to client (required for SSE streaming)
                while True:
                    chunk = resp.read(8192)
                    if not chunk:
                        break
                    self.wfile.write(chunk)
                    self.wfile.flush()
        except urllib.error.HTTPError as e:
            self.send_response(e.code)
            self.end_headers()
            try:
                self.wfile.write(e.read())
            except Exception:
                pass
        except Exception as e:
            logger.error("Proxy error: %s", e)
            self.send_response(502)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(
                json.dumps({"detail": "Backend unavailable"}).encode()
            )

    # ---- SPA fallback --------------------------------------------------------

    def _serve_spa_fallback(self) -> None:
        """Serve ``index.html`` for client-side routing."""
        index_path = DIST_DIR / "index.html"
        if not index_path.is_file():
            self.send_response(404)
            self.end_headers()
            self.wfile.write(b"index.html not found")
            return
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.end_headers()
        with open(index_path, "rb") as f:
            self.wfile.write(f.read())

    # ---- routing -------------------------------------------------------------

    def do_GET(self) -> None:
        if self.path.startswith("/api/"):
            self._proxy_request()
            return
        # SPA fallback: if the path doesn't map to a real file, serve index.html
        file_path = DIST_DIR / self.path.lstrip("/")
        if not file_path.is_file():
            self._serve_spa_fallback()
            return
        super().do_GET()

    def do_POST(self) -> None:
        if self.path.startswith("/api/"):
            self._proxy_request()
            return
        super().do_POST()

    def do_PUT(self) -> None:
        if self.path.startswith("/api/"):
            self._proxy_request()
            return
        super().do_PUT()

    def do_DELETE(self) -> None:
        if self.path.startswith("/api/"):
            self._proxy_request()
            return
        super().do_DELETE()

    def do_PATCH(self) -> None:
        if self.path.startswith("/api/"):
            self._proxy_request()
            return
        super().do_PATCH()

    def do_OPTIONS(self) -> None:
        if self.path.startswith("/api/"):
            self._proxy_request()
            return
        super().do_OPTIONS()

    def do_HEAD(self) -> None:
        if self.path.startswith("/api/"):
            self._proxy_request()
            return
        super().do_HEAD()

    def log_message(self, format, *args):
        logger.info("%s - %s", self.client_address[0], format % args)


def main():
    logger.info("Serving frontend from: %s", DIST_DIR)
    logger.info("API proxy target: %s", BACKEND_URL)
    logger.info("Listening on %s:%d", LISTEN_HOST, LISTEN_PORT)

    server = http.server.HTTPServer((LISTEN_HOST, LISTEN_PORT), ProxyHandler)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
        logger.info("Server stopped.")


if __name__ == "__main__":
    main()
