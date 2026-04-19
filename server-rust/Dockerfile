# ── Stage 1: Build ────────────────────────────────────────────────────────────
FROM rust:alpine AS builder

RUN apk add --no-cache musl-dev pkgconfig openssl-dev openssl-libs-static

WORKDIR /build

# Cache dependencies separately — only re-runs when Cargo.toml/Cargo.lock changes
COPY Cargo.toml Cargo.lock* ./
RUN mkdir src && echo "fn main() {}" > src/main.rs
RUN cargo build --release
RUN rm -f src/main.rs

# Build the actual application
COPY src ./src
COPY migrations ./migrations
RUN touch src/main.rs && cargo build --release

# ── Stage 2: Runtime ──────────────────────────────────────────────────────────
FROM alpine:3.20 AS runtime

RUN apk add --no-cache ca-certificates wget

WORKDIR /app

COPY --from=builder /build/target/release/manga-collector-server .
COPY --from=builder /build/migrations ./migrations

ENV RUST_LOG=info
ENV APP_UNSECURE_HEALTHCHECK=false

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://127.0.0.1:3000/api/health || exit 1

CMD ["./manga-collector-server"]
