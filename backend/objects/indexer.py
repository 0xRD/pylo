import logging
from sqlalchemy import text
from sqlmodel import Session

logger = logging.getLogger(__name__)


def index_entry(session: Session, entry_id: str, blueprint_id: str, content: str) -> None:
    """Insert or replace an entry's text content in the FTS5 index."""
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


def search_fts(
    session: Session,
    query: str,
    blueprint_id: str | None = None,
    limit: int = 50,
    offset: int = 0,
) -> list[str]:
    """Full-text search. Returns a list of entry_ids ordered by BM25 rank."""
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
