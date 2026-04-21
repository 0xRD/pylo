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


def apply_field_filter(stmt, filter_expr: str, data_column):
    """Add WHERE clauses to a SQLModel select statement using SQLite json_extract."""
    for field, op, value in _parse_conditions(filter_expr):
        extracted = func.json_extract(data_column, f'$.{field}')
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
