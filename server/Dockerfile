# syntax=docker/dockerfile:1.7
# ↑ BuildKit cache mounts. Without this directive `--mount=type=cache` is
# silently ignored and only the classic Docker layer cache applies.

# Build profile (`release` = full LTO/opt for prod, `release-fast` = quicker
# compile for dev). Override at build time:  --build-arg CARGO_PROFILE=release
ARG CARGO_PROFILE=release-fast

# ── Stage 0: chef base — Rust + musl + mold + cargo-chef ──────────────────────
FROM rust:alpine AS chef
# `musl-dev` for the static link, `pkgconfig` + `ca-certificates` so we can
# copy the CA bundle into the scratch runtime stage. `mold` + `clang` are
# enabled by .cargo/config.toml; mold replaces the linker (~30-90s → few s
# on the final link). All TLS goes through rustls/aws-lc-rs — no openssl
# in the dep graph, so no openssl-dev / openssl-libs-static here.
RUN apk add --no-cache musl-dev pkgconfig ca-certificates mold clang
RUN cargo install cargo-chef --locked
WORKDIR /build

# ── Stage 1: planner — emit recipe.json describing the dep graph ──────────────
# The recipe captures only what `cargo chef cook` needs to build deps. It
# changes whenever Cargo.toml / Cargo.lock change, never on src/ edits.
FROM chef AS planner
COPY Cargo.toml Cargo.lock ./
COPY src ./src
COPY migrations ./migrations
RUN cargo chef prepare --recipe-path recipe.json

# ── Stage 2: builder ──────────────────────────────────────────────────────────
FROM chef AS builder
ARG CARGO_PROFILE
ENV CARGO_PROFILE=${CARGO_PROFILE}

# Pull the linker config in early so `chef cook` and the real build below
# both honour it. (.cargo/config.toml is resolved per invocation, not baked
# into the artefact, so it must sit alongside Cargo.toml at build time.)
COPY .cargo .cargo

# Cook deps — this is the slow step on a cold build, but the layer cache
# (Cargo.toml + Cargo.lock + recipe.json invariant) keeps it warm across
# almost every src-only iteration.
COPY --from=planner /build/recipe.json recipe.json
RUN --mount=type=cache,target=/usr/local/cargo/registry,sharing=locked \
    --mount=type=cache,target=/build/target,sharing=locked \
    cargo chef cook --profile ${CARGO_PROFILE} --recipe-path recipe.json

# Real build. Migrations are embedded at compile time by sqlx::migrate!()
# so they don't ship in the runtime image. `cp` extracts the binary out of
# the cache mount because /build/target is volatile after the RUN finishes.
COPY Cargo.toml Cargo.lock ./
COPY src ./src
COPY migrations ./migrations
RUN --mount=type=cache,target=/usr/local/cargo/registry,sharing=locked \
    --mount=type=cache,target=/build/target,sharing=locked \
    cargo build --profile ${CARGO_PROFILE} --bin manga-collector-server && \
    cp target/${CARGO_PROFILE}/manga-collector-server /manga-collector-server

# ── Stage 3: Runtime (scratch) ────────────────────────────────────────────────
FROM scratch AS runtime

# OCI labels document the read-only deploy contract for scanners + humans.
# These don't enforce runtime — flags must still be passed by the launcher.
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

# Binary was copied out of the (volatile) cache-mounted /build/target by the
# builder stage — we COPY from the image-layer path, not /build/target/*.
COPY --from=builder /manga-collector-server /manga-collector-server
COPY --from=builder /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/ca-certificates.crt

ENV RUST_LOG=info
ENV APP_UNSECURE_HEALTHCHECK=false
ENV SSL_CERT_FILE=/etc/ssl/certs/ca-certificates.crt

EXPOSE 3000

# `--health` hits /api/health over loopback and exits 0/1 — avoids needing
# curl/wget in the scratch image.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD ["/manga-collector-server", "--health"]

ENTRYPOINT ["/manga-collector-server"]
