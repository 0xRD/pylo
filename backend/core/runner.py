import json
import logging
import os
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import docker
from docker.errors import APIError, ImageNotFound, NotFound
from docker.types import LogConfig

from backend.config import settings
from backend.core.auth import create_run_token
from backend.core.image_builder import ensure_image

logger = logging.getLogger(__name__)
# Queue manager enforces the live concurrency limit. Keep the executor wide
# enough for the settings API cap so it does not become a hidden lower limit.
_executor = ThreadPoolExecutor(max_workers=max(settings.PYLO_MAX_CONCURRENT_RUNS, 50))

# Stored stdout/stderr are capped per stream; the tail is kept because that is
# where the error usually is.
MAX_OUTPUT_BYTES = 1_000_000
_LIVE_LOG_INTERVAL = 1.0
_POLL_INTERVAL = 0.25
EGRESS_PROXY_PORT = 8001

# Resolved once at startup — derived from the container's own mounts (DooD)
_host_pybooks_path: str | None = None
_host_pylo_sdk_path: str | None = None


class RunTimeout(TimeoutError):
    """Raised when a PyBook exceeds its time limit. Carries the output captured so far."""

    def __init__(self, message: str, stdout: str = "", stderr: str = ""):
        super().__init__(message)
        self.stdout = stdout
        self.stderr = stderr


def container_name(run_id: str) -> str:
    return f"pylo-run-{run_id}"


def _detect_host_paths() -> tuple[str, str]:
    """
    Inspect this container's own bind mounts to find host-side paths.
    Required for Docker-out-of-Docker: the daemon mounts from the host FS.
    Falls back to settings values if detection fails.
    """
    try:
        client = docker.from_env()
        hostname = os.environ.get("HOSTNAME", "")
        container = client.containers.get(hostname)
        pybooks_host = settings.PYBOOKS_HOST_PATH
        sdk_host = settings.PYLO_SDK_HOST_PATH

        for mount in container.attrs.get("Mounts", []):
            dest = mount.get("Destination", "")
            src = mount.get("Source", "")
            if dest == "/app/pybooks_storage":
                pybooks_host = src
            elif dest == "/app/pylo_sdk.py":
                sdk_host = src

        logger.info("Host paths detected — pybooks: %s  sdk: %s", pybooks_host, sdk_host)
        return pybooks_host, sdk_host
    except Exception as exc:
        logger.warning("Could not auto-detect host paths (%s) — using config values", exc)
        return settings.PYBOOKS_HOST_PATH, settings.PYLO_SDK_HOST_PATH


def init_host_paths() -> None:
    global _host_pybooks_path, _host_pylo_sdk_path
    _host_pybooks_path, _host_pylo_sdk_path = _detect_host_paths()
    cleanup_orphan_containers()


def _collect_secrets(pybook_id: str, run_id: str, required_secrets: list[str]) -> dict[str, str]:
    if not required_secrets:
        return {}
    from backend.activity.logger import log_activity
    from backend.core.crypto import decrypt
    from backend.database import engine
    from backend.secrets.models import Secret
    from sqlmodel import Session, select

    env = {}
    injected_names = []
    with Session(engine) as session:
        for name in required_secrets:
            secret = session.exec(select(Secret).where(Secret.name == name)).first()
            if secret:
                env[f"SECRET_{name}"] = decrypt(secret.encrypted_value)
                injected_names.append(name)
            else:
                logger.warning("PyBook %s references a secret that was not found — skipping injection", pybook_id)
        if injected_names:
            log_activity(
                session,
                "secret.accessed",
                actor=f"pybook:{pybook_id}",
                resource_type="pybook_run",
                resource_id=run_id,
                resource_name=pybook_id,
                detail={"secret_names": injected_names},
            )
            session.commit()
    return env


