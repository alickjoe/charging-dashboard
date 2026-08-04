"""FastAPI application entry point for AI DB Query."""

import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.database import create_pools_from_rows, close_pools
from app.sqlite_store import init_db, ConnectionStore
from app.routers import connections, connection_admin, databases, charts, llm, conversations, custom_query, skills


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup: init SQLite and load connections. Shutdown: close pools."""
    await init_db()
    rows = await ConnectionStore.list_all()
    # Decrypt passwords before creating pools
    rows = [ConnectionStore.decrypt_password(r) for r in rows]
    app.state.pools = await create_pools_from_rows(rows)
    yield
    await close_pools(app.state.pools)


app = FastAPI(
    title="AI DB Query API",
    version="0.1.0",
    lifespan=lifespan,
)

cors_origins = os.getenv(
    "CORS_ORIGINS",
    "http://localhost:5173,http://127.0.0.1:5173"
).split(",")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in cors_origins if o.strip()],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


app.include_router(connections.router)
app.include_router(connection_admin.router)
app.include_router(databases.router)
app.include_router(charts.router)
app.include_router(llm.router)
app.include_router(conversations.router)
app.include_router(custom_query.router)
app.include_router(skills.router)


@app.get("/health")
async def health_check():
    return {"status": "ok"}
