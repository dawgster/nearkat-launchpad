# The keeper, for a container host such as Railway. Built from the repo root:
# it imports the shared art package beside it.
FROM node:24-slim@sha256:01d566e8d94d8c619591d78652babfccd3c6992a3dffa9ed5ab39e11cf6c70e9
WORKDIR /app
COPY art ./art
COPY keeper/package.json keeper/package-lock.json ./keeper/
RUN cd keeper && npm ci --omit=dev
COPY keeper ./keeper
WORKDIR /app/keeper
ENV NODE_ENV=production
# Keep contexts' cache, the meter journal and loan counters on a volume mounted at /data.
ENV STORE_DIR=/data/contexts METER_JOURNAL=/data/meter.json
CMD ["node", "src/main.ts"]
