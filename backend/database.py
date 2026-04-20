import logging
from sqlalchemy import text
from sqlmodel import SQLModel, create_engine, Session

from backend.config import settings

# Import all models so SQLModel.metadata sees every table
from backend.pybooks.models import PyBook, PyBookRun          # noqa: F401
from backend.objects.models import ObjectType, ObjectInstance  # noqa: F401
from backend.secrets.models import Secret                      # noqa: F401

logger = logging.getLogger(__name__)

engine = create_engine(
    settings.DATABASE_URL,
    connect_args={"check_same_thread": False},
)


def init_db() -> None:
    SQLModel.metadata.create_all(engine)
    with engine.connect() as conn:
        conn.execute(text("""
            CREATE VIRTUAL TABLE IF NOT EXISTS fts_objects
            USING fts5(
                instance_id UNINDEXED,
                object_type_id UNINDEXED,
                content,
                tokenize='porter ascii'
            )
        """))
        conn.commit()
    logger.info("Database initialised")


def get_session():
    with Session(engine) as session:
        yield session
