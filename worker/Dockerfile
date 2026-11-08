# sloptube encoder worker image for hosts that build from the worker/ folder
# itself, like a Railway service with its root directory set to /worker.
# Keep in step with ops/encoder/Dockerfile (the same image, built by CI for the
# encoder box).

FROM node:22-bookworm-slim

# ffmpeg and ffprobe from the distro: H.264 (libx264), AAC, WebP and the HLS muxer.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force

COPY index.mjs ./
COPY lib ./lib
COPY test ./test

ARG GIT_SHA=dev
ENV NODE_ENV=production \
    WORK_DIR=/work \
    STATE_DIR=/state \
    GIT_SHA=$GIT_SHA

RUN mkdir -p /work /state && chown node:node /work /state
USER node
CMD ["node", "index.mjs"]
