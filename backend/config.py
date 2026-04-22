from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    DATABASE_URL: str = "sqlite:///./objects_storage/pylo.db"
    SECRET_KEY: str = "change_me_in_production"
    API_TOKEN: str = "change_me_in_production"

    DOCKER_NETWORK: str = "pylo_pylo_default"
    PYLO_BASE_IMAGE: str = "pylo-runner-base:latest"
    PYLO_TIMEOUT_SECONDS: int = 300
    PYLO_MAX_CONCURRENT_RUNS: int = 5
    PYLO_MEM_LIMIT: str = "256m"
    PYLO_CPU_QUOTA: int = 50000

    # Host-side paths for Docker-out-of-Docker volume mounts (auto-detected at startup)
    PYBOOKS_HOST_PATH: str = "/app/pybooks_storage"
    PYLO_SDK_HOST_PATH: str = "/app/pylo_sdk.py"

    GIT_REMOTE_URL: str = ""
    GIT_USERNAME: str = ""
    GIT_TOKEN: str = ""

    JWT_EXPIRE_HOURS: int = 24

    MCP_ENABLED: bool = False
    MCP_AUTH_TOKEN: str = "change_me"


settings = Settings()
