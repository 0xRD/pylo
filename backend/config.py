from pydantic_settings import BaseSettings, SettingsConfigDict


INSECURE_DEFAULT = "change_me_in_production"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    PYLO_ENV: str = "production"
    PYLO_ALLOW_INSECURE_DEFAULTS: bool = False
    PYLO_ALLOW_DEPRECATED_SQLITE: bool = False

    DATABASE_URL: str = "postgresql+psycopg://pylo:pylo_change_me@postgres:5432/pylo"
    SECRET_KEY: str
    API_TOKEN: str

    DOCKER_NETWORK: str = "pylo_pylo_default"
    PYLO_BASE_IMAGE: str = "pylo-runner-base:2026.05"
    PYLO_TIMEOUT_SECONDS: int = 300
    PYLO_MAX_CONCURRENT_RUNS: int = 5
    PYLO_MEM_LIMIT: str = "256m"
    PYLO_CPU_QUOTA: int = 50000
    PYLO_RUN_TOKEN_TTL_SECONDS: int = 900

    # Host-side paths for Docker-out-of-Docker volume mounts (auto-detected at startup)
    PYBOOKS_HOST_PATH: str = "/app/pybooks_storage"
    PYLO_SDK_HOST_PATH: str = "/app/pylo_sdk.py"

    PYLO_ALLOWED_ORIGINS: str = "http://localhost:3000,http://127.0.0.1:3000"
    PYLO_EXPOSE_DOCS: bool = False
    PYLO_ALLOW_PRIVATE_FETCH: bool = False
    PYLO_COOKIE_SECURE: bool = False

    GIT_REMOTE_URL: str = ""
    GIT_USERNAME: str = ""
    GIT_TOKEN: str = ""

    JWT_EXPIRE_HOURS: int = 24

    # Dependency allowlist: comma-separated package names (empty = allow all)
    PYLO_ALLOWED_PACKAGES: str = ""
    # Optional trusted pip index URL (empty = use default PyPI)
    PYLO_PIP_INDEX_URL: str = ""

    MCP_ENABLED: bool = False
    MCP_AUTH_TOKEN: str = "change_me"

    def validate_security(self) -> None:
        if self.PYLO_ALLOW_INSECURE_DEFAULTS or self.PYLO_ENV.lower() in {"dev", "development", "test"}:
            return
        insecure = []
        if self.SECRET_KEY == INSECURE_DEFAULT or len(self.SECRET_KEY) < 32:
            insecure.append("SECRET_KEY")
        if self.API_TOKEN == INSECURE_DEFAULT or len(self.API_TOKEN) < 32:
            insecure.append("API_TOKEN")
        if insecure:
            names = ", ".join(insecure)
            raise RuntimeError(f"Refusing to start with insecure production secret settings: {names}")

    def validate_database(self) -> None:
        if self.DATABASE_URL.startswith("sqlite") and not self.PYLO_ALLOW_DEPRECATED_SQLITE:
            raise RuntimeError("SQLite DATABASE_URL is deprecated. Use Postgres or set PYLO_ALLOW_DEPRECATED_SQLITE=true for temporary local recovery only.")
        if self.PYLO_ENV.lower() not in {"dev", "development", "test"}:
            weak_markers = ("pylo_change_me", "change_this_password")
            if any(marker in self.DATABASE_URL for marker in weak_markers):
                raise RuntimeError("Refusing to start with placeholder Postgres credentials in DATABASE_URL")

    @property
    def allowed_origins(self) -> list[str]:
        return [origin.strip() for origin in self.PYLO_ALLOWED_ORIGINS.split(",") if origin.strip()]


settings = Settings()
settings.validate_database()
settings.validate_security()
