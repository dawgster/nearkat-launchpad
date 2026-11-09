# The training app: Node 24 service plus a CPU-only PyTorch trainer. Built from
# the repo root; it imports the keeper's modules beside it. A clean checkout
# builds: the held-out images are fetched in a stage (pinned commit, AGPL-3.0,
# never committed), so scripts/fetch-hotdog.sh needs no earlier run.
FROM debian:bookworm-slim AS heldout
RUN apt-get update \
 && apt-get install -y --no-install-recommends git ca-certificates python3 \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /w
COPY scripts/fetch-hotdog.sh scripts/fetch-hotdog.sh
RUN bash scripts/fetch-hotdog.sh && rm -rf data/hotdog-src

# Python 3.12 and the locked CPU torch, from trainer/py's uv.lock.
FROM node:24-slim AS python
COPY --from=ghcr.io/astral-sh/uv:0.9 /uv /usr/local/bin/uv
ENV UV_PYTHON_INSTALL_DIR=/opt/python UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy
WORKDIR /app/trainer/py
COPY trainer/py/pyproject.toml trainer/py/uv.lock ./
RUN uv sync --frozen --no-dev --python 3.12

FROM node:24-slim
WORKDIR /app
# The keeper's modules are imported by relative path, so keeper/node_modules is needed.
COPY keeper/package.json keeper/package-lock.json ./keeper/
RUN cd keeper && npm ci --omit=dev
COPY trainer/package.json trainer/package-lock.json ./trainer/
RUN cd trainer && npm ci --omit=dev
COPY keeper/src ./keeper/src
COPY trainer/src ./trainer/src
COPY trainer/py/train.py ./trainer/py/train.py
COPY --from=python /opt/python /opt/python
COPY --from=python /app/trainer/py/.venv ./trainer/py/.venv
COPY --from=heldout /w/trainer/heldout ./trainer/heldout
ENV NODE_ENV=production \
    HELDOUT_DIR=/app/trainer/heldout \
    TRAINER_PYTHON=/app/trainer/py/.venv/bin/python
USER node
EXPOSE 8790
CMD ["node", "trainer/src/main.ts"]
