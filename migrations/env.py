import os
from logging.config import fileConfig

from sqlalchemy import pool
from sqlmodel import SQLModel

from alembic import context

# Import all models so their metadata is populated
import backend.objects.models  # noqa
import backend.pybooks.models  # noqa
import backend.secrets.models  # noqa

config = context.config

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = SQLModel.metadata

EXCLUDE_TABLES = {"fts_objects", "fts_objects_content", "fts_objects_data", "fts_objects_config", "fts_objects_idx", "fts_objects_docsize"}

def include_object(object, name, type_, reflected, compare_to):
    if type_ == "table" and name in EXCLUDE_TABLES:
        return False
    return True

# Override sqlalchemy.url from environment/settings
from backend.config import settings
config.set_main_option("sqlalchemy.url", settings.DATABASE_URL)


def run_migrations_offline() -> None:
    url = config.get_main_option("sqlalchemy.url")
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        render_as_batch=True,
            include_object=include_object,
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    from sqlalchemy import create_engine
    url = config.get_main_option("sqlalchemy.url")
    connectable = create_engine(url, connect_args={"check_same_thread": False}, poolclass=pool.NullPool)
    with connectable.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            render_as_batch=True,
            include_object=include_object,
        )
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
