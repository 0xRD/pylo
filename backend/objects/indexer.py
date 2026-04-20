import logging
from sqlalchemy import text
from sqlmodel import Session

logger = logging.getLogger(__name__)


def index_instance(session: Session, instance_id: str, object_type_id: str, content: str) -> None:
    """Insert or replace an instance's text content in the FTS5 index."""
    # Delete any existing entry first (FTS5 has no upsert)
    session.exec(
        text("DELETE FROM fts_objects WHERE instance_id = :id"),
        params={"id": instance_id},
    )
    session.exec(
        text(
            "INSERT INTO fts_objects(instance_id, object_type_id, content) "
            "VALUES (:id, :type_id, :content)"
        ),
        params={"id": instance_id, "type_id": object_type_id, "content": content},
    )


def remove_from_index(session: Session, instance_id: str) -> None:
    session.exec(
        text("DELETE FROM fts_objects WHERE instance_id = :id"),
        params={"id": instance_id},
    )


def search_fts(
    session: Session,
    query: str,
    object_type_id: str | None = None,
    limit: int = 50,
    offset: int = 0,
) -> list[str]:
    """
    Full-text search. Returns a list of instance_ids ordered by BM25 rank.
    """
    if object_type_id:
        sql = text(
            "SELECT instance_id FROM fts_objects "
            "WHERE fts_objects MATCH :query AND object_type_id = :type_id "
            "ORDER BY rank LIMIT :limit OFFSET :offset"
        )
        rows = session.exec(
            sql,
            params={"query": query, "type_id": object_type_id, "limit": limit, "offset": offset},
        ).fetchall()
    else:
        sql = text(
            "SELECT instance_id FROM fts_objects "
            "WHERE fts_objects MATCH :query "
            "ORDER BY rank LIMIT :limit OFFSET :offset"
        )
        rows = session.exec(
            sql,
            params={"query": query, "limit": limit, "offset": offset},
        ).fetchall()

    return [row[0] for row in rows]
