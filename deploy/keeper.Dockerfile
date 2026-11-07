# The keeper, for a container host such as Railway. Built from the repo root:
# it imports the shared art package beside it.
FROM node:24-slim
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
