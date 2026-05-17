import base64
import hashlib
from functools import lru_cache
from cryptography.fernet import Fernet
from cryptography.fernet import InvalidToken
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
from backend.config import settings

_APP_SALT = b"pylo-secret-encryption-v2"
_PBKDF2_ITERATIONS = 600_000


@lru_cache(maxsize=8)
def _pbkdf2_fernet(secret: str) -> Fernet:
    kdf = PBKDF2HMAC(
        algorithm=hashes.SHA256(),
        length=32,
        salt=_APP_SALT,
        iterations=_PBKDF2_ITERATIONS,
    )
    fernet_key = base64.urlsafe_b64encode(kdf.derive(secret.encode()))
    return Fernet(fernet_key)


@lru_cache(maxsize=8)
def _legacy_fernet(secret: str) -> Fernet:
    key_bytes = hashlib.sha256(secret.encode()).digest()
    return Fernet(base64.urlsafe_b64encode(key_bytes))


def _get_fernet() -> Fernet:
    if not settings.ENCRYPTION_KEY:
        raise RuntimeError("ENCRYPTION_KEY is required for secret encryption")
    return _pbkdf2_fernet(settings.ENCRYPTION_KEY)


def encrypt(value: str) -> str:
    return _get_fernet().encrypt(value.encode()).decode()


def decrypt_with_rotation_status(token: str) -> tuple[str, bool]:
    try:
        return _get_fernet().decrypt(token.encode()).decode(), False
    except InvalidToken:
        plain = _legacy_fernet(settings.SECRET_KEY).decrypt(token.encode()).decode()
        return plain, True


def decrypt(token: str) -> str:
    plain, _ = decrypt_with_rotation_status(token)
    return plain


def resolve_secret_templates(text: str, secrets_map: dict[str, str]) -> str:
    """Replace {{secret:name}} placeholders with decrypted values."""
    import re
    def replacer(m):
        name = m.group(1)
        return secrets_map.get(name, m.group(0))
    return re.sub(r'\{\{secret:([^}]+)\}\}', replacer, text)
