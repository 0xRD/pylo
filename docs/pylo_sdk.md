# pylo-sdk

Python client for the [Pylo](https://github.com/0xRD/pylo) automation
orchestration platform.

The same `pylo_sdk.py` module serves two roles:

- **Inside PyBooks** it is mounted into the runner container and imported as
  `pylo`, exposing helpers like `pylo.get_payload()`, `pylo.set_output()`, and
  `pylo.search_entries()`. These read the container environment Pylo injects.
- **From external scripts** it provides `PyloClient`, a self-contained REST
  client you configure with a base URL and API token. This is what ships as the
  pip-installable `pylo-sdk` package.

## Install

```bash
pip install pylo-sdk
# or, from a checkout of the Pylo repository:
pip install .
```

## Quick start

```python
from pylo_sdk import PyloClient

pylo = PyloClient("http://localhost:8000", "my-api-token")

# Full-text search over blueprint entries
entries = pylo.search_entries("malware", blueprint_id="bp-123")

# Fetch and update a single entry (blueprint_id is inferred when omitted)
entry = pylo.get_entry("entry-abc")
pylo.update_entry("entry-abc", {"status": "triaged"})

# Trigger a PyBook and wait for the result
run = pylo.run_pybook("pybook-xyz", {"ip": "1.2.3.4"}, wait=True)
print(run.status, run.ok, run.outputs)
```

Credentials also fall back to environment variables, so this works too:

```python
import os
os.environ["PYLO_API_URL"] = "http://localhost:8000"
os.environ["PYLO_API_TOKEN"] = "my-api-token"

from pylo_sdk import PyloClient
pylo = PyloClient()
```

## API

### `PyloClient(base_url=None, api_token=None, *, timeout=30.0, session=None)`

| Argument    | Default                   | Description                                   |
|-------------|---------------------------|-----------------------------------------------|
| `base_url`  | `$PYLO_API_URL`           | Backend URL, e.g. `http://localhost:8000`.    |
| `api_token` | `$PYLO_API_TOKEN`         | Sent as the `X-API-Token` header.             |
| `timeout`   | `30.0`                    | Default per-request timeout, in seconds.      |
| `session`   | new `requests.Session()`  | Inject a pre-configured session if you like.  |

**Methods**

- `search_entries(query, blueprint_id=None, limit=None) -> list`
- `get_entry(entry_id) -> dict`
- `update_entry(entry_id, fields, blueprint_id=None) -> dict`
- `run_pybook(pybook_id, payload=None, *, wait=False, timeout=300.0, poll_interval=2.0) -> RunResult`
- `get_run(run_id) -> RunResult`
- `wait_for_run(run_id, *, timeout=300.0, poll_interval=2.0) -> RunResult`

### `RunResult`

A `dict` subclass (the raw run JSON) with convenience accessors:

- `.status` — via `run["status"]`
- `.outputs` — parsed `output_vars` dict (populated by `pylo.set_output()`)
- `.ok` — `True` when `status == "success"`
- `.finished` — `True` when the run reached a terminal status

Terminal statuses: `success`, `error`, `timeout`, `cancelled`, `dead_letter`
(exported as `pylo_sdk.TERMINAL_STATUSES`).

### Errors

- `PyloError` — raised on any non-2xx API response; carries `.status_code` and
  the underlying `.response`.
- `TimeoutError` — raised by `wait_for_run` / `run_pybook(wait=True)` when the
  run does not finish within `timeout`.

## Scopes

When using a **scoped API key** rather than the master token, the key needs the
relevant scopes: `entries:read` (search/get), `entries:write` (update),
`pybooks:trigger` (run), and `runs:read` (get/wait).

## Requirements

Python 3.9+ and `requests`.
