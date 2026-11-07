# The web app as static files, for a container host such as Railway. Built
# from the repo root: it imports the shared art package beside it. The
# VITE_ settings are baked in at build time.
FROM node:24-slim AS build
WORKDIR /app
COPY art ./art
COPY web/package.json web/package-lock.json ./web/
RUN cd web && npm ci
COPY web ./web
ARG VITE_NEAR_NETWORK
ARG VITE_CONTRACT_ID
ARG VITE_KEEPER_URL
ARG VITE_FACTORY_ID
ARG VITE_AUTH_RECIPIENT
ARG VITE_NEAR_RPC_URL
# Typechecking runs with the tests; the image only needs the bundle.
RUN cd web && npx vite build

FROM caddy:2-alpine
COPY --from=build /app/web/dist /srv
COPY deploy/Caddyfile /etc/caddy/Caddyfile
