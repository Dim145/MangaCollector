FROM node:24-alpine AS build

WORKDIR /client

COPY package*.json ./
RUN npm install

COPY . .

RUN npm run build

FROM nginx:alpine

# Image metadata (OCI). Security labels document the read-only contract so
# orchestrators, scanners (Trivy, Docker Scout, Snyk) and humans can see how
# the image is meant to be deployed. Nothing here forces runtime — the flags
# must still be passed by the launcher (docker run / compose / k8s).
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
