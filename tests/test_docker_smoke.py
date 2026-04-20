"""
Step 2 smoke test: validate that the backend can spawn an ephemeral container
via the Docker SDK, capture its stdout, and confirm automatic removal.
"""
import uuid
import docker
import pytest


@pytest.fixture(scope="module")
def docker_client():
    return docker.from_env()


def test_docker_daemon_reachable(docker_client):
    """Docker daemon must be accessible."""
    info = docker_client.info()
    assert "ID" in info, "Expected Docker info to return an ID"


def test_spawn_container_capture_stdout(docker_client):
    """
    Spawn python:3.12-slim, run a simple print, capture stdout.
    The container must be removed automatically (remove=True).
    """
    expected = f"pylo-smoke-{uuid.uuid4().hex[:8]}"

    output = docker_client.containers.run(
        image="python:3.12-slim",
        command=["python3", "-c", f"print('{expected}')"],
        detach=False,
        remove=True,
        stdout=True,
        stderr=False,
    )

    stdout = output.decode("utf-8").strip()
    assert stdout == expected, f"Expected '{expected}', got '{stdout}'"


def test_container_auto_removed(docker_client):
    """
    After run with remove=True the container must not appear in `docker ps -a`.
    We track by a unique label to avoid collisions with other containers.
    """
    run_id = uuid.uuid4().hex

    docker_client.containers.run(
        image="python:3.12-slim",
        command=["python3", "-c", "import time; time.sleep(0)"],
        labels={"pylo-test-run-id": run_id},
        detach=False,
        remove=True,
    )

    # Container should not appear in ps -a
    remaining = docker_client.containers.list(
        all=True,
        filters={"label": f"pylo-test-run-id={run_id}"},
    )
    assert remaining == [], f"Container was not removed: {remaining}"


def test_exit_code_nonzero_propagated(docker_client):
    """A failing container must surface a non-zero exit code via ContainerError."""
    from docker.errors import ContainerError

    with pytest.raises(ContainerError) as exc_info:
        docker_client.containers.run(
            image="python:3.12-slim",
            command=["python3", "-c", "raise SystemExit(42)"],
            detach=False,
            remove=True,
        )

    assert exc_info.value.exit_status == 42


def test_stderr_captured(docker_client):
    """stderr output must be captured separately."""
    from docker.errors import ContainerError

    try:
        docker_client.containers.run(
            image="python:3.12-slim",
            command=["python3", "-c", "import sys; sys.stderr.write('err-output\\n'); raise SystemExit(1)"],
            detach=False,
            remove=True,
            stderr=True,
        )
    except ContainerError as e:
        assert e.stderr is not None
        assert b"err-output" in e.stderr
