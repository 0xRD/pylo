import logging
from datetime import datetime, timezone
from typing import Any

from jsonpath_ng import parse as jsonpath_parse

logger = logging.getLogger(__name__)

_FIELD_TYPES = {"string", "number", "boolean", "datetime"}


def _coerce(value: Any, field_type: str) -> Any:
    if value is None:
        return None
    if field_type == "string":
        return str(value)
    if field_type == "number":
        try:
            return float(value) if "." in str(value) else int(value)
        except (TypeError, ValueError):
            return value
    if field_type == "boolean":
        if isinstance(value, bool):
            return value
        return str(value).lower() in ("true", "1", "yes")
    if field_type == "datetime":
        if isinstance(value, datetime):
            return value.isoformat()
        try:
            # Try ISO 8601 first
            return datetime.fromisoformat(str(value)).isoformat()
        except ValueError:
            return str(value)
    return value


def parse_instance(raw_data: dict, field_mappings: list[dict]) -> dict:
    """
    Apply a list of JSONPath mappings to raw_data and return a dict of named fields.

    Each mapping: {"source_path": "$.data.id", "field_name": "external_id", "field_type": "string"}
    """
    result: dict[str, Any] = {}

    for mapping in field_mappings:
        source_path = mapping.get("source_path", "")
        field_name = mapping.get("field_name", "")
        field_type = mapping.get("field_type", "string")

        if not source_path or not field_name:
            continue
        if field_type not in _FIELD_TYPES:
            field_type = "string"

        try:
            expr = jsonpath_parse(source_path)
            matches = expr.find(raw_data)
            value = matches[0].value if matches else None
            result[field_name] = _coerce(value, field_type)
        except Exception as exc:
            logger.warning("JSONPath error for path '%s': %s", source_path, exc)
            result[field_name] = None

    return result


def extract_text_content(data: dict) -> str:
    """Flatten all string values from parsed data for FTS5 indexing."""
    parts = []
    for v in data.values():
        if v is not None:
            parts.append(str(v))
    return " ".join(parts)
