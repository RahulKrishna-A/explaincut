# ExplainCut - runs the whole app (Next.js + ffmpeg + Remotion/Chromium) as one
# long-lived process. Built for Railway, but works on any Docker host.
FROM node:22-bookworm-slim

# System libraries headless Chromium needs for Remotion, plus fonts.
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    fonts-liberation \
    libnss3 libdbus-1-3 libatk1.0-0 libatk-bridge2.0-0 libasound2 \
    libxrandr2 libxkbcommon0 libxfixes3 libxcomposite1 libxdamage1 \
    libgbm1 libcups2 libcairo2 libpango-1.0-0 libx11-6 libxext6 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# Public build-time values are inlined into the client bundle. On Railway,
# service variables are passed to the build automatically as build args when
# declared here.
ARG NEXT_PUBLIC_SITE_URL
ARG NEXT_PUBLIC_APP_NAME
ENV NEXT_PUBLIC_SITE_URL=$NEXT_PUBLIC_SITE_URL \
    NEXT_PUBLIC_APP_NAME=$NEXT_PUBLIC_APP_NAME

RUN npm run build

# Download Remotion's headless Chromium now so the first render isn't slow.
RUN npx remotion browser ensure

# Bundle the Remotion compositions once here: running webpack inside the live
# server (next to Next.js) can run out of memory on a small instance.
RUN npx remotion bundle --out-dir=/app/.remotion-bundle --log=error
ENV REMOTION_BUNDLE_DIR=/app/.remotion-bundle
# Remotion's shared-memory frame hand-off to FFmpeg fails in containers; use screenshots.
ENV REMOTION_DISABLE_SHARED_MEMORY=1

ENV NODE_ENV=production
# Job files live here; mount a Railway volume at this path to keep them across restarts.
ENV JOB_DATA_DIR=/app/data/jobs
RUN mkdir -p /app/data/jobs /app/data/stickers

EXPOSE 3000
# Railway injects PORT; next start honours it and binds 0.0.0.0.
CMD ["sh", "-c", "npx next start -p ${PORT:-3000}"]
