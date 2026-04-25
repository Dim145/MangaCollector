# syntax=docker/dockerfile:1.7
# ↑ Enables BuildKit cache mounts (below). Works with docker buildx,
# docker-compose 2.x default builder, and the DOCKER_BUILDKIT=1 legacy
# switch. Without this directive the `--mount=type=cache` lines are
# silently ignored and we fall back to the classic dummy-main Docker
# layer cache only.

# ── Stage 1: Build ────────────────────────────────────────────────────────────
FROM rust:alpine AS builder

# `musl-dev` + `pkgconfig` for the static link, `ca-certificates` so we
# can copy the CA bundle into the scratch runtime stage. `openssl-dev`
# and `openssl-libs-static` used to live here but were retired once the
# Rust deps dropped the `openssl` crate entirely — reqwest now rides on
# `rustls-tls` (aws-lc-rs backend), and sqlx / aws-sdk-s3 already used
# rustls. Net effect: ~15 MB shaved off the build image and 5 RUSTSEC
# advisories in the `openssl`/`openssl-sys` family can no longer apply.
RUN apk add --no-cache musl-dev pkgconfig ca-certificates

WORKDIR /build

# Two-layer caching strategy for Rust builds:
#
#   1. Docker layer cache (classic) — via the dummy-main pattern below.
#      A change to src/ doesn't invalidate the "compile deps" layer,
#      only the "compile app" one. Breaks when Cargo.toml/Cargo.lock
#      change (full rebuild of deps).
#
#   2. BuildKit cache mounts (`--mount=type=cache,...`) — persist the
#      cargo registry and `target/` directory ACROSS builds. Even when
#      Cargo.lock changes and invalidates layer 1, most of the crates'
#      compiled artefacts are still on disk, so the "full rebuild"
#      turns into an incremental one. Typical cold build drops from
#      ~500s to ~30-60s once the caches are warm.
#
#      Gotcha: `target/` becomes a volume mount that disappears after
#      the RUN finishes. We `cp` the final binary out of it (into /out)
#      so the runtime stage can COPY it from a path that actually
#      survives in the image layer.

# Layer 1a: dep warmup with a dummy main — only invalidates when
# Cargo.toml/Cargo.lock change.
COPY Cargo.toml Cargo.lock* ./
RUN mkdir src && echo "fn main() {}" > src/main.rs
RUN --mount=type=cache,target=/usr/local/cargo/registry,sharing=locked \
    --mount=type=cache,target=/build/target,sharing=locked \
    cargo build --release
RUN rm -f src/main.rs

# Layer 1b: real build. Migrations are embedded at compile time by
# sqlx::migrate!() so they don't need to ship in the runtime image.
# `touch src/main.rs` forces cargo to re-link against the fresh source
# tree instead of reusing the dummy-main artefact. `cp` extracts the
# binary out of the cache mount so the runtime stage can grab it.
COPY src ./src
COPY migrations ./migrations
RUN --mount=type=cache,target=/usr/local/cargo/registry,sharing=locked \
    --mount=type=cache,target=/build/target,sharing=locked \
    touch src/main.rs && \
    cargo build --release && \
    cp target/release/manga-collector-server /manga-collector-server

# ── Stage 2: Runtime (scratch) ────────────────────────────────────────────────
FROM scratch AS runtime

# Image metadata (OCI). Security labels document the read-only contract so
# orchestrators, scanners (Trivy, Docker Scout, Snyk) and humans can see how
# the image is meant to be deployed. Nothing here forces runtime — the flags
# must still be passed by the launcher (docker run / compose / k8s).
LABEL org.opencontainers.image.title="MangaCollector Backend" \
      org.opencontainers.image.description="Rust/Axum API backend. Designed to run read-only — requires /tmp as tmpfs and an optional /data volume for LocalStorage uploads." \
      org.opencontainers.image.source="https://github.com/dim145/MangaCollector" \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.vendor="dim145" \
      security.readonly-rootfs="required" \
      security.tmpfs="/tmp" \
      security.caps.drop="ALL" \
      security.no-new-privileges="required" \
      security.writable-volumes="/data (optional, for LocalStorage backend)"

# Binary was copied out of the (volatile) cache-mounted /build/target
# by the builder stage — we COPY from the image-layer path now, not
# from /build/target/release which doesn't exist in the final layer.
COPY --from=builder /manga-collector-server /manga-collector-server
COPY --from=builder /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/ca-certificates.crt

ENV RUST_LOG=info
ENV APP_UNSECURE_HEALTHCHECK=false
ENV SSL_CERT_FILE=/etc/ssl/certs/ca-certificates.crt

EXPOSE 3000

# The binary exposes a `--health` subcommand that hits /api/health over
# loopback and exits 0/1 — avoids needing curl/wget in the scratch image.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD ["/manga-collector-server", "--health"]

ENTRYPOINT ["/manga-collector-server"]
