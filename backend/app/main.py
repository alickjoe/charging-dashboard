"""FastAPI application entry point for Charging Dashboard."""

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import load_config
from app.database import create_pools, close_pools
from app.routers import connections, databases, charts


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup: load config and create connection pools. Shutdown: close pools."""
    app.state.db_config = load_config()
    app.state.pools = await create_pools(app.state.db_config)
    yield
    await close_pools(app.state.pools)


app = FastAPI(
    title="Charging Dashboard API",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


app.include_router(connections.router)
app.include_router(databases.router)
app.include_router(charts.router)


@app.get("/health")
async def health_check():
    return {"status": "ok"}
