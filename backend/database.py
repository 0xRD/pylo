import logging

from sqlalchemy import text
from sqlalchemy.engine import make_url
from sqlalchemy.pool import NullPool
from sqlmodel import SQLModel, create_engine, Session, select

from backend.config import settings

# Import all models so SQLModel.metadata sees every table
from backend.pybooks.models import PyBook, PyBookRun, PyBookVersion  # noqa: F401
from backend.objects.models import Blueprint, Entry            # noqa: F401
from backend.secrets.models import Secret                      # noqa: F401
from backend.core.settings_model import SystemSetting         # noqa: F401
from backend.users.models import User, ApiKey                  # noqa: F401
from backend.users.invitation import Invitation                # noqa: F401
from backend.activity.models import ActivityEvent             # noqa: F401
from backend.workflows.models import Workflow, WorkflowRun, WorkflowNodeRun  # noqa: F401

logger = logging.getLogger(__name__)


def database_dialect_name(url: str | None = None) -> str:
    return make_url(url or settings.DATABASE_URL).get_backend_name()


def is_sqlite_url(url: str | None = None) -> bool:
    return database_dialect_name(url) == "sqlite"


def is_postgres_url(url: str | None = None) -> bool:
    return database_dialect_name(url) in {"postgresql", "postgres"}


def engine_kwargs(url: str | None = None) -> dict:
    if is_sqlite_url(url):
        # NullPool prevents pool exhaustion when many PyBook runs compete with
        # HTTP handlers against the same SQLite file.
        return {"connect_args": {"check_same_thread": False}, "poolclass": NullPool}
    return {"pool_pre_ping": True}


engine = create_engine(settings.DATABASE_URL, **engine_kwargs(settings.DATABASE_URL))


def init_search_index(bind) -> None:
    dialect = bind.dialect.name
    if dialect == "sqlite":
        bind.execute(text("""
            CREATE VIRTUAL TABLE IF NOT EXISTS fts_entries
            USING fts5(
                entry_id UNINDEXED,
                blueprint_id UNINDEXED,
                content,
                tokenize='porter ascii'
            )
        """))
    elif dialect == "postgresql":
        bind.execute(text("""
            CREATE TABLE IF NOT EXISTS fts_entries (
                entry_id TEXT PRIMARY KEY,
                blueprint_id TEXT NOT NULL,
                content TEXT NOT NULL
            )
        """))
        bind.execute(text("CREATE INDEX IF NOT EXISTS ix_fts_entries_blueprint ON fts_entries (blueprint_id)"))
        bind.execute(text("""
            CREATE INDEX IF NOT EXISTS ix_fts_entries_content_fts
            ON fts_entries USING GIN (to_tsvector('simple', coalesce(content, '')))
        """))


def rotate_legacy_secret_ciphertexts() -> None:
    from backend.core.crypto import decrypt_with_rotation_status, encrypt

    rotated = 0
    with Session(engine) as session:
        for secret in session.exec(select(Secret)).all():
            plain, used_legacy_key = decrypt_with_rotation_status(secret.encrypted_value)
            if used_legacy_key:
                secret.encrypted_value = encrypt(plain)
                session.add(secret)
                rotated += 1
        if rotated:
            session.commit()
            logger.info("Rotated %s legacy secret ciphertext(s)", rotated)


def init_db() -> None:
    SQLModel.metadata.create_all(engine)
    with engine.connect() as conn:
        init_search_index(conn)
        conn.commit()
    rotate_legacy_secret_ciphertexts()
    logger.info("Database initialised (%s)", engine.dialect.name)


def get_session():
    with Session(engine) as session:
        yield session


def get_session_ctx():
    return Session(engine)
