"""System-tray launcher for AI DB Query on Windows.

Starts the FastAPI backend and the frontend static-file server as child processes,
provides a system-tray icon with an "Open Dashboard" / "Quit" menu, and
automatically restarts crashed processes (up to 3 attempts).

Designed to be bundled with PyInstaller for the Windows installer.
"""

import json
import logging
import os
import subprocess
import sys
import threading
import time
import webbrowser
from pathlib import Path

# ---------------------------------------------------------------------------
# Path resolution (works both from source and inside PyInstaller bundle)
# ---------------------------------------------------------------------------

if getattr(sys, "frozen", False):
    _BASE_DIR = Path(sys.executable).resolve().parent
else:
    _BASE_DIR = Path(__file__).resolve().parent

BACKEND_EXE = str(_BASE_DIR / "backend" / "backend.exe")
FRONTEND_EXE = str(_BASE_DIR / "frontend" / "server.exe")
DATA_DIR = str(_BASE_DIR / "data")
LOG_DIR = str(_BASE_DIR / "logs")

# Ensure log directory exists
Path(LOG_DIR).mkdir(parents=True, exist_ok=True)

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [launcher] %(levelname)s %(message)s",
    handlers=[
        logging.FileHandler(os.path.join(LOG_DIR, "launcher.log"), encoding="utf-8"),
        logging.StreamHandler(),
    ],
)
logger = logging.getLogger("launcher")

# ---------------------------------------------------------------------------
# Tray icon generation
# ---------------------------------------------------------------------------

def _make_icon():
    """Generate a simple 64x64 tray icon (blue square with "AI" text)."""
    from PIL import Image, ImageDraw, ImageFont

    size = 64
    img = Image.new("RGBA", (size, size), (30, 100, 200, 255))
    draw = ImageDraw.Draw(img)
    try:
        font = ImageFont.truetype("segoeui.ttf", 28)
    except Exception:
        font = ImageFont.load_default()
    bbox = draw.textbbox((0, 0), "AI", font=font)
    tw = bbox[2] - bbox[0]
    th = bbox[3] - bbox[1]
    draw.text(((size - tw) / 2, (size - th) / 2 - 2), "AI", fill="white", font=font)
    return img

# ---------------------------------------------------------------------------
# Process management
# ---------------------------------------------------------------------------

MAX_RESTARTS = 3

class ProcessManager:
    """Manages backend and frontend child processes with auto-restart."""

    def __init__(self):
        self._procs: dict[str, subprocess.Popen | None] = {
            "backend": None,
            "frontend": None,
        }
        self._restart_counts: dict[str, int] = {"backend": 0, "frontend": 0}
        self._stop_event = threading.Event()

    # -- launch ---------------------------------------------------------------

    def _launch_backend(self) -> None:
        env = os.environ.copy()
        env["DATA_DIR"] = DATA_DIR  # tell sqlite_store where to find config.db
        logger.info("Starting backend: %s", BACKEND_EXE)
        log_path = os.path.join(LOG_DIR, "backend.log")
        with open(log_path, "a", encoding="utf-8") as log_f:
            self._procs["backend"] = subprocess.Popen(
                [BACKEND_EXE],
                env=env,
                stdout=log_f,
                stderr=subprocess.STDOUT,
                cwd=_BASE_DIR,
            )

    def _launch_frontend(self) -> None:
        logger.info("Starting frontend: %s", FRONTEND_EXE)
        log_path = os.path.join(LOG_DIR, "frontend.log")
        with open(log_path, "a", encoding="utf-8") as log_f:
            self._procs["frontend"] = subprocess.Popen(
                [FRONTEND_EXE],
                stdout=log_f,
                stderr=subprocess.STDOUT,
                cwd=_BASE_DIR,
            )

    def start_all(self) -> None:
        self._launch_backend()
        # Give backend a head start before launching frontend
        time.sleep(1)
        self._launch_frontend()

    # -- monitor loop (runs in background thread) -----------------------------

    def _monitor_loop(self) -> None:
        while not self._stop_event.is_set():
            for name, proc in list(self._procs.items()):
                if proc is None:
                    continue
                ret = proc.poll()
                if ret is not None:
                    logger.warning(
                        "%s exited with code %d (restart #%d)",
                        name, ret, self._restart_counts[name] + 1,
                    )
                    if self._restart_counts[name] < MAX_RESTARTS:
                        self._restart_counts[name] += 1
                        time.sleep(2)
                        if name == "backend":
                            self._launch_backend()
                        else:
                            self._launch_frontend()
                    else:
                        logger.error(
                            "%s reached max restarts (%d), giving up.",
                            name, MAX_RESTARTS,
                        )
            time.sleep(3)

    def start_monitor(self) -> None:
        t = threading.Thread(target=self._monitor_loop, daemon=True)
        t.start()

    # -- shutdown -------------------------------------------------------------

    def stop_all(self) -> None:
        self._stop_event.set()
        for name, proc in self._procs.items():
            if proc and proc.poll() is None:
                logger.info("Terminating %s (PID %d)", name, proc.pid)
                proc.terminate()
                try:
                    proc.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    logger.warning("Force-killing %s", name)
                    proc.kill()
        logger.info("All processes stopped.")


# ---------------------------------------------------------------------------
# System tray
# ---------------------------------------------------------------------------

def _open_dashboard(_icon, _item):
    webbrowser.open("http://localhost:5173")

def _quit_app(icon, _item):
    global _mgr
    _mgr.stop_all()
    icon.stop()

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    import pystray

    global _mgr
    _mgr = ProcessManager()
    _mgr.start_all()
    _mgr.start_monitor()

    icon_img = _make_icon()
    menu = pystray.Menu(
        pystray.MenuItem("打开看板", _open_dashboard, default=True),
        pystray.MenuItem("退出", _quit_app),
    )
    tray_icon = pystray.Icon(
        "ai-db-query",
        icon_img,
        "AI DB Query",
        menu,
    )

    logger.info("AI DB Query launcher started (tray icon visible).")
    tray_icon.run()


if __name__ == "__main__":
    main()
