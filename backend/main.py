import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from backend.database import init_db
from backend.api.objects import router as objects_router
from backend.api.pybooks import router as pybooks_router
from backend.api.runs import router as runs_router
from backend.api.secrets import router as secrets_router
from backend.api.webhooks import router as webhooks_router
from backend.core.scheduler import start_scheduler, stop_scheduler
from backend.core.runner import init_host_paths

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Starting Pylo backend...")
    init_db()
    init_host_paths()
    start_scheduler()
    yield
    stop_scheduler()
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

app.include_router(objects_router)
app.include_router(pybooks_router)
app.include_router(runs_router)
app.include_router(secrets_router)
app.include_router(webhooks_router)


@app.get("/health")
async def health():
    return {"status": "ok", "service": "pylo-backend"}
