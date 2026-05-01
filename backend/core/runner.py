import json
import logging
import os
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path

import docker
from docker.errors import ContainerError, ImageNotFound, APIError

from backend.config import settings
from backend.core.auth import create_run_token
from backend.core.image_builder import ensure_image

logger = logging.getLogger(__name__)
_executor = ThreadPoolExecutor(max_workers=settings.PYLO_MAX_CONCURRENT_RUNS)

# Resolved once at startup — derived from the container's own mounts (DooD)
_host_pybooks_path: str | None = None
_host_pylo_sdk_path: str | None = None


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
                logger.warning("Secret '%s' not found — skipping injection", name)
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


def _run_container_sync(
    pybook_id: str,
    run_id: str,
    dependencies: list[str],
    required_secrets: list[str],
    trigger_payload: dict,
) -> tuple[str, str, int]:
    client = docker.from_env()
    image_tag = ensure_image(pybook_id, dependencies)

    pybooks_path = _host_pybooks_path or settings.PYBOOKS_HOST_PATH
    sdk_path = _host_pylo_sdk_path or settings.PYLO_SDK_HOST_PATH

    host_script = str(Path(pybooks_path) / pybook_id / "main.py")

    secret_env = _collect_secrets(pybook_id, run_id, required_secrets)
    run_token = create_run_token(run_id, pybook_id)
    environment = {
        "PYLO_RUN_ID": run_id,
        "PYLO_PYBOOK_ID": pybook_id,
        "TRIGGER_PAYLOAD": json.dumps(trigger_payload),
        "PYLO_API_URL": "http://backend:8000",
        "PYLO_API_TOKEN": run_token,
        "PYLO_RUN_TOKEN": run_token,
        **secret_env,
    }

    volumes = {
        host_script: {"bind": "/pybook/main.py", "mode": "ro"},
        sdk_path: {"bind": "/pybook/pylo_sdk.py", "mode": "ro"},
    }

    try:
        output = client.containers.run(
            image=image_tag,
            command=["python", "/pybook/main.py"],
            volumes=volumes,
            environment=environment,
            network=settings.DOCKER_NETWORK,
            mem_limit=settings.PYLO_MEM_LIMIT,
            cpu_quota=settings.PYLO_CPU_QUOTA,
            cap_drop=["ALL"],
            security_opt=["no-new-privileges:true"],
            pids_limit=128,
            read_only=True,
            tmpfs={"/tmp": "rw,nosuid,nodev,size=64m"},
            user="1000:1000",
            detach=False,
            remove=True,
            stdout=True,
            stderr=True,
        )
        return output.decode("utf-8", errors="replace"), "", 0
    except ContainerError as exc:
        stderr = exc.stderr.decode("utf-8", errors="replace") if exc.stderr else ""
        return "", stderr, exc.exit_status
    except (ImageNotFound, APIError) as exc:
        logger.error("Docker error running pybook %s: %s", pybook_id, exc)
        raise


async def run_pybook(
    pybook_id: str,
    run_id: str,
    script_path: str,
    dependencies: list[str],
    required_secrets: list[str],
    trigger_payload: dict,
) -> tuple[str, str, int]:
    import asyncio
    loop = asyncio.get_running_loop()
    try:
        return await asyncio.wait_for(
            loop.run_in_executor(
                _executor,
                _run_container_sync,
                pybook_id, run_id,
                dependencies, required_secrets, trigger_payload,
            ),
            timeout=settings.PYLO_TIMEOUT_SECONDS,
        )
    except asyncio.TimeoutError:
        raise TimeoutError(f"PyBook {pybook_id} timed out after {settings.PYLO_TIMEOUT_SECONDS}s")
