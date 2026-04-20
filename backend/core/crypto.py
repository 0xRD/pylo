import base64
import hashlib
from cryptography.fernet import Fernet
from backend.config import settings


def _get_fernet() -> Fernet:
    # Derive a 32-byte URL-safe base64 key from SECRET_KEY
    key_bytes = hashlib.sha256(settings.SECRET_KEY.encode()).digest()
    fernet_key = base64.urlsafe_b64encode(key_bytes)
    return Fernet(fernet_key)


def encrypt(value: str) -> str:
    return _get_fernet().encrypt(value.encode()).decode()


def decrypt(token: str) -> str:
    return _get_fernet().decrypt(token.encode()).decode()


def resolve_secret_templates(text: str, secrets_map: dict[str, str]) -> str:
    """Replace {{secret:name}} placeholders with decrypted values."""
    import re
    def replacer(m):
        name = m.group(1)
        return secrets_map.get(name, m.group(0))
    return re.sub(r'\{\{secret:([^}]+)\}\}', replacer, text)
