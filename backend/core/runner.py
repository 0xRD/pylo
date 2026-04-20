import json
import logging
import os
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path

import docker
from docker.errors import ContainerError, ImageNotFound, APIError

from backend.config import settings
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


def _collect_secrets(required_secrets: list[str]) -> dict[str, str]:
    if not required_secrets:
        return {}
    from backend.core.crypto import decrypt
    from backend.database import engine
    from backend.secrets.models import Secret
    from sqlmodel import Session, select

    env = {}
    with Session(engine) as session:
        for name in required_secrets:
            secret = session.exec(select(Secret).where(Secret.name == name)).first()
            if secret:
                env[f"SECRET_{name}"] = decrypt(secret.encrypted_value)
            else:
                logger.warning("Secret '%s' not found — skipping injection", name)
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

    secret_env = _collect_secrets(required_secrets)
    environment = {
        "PYLO_RUN_ID": run_id,
        "PYLO_PYBOOK_ID": pybook_id,
        "TRIGGER_PAYLOAD": json.dumps(trigger_payload),
        "PYLO_API_URL": "http://backend:8000",
        "PYLO_API_TOKEN": settings.API_TOKEN,
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
    loop = asyncio.get_event_loop()
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
