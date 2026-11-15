---
name: pylo
description: Build, run and debug automations on a Pylo instance (Python automation orchestration - PyBooks, Workflows, Blueprints, Entries) through its API. Use when asked to create or change a PyBook or a Workflow in Pylo, automate something with Pylo, run or debug a Pylo run, or query Pylo entries.
---

# Pylo

Pylo runs Python scripts (**PyBooks**) in short-lived Docker containers and chains them into **Workflows**. **Blueprints** pull records from external APIs and store them as **Entries**.

Everything here goes through `scripts/pylo_cli.py` (Python 3.10+, standard library only). Every command prints JSON; a non-zero exit code means the command or the run failed.

## Setup

```bash
export PYLO_URL=http://localhost:8000      # backend, or http://<host>:3000 through the frontend proxy
export PYLO_API_TOKEN=...                  # API_TOKEN from Pylo's .env file
python3 scripts/pylo_cli.py status         # connectivity check: queue load and object counts
```

If `PYLO_API_TOKEN` is not set, ask the user for it. Never print it or write it into a script or a PyBook.

## Working method

Follow this loop. Do not hand a workflow to the user before step 5 passes.

1. **Look first**: `list-pybooks`, `list-blueprints` (shows field names), `list-secrets`, and `get-pybook <name>` for anything you plan to reuse. Reuse existing PyBooks when they fit.
2. **Write one PyBook per step** and test each one alone with `run-pybook --payload`. Fix it until it succeeds and its `outputs` are what the next step needs.
3. **Write the workflow definition** as a JSON file and save it with `save-workflow @file.json`. It validates the graph and prints the errors.
4. **Run it** with `run-workflow <name> --payload '{...}'`. The report lists every node with its status, outputs, stdout and stderr.
5. **Check the result**: overall status `success`, the nodes you expected ran, and the ones on the untaken branch are absent. Test each branch with a payload that takes it.

When a run fails, read `stderr` of the failing node, fix that PyBook with `update-pybook --script @file.py`, and run again.

## PyBooks

A PyBook is a plain Python script. The SDK module is available as `pylo_sdk`.

```python
import pylo_sdk as pylo

payload = pylo.get_payload()                 # dict: the run's input
ip = payload.get("ip", "")

print(f"checking {ip}")                      # stdout/stderr are the run logs

pylo.set_output("ip", ip)                    # outputs: what later workflow nodes can read
pylo.set_output("malicious", ip.startswith("203."))
```

Rules that matter:

- **Input** comes only from `pylo.get_payload()`. **Output** to other nodes goes only through `pylo.set_output(key, value)` (JSON-serialisable values). Printing is for logs, it is not passed on.
- **Fail loudly**: an uncaught exception or `sys.exit(1)` marks the run `error`, which is what `on_failure` edges react to. Do not catch an error and exit 0.
- **Packages**: `requests`, `httpx` and `pydantic` are preinstalled. Anything else goes in `--dependencies '["package==version"]'` (the first run builds an image and is slower).
- **Secrets**: never hard-code credentials. Use an existing secret name from `list-secrets`, declare it with `--required-secrets '["name"]'`, and read it as `os.environ["SECRET_name"]`. You cannot create or read secret values with this skill; ask the user to add missing ones in the UI.
- **Network**: `--network-policy default` (internet), `allowlisted` with `--allowed-hosts '["api.example.com"]'` (only those hosts; use for anything touching secrets), or `none` (no network, and then the SDK calls do not work either).
- **Limits**: 300 s per run by default, 256 MB of memory, read-only filesystem except `/tmp`.
- **SDK helpers**: `pylo.search_entries(query, blueprint_id)`, `pylo.get_entry(id)`, `pylo.create_entry(blueprint_id, fields)`, `pylo.update_entry(id, fields)`, `pylo.delete_entry(id)`, `pylo.call_sub_pybook(pybook_id, payload)` (queues another PyBook; it is not awaited).

```bash
python3 scripts/pylo_cli.py create-pybook "Check IP" --script @check_ip.py --description "Flags known-bad ranges"
python3 scripts/pylo_cli.py run-pybook "Check IP" --payload '{"ip": "203.0.113.9"}'
python3 scripts/pylo_cli.py update-pybook "Check IP" --script @check_ip.py --message "handle empty input"
```

PyBooks are addressed by name or id. Keep names unique.

## Workflows

A workflow is a directed graph without cycles. Save it from a JSON definition:

```json
{
  "name": "IP triage",
  "description": "Check an IP and alert when it is malicious",
  "trigger_type": "manual",
  "nodes": [
    {"id": "check",  "pybook": "Check IP"},
    {"id": "is_bad", "type": "condition", "label": "Malicious?",
     "config": {"conditions": [{"field": "malicious", "operator": "eq", "value": "true"}]}},
    {"id": "alert",  "pybook": "Send alert"}
  ],
  "edges": [
    {"from": "check", "to": "is_bad", "condition": "on_success",
     "mappings": [{"key": "malicious", "source": "$.vars.malicious"},
                  {"key": "ip", "source": "$.vars.ip"}]},
    {"from": "is_bad", "to": "alert", "condition": "true"}
  ]
}
```

`save-workflow` resolves `"pybook": "<name>"` to the PyBook id, fills in edge ids and canvas positions, creates the workflow or updates the one with the same name, and validates it.

