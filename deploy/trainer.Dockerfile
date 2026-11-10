# The training app: Node 24 service plus a CPU-only PyTorch trainer. Built from
# the repo root; it imports the keeper's modules beside it. A clean checkout
# builds: the held-out images are fetched in a stage (pinned commit, AGPL-3.0,
# never committed), so scripts/fetch-hotdog.sh needs no earlier run. The image
# therefore contains those images: pushing it distributes them under the AGPL.
FROM debian:bookworm-slim@sha256:734a72b3d6142a71993b4bc580ca01d8ca687f77a2c422d96a961d3376b179bc AS heldout
RUN apt-get update \
 && apt-get install -y --no-install-recommends git ca-certificates python3 \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /w
COPY scripts/fetch-hotdog.sh scripts/fetch-hotdog.sh
RUN bash scripts/fetch-hotdog.sh && rm -rf data/hotdog-src

# The backbone's ImageNet weights (torchvision's MobileNetV3-Large), fetched at
# build time and checked against the SHA-256 that train.py pins and checks again
# on every load. At runtime nothing is downloaded.
FROM heldout AS weights
ARG WEIGHTS_FILE=mobilenet_v3_large-5c1a4163.pth
ARG WEIGHTS_SHA256=5c1a416349c4cf298f2a6a5e2600ed0ee55e604713578f5e74e6bc8bcaef7997
RUN mkdir -p /opt/torch/hub/checkpoints \
 && python3 -c "import sys, urllib.request; urllib.request.urlretrieve(sys.argv[1], sys.argv[2])" \
      "https://download.pytorch.org/models/$WEIGHTS_FILE" "/opt/torch/hub/checkpoints/$WEIGHTS_FILE" \
 && echo "$WEIGHTS_SHA256  /opt/torch/hub/checkpoints/$WEIGHTS_FILE" | sha256sum -c -

# Python 3.12 and the locked CPU torch, from trainer/py's uv.lock.
FROM node:24-slim@sha256:01d566e8d94d8c619591d78652babfccd3c6992a3dffa9ed5ab39e11cf6c70e9 AS python
COPY --from=ghcr.io/astral-sh/uv:0.9@sha256:538e0b39736e7feae937a65983e49d2ab75e1559d35041f9878b7b7e51de91e4 /uv /usr/local/bin/uv
ENV UV_PYTHON_INSTALL_DIR=/opt/python UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy
WORKDIR /app/trainer/py
COPY trainer/py/pyproject.toml trainer/py/uv.lock ./
RUN uv sync --frozen --no-dev --python 3.12

FROM node:24-slim@sha256:01d566e8d94d8c619591d78652babfccd3c6992a3dffa9ed5ab39e11cf6c70e9
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
COPY --from=weights /opt/torch /opt/torch
COPY --from=heldout /w/trainer/heldout ./trainer/heldout
ENV NODE_ENV=production \
    HELDOUT_DIR=/app/trainer/heldout \
    TORCH_HOME=/opt/torch \
    TRAINER_PYTHON=/app/trainer/py/.venv/bin/python
# Runs as root, like the keeper's image: it must open dstack's socket
# (/var/run/dstack.sock), which belongs to root inside the CVM.
EXPOSE 8790
CMD ["node", "trainer/src/main.ts"]
