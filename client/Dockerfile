FROM node:24-alpine AS build

WORKDIR /client

# pnpm version is pinned via the `packageManager` field in package.json.
RUN corepack enable

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .

RUN pnpm run build

FROM nginx:alpine

# OCI labels document the read-only deploy contract for scanners + humans.
# These don't enforce runtime — flags must still be passed by the launcher.
LABEL org.opencontainers.image.title="MangaCollector Frontend" \
      org.opencontainers.image.description="React 19 + Vite PWA served by nginx. Designed to run read-only — requires /tmp and /var/cache/nginx as tmpfs, and the NET_BIND_SERVICE capability to bind port 80." \
      org.opencontainers.image.source="https://github.com/dim145/MangaCollector" \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.vendor="dim145" \
      security.readonly-rootfs="required" \
      security.tmpfs="/tmp,/var/cache/nginx" \
      security.caps.drop="ALL" \
      security.caps.required="CHOWN,SETUID,SETGID,NET_BIND_SERVICE" \
      security.no-new-privileges="required"

COPY --from=build /client/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/nginx.conf

EXPOSE 80
HEALTHCHECK --interval=30s --timeout=5s --start-period=1s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://127.0.0.1/health || exit 1