def network_settings(network_policy: str, run_token: str) -> tuple[dict, dict]:
    """Return (docker run kwargs, extra environment) for a PyBook network policy.

    - ``none``: no network interface at all (the SDK cannot reach Pylo either).
    - ``allowlisted``: an internal Docker network with no route to the outside.
      The only way out is Pylo's egress proxy, which authenticates the run and
      only connects to that PyBook's allowed hosts.
    - anything else (``default``): the runner egress network, which reaches the
      internet and the Pylo API but not the database.
    """
    if network_policy == "none":
        return {"network_mode": "none"}, {}
    if network_policy == "allowlisted":
        proxy = f"http://pylo:{run_token}@backend:{EGRESS_PROXY_PORT}"
        no_proxy = "backend,localhost,127.0.0.1"
        env = {
            "HTTP_PROXY": proxy, "HTTPS_PROXY": proxy, "ALL_PROXY": proxy,
            "http_proxy": proxy, "https_proxy": proxy, "all_proxy": proxy,
            "NO_PROXY": no_proxy, "no_proxy": no_proxy,
        }
        return {"network": settings.PYLO_RUNNER_INTERNAL_NETWORK}, env
    return {"network": settings.DOCKER_NETWORK}, {}


def _truncate(text: str) -> str:
    raw = text.encode("utf-8", errors="replace")
    if len(raw) <= MAX_OUTPUT_BYTES:
        return text
    kept = raw[-MAX_OUTPUT_BYTES:].decode("utf-8", errors="replace")
    return f"[output truncated: showing the last {MAX_OUTPUT_BYTES // 1000} kB]\n{kept}"


def _read_logs(container, tail: int | str = "all") -> tuple[str, str]:
    out = container.logs(stdout=True, stderr=False, tail=tail)
    err = container.logs(stdout=False, stderr=True, tail=tail)
    return (
        _truncate(out.decode("utf-8", errors="replace")),
        _truncate(err.decode("utf-8", errors="replace")),
    )


def _store_live_output(run_id: str, stdout: str, stderr: str) -> None:
    """Persist partial output so the run console can show logs while the run is active."""
    from backend.database import engine
    from backend.pybooks.models import PyBookRun
    from sqlmodel import Session

    try:
        with Session(engine) as session:
            run = session.get(PyBookRun, run_id)
            if run and run.status == "running":
                run.stdout = stdout
                run.stderr = stderr
                session.add(run)
                session.commit()
    except Exception as exc:  # live logs are best-effort
        logger.debug("Could not store live output for run %s: %s", run_id, exc)


def _instance_label() -> str:
    # Several Pylo stacks can share one Docker daemon; the runner network name is per stack.
    return settings.DOCKER_NETWORK


def cleanup_orphan_containers() -> int:
    """Remove run containers left behind by a previous backend process.

    Runs interrupted by a restart are marked as failed by the queue manager;
    their containers must not keep running (or pile up) on the Docker host.
    """
    removed = 0
    try:
        client = docker.from_env()
        for container in client.containers.list(all=True, filters={"label": f"pylo.instance={_instance_label()}"}):
            _remove_container(container)
            removed += 1
    except Exception as exc:
        logger.warning("Could not clean up leftover run containers: %s", exc)
    if removed:
        logger.warning("Removed %d leftover run container(s) from a previous backend process", removed)
    return removed


def _run_was_cancelled(run_id: str) -> bool:
    from backend.database import engine
    from backend.pybooks.models import PyBookRun
    from sqlmodel import Session

    try:
        with Session(engine) as session:
            run = session.get(PyBookRun, run_id)
            return bool(run and run.status == "cancelled")
    except Exception:
        return False


def kill_run(run_id: str) -> bool:
    """Kill the container of an active run. Returns True if a container was killed."""
    try:
        client = docker.from_env()
        client.containers.get(container_name(run_id)).kill()
        return True
    except NotFound:
        return False
    except Exception as exc:
        logger.warning("Could not kill container for run %s: %s", run_id, exc)
        return False


def _remove_container(container) -> None:
    try:
        container.remove(force=True)
    except NotFound:
        pass
    except Exception as exc:
        logger.warning("Could not remove container %s: %s", getattr(container, "name", "?"), exc)


