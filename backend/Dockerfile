FROM python:3.12.13-slim-trixie@sha256:401f6e1a67dad31a1bd78e9ad22d0ee0a3b52154e6bd30e90be696bb6a3d7461

RUN apt-get update && apt-get install -y --no-install-recommends \
    curl ca-certificates gnupg && \
    install -m 0755 -d /etc/apt/keyrings && \
    curl -fsSL https://download.docker.com/linux/debian/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg && \
    chmod a+r /etc/apt/keyrings/docker.gpg && \
    arch="$(dpkg --print-architecture)" && \
    echo "deb [arch=${arch} signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/debian bookworm stable" > /etc/apt/sources.list.d/docker.list && \
    apt-get update && apt-get install -y --no-install-recommends docker-ce-cli docker-compose-plugin && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt /tmp/requirements.txt
RUN pip install --no-cache-dir -r /tmp/requirements.txt

COPY . /app/backend/

RUN mkdir -p /app/pybooks_storage /app/objects_storage

COPY entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh

ARG PYLO_UID=501
ARG PYLO_GID=501

RUN groupadd --gid "${PYLO_GID}" pylo \
 && useradd --uid "${PYLO_UID}" --gid pylo --home-dir /app --shell /usr/sbin/nologin pylo \
 && chown -R pylo:pylo /app /tmp

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/health')" || exit 1

USER pylo

CMD ["/app/entrypoint.sh"]
