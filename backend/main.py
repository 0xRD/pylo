import logging
import re
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from backend.database import engine, init_db
from backend.api.activity import router as activity_router
from backend.api.api_keys import router as api_keys_router
from backend.api.dashboard import router as dashboard_router
from backend.api.auth import router as auth_router
from backend.api.invitations import router as invitations_router
from backend.api.blueprints import router as blueprints_router
from backend.api.pybooks import router as pybooks_router
from backend.api.runs import router as runs_router
from backend.api.secrets import router as secrets_router
from backend.api.settings import router as settings_router
from backend.api.users import router as users_router
from backend.api.webhooks import router as webhooks_router
from backend.api.workflows import router as workflows_router
from backend.api.export_import import router as export_import_router
from backend.api.gitops import router as gitops_router
from backend.core.scheduler import start_scheduler, stop_scheduler
from backend.core.runner import init_host_paths
from backend.core import queue_manager
from backend.core.auth import auth_user_from_jwt, auth_user_from_run_token, auth_user_from_scoped_api_key, is_master_token
from backend import __version__
from backend.config import settings
from sqlmodel import Session

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

_RUNNER_ALLOWLIST = (
    ("GET", re.compile(r"^/api/blueprints/entries(?:/[^/]+)?$")),
    ("GET", re.compile(r"^/api/runs/[^/]+$")),
    ("POST", re.compile(r"^/api/runs/[^/]+/output$")),
    ("POST", re.compile(r"^/api/pybooks/[^/]+/run$")),
    ("POST", re.compile(r"^/api/blueprints/[^/]+/entries$")),
    ("PATCH", re.compile(r"^/api/blueprints/[^/]+/entries/[^/]+$")),
    ("DELETE", re.compile(r"^/api/blueprints/entries/[^/]+$")),
)

_SCOPE_RULES = (
    ("GET", re.compile(r"^/api/blueprints/entries(?:/[^/]+)?$"), "entries:read"),
    ("POST", re.compile(r"^/api/blueprints/[^/]+/entries$"), "entries:write"),
    ("PATCH", re.compile(r"^/api/blueprints/[^/]+/entries/[^/]+$"), "entries:write"),
    ("DELETE", re.compile(r"^/api/blueprints/entries/[^/]+$"), "entries:write"),
    ("GET", re.compile(r"^/api/blueprints(?:/[^/]+)?$"), "blueprints:read"),
    ("POST", re.compile(r"^/api/pybooks/[^/]+/run$"), "pybooks:trigger"),
    ("POST", re.compile(r"^/api/webhooks/[^/]+$"), "pybooks:trigger"),
    ("GET", re.compile(r"^/api/runs(?:/[^/]+)?$"), "runs:read"),
    ("GET", re.compile(r"^/api/runs/queue$"), "runs:read"),
)


def _scoped_can_access(user, method: str, path: str) -> bool:
    return any(method == allowed_method and pattern.fullmatch(path) and user.has_scope(scope)
               for allowed_method, pattern, scope in _SCOPE_RULES)


def _runner_can_access(method: str, path: str) -> bool:
    return any(method == allowed_method and pattern.fullmatch(path) for allowed_method, pattern in _RUNNER_ALLOWLIST)


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
    version=__version__,
    lifespan=lifespan,
    docs_url="/docs" if settings.PYLO_EXPOSE_DOCS else None,
    redoc_url="/redoc" if settings.PYLO_EXPOSE_DOCS else None,
    openapi_url="/openapi.json" if settings.PYLO_EXPOSE_DOCS else None,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def enforce_viewer_readonly(request: Request, call_next):
    """Block write operations (non-GET) for viewer-role JWT sessions."""
    path = request.url.path

    if request.method in ("GET", "HEAD", "OPTIONS"):
        api_key = request.headers.get("X-API-Token")
        if api_key and not is_master_token(api_key):
            runner = auth_user_from_run_token(api_key)
            if runner and not _runner_can_access(request.method, path):
                return JSONResponse(status_code=403, content={"detail": "Run token scope does not allow this operation"})
            if not runner:
                with Session(engine) as session:
                    scoped_user = auth_user_from_scoped_api_key(api_key, session)
                if scoped_user and not _scoped_can_access(scoped_user, request.method, path):
                    return JSONResponse(status_code=403, content={"detail": "API key scope does not allow this operation"})
        return await call_next(request)


    # Invitation accept endpoints are public
    if path.startswith("/api/auth/invite/"):
        return await call_next(request)

    # Explicitly allowed write paths (login, logout, change-password, etc.)
    if path in _WRITE_ALLOWLIST:
        return await call_next(request)

    api_key = request.headers.get("X-API-Token")
    if api_key:
        if is_master_token(api_key):
            return await call_next(request)
        runner = auth_user_from_run_token(api_key)
        if runner:
            if _runner_can_access(request.method, path):
                return await call_next(request)
            return JSONResponse(status_code=403, content={"detail": "Run token scope does not allow this operation"})
        with Session(engine) as session:
            scoped_user = auth_user_from_scoped_api_key(api_key, session)
        if scoped_user:
            if _scoped_can_access(scoped_user, request.method, path):
                return await call_next(request)
            return JSONResponse(status_code=403, content={"detail": "API key scope does not allow this operation"})

    token = request.cookies.get("pylo_token")
    if token:
        with Session(engine) as session:
            user = auth_user_from_jwt(token, session)
        if user and user.is_admin:
            return await call_next(request)
        if user and user.role == "viewer":
            return JSONResponse(status_code=403, content={"detail": "Viewers cannot perform write operations"})

    # No valid token at all — let the route's own auth dependency handle the 401
    return await call_next(request)


app.include_router(activity_router)
app.include_router(api_keys_router)
app.include_router(dashboard_router)
app.include_router(auth_router)
app.include_router(invitations_router)
app.include_router(blueprints_router)
app.include_router(pybooks_router)
app.include_router(runs_router)
app.include_router(secrets_router)
app.include_router(settings_router)
app.include_router(users_router)
app.include_router(webhooks_router)
app.include_router(workflows_router)
app.include_router(export_import_router)
app.include_router(gitops_router)


@app.get("/health")
async def health():
    return {"status": "ok", "service": "pylo-backend", "version": __version__}
