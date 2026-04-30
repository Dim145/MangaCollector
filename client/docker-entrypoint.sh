#!/bin/sh
# 設 · Runtime config templating for the SPA shell.
#
# `index.html` ships with `${FRONTEND_UMAMI_*}` placeholders inside an
# inline `window.__APP_CONFIG__` block, and `nginx.conf`'s CSP carries a
# `${FRONTEND_UMAMI_ORIGIN}` token that allow-lists the analytics
# script origin when configured. Both are resolved here at container
# start so the same image redeploys across dev / staging / prod with
# different Umami targets — no rebuild required.
#
# The container runs with a read-only root filesystem; `/tmp` is the
# only writable mount we can rely on. We mirror the html dir into
# `/tmp/html` (cheap copy on tmpfs — ~3.5 MB on RAM, ms-level), apply
# the template pass to `index.html` and `nginx.conf`, then start nginx
# pointed at the rewritten config + html root via `-c /tmp/nginx.conf`.
#
# `envsubst` is restricted to a specific allow-list of variables
# (`$VARS`) so legitimate `${...}` patterns elsewhere in either file
# can't be mangled by the template pass.
#
# Unset variables resolve to empty strings — the frontend's analytics
# module checks for that and skips Umami init silently. Empty CSP
# tokens are harmless (browsers drop them).
set -eu

# Cheap shell parse: strip the optional `KEY@` userinfo (Sentry DSN
# format: `https://KEY@HOST/PROJECT`), keep `scheme://host[:port]`.
# Plain URLs (Umami script URL) pass through with no userinfo. Empty
# in → empty out → no CSP impact.
extract_origin() {
    printf '%s' "$1" | sed -E 's|^(https?://)([^@/]+@)?([^/]+).*|\1\3|'
}

if [ -z "${FRONTEND_UMAMI_ORIGIN:-}" ] && [ -n "${FRONTEND_UMAMI_SCRIPT_URL:-}" ]; then
    FRONTEND_UMAMI_ORIGIN=$(extract_origin "$FRONTEND_UMAMI_SCRIPT_URL")
fi

# Single shared CSP token for Sentry / Bugsink — the mutex enforced by
# the Rust backend means at most one of the two DSNs is set at a time,
# so we collapse them into one origin slot. The frontend SDK only
# needs `connect-src` access (to POST events), not `script-src` —
# `@sentry/browser` is bundled with the app, served from 'self'.
if [ -z "${FRONTEND_OBSERVABILITY_ORIGIN:-}" ]; then
    if [ -n "${FRONTEND_SENTRY_DSN:-}" ]; then
        FRONTEND_OBSERVABILITY_ORIGIN=$(extract_origin "$FRONTEND_SENTRY_DSN")
    elif [ -n "${FRONTEND_BUGSINK_DSN:-}" ]; then
        FRONTEND_OBSERVABILITY_ORIGIN=$(extract_origin "$FRONTEND_BUGSINK_DSN")
    fi
fi

# Export with empty defaults — envsubst won't substitute unset vars
# and would leave literal `${...}` strings in the output.
export FRONTEND_UMAMI_SCRIPT_URL="${FRONTEND_UMAMI_SCRIPT_URL:-}"
export FRONTEND_UMAMI_WEBSITE_ID="${FRONTEND_UMAMI_WEBSITE_ID:-}"
export FRONTEND_UMAMI_ORIGIN="${FRONTEND_UMAMI_ORIGIN:-}"
export FRONTEND_OBSERVABILITY_ORIGIN="${FRONTEND_OBSERVABILITY_ORIGIN:-}"

VARS='$FRONTEND_UMAMI_SCRIPT_URL $FRONTEND_UMAMI_WEBSITE_ID $FRONTEND_UMAMI_ORIGIN $FRONTEND_OBSERVABILITY_ORIGIN'

# Mirror the dist to a writable tmpfs location. The cp keeps Vite's
# hashed assets byte-identical so downstream caching (CDN, browser,
# service worker precache) sees stable URLs across container restarts
# — only `index.html` differs after the templating pass.
mkdir -p /tmp/html
cp -r /usr/share/nginx/html/. /tmp/html/
envsubst "$VARS" < /usr/share/nginx/html/index.html > /tmp/html/index.html

# nginx.conf gets the same template pass — its CSP needs the Umami
# origin allow-listed when configured.
envsubst "$VARS" < /etc/nginx/nginx.conf > /tmp/nginx.conf

exec nginx -c /tmp/nginx.conf -g 'daemon off;'
