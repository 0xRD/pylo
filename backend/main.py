import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from backend.database import init_db
from backend.api.activity import router as activity_router
from backend.api.auth import router as auth_router
from backend.api.invitations import router as invitations_router
from backend.api.blueprints import router as blueprints_router
from backend.api.pybooks import router as pybooks_router
from backend.api.runs import router as runs_router
from backend.api.secrets import router as secrets_router
from backend.api.settings import router as settings_router
from backend.api.users import router as users_router
from backend.api.webhooks import router as webhooks_router
from backend.core.scheduler import start_scheduler, stop_scheduler
from backend.core.runner import init_host_paths
from backend.core import queue_manager
from backend.core.auth import _decode_jwt
from backend.config import settings

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Paths that viewers (or unauthenticated users) may POST/DELETE to
_WRITE_ALLOWLIST = {
    "/api/auth/login",
    "/api/auth/logout",
    "/api/auth/setup",
    "/api/auth/change-password",
    "/health",
}


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Starting Pylo backend...")
    init_db()
    init_host_paths()
    start_scheduler()
    await queue_manager.start()
    yield
    stop_scheduler()
    queue_manager.stop()
    logger.info("Pylo backend stopped.")


app = FastAPI(
    title="Pylo",
    description="Python automation orchestration platform",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def enforce_viewer_readonly(request: Request, call_next):
    """Block write operations (non-GET) for viewer-role JWT sessions."""
    if request.method in ("GET", "HEAD", "OPTIONS"):
        return await call_next(request)

    path = request.url.path

    # Invitation accept endpoints are public
    if path.startswith("/api/auth/invite/"):
        return await call_next(request)

    # Explicitly allowed write paths (login, logout, change-password, etc.)
    if path in _WRITE_ALLOWLIST:
        return await call_next(request)

    # Master API_TOKEN always grants admin
    api_key = request.headers.get("X-API-Token")
    if api_key and api_key == settings.API_TOKEN:
        return await call_next(request)

    # Check JWT cookie role
    token = request.cookies.get("pylo_token")
    if token:
        payload = _decode_jwt(token)
        if payload and payload.get("role") == "admin":
            return await call_next(request)
        if payload and payload.get("role") == "viewer":
            return JSONResponse(status_code=403, content={"detail": "Viewers cannot perform write operations"})

    # No valid token at all — let the route's own auth dependency handle the 401
    return await call_next(request)


app.include_router(activity_router)
app.include_router(auth_router)
app.include_router(invitations_router)
app.include_router(blueprints_router)
app.include_router(pybooks_router)
app.include_router(runs_router)
app.include_router(secrets_router)
app.include_router(settings_router)
app.include_router(users_router)
app.include_router(webhooks_router)


@app.get("/health")
async def health():
    return {"status": "ok", "service": "pylo-backend"}
