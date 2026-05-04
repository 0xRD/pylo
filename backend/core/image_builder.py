import hashlib
import io
import json
import logging
import tarfile
import threading

import docker
from docker.errors import BuildError, ImageNotFound
from packaging.requirements import InvalidRequirement, Requirement

logger = logging.getLogger(__name__)

# Per-image-tag lock: prevents duplicate Docker builds when multiple runs
# for the same PyBook start simultaneously before the image exists.
_build_locks: dict[str, threading.Lock] = {}
_build_locks_mutex = threading.Lock()


def _get_build_lock(image_tag: str) -> threading.Lock:
    with _build_locks_mutex:
        if image_tag not in _build_locks:
            _build_locks[image_tag] = threading.Lock()
        return _build_locks[image_tag]


def _validate_dependency(dep: str) -> str:
    dep = dep.strip()
    if not dep or "\n" in dep or "\r" in dep:
        raise ValueError("Invalid dependency specifier")
    try:
        parsed = Requirement(dep)
    except InvalidRequirement as exc:
        raise ValueError(f"Invalid dependency specifier: {dep}") from exc
    if parsed.url:
        raise ValueError("Direct URL dependencies are not allowed")
    # Allowlist check: if PYLO_ALLOWED_PACKAGES is set, only those packages are permitted
    from backend.config import settings
    if settings.PYLO_ALLOWED_PACKAGES:
        allowed = {p.strip().lower() for p in settings.PYLO_ALLOWED_PACKAGES.split(",") if p.strip()}
        if parsed.name.lower() not in allowed:
            raise ValueError(
                f"Package '{parsed.name}' is not in the allowed packages list. "
                f"Contact your administrator to add it."
            )
    return dep


def _build_context(dockerfile: str, requirements: str) -> io.BytesIO:
    buffer = io.BytesIO()
    with tarfile.open(fileobj=buffer, mode="w") as tf:
        dockerfile_bytes = dockerfile.encode()
        dockerfile_info = tarfile.TarInfo("Dockerfile")
        dockerfile_info.size = len(dockerfile_bytes)
        tf.addfile(dockerfile_info, io.BytesIO(dockerfile_bytes))

        req_bytes = requirements.encode()
        req_info = tarfile.TarInfo("requirements.txt")
        req_info.size = len(req_bytes)
        tf.addfile(req_info, io.BytesIO(req_bytes))
    buffer.seek(0)
    return buffer


def get_deps_hash(dependencies: list[str]) -> str:
    return hashlib.sha256(json.dumps(sorted(dependencies)).encode()).hexdigest()[:12]


def ensure_image(pybook_id: str, dependencies: list[str]) -> str:
    """
    Returns the image tag for this PyBook's dependency set.
    Builds the image if it doesn't exist yet; reuses cached image otherwise.
    Per-tag locking prevents concurrent duplicate builds.
    """
    from backend.config import settings

    client = docker.from_env()
    deps_hash = get_deps_hash(dependencies)
    image_tag = f"pylo-runner-{pybook_id}:{deps_hash}"

    # Fast path: image already exists
    try:
        client.images.get(image_tag)
        logger.info("Reusing cached image %s", image_tag)
        return image_tag
    except ImageNotFound:
        pass

    # Slow path: build under a per-tag lock so concurrent callers don't
    # all kick off duplicate builds for the same image.
    lock = _get_build_lock(image_tag)
    with lock:
        # Re-check inside the lock in case another thread just built it.
        try:
            client.images.get(image_tag)
            logger.info("Reusing cached image %s (built by concurrent caller)", image_tag)
            return image_tag
        except ImageNotFound:
            pass

        validated_deps = [_validate_dependency(dep) for dep in dependencies]
        requirements = "\n".join(validated_deps) + ("\n" if validated_deps else "")

        pip_flags = "--no-cache-dir"
        if settings.PYLO_PIP_INDEX_URL:
            pip_flags += f" --index-url {settings.PYLO_PIP_INDEX_URL} --trusted-host {settings.PYLO_PIP_INDEX_URL.split('/')[2]}"

        dockerfile = f"FROM {settings.PYLO_BASE_IMAGE}\n"
        if validated_deps:
            dockerfile += "COPY requirements.txt /tmp/requirements.txt\n"
            dockerfile += f"RUN pip install {pip_flags} -r /tmp/requirements.txt\n"

        logger.info("Building image %s (deps: %s)", image_tag, ", ".join(validated_deps) or "none")
        try:
            client.images.build(
                fileobj=_build_context(dockerfile, requirements),
                custom_context=True,
                tag=image_tag,
                rm=True,
            )
        except BuildError as exc:
            logger.error("Image build failed for %s: %s", image_tag, exc)
            raise

    return image_tag


def cleanup_unused_images(pybook_id: str, current_tag: str) -> None:
    """Remove stale images for a PyBook when deps change."""
    client = docker.from_env()
    prefix = f"pylo-runner-{pybook_id}:"
    for image in client.images.list():
        for tag in image.tags:
            if tag.startswith(prefix) and tag != current_tag:
                try:
                    client.images.remove(tag, force=False)
                    logger.info("Removed stale image %s", tag)
                except Exception as exc:
                    logger.warning("Could not remove image %s: %s", tag, exc)
