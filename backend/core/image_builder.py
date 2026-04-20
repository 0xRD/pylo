import hashlib
import io
import json
import logging

import docker
from docker.errors import BuildError, ImageNotFound

logger = logging.getLogger(__name__)


def get_deps_hash(dependencies: list[str]) -> str:
    return hashlib.sha256(json.dumps(sorted(dependencies)).encode()).hexdigest()[:12]


def ensure_image(pybook_id: str, dependencies: list[str]) -> str:
    """
    Returns the image tag for this PyBook's dependency set.
    Builds the image if it doesn't exist yet; reuses cached image otherwise.
    """
    from backend.config import settings

    client = docker.from_env()
    deps_hash = get_deps_hash(dependencies)
    image_tag = f"pylo-runner-{pybook_id}:{deps_hash}"

    try:
        client.images.get(image_tag)
        logger.info("Reusing cached image %s", image_tag)
        return image_tag
    except ImageNotFound:
        pass

    pip_line = " ".join(dependencies) if dependencies else ""
    dockerfile = f"FROM {settings.PYLO_BASE_IMAGE}\n"
    if pip_line:
        dockerfile += f"RUN pip install --no-cache-dir {pip_line}\n"

    logger.info("Building image %s (deps: %s)", image_tag, pip_line or "none")
    try:
        client.images.build(
            fileobj=io.BytesIO(dockerfile.encode()),
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
