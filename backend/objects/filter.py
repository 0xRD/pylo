"""
Field-level query filter for Entry.data (parsed fields stored as JSON).

Syntax:  field_name OPERATOR "value"  [AND field_name OPERATOR "value" ...]

Operators:
  =           exact match (case-insensitive)
  !=          not equal (case-insensitive)
  contains    substring match (case-insensitive)
  starts_with prefix match (case-insensitive)
  >  >=  <  <= numeric comparison (values coerced to float)

Example:  severity = "high" AND category contains "Execute"
"""
import json
import re
from typing import Any

from sqlalchemy import func, cast
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.types import Float as SAFloat
from sqlmodel import select

_FIELD_RE = re.compile(r'^[a-zA-Z0-9_]{1,64}$')
_CONDITION_RE = re.compile(
    r'(\w+)\s+(=|!=|contains|starts_with|>=|<=|>|<)\s+"([^"]*)"',
    re.IGNORECASE,
)


def _parse_conditions(filter_expr: str) -> list[tuple[str, str, str]]:
    return [
        (m.group(1), m.group(2).lower(), m.group(3))
        for m in _CONDITION_RE.finditer(filter_expr)
        if _FIELD_RE.match(m.group(1))
    ]


def json_field_text(data_column, field: str, dialect_name: str = "sqlite"):
    if dialect_name == "postgresql":
        return cast(data_column, JSONB)[field].astext
    return func.json_extract(data_column, f'$.{field}')


def apply_field_filter(stmt, filter_expr: str, data_column, dialect_name: str = "sqlite"):
    """Add WHERE clauses to a SQLModel select statement using JSON field extraction."""
    for field, op, value in _parse_conditions(filter_expr):
        extracted = json_field_text(data_column, field, dialect_name)
        if op == '=':
            stmt = stmt.where(func.lower(extracted) == value.lower())
        elif op == '!=':
            stmt = stmt.where(func.lower(extracted) != value.lower())
        elif op == 'contains':
            stmt = stmt.where(func.lower(extracted).like(f'%{value.lower()}%'))
        elif op == 'starts_with':
            stmt = stmt.where(func.lower(extracted).like(f'{value.lower()}%'))
        elif op in ('>', '>=', '<', '<='):
            try:
                num = float(value)
                col_num = cast(extracted, SAFloat)
                if op == '>':   stmt = stmt.where(col_num > num)
                elif op == '>=': stmt = stmt.where(col_num >= num)
                elif op == '<':  stmt = stmt.where(col_num < num)
                elif op == '<=': stmt = stmt.where(col_num <= num)
            except ValueError:
                pass
    return stmt


def python_field_filter(entries: list, filter_expr: str) -> list:
    """Python-side filter used when entries are already loaded (e.g. from FTS)."""
    conditions = _parse_conditions(filter_expr)
    if not conditions:
        return entries

    result = []
    for entry in entries:
        try:
            data: dict[str, Any] = json.loads(entry.data)
        except Exception:
            continue
        if _matches_all(data, conditions):
            result.append(entry)
    return result


def _matches_all(data: dict, conditions: list[tuple[str, str, str]]) -> bool:
    for field, op, value in conditions:
        raw = data.get(field)
        field_val = str(raw) if raw is not None else ''
        if op == '=':
            if field_val.lower() != value.lower(): return False
        elif op == '!=':
            if field_val.lower() == value.lower(): return False
        elif op == 'contains':
            if value.lower() not in field_val.lower(): return False
        elif op == 'starts_with':
            if not field_val.lower().startswith(value.lower()): return False
        elif op in ('>', '>=', '<', '<='):
            try:
                fv, v = float(field_val), float(value)
                if op == '>' and not fv > v: return False
                elif op == '>=' and not fv >= v: return False
                elif op == '<' and not fv < v: return False
                elif op == '<=' and not fv <= v: return False
            except ValueError:
                return False
    return True


# ── Trigger conditions (structured dict format) ───────────────────────────────

_VALID_OPS = frozenset(('eq', 'ne', 'contains', 'starts_with', 'regex', 'gt', 'lt'))


def check_trigger_conditions(parsed: dict, conditions: list[dict]) -> bool:
    """Return True if parsed entry fields satisfy all trigger conditions (AND-logic).

    Each condition dict: {"field": str, "operator": str, "value": str}
    An empty conditions list always returns True (unconditional trigger).
    """
    for cond in conditions:
        field = cond.get("field", "")
        operator = cond.get("operator", "eq")
        value = str(cond.get("value", ""))
        if operator not in _VALID_OPS:
            return False  # unknown operator treated as non-match
        raw = parsed.get(field)
        field_val = str(raw) if raw is not None else ""
        if not _eval_condition(field_val, operator, value):
            return False
    return True


def _eval_condition(field_val: str, operator: str, value: str) -> bool:
    if operator == "eq":
        return field_val.lower() == value.lower()
    if operator == "ne":
        return field_val.lower() != value.lower()
    if operator == "contains":
        return value.lower() in field_val.lower()
    if operator == "starts_with":
        return field_val.lower().startswith(value.lower())
    if operator == "regex":
        try:
            return bool(re.search(value, field_val, re.IGNORECASE))
        except re.error:
            return False
    # numeric operators
    try:
        fv, v = float(field_val), float(value)
        if operator == "gt":
            return fv > v
        if operator == "lt":
            return fv < v
    except ValueError:
        return False
    return False