def _run_container_sync(
    pybook_id: str,
    run_id: str,
    dependencies: list[str],
    required_secrets: list[str],
    trigger_payload: dict,
    network_policy: str = "default",
    allowed_hosts: list[str] | None = None,
    timeout: int | None = None,
) -> tuple[str, str, int]:
    client = docker.from_env()
    image_tag = ensure_image(pybook_id, dependencies)

    pybooks_path = _host_pybooks_path or settings.PYBOOKS_HOST_PATH
    sdk_path = _host_pylo_sdk_path or settings.PYLO_SDK_HOST_PATH

    host_script = str(Path(pybooks_path) / pybook_id / "main.py")

    secret_env = _collect_secrets(pybook_id, run_id, required_secrets)
    run_token = create_run_token(run_id, pybook_id)
    network_kwargs, network_env = network_settings(network_policy, run_token)
    environment = {
        "PYLO_RUN_ID": run_id,
        "PYLO_PYBOOK_ID": pybook_id,
        "TRIGGER_PAYLOAD": json.dumps(trigger_payload),
        "PYLO_API_URL": "http://backend:8000",
        "PYLO_API_TOKEN": run_token,
        "PYLO_RUN_TOKEN": run_token,
        "PYTHONUNBUFFERED": "1",
        **network_env,
        **secret_env,
    }

    volumes = {
        host_script: {"bind": "/pybook/main.py", "mode": "ro"},
        sdk_path: {"bind": "/pybook/pylo_sdk.py", "mode": "ro"},
    }

    name = container_name(run_id)
    # A retry reuses the run id: clear any leftover container from the previous attempt.
    try:
        _remove_container(client.containers.get(name))
    except NotFound:
        pass

    # The image build above can take a while: honour a cancel that arrived meanwhile.
    if _run_was_cancelled(run_id):
        return "", "", -1

    timeout = timeout or settings.PYLO_TIMEOUT_SECONDS
    try:
        container = client.containers.run(
            image=image_tag,
            command=["python", "/pybook/main.py"],
            name=name,
            labels={"pylo.run_id": run_id, "pylo.pybook_id": pybook_id, "pylo.instance": _instance_label()},
            volumes=volumes,
            environment=environment,
            mem_limit=settings.PYLO_MEM_LIMIT,
            cpu_quota=settings.PYLO_CPU_QUOTA,
            cap_drop=["ALL"],
            security_opt=["no-new-privileges:true"],
            pids_limit=128,
            read_only=True,
            tmpfs={"/tmp": "rw,nosuid,nodev,size=64m"},
            user="1000:1000",
            # Bound what a noisy script can write to the Docker host's disk.
            log_config=LogConfig(type="json-file", config={"max-size": "5m", "max-file": "1"}),
            detach=True,
            **network_kwargs,
        )
    except (ImageNotFound, APIError) as exc:
        logger.error("Docker error running pybook %s: %s", pybook_id, exc)
        raise

    try:
        deadline = time.monotonic() + timeout
        next_live = time.monotonic() + _LIVE_LOG_INTERVAL
        last_live: tuple[str, str] | None = None
        while True:
            container.reload()
            if container.status in ("exited", "dead"):
                break
            now = time.monotonic()
            if now >= deadline:
                try:
                    container.kill()
                except APIError:
                    pass  # exited between the status check and the kill
                stdout, stderr = _read_logs(container)
                raise RunTimeout(f"PyBook {pybook_id} timed out after {timeout}s", stdout, stderr)
            if now >= next_live:
                live = _read_logs(container, tail=2000)
                if live != last_live:
                    _store_live_output(run_id, *live)
                    last_live = live
                next_live = now + _LIVE_LOG_INTERVAL
            time.sleep(_POLL_INTERVAL)

        exit_code = int(container.attrs.get("State", {}).get("ExitCode", -1))
        stdout, stderr = _read_logs(container)
        if container.attrs.get("State", {}).get("OOMKilled"):
            stderr += f"\n[Killed: the PyBook exceeded its memory limit of {settings.PYLO_MEM_LIMIT}]"
        return stdout, stderr, exit_code
    finally:
        _remove_container(container)


async def run_pybook(
    pybook_id: str,
    run_id: str,
    script_path: str,
    dependencies: list[str],
    required_secrets: list[str],
    trigger_payload: dict,
    network_policy: str = "default",
    allowed_hosts: list[str] | None = None,
) -> tuple[str, str, int]:
    """Run a PyBook container to completion.

    The time limit is enforced next to the container (it is killed and removed
    on expiry), so a timed-out run never keeps consuming resources.
    """
    import asyncio
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(
        _executor,
        _run_container_sync,
        pybook_id, run_id,
        dependencies, required_secrets, trigger_payload,
        network_policy, allowed_hosts, settings.PYLO_TIMEOUT_SECONDS,
    )
