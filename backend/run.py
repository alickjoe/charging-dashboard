"""Entry point for the PyInstaller-bundled backend executable.

When frozen by PyInstaller this script starts the uvicorn ASGI server
directly (passing the app object rather than a module string, which
avoids import-path issues inside the bundle).

Not used in Docker deployments — Docker uses ``uvicorn app.main:app``.
"""

import uvicorn
from app.main import app

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000, log_level="info")
