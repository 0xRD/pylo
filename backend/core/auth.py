from fastapi import HTTPException, Security
from fastapi.security import APIKeyHeader

from backend.config import settings

_api_key_header = APIKeyHeader(name="X-API-Token", auto_error=False)


def verify_token(api_key: str = Security(_api_key_header)) -> str:
    if api_key is None or api_key != settings.API_TOKEN:
        raise HTTPException(status_code=401, detail="Unauthorized")
    return api_key
