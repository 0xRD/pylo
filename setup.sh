#!/usr/bin/env bash
# Pylo setup script — run once on a new machine after cloning.
set -euo pipefail

CYAN='\033[0;36m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

info()    { echo -e "${CYAN}[pylo]${NC} $*"; }
success() { echo -e "${GREEN}[pylo]${NC} $*"; }
warn()    { echo -e "${YELLOW}[pylo]${NC} $*"; }
die()     { echo -e "${RED}[pylo] ERROR:${NC} $*" >&2; exit 1; }

# ── 1. Verify we're in the project root ───────────────────────────────────────
[[ -f docker-compose.yml && -f .env.example ]] || die "Run this script from the Pylo project root directory."

# ── 2. Check / install Docker ─────────────────────────────────────────────────
if ! command -v docker &>/dev/null; then
    warn "Docker not found — installing via get.docker.com ..."
    curl -fsSL https://get.docker.com | sudo sh
    sudo usermod -aG docker "$USER"
    warn "Docker installed. You may need to log out and back in for the group change."
    warn "Re-run this script after logging back in if docker commands fail."
fi

if ! docker info &>/dev/null; then
    warn "Docker daemon not reachable as current user — trying with sudo ..."
    if ! sudo docker info &>/dev/null; then
        die "Cannot reach Docker daemon. Start it with: sudo systemctl start docker"
    fi
    warn "You may need to add yourself to the docker group: sudo usermod -aG docker \$USER"
fi

if ! docker compose version &>/dev/null; then
    die "docker compose plugin not found. Install Docker Desktop or 'sudo apt install docker-compose-plugin'."
fi

info "Docker $(docker --version | awk '{print $3}' | tr -d ',')"

# ── 3. Check git ──────────────────────────────────────────────────────────────
command -v git &>/dev/null || die "git is required. Install it with: sudo apt install git"

# ── 4. Generate .env ──────────────────────────────────────────────────────────
if [[ -f .env ]]; then
    warn ".env already exists — skipping generation. Delete it to regenerate."
else
    cp .env.example .env

    # Generate cryptographically secure secrets
    if command -v python3 &>/dev/null; then
        SECRET_KEY=$(python3 -c "import secrets; print(secrets.token_hex(32))")
        API_TOKEN=$(python3 -c "import secrets; print(secrets.token_urlsafe(32))")
        POSTGRES_PASSWORD=$(python3 -c "import secrets; print(secrets.token_urlsafe(32))")
    else
        die "python3 is required to generate secrets."
    fi

    # Inject into .env
    sed -i "s|SECRET_KEY=.*|SECRET_KEY=${SECRET_KEY}|" .env
    sed -i "s|API_TOKEN=.*|API_TOKEN=${API_TOKEN}|" .env
    sed -i "s|POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=${POSTGRES_PASSWORD}|" .env
    sed -i "s|DATABASE_URL=.*|DATABASE_URL=postgresql+psycopg://pylo:${POSTGRES_PASSWORD}@postgres:5432/pylo|" .env

    # Set PYBOOKS_HOST_PATH to the actual absolute path on this machine
    PYBOOKS_ABS="$(pwd)/pybooks_storage"
    sed -i "s|PYBOOKS_HOST_PATH=.*|PYBOOKS_HOST_PATH=${PYBOOKS_ABS}|" .env

    chmod 600 .env
    info "Generated .env with fresh secrets."
    echo ""
    echo "  API_TOKEN  = ${API_TOKEN}"
    echo ""
    warn "Save your API_TOKEN — you'll need it for SDK / script access."
    warn "SECRET_KEY was generated and stored in .env; it is not printed."
fi

chmod 600 .env

# ── 5. Create storage directories ─────────────────────────────────────────────
mkdir -p pybooks_storage
info "Storage directories ready."

# ── 6. Build the PyBook runner base image ─────────────────────────────────────
info "Building PyBook runner base image (pinned python:3.12.13-slim-trixie + requests/httpx/pydantic) ..."
docker build -q -t pylo-runner-base:2026.05 -f docker/pybook-runner/Dockerfile.base docker/pybook-runner/ \
    && success "pylo-runner-base:2026.05 built."

# ── 7. Start the stack ────────────────────────────────────────────────────────
info "Starting Pylo stack ..."
docker compose up -d --build

# ── 8. Wait for the backend to be healthy ────────────────────────────────────
info "Waiting for backend ..."
RETRIES=40
until curl -sf http://localhost:8000/health >/dev/null 2>&1; do
    RETRIES=$((RETRIES - 1))
    if [[ $RETRIES -le 0 ]]; then
        die "Backend did not become healthy in time.\nCheck logs: docker compose logs backend"
    fi
    sleep 3
done

# ── Done ─────────────────────────────────────────────────────────────────────
echo ""
success "=== Pylo is running! ==="
echo ""
echo "  Frontend : http://localhost:3000"
echo "  API docs : http://localhost:8000/docs"
echo "  API token: $(grep ^API_TOKEN .env | cut -d= -f2)"
echo ""
echo "  Open http://localhost:3000 in your browser to create the first admin account."
echo ""
