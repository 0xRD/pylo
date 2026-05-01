"""
Workflow DAG validator.

Checks:
  - Empty workflow (no nodes)
  - Broken edges (source/target reference unknown node IDs)
  - Cycles (topological sort via Kahn's algorithm)
  - Missing PyBook (node references a deleted PyBook)
  - Inactive PyBook (node references a PyBook with is_active=False)

Returns a list of error dicts:
  { type: str, message: str, node_id?: str }
Empty list = valid.
"""
import json
from collections import defaultdict, deque

from sqlmodel import Session

from backend.pybooks.models import PyBook


def validate_dag(nodes_json: str, edges_json: str, session: Session) -> list[dict]:
    errors: list[dict] = []

    try:
        nodes: list[dict] = json.loads(nodes_json or "[]")
        edges: list[dict] = json.loads(edges_json or "[]")
    except Exception:
        return [{"type": "parse_error", "message": "Invalid nodes or edges JSON"}]

    # ── 1. Empty workflow ─────────────────────────────────────────────────────
    if not nodes:
        return [{"type": "empty", "message": "Workflow has no nodes"}]

    node_ids = {n["id"] for n in nodes}

    # ── 2. Broken edge references ─────────────────────────────────────────────
    for edge in edges:
        # Support both "source"/"target" and "from"/"to" field names
        src = edge.get("source") or edge.get("from")
        tgt = edge.get("target") or edge.get("to")
        if src and src not in node_ids:
            errors.append({
                "type": "broken_edge",
                "message": f"Edge source '{src}' does not match any node",
            })
        if tgt and tgt not in node_ids:
            errors.append({
                "type": "broken_edge",
                "message": f"Edge target '{tgt}' does not match any node",
            })

    # ── 3. Cycle detection (Kahn's algorithm) ─────────────────────────────────
    in_degree: dict[str, int] = {n["id"]: 0 for n in nodes}
    adj: dict[str, list[str]] = defaultdict(list)
    for edge in edges:
        src = edge.get("source") or edge.get("from")
        tgt = edge.get("target") or edge.get("to")
        if src in in_degree and tgt in in_degree:
            adj[src].append(tgt)
            in_degree[tgt] += 1

    queue: deque[str] = deque(nid for nid, deg in in_degree.items() if deg == 0)
    visited = 0
    while queue:
        nid = queue.popleft()
        visited += 1
        for neighbor in adj[nid]:
            in_degree[neighbor] -= 1
            if in_degree[neighbor] == 0:
                queue.append(neighbor)

    if visited != len(nodes):
        errors.append({
            "type": "cycle",
            "message": "Workflow contains a circular dependency — check for loops between nodes",
        })

    # ── 4. PyBook checks ──────────────────────────────────────────────────────
    for node in nodes:
        pb_id = node.get("pybookId")
        node_id = node.get("id")
        label = node.get("label") or node_id or "?"

        if not pb_id:
            errors.append({
                "type": "missing_pybook",
                "message": f"Node \"{label}\" has no PyBook assigned",
                "node_id": node_id,
            })
            continue

        pb = session.get(PyBook, pb_id)
        if not pb:
            errors.append({
                "type": "missing_pybook",
                "message": f"Node \"{label}\": PyBook was deleted",
                "node_id": node_id,
            })
        elif not pb.is_active:
            errors.append({
                "type": "inactive_pybook",
                "message": f"Node \"{label}\": PyBook \"{pb.name}\" is inactive",
                "node_id": node_id,
            })

    return errors
