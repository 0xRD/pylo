"""Minimal example of using the standalone Pylo SDK from an external script.

Run it with the backend URL and an API token in the environment:

    export PYLO_API_URL=http://localhost:8000
    export PYLO_API_TOKEN=your-api-token
    python examples/pylo_sdk_example.py <pybook_id>
"""

import os
import sys

from pylo_sdk import PyloClient, PyloError


def main() -> int:
    pybook_id = sys.argv[1] if len(sys.argv) > 1 else None

    # base_url / api_token fall back to PYLO_API_URL / PYLO_API_TOKEN.
    pylo = PyloClient(
        base_url=os.environ.get("PYLO_API_URL"),
        api_token=os.environ.get("PYLO_API_TOKEN"),
    )

    try:
        entries = pylo.search_entries("", limit=5)
        print(f"Found {len(entries)} entries (showing up to 5):")
        for entry in entries[:5]:
            print(f"  - {entry.get('id')}: {entry.get('blueprint_id')}")

        if pybook_id:
            print(f"\nTriggering PyBook {pybook_id} and waiting for the result...")
            run = pylo.run_pybook(pybook_id, {"source": "sdk-example"}, wait=True)
            print(f"  run {run['id']} finished: status={run.status} ok={run.ok}")
            if run.outputs:
                print(f"  output vars: {run.outputs}")
    except PyloError as exc:
        print(f"API error ({exc.status_code}): {exc}", file=sys.stderr)
        return 1
    except TimeoutError as exc:
        print(f"Timed out: {exc}", file=sys.stderr)
        return 1

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
