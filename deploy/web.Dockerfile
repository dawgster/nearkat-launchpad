# The web app as static files, for a container host such as Railway. Built
# from the repo root: it imports the shared art package beside it. The
# VITE_ settings are baked in at build time.
#
# VITE_TRAINER_URLS names each training app the site can train with, as JSON:
#   {"<trainer-app-id>":{"url":"<trainer-url>","recipient":"<trainer-auth-recipient>"}}
# Without it there is no Train button.

# The held-out images TryModel scores a model on, served at /heldout. Fetched
# from a pinned commit (AGPL-3.0, never committed), as trainer.Dockerfile does.
FROM debian:bookworm-slim@sha256:734a72b3d6142a71993b4bc580ca01d8ca687f77a2c422d96a961d3376b179bc AS heldout
RUN apt-get update \
 && apt-get install -y --no-install-recommends git ca-certificates python3 \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /w
COPY scripts/fetch-hotdog.sh scripts/fetch-hotdog.sh
RUN bash scripts/fetch-hotdog.sh && rm -rf data/hotdog-src

FROM node:24-slim@sha256:01d566e8d94d8c619591d78652babfccd3c6992a3dffa9ed5ab39e11cf6c70e9 AS build
WORKDIR /app
COPY art ./art
COPY web/package.json web/package-lock.json ./web/
RUN cd web && npm ci
COPY web ./web
COPY --from=heldout /w/web/public/heldout ./web/public/heldout
ARG VITE_NEAR_NETWORK
ARG VITE_CONTRACT_ID
ARG VITE_KEEPER_URL
ARG VITE_FACTORY_ID
ARG VITE_AUTH_RECIPIENT
ARG VITE_NEAR_RPC_URL
ARG VITE_TRAINER_URLS
# Typechecking runs with the tests; the image only needs the bundle.
RUN cd web && npx vite build

FROM caddy:2-alpine@sha256:78bd35025c7ba85961dd149ae670315129954e77abe2383ac47c89106b35ade9
COPY --from=build /app/web/dist /srv
COPY deploy/Caddyfile /etc/caddy/Caddyfile
