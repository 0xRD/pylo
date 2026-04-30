import pytest
from fastapi import HTTPException

from backend.api.blueprints import _validate_fetch_url
from backend.core.auth import auth_user_from_run_token, create_run_token
from backend.core.image_builder import _validate_dependency


def test_run_token_decodes_as_runner_scope():
    token = create_run_token("run-123", "pybook-456")

    user = auth_user_from_run_token(token)

    assert user is not None
    assert user.role == "runner"
    assert user.run_id == "run-123"
    assert user.pybook_id == "pybook-456"


@pytest.mark.parametrize(
    "dependency",
    [
        "requests\nRUN touch /tmp/pwned",
        "requests @ https://example.com/pkg.tar.gz",
        "",
    ],
)
def test_dependency_validator_rejects_injection_primitives(dependency):
    with pytest.raises(ValueError):
        _validate_dependency(dependency)


def test_dependency_validator_accepts_normal_package_specifier():
    assert _validate_dependency("requests==2.32.3") == "requests==2.32.3"


@pytest.mark.parametrize("url", ["http://localhost:8000/health", "http://127.0.0.1:8000/health"])
def test_blueprint_fetch_blocks_local_targets(url):
    with pytest.raises(HTTPException) as exc:
        _validate_fetch_url(url)

    assert exc.value.status_code == 400
