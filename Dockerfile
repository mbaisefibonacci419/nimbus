# ── Stage 1: Build ──────────────────────────────────────────
FROM node:22-slim AS build

RUN apt-get update && \
    apt-get install -y python3 make g++ && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
COPY shared/package*.json shared/
COPY client/package*.json client/
COPY server/package*.json server/

RUN npm ci

COPY . .
ENV VITE_API_BASE=""
RUN npm run build

# ── Stage 2: Production ────────────────────────────────────
FROM node:22-slim

RUN apt-get update && \
    apt-get install -y python3 python3-pip python3-venv make g++ && \
    python3 -m venv /opt/docling-venv && \
    /opt/docling-venv/bin/pip install --no-cache-dir docling && \
    apt-get purge -y python3-pip && \
    rm -rf /var/lib/apt/lists/*

ENV PATH="/opt/docling-venv/bin:$PATH"

WORKDIR /app

COPY package*.json ./
COPY shared/package*.json shared/
COPY server/package*.json server/

RUN npm ci --omit=dev --workspace=shared --workspace=server && \
    apt-get update && apt-get purge -y make g++ && apt-get autoremove -y && rm -rf /var/lib/apt/lists/*

COPY --from=build /app/shared/dist shared/dist
COPY --from=build /app/shared/src shared/src
COPY --from=build /app/shared/package.json shared/package.json
COPY --from=build /app/server/dist server/dist
COPY --from=build /app/server/src/db/schema.sql server/dist/db/schema.sql
COPY --from=build /app/client/dist client/dist

ENV NODE_ENV=production
ENV TRUST_PROXY=1

EXPOSE 8080

CMD ["npm", "start"]

