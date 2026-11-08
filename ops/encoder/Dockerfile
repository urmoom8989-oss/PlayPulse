# sloptube encoder worker image: Node 22 and ffmpeg from Debian, and whisper.cpp
# for the auto-generated captions.
# The build context is the worker/ folder:
#   docker build -f ops/encoder/Dockerfile --build-arg GIT_SHA=$(git rev-parse HEAD) -t sloptube-encoder worker/

# Speech to text for the auto-generated captions (lib/captions.mjs): whisper.cpp
# from a pinned release, built for any x86-64 CPU with AVX2 rather than only the
# build machine's, with its multilingual base model (checked against the SHA-1
# in whisper.cpp's models/README.md) and the Silero voice detection model.
FROM debian:bookworm-slim AS whisper
ARG WHISPER_VERSION=v1.9.5
ARG WHISPER_MODEL=base
ARG WHISPER_MODEL_SHA1=465707469ff3a37a2b9b8d8f89f2f99de7299dac
ARG VAD_MODEL=silero-v6.2.0
RUN apt-get update \
 && apt-get install -y --no-install-recommends build-essential cmake git ca-certificates curl \
 && rm -rf /var/lib/apt/lists/*
RUN git clone --depth 1 --branch "$WHISPER_VERSION" https://github.com/ggml-org/whisper.cpp /src/whisper.cpp
WORKDIR /src/whisper.cpp
RUN cmake -B build -DCMAKE_BUILD_TYPE=Release -DBUILD_SHARED_LIBS=OFF \
      -DWHISPER_BUILD_TESTS=OFF -DWHISPER_BUILD_SERVER=OFF \
      -DGGML_NATIVE=OFF -DGGML_AVX=ON -DGGML_AVX2=ON -DGGML_FMA=ON -DGGML_F16C=ON \
 && cmake --build build --config Release -j"$(nproc)" --target whisper-cli \
 && install -m 755 -s build/bin/whisper-cli /usr/local/bin/whisper-cli
RUN mkdir -p /opt/whisper \
 && curl -fsSL --retry 3 -o /opt/whisper/speech.bin \
      "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-${WHISPER_MODEL}.bin" \
 && echo "${WHISPER_MODEL_SHA1}  /opt/whisper/speech.bin" | sha1sum -c - \
 && curl -fsSL --retry 3 -o /opt/whisper/vad.bin \
      "https://huggingface.co/ggml-org/whisper-vad/resolve/main/ggml-${VAD_MODEL}.bin" \
 && test -s /opt/whisper/vad.bin

FROM node:22-bookworm-slim

# ffmpeg and ffprobe from the distro: H.264 (libx264), AAC, WebP and the HLS muxer.
# libgomp1 is the OpenMP runtime whisper-cli uses for its threads.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg ca-certificates libgomp1 \
 && rm -rf /var/lib/apt/lists/*

# whisper-cli and its two models, from the stage above.
COPY --from=whisper /usr/local/bin/whisper-cli /usr/local/bin/whisper-cli
COPY --from=whisper /opt/whisper /opt/whisper

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force

# The tests come along so the ffmpeg smoke test can run on the box:
#   docker exec sloptube-encoder node --test test/
COPY index.mjs ./
COPY lib ./lib
COPY test ./test

ARG GIT_SHA=dev
ENV NODE_ENV=production \
    WORK_DIR=/work \
    STATE_DIR=/state \
    CAPTIONS_MODEL=/opt/whisper/speech.bin \
    CAPTIONS_VAD_MODEL=/opt/whisper/vad.bin \
    GIT_SHA=$GIT_SHA
LABEL org.opencontainers.image.source="https://github.com/myfilehero/sloptube" \
      org.opencontainers.image.description="sloptube encoder worker" \
      org.opencontainers.image.revision=$GIT_SHA

# /work holds the source and the encoded files of the one running job.
# /state holds the busy marker the update script checks.
RUN mkdir -p /work /state && chown node:node /work /state
USER node
CMD ["node", "index.mjs"]
