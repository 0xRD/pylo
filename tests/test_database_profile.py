from sqlalchemy.pool import NullPool

from backend.database import database_dialect_name, engine_kwargs, is_postgres_url, is_sqlite_url


def test_sqlite_engine_kwargs_keep_nullpool_and_check_same_thread():
    kwargs = engine_kwargs("sqlite:///./objects_storage/pylo.db")

    assert is_sqlite_url("sqlite:///./objects_storage/pylo.db")
    assert not is_postgres_url("sqlite:///./objects_storage/pylo.db")
    assert kwargs["connect_args"] == {"check_same_thread": False}
    assert kwargs["poolclass"] is NullPool


def test_postgres_engine_kwargs_use_pool_pre_ping_without_sqlite_args():
    url = "postgresql+psycopg://pylo:secret@postgres:5432/pylo"
    kwargs = engine_kwargs(url)

    assert database_dialect_name(url) == "postgresql"
    assert is_postgres_url(url)
    assert not is_sqlite_url(url)
    assert kwargs == {"pool_pre_ping": True}


def test_init_search_index_uses_postgres_fts_table_and_indexes():
    from backend.database import init_search_index

    statements = []

    class Dialect:
        name = "postgresql"

    class Bind:
        dialect = Dialect()

        def execute(self, stmt):
            statements.append(str(stmt))

    init_search_index(Bind())

    joined = "\n".join(statements)
    assert "CREATE TABLE IF NOT EXISTS fts_entries" in joined
    assert "USING GIN" in joined
    assert "to_tsvector" in joined


def test_json_field_text_compiles_for_postgres_jsonb():
    from sqlalchemy import column, select
    from sqlalchemy.dialects import postgresql
    from backend.objects.filter import json_field_text

    expr = select(json_field_text(column("data"), "severity", "postgresql"))
    compiled_obj = expr.compile(dialect=postgresql.dialect())
    compiled = str(compiled_obj)

    assert "->>" in compiled
    assert "severity" in compiled_obj.params.values()
