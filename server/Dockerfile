# ── Stage 1: Build ────────────────────────────────────────────────────────────
FROM rust:alpine AS builder

RUN apk add --no-cache musl-dev pkgconfig openssl-dev openssl-libs-static ca-certificates

WORKDIR /build

# musl targets link statically by default; only OpenSSL needs an explicit opt-in
# so the runtime image can be FROM scratch without libssl.
ENV OPENSSL_STATIC=1

# Cache dependencies separately — only re-runs when Cargo.toml/Cargo.lock changes
COPY Cargo.toml Cargo.lock* ./
RUN mkdir src && echo "fn main() {}" > src/main.rs
RUN cargo build --release
RUN rm -f src/main.rs

# Build the actual application. Migrations are embedded at compile time by
# the sqlx::migrate!() macro, so they don't need to ship in the runtime image.
COPY src ./src
COPY migrations ./migrations
RUN touch src/main.rs && cargo build --release

# ── Stage 2: Runtime (scratch) ────────────────────────────────────────────────
FROM scratch AS runtime

COPY --from=builder /build/target/release/manga-collector-server /manga-collector-server
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
