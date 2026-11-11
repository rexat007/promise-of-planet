# Isolated Quarantine ClamAV Cloud Run Job Worker Image
# Pinned base image — no :latest tag, no exposed HTTP ports, non-root runtime user
FROM node:22.11.0-bookworm-slim AS builder

WORKDIR /workspace/functions

COPY package.json package-lock.json tsconfig.json ./
RUN npm ci

COPY src ./src
RUN npm run build

FROM node:22.11.0-bookworm-slim AS runtime

ENV NODE_ENV=production \
    POP_CLAMAV_DB_DIR=/var/lib/clamav \
    POP_CLAMSCAN_PATH=/usr/bin/clamscan

RUN apt-get update && \
    apt-get install -y --no-install-recommends \
      ca-certificates \
      clamav \
      clamav-freshclam && \
    rm -rf /var/lib/apt/lists/* && \
    mkdir -p /var/lib/clamav && \
    chown -R clamav:clamav /var/lib/clamav && \
    freshclam --datadir=/var/lib/clamav && \
    test -s /var/lib/clamav/main.cvd -o -s /var/lib/clamav/main.cld && \
    test -s /var/lib/clamav/daily.cvd -o -s /var/lib/clamav/daily.cld && \
    /usr/bin/clamscan --version --database=/var/lib/clamav && \
    chmod -R a+rX /var/lib/clamav

WORKDIR /app/functions

COPY --from=builder /workspace/functions/package.json /workspace/functions/package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=builder /workspace/functions/lib ./lib

USER node

ENTRYPOINT ["node", "lib/library/libraryQuarantineAvWorker.js"]
