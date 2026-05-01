import logging
from sqlalchemy import text
from sqlmodel import Session

logger = logging.getLogger(__name__)


def _dialect(session: Session) -> str:
    return session.get_bind().dialect.name


def index_entry(session: Session, entry_id: str, blueprint_id: str, content: str) -> None:
    """Insert or replace an entry's searchable text content."""
    session.exec(
        text("DELETE FROM fts_entries WHERE entry_id = :id"),
        params={"id": entry_id},
    )
    session.exec(
        text(
            "INSERT INTO fts_entries(entry_id, blueprint_id, content) "
            "VALUES (:id, :blueprint_id, :content)"
        ),
        params={"id": entry_id, "blueprint_id": blueprint_id, "content": content},
    )


def remove_from_index(session: Session, entry_id: str) -> None:
    session.exec(
        text("DELETE FROM fts_entries WHERE entry_id = :id"),
        params={"id": entry_id},
    )


def count_fts(session: Session, query: str, blueprint_id: str | None = None) -> int:
    if _dialect(session) == "postgresql":
        where = "to_tsvector('simple', coalesce(content, '')) @@ plainto_tsquery('simple', :query)"
        params = {"query": query}
        if blueprint_id:
            where += " AND blueprint_id = :blueprint_id"
            params["blueprint_id"] = blueprint_id
        row = session.exec(text(f"SELECT count(*) FROM fts_entries WHERE {where}"), params=params).fetchone()
        return int(row[0]) if row else 0

    if blueprint_id:
        sql = text(
            "SELECT count(*) FROM fts_entries "
            "WHERE fts_entries MATCH :query AND blueprint_id = :blueprint_id"
        )
        row = session.exec(sql, params={"query": query, "blueprint_id": blueprint_id}).fetchone()
    else:
        row = session.exec(text("SELECT count(*) FROM fts_entries WHERE fts_entries MATCH :query"), params={"query": query}).fetchone()
    return int(row[0]) if row else 0


def search_fts(
    session: Session,
    query: str,
    blueprint_id: str | None = None,
    limit: int = 50,
    offset: int = 0,
) -> list[str]:
    """Full-text search. Returns a list of entry_ids ordered by rank."""
    if _dialect(session) == "postgresql":
        where = "to_tsvector('simple', coalesce(content, '')) @@ plainto_tsquery('simple', :query)"
        params = {"query": query, "limit": limit, "offset": offset}
        if blueprint_id:
            where += " AND blueprint_id = :blueprint_id"
            params["blueprint_id"] = blueprint_id
        sql = text(
            f"SELECT entry_id FROM fts_entries WHERE {where} "
            "ORDER BY ts_rank_cd(to_tsvector('simple', coalesce(content, '')), plainto_tsquery('simple', :query)) DESC "
            "LIMIT :limit OFFSET :offset"
        )
        rows = session.exec(sql, params=params).fetchall()
        return [row[0] for row in rows]

    if blueprint_id:
        sql = text(
            "SELECT entry_id FROM fts_entries "
            "WHERE fts_entries MATCH :query AND blueprint_id = :blueprint_id "
            "ORDER BY rank LIMIT :limit OFFSET :offset"
        )
        rows = session.exec(
            sql,
            params={"query": query, "blueprint_id": blueprint_id, "limit": limit, "offset": offset},
        ).fetchall()
    else:
        sql = text(
            "SELECT entry_id FROM fts_entries "
            "WHERE fts_entries MATCH :query "
            "ORDER BY rank LIMIT :limit OFFSET :offset"
        )
        rows = session.exec(
            sql,
            params={"query": query, "limit": limit, "offset": offset},
        ).fetchall()

    return [row[0] for row in rows]