### How data moves (read this carefully)

Each node receives one **payload** (a dict). Start nodes (no incoming edge) receive the trigger payload.

- An edge **without mappings** passes on the *payload the source node received*, unchanged. The source node's outputs are **not** included.
- An edge **with mappings** passes on that same payload plus one key per mapping. `source` is `$.vars.<name>` for an output set by the source node with `set_output`, `$.payload.<name>` for a key of the source node's own input, or any other text as a literal value.

So to hand a PyBook's result to the next node you must add a mapping with `$.vars.<output name>`. Forgetting it is the most common mistake: the next node then sees only the old payload.

A node with several incoming edges waits for all of them and receives the merged payloads of the edges that matched. If none matched it is skipped, and so is everything that depends only on it.

### Node types

| Type | Definition | Behaviour |
|---|---|---|
| `pybook` (default) | `{"id": "...", "pybook": "<name or id>"}`, optional `"retry_count": 0-5` | Runs the PyBook with the payload. Status `success`, `error` or `timeout`. |
| `condition` | `{"id": "...", "type": "condition", "config": {"conditions": [...]}}` | Evaluates all conditions (AND) against **its input payload**. Runs no code. |
| `loop` | `{"id": "...", "type": "loop", "config": {"items_path": "$.items"}}` | Reads a list from its input payload and runs the next nodes once per item. |

Condition entries are `{"field": "<payload key>", "operator": "...", "value": "..."}` with operators `eq`, `ne`, `contains`, `starts_with`, `regex`, `gt`, `lt`. Values are compared as text, case-insensitively (a Python `True` output matches `"true"`); `gt`/`lt` compare numbers. The field must be a top-level key of the payload, so map the value in on the incoming edge.

Loop targets receive the loop's payload plus `item` (the current element) and `loop_index`. `items_path` is `$.key` or `$.key.sub` in the loop's input payload, so map the list in on the incoming edge.

### Edge conditions

| `condition` | Follows the edge when |
|---|---|
| `always` (default) | the source node finished, whatever its status |
| `on_success` | the source node succeeded |
| `on_failure` | the source node ended in `error` or `timeout` |
| `true` / `false` | the source is a `condition` node and its result was true / false |
| `loop_item` | the source is a `loop` node (once per item) |

Use `on_success` between PyBook nodes unless the next step must also run after a failure. Use `true`/`false` only on edges leaving a condition node.

A workflow run is `success` only if no node ended in `error` or `timeout`. A failure handled by an `on_failure` branch still makes the run `error`.

### Triggers

`"trigger_type"` is `manual`, `cron`, `webhook` or `blueprint`, with `"trigger_config"`:

- `cron`: `{"cron": "0 8 * * 1"}` (5 fields, UTC)
- `webhook`: `{}`; callers `POST /api/webhooks/workflows/<workflow id>` with a JSON body that becomes the payload
- `blueprint`: `{"blueprint_id": "<id>", "trigger_event": "on_create" | "on_create_or_update", "trigger_conditions": [same format as condition nodes]}`; the payload is `{"blueprint_id", "entry_id", "entry_data": {<entry fields>}, "event_type"}`

Build and test with `manual` first, then switch the trigger with another `save-workflow`. New workflows are active by default; add `"is_active": false` to save without enabling a schedule.

## Entries

```bash
python3 scripts/pylo_cli.py list-blueprints
python3 scripts/pylo_cli.py search-entries 'severity = high AND score >= 80' --blueprint "Alerts"
```

Field filters: `=`, `!=`, `contains`, `starts_with`, `ends_with`, `>`, `>=`, `<`, `<=`. Full text: `a b`, `a OR b`, `a NOT b`, `"exact phrase"`, `prefix*`. Combine with `AND` / `OR`.

## Commands

| Command | Purpose |
|---|---|
| `status` | queue load and object counts |
| `list-pybooks`, `get-pybook <p>` | inspect PyBooks |
| `create-pybook <name> --script @f.py [...]`, `update-pybook <p> [...]`, `delete-pybook <p>` | manage PyBooks |
| `run-pybook <p> [--payload JSON] [--timeout s] [--no-wait]` | run and print status, outputs, logs |
| `get-run <id>`, `cancel-run <id>`, `list-runs [--pybook p] [--status s]` | PyBook runs |
| `list-workflows`, `get-workflow <w>` | inspect workflows |
| `save-workflow @def.json`, `validate-workflow <w>`, `delete-workflow <w>` | manage workflows |
| `run-workflow <w> [--payload JSON] [--timeout s] [--no-wait]` | run and print per-node results |
| `get-workflow-run <w> <id>`, `cancel-workflow-run <id>` | workflow runs |
| `list-blueprints`, `search-entries <query> [--blueprint b]`, `list-secrets` | context |

JSON arguments accept inline JSON, `@path/to/file` or `-` for stdin.

## Safety

- Deleting a PyBook or workflow also deletes its run history. Only delete what you created in this task, or what the user asked you to delete.
- Do not change PyBooks or workflows you did not create without telling the user what you are changing.
- Do not enable `cron`, `webhook` or `blueprint` triggers on something that sends messages, changes external systems or deletes data until the user has seen a successful manual run.
- Runs count against the instance's concurrency limit. Cancel runs you no longer need (`cancel-run`, `cancel-workflow-run`).
