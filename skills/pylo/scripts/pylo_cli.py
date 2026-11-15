#!/usr/bin/env python3
"""Small, dependency-free command line client for the Pylo API.

Written for LLM agents (and humans) that need to build and run automations
without the web UI. Standard library only; every command prints JSON.

Configuration (environment variables):
  PYLO_URL        Base URL of the Pylo backend or frontend proxy.
                  Default: http://localhost:8000
  PYLO_API_TOKEN  The API_TOKEN from Pylo's .env (admin access). Required.

Run `pylo_cli.py --help` for the list of commands.
"""
import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

TERMINAL = {"success", "error", "timeout", "cancelled", "dead_letter"}


class ApiError(Exception):
    def __init__(self, status: int, detail):
        super().__init__(f"HTTP {status}: {detail}")
        self.status = status
        self.detail = detail


def api(method: str, path: str, body=None, params: dict | None = None):
    base = os.environ.get("PYLO_URL", "http://localhost:8000").rstrip("/")
    token = os.environ.get("PYLO_API_TOKEN", "")
    if not token:
        raise SystemExit("PYLO_API_TOKEN is not set (use the API_TOKEN value from Pylo's .env file)")
    url = f"{base}/api{path}"
    if params:
        url += "?" + urllib.parse.urlencode({k: v for k, v in params.items() if v is not None}, doseq=True)
    request = urllib.request.Request(
        url,
        method=method,
        data=json.dumps(body).encode() if body is not None else None,
        headers={"X-API-Token": token, "Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(request, timeout=120) as response:
            raw = response.read()
            return json.loads(raw) if raw else None
    except urllib.error.HTTPError as exc:
        raw = exc.read().decode(errors="replace")
        try:
            detail = json.loads(raw).get("detail", raw)
        except ValueError:
            detail = raw
        raise ApiError(exc.code, detail) from None
    except urllib.error.URLError as exc:
        raise SystemExit(f"Cannot reach Pylo at {base}: {exc.reason}")


def out(value) -> None:
    print(json.dumps(value, indent=2, default=str))


def read_text(value: str) -> str:
    """`@path` reads a file, `-` reads stdin, anything else is used as-is."""
    if value == "-":
        return sys.stdin.read()
    if value.startswith("@"):
        with open(value[1:], encoding="utf-8") as fh:
            return fh.read()
    return value


def read_json(value: str | None, default):
    if value is None:
        return default
    try:
        return json.loads(read_text(value))
    except ValueError as exc:
        raise SystemExit(f"Invalid JSON: {exc}")


def json_text(value) -> str:
    """Pylo stores list/object settings as JSON strings."""
    return value if isinstance(value, str) else json.dumps(value)


def find(kind: str, ref: str) -> dict:
    """Resolve a PyBook / workflow / blueprint by id or exact name."""
    items = api("GET", f"/{kind}")
    matches = [i for i in items if i["id"] == ref] or [i for i in items if i["name"] == ref]
    if not matches:
        raise SystemExit(f"No {kind[:-1]} with id or name {ref!r}")
    if len(matches) > 1:
        raise SystemExit(f"Several {kind} are named {ref!r}; use the id: {[m['id'] for m in matches]}")
    return matches[0]


def wait_pybook_run(run_id: str, timeout: float) -> dict:
    deadline = time.time() + timeout
    while True:
        run = api("GET", f"/runs/{run_id}")
        if run["status"] in TERMINAL:
            return run
        if time.time() > deadline:
            raise SystemExit(f"Run {run_id} is still {run['status']} after {timeout:.0f}s "
                             f"(cancel it with: cancel-run {run_id})")
        time.sleep(1)


def summarize_run(run: dict) -> dict:
    try:
        outputs = json.loads(run.get("output_vars") or "{}")
    except ValueError:
        outputs = {}
    return {
        "run_id": run["id"], "status": run["status"], "exit_code": run.get("exit_code"),
        "duration_ms": run.get("duration_ms"), "outputs": outputs,
        "stdout": run.get("stdout", ""), "stderr": run.get("stderr", ""),
    }


# ── PyBooks ──────────────────────────────────────────────────────────────────

def cmd_list_pybooks(args):
    out([{k: p[k] for k in ("id", "name", "description", "trigger_type", "is_active", "network_policy")}
         for p in api("GET", "/pybooks")])


def cmd_get_pybook(args):
    out(find("pybooks", args.pybook))


def pybook_fields(args) -> dict:
    fields = {}
    if args.script is not None:
        fields["script"] = read_text(args.script)
    for name in ("description", "trigger_type", "network_policy"):
        if getattr(args, name, None) is not None:
            fields[name] = getattr(args, name)
    for name in ("dependencies", "required_secrets", "allowed_hosts", "tags", "trigger_config"):
        value = getattr(args, name, None)
        if value is not None:
            fields[name] = json_text(read_json(value, None))
    return fields


def cmd_create_pybook(args):
    out(api("POST", "/pybooks", {"name": args.name, **pybook_fields(args)}))


def cmd_update_pybook(args):
    pybook = find("pybooks", args.pybook)
    fields = pybook_fields(args)
    if args.name is not None:
        fields["name"] = args.name
    if args.message and "script" in fields:
        fields["commit_message"] = args.message
    if not fields:
        raise SystemExit("Nothing to update")
    out(api("PUT", f"/pybooks/{pybook['id']}", fields))


def cmd_delete_pybook(args):
    api("DELETE", f"/pybooks/{find('pybooks', args.pybook)['id']}")
    out({"deleted": True})


def cmd_run_pybook(args):
    pybook = find("pybooks", args.pybook)
    run = api("POST", f"/pybooks/{pybook['id']}/run", {"trigger_payload": read_json(args.payload, {})})
    if args.no_wait:
        out({"run_id": run["id"], "status": run["status"]})
        return
    result = summarize_run(wait_pybook_run(run["id"], args.timeout))
    out(result)
    if result["status"] != "success":
        sys.exit(1)


def cmd_get_run(args):
    out(summarize_run(api("GET", f"/runs/{args.run_id}")))


def cmd_cancel_run(args):
    out(api("DELETE", f"/runs/{args.run_id}"))


def cmd_list_runs(args):
    params = {"limit": args.limit, "include_output": "false"}
    if args.pybook:
        params["pybook_id"] = find("pybooks", args.pybook)["id"]
    if args.status:
        params["status"] = args.status
    out([{k: r.get(k) for k in ("id", "pybook_id", "status", "trigger_source", "started_at", "duration_ms")}
         for r in api("GET", "/runs", params=params)])


# ── Workflows ────────────────────────────────────────────────────────────────

def resolve_workflow_definition(definition: dict) -> dict:
    """Accept `pybook` (name or id) on nodes and turn it into `pybookId`."""
    nodes = definition.get("nodes", [])
    edges = definition.get("edges", [])
    if isinstance(nodes, str):
        nodes = json.loads(nodes)
    if isinstance(edges, str):
        edges = json.loads(edges)
    pybooks = None
    for node in nodes:
        node.setdefault("type", "pybook")
        ref = node.pop("pybook", None)
        if node["type"] == "pybook" and ref and not node.get("pybookId"):
            pybooks = pybooks if pybooks is not None else api("GET", "/pybooks")
            matches = [p for p in pybooks if p["id"] == ref] or [p for p in pybooks if p["name"] == ref]
            if len(matches) != 1:
                raise SystemExit(f"Node {node.get('id')!r}: no single PyBook named {ref!r}")
            node["pybookId"] = matches[0]["id"]
            node.setdefault("label", matches[0]["name"])
        node.setdefault("label", node.get("id"))
    for index, edge in enumerate(edges):
        edge.setdefault("id", f"e{index + 1}")
        edge.setdefault("condition", "always")
        edge.setdefault("mappings", [])
    body = {k: definition[k] for k in ("name", "description", "is_active", "trigger_type") if k in definition}
    if "trigger_config" in definition:
        body["trigger_config"] = json_text(definition["trigger_config"])
    body["nodes"] = json.dumps(nodes)
    body["edges"] = json.dumps(edges)
    return body


def cmd_list_workflows(args):
    out([{k: w[k] for k in ("id", "name", "description", "trigger_type", "is_active")} for w in api("GET", "/workflows")])


def cmd_get_workflow(args):
    workflow = find("workflows", args.workflow)
    workflow["nodes"] = json.loads(workflow["nodes"] or "[]")
    workflow["edges"] = json.loads(workflow["edges"] or "[]")
    out(workflow)


def cmd_save_workflow(args):
    definition = read_json(args.definition, None)
    if not isinstance(definition, dict) or not definition.get("name"):
        raise SystemExit("The definition must be a JSON object with at least a name")
    body = resolve_workflow_definition(definition)
    existing = [w for w in api("GET", "/workflows") if w["name"] == definition["name"]]
    if existing:
        workflow = api("PUT", f"/workflows/{existing[0]['id']}", body)
    else:
        workflow = api("POST", "/workflows", body)
    validation = api("GET", f"/workflows/{workflow['id']}/validate")
    out({"id": workflow["id"], "name": workflow["name"], "updated": bool(existing), **validation})
    if not validation["valid"]:
        sys.exit(1)


def cmd_validate_workflow(args):
    result = api("GET", f"/workflows/{find('workflows', args.workflow)['id']}/validate")
    out(result)
    if not result["valid"]:
        sys.exit(1)


def cmd_delete_workflow(args):
    api("DELETE", f"/workflows/{find('workflows', args.workflow)['id']}")
    out({"deleted": True})


def workflow_run_report(workflow_id: str, run_id: str) -> dict:
    detail = api("GET", f"/workflows/{workflow_id}/runs/{run_id}")
    nodes = []
    for node_run in detail["node_runs"]:
        item = {k: node_run.get(k) for k in ("node_id", "node_label", "node_type", "status", "duration_ms", "pybook_name")}
        try:
            item["outputs"] = json.loads(node_run.get("output_vars") or "{}")
        except ValueError:
            item["outputs"] = {}
        if node_run.get("pybook_run_id"):
            try:
                run = api("GET", f"/runs/{node_run['pybook_run_id']}")
                item["stdout"], item["stderr"] = run.get("stdout", ""), run.get("stderr", "")
            except ApiError:
                pass
        nodes.append(item)
    return {"run_id": detail["id"], "status": detail["status"], "duration_ms": detail["duration_ms"], "nodes": nodes}


def cmd_run_workflow(args):
    workflow = find("workflows", args.workflow)
    run = api("POST", f"/workflows/{workflow['id']}/run", {"trigger_payload": read_json(args.payload, {})})
    if args.no_wait:
        out({"run_id": run["id"], "status": run["status"]})
        return
    deadline = time.time() + args.timeout
    while True:
        detail = api("GET", f"/workflows/{workflow['id']}/runs/{run['id']}")
        if detail["status"] in TERMINAL:
            break
        if time.time() > deadline:
            raise SystemExit(f"Workflow run {run['id']} is still {detail['status']} after {args.timeout:.0f}s "
                             f"(cancel it with: cancel-workflow-run {run['id']})")
        time.sleep(1)
    report = workflow_run_report(workflow["id"], run["id"])
    out(report)
    if report["status"] != "success":
        sys.exit(1)


def cmd_get_workflow_run(args):
    out(workflow_run_report(find("workflows", args.workflow)["id"], args.run_id))


def cmd_cancel_workflow_run(args):
    out(api("POST", f"/workflows/runs/{args.run_id}/cancel"))


# ── Data and context ─────────────────────────────────────────────────────────

def cmd_list_blueprints(args):
    result = []
    for blueprint in api("GET", "/blueprints"):
        try:
            fields = [m.get("field_name") for m in json.loads(blueprint.get("field_mappings") or "[]")]
        except ValueError:
            fields = []
        result.append({"id": blueprint["id"], "name": blueprint["name"], "description": blueprint.get("description"),
                       "fields": fields, "mutable_mode": blueprint.get("mutable_mode"), "is_manual": blueprint.get("is_manual")})
    out(result)


def cmd_search_entries(args):
    params = {"q": args.query, "limit": args.limit}
    if args.blueprint:
        params["blueprint_id"] = find("blueprints", args.blueprint)["id"]
    data = api("GET", "/blueprints/entries", params=params)
    items = []
    for entry in data["items"]:
        try:
            fields = json.loads(entry["data"])
        except ValueError:
            fields = {}
        items.append({"id": entry["id"], "blueprint_id": entry["blueprint_id"], "fields": fields})
    out({"total": data["total"], "items": items})


def cmd_list_secrets(args):
    out([{"name": s["name"], "description": s.get("description")} for s in api("GET", "/secrets")])


def cmd_status(args):
    out({"queue": api("GET", "/runs/queue"),
         "pybooks": len(api("GET", "/pybooks")), "workflows": len(api("GET", "/workflows")),
         "blueprints": len(api("GET", "/blueprints"))})


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="command", required=True)

    def add(name, func, help_text):
        command = sub.add_parser(name, help=help_text)
        command.set_defaults(func=func)
        return command

    def pybook_options(command, with_name_option):
        if with_name_option:
            command.add_argument("--name", help="new name")
        command.add_argument("--script", help="Python source, @file to read a file, or - for stdin")
        command.add_argument("--description")
        command.add_argument("--dependencies", help='JSON list of pip requirements, e.g. \'["pyyaml==6.0.2"]\'')
        command.add_argument("--required-secrets", dest="required_secrets", help='JSON list of secret names')
        command.add_argument("--network-policy", dest="network_policy", choices=["default", "allowlisted", "none"])
        command.add_argument("--allowed-hosts", dest="allowed_hosts", help='JSON list of hostnames (allowlisted policy)')
        command.add_argument("--tags", help="JSON list of tags")
        command.add_argument("--trigger-type", dest="trigger_type", choices=["manual", "cron", "webhook", "blueprint"])
        command.add_argument("--trigger-config", dest="trigger_config", help="JSON object, e.g. '{\"cron\": \"0 * * * *\"}'")

    add("status", cmd_status, "queue load and object counts (also a connectivity check)")
    add("list-pybooks", cmd_list_pybooks, "list PyBooks")
    add("get-pybook", cmd_get_pybook, "show one PyBook with its script").add_argument("pybook")
    command = add("create-pybook", cmd_create_pybook, "create a PyBook")
    command.add_argument("name")
    pybook_options(command, with_name_option=False)
    command = add("update-pybook", cmd_update_pybook, "change a PyBook (only the given options)")
    command.add_argument("pybook")
    pybook_options(command, with_name_option=True)
    command.add_argument("--message", help="change description stored in the script history")
    add("delete-pybook", cmd_delete_pybook, "delete a PyBook and its runs").add_argument("pybook")
    command = add("run-pybook", cmd_run_pybook, "run a PyBook and print status, outputs and logs")
    command.add_argument("pybook")
    command.add_argument("--payload", help="JSON object, @file or -")
    command.add_argument("--no-wait", action="store_true")
    command.add_argument("--timeout", type=float, default=600)
    add("get-run", cmd_get_run, "status, outputs and logs of a PyBook run").add_argument("run_id")
    add("cancel-run", cmd_cancel_run, "cancel a queued or running PyBook run").add_argument("run_id")
    command = add("list-runs", cmd_list_runs, "recent PyBook runs")
    command.add_argument("--pybook")
    command.add_argument("--status", action="append", help="repeatable: queued, running, success, error, timeout, cancelled")
    command.add_argument("--limit", type=int, default=20)

    add("list-workflows", cmd_list_workflows, "list workflows")
    add("get-workflow", cmd_get_workflow, "show a workflow with parsed nodes and edges").add_argument("workflow")
    add("save-workflow", cmd_save_workflow,
        "create or update (by name) a workflow from a JSON definition, then validate it").add_argument(
        "definition", help="JSON object, @file or -")
    add("validate-workflow", cmd_validate_workflow, "check a workflow graph").add_argument("workflow")
    add("delete-workflow", cmd_delete_workflow, "delete a workflow and its runs").add_argument("workflow")
    command = add("run-workflow", cmd_run_workflow, "run a workflow and print the per-node results")
    command.add_argument("workflow")
    command.add_argument("--payload", help="JSON object, @file or -")
    command.add_argument("--no-wait", action="store_true")
    command.add_argument("--timeout", type=float, default=900)
    command = add("get-workflow-run", cmd_get_workflow_run, "per-node results of a workflow run")
    command.add_argument("workflow")
    command.add_argument("run_id")
    add("cancel-workflow-run", cmd_cancel_workflow_run, "cancel a workflow run").add_argument("run_id")

    add("list-blueprints", cmd_list_blueprints, "data sources and their field names")
    command = add("search-entries", cmd_search_entries, "search entries (field filters and full text)")
    command.add_argument("query")
    command.add_argument("--blueprint")
    command.add_argument("--limit", type=int, default=20)
    add("list-secrets", cmd_list_secrets, "secret names (values are never returned)")
    return parser


def main() -> None:
    args = build_parser().parse_args()
    try:
        args.func(args)
    except ApiError as exc:
        print(json.dumps({"error": exc.detail, "http_status": exc.status}, indent=2), file=sys.stderr)
        sys.exit(2)


if __name__ == "__main__":
    main()
