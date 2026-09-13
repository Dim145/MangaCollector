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

# 閉 · Both Umami values land inside a double-quoted JS string literal
# in `index.html`. A value carrying `"`, a backslash, or `</script>`
# would close that literal — or the whole block — and everything after
# it would run as script on every page load, with the app's own origin
# and the app's own CSP hash covering it. The operator writes these,
# not a visitor, but "the operator pasted a URL with a quote in it" is
# a typo, not an attack, and the failure mode is the same. So they are
# validated against what they are actually allowed to be, and a value
# that isn't is dropped with a word on stderr rather than templated in.
reject_unsafe() {
    # $1 = variable name (for the message), $2 = value, $3 = ERE it must match
    if [ -n "$2" ] && ! printf '%s' "$2" | grep -Eq "$3"; then
        echo "[entrypoint] $1 is not a valid value — ignoring it." >&2
        return 1
    fi
    return 0
}

# A plain http(s) URL: no quotes, no backslash, no angle brackets, no
# whitespace, nothing that can leave the literal it is pasted into.
reject_unsafe FRONTEND_UMAMI_SCRIPT_URL "${FRONTEND_UMAMI_SCRIPT_URL:-}" \
    '^https?://[A-Za-z0-9._~:/?#@!$&()*+,;=%-]+$' || FRONTEND_UMAMI_SCRIPT_URL=''
# Umami website ids are UUIDs; accept any hex/dash token of that shape.
reject_unsafe FRONTEND_UMAMI_WEBSITE_ID "${FRONTEND_UMAMI_WEBSITE_ID:-}" \
    '^[A-Za-z0-9._-]+$' || FRONTEND_UMAMI_WEBSITE_ID=''

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

# Same for the two CSP tokens. These are pasted into a header value,
# where a space would silently widen the policy and a newline would
# start a header of the operator's choosing.
reject_unsafe FRONTEND_UMAMI_ORIGIN "${FRONTEND_UMAMI_ORIGIN:-}" \
    '^https?://[A-Za-z0-9.:_-]+$' || FRONTEND_UMAMI_ORIGIN=''
reject_unsafe FRONTEND_OBSERVABILITY_ORIGIN "${FRONTEND_OBSERVABILITY_ORIGIN:-}" \
    '^https?://[A-Za-z0-9.:_-]+$' || FRONTEND_OBSERVABILITY_ORIGIN=''

# Export with empty defaults — envsubst won't substitute unset vars
# and would leave literal `${...}` strings in the output.
export FRONTEND_UMAMI_SCRIPT_URL="${FRONTEND_UMAMI_SCRIPT_URL:-}"
export FRONTEND_UMAMI_WEBSITE_ID="${FRONTEND_UMAMI_WEBSITE_ID:-}"
export FRONTEND_UMAMI_ORIGIN="${FRONTEND_UMAMI_ORIGIN:-}"
export FRONTEND_OBSERVABILITY_ORIGIN="${FRONTEND_OBSERVABILITY_ORIGIN:-}"

VARS='$FRONTEND_UMAMI_SCRIPT_URL $FRONTEND_UMAMI_WEBSITE_ID $FRONTEND_UMAMI_ORIGIN $FRONTEND_OBSERVABILITY_ORIGIN $FRONTEND_INLINE_SCRIPT_HASHES'

# Mirror the dist to a writable tmpfs location. The cp keeps Vite's
# hashed assets byte-identical so downstream caching (CDN, browser,
# service worker precache) sees stable URLs across container restarts
# — only `index.html` differs after the templating pass.
mkdir -p /tmp/html
cp -r /usr/share/nginx/html/. /tmp/html/
envsubst "$VARS" < /usr/share/nginx/html/index.html > /tmp/html/index.html

# 印 · Hash the inline scripts so the CSP can name them instead of
# opening the door with 'unsafe-inline'. Computed from the TEMPLATED
# index.html, because one of those blocks carries the Umami settings
# substituted just above — the hash is over the exact bytes the browser
# will see, so it has to be taken after the substitution.
#
# Exactness is the whole game: the hashed text is everything between the
# `>` of the opening tag and the `<` of the closing one, which includes
# the newline that ends the `<script>` line and the indentation that
# precedes `</script>`. Awk writes each block to its own file rather
# than piping it, because busybox `read` has no -d and a command
# substitution would eat the trailing newline.
#
# A page that boots matters more than a tighter policy: if nothing is
# extracted, fall back to 'unsafe-inline' rather than shipping a policy
# that blocks the app's own bootstrap.
rm -f /tmp/inline-*.js
awk '
    /<script[^>]*>/ && !/src=/ && !/<\/script>/ {
        n += 1
        out = "/tmp/inline-" n ".js"
        printf "\n" > out
        inside = 1
        next
    }
    inside && /<\/script>/ {
        # the indentation before the closing tag is part of the text
        match($0, /^[ \t]*/)
        printf "%s", substr($0, 1, RLENGTH) >> out
        close(out)
        inside = 0
        next
    }
    inside { printf "%s\n", $0 >> out }
' /tmp/html/index.html

FRONTEND_INLINE_SCRIPT_HASHES=""
for block in /tmp/inline-*.js; do
    [ -f "$block" ] || continue
    digest=$(sha256sum "$block" | cut -d" " -f1 | xxd -r -p | base64 | tr -d "\n")
    FRONTEND_INLINE_SCRIPT_HASHES="${FRONTEND_INLINE_SCRIPT_HASHES}'sha256-${digest}' "
done
rm -f /tmp/inline-*.js

if [ -z "$FRONTEND_INLINE_SCRIPT_HASHES" ]; then
    echo "mc-entrypoint: no inline script hashed, keeping 'unsafe-inline'" >&2
    FRONTEND_INLINE_SCRIPT_HASHES="'unsafe-inline'"
fi
export FRONTEND_INLINE_SCRIPT_HASHES

# nginx.conf and the header snippet get the same template pass — the CSP
# needs the Umami origin allow-listed when configured, and the hashes
# computed just above.
envsubst "$VARS" < /etc/nginx/nginx.conf > /tmp/nginx.conf
envsubst "$VARS" < /etc/nginx/security-headers.conf > /tmp/security-headers.conf

exec nginx -c /tmp/nginx.conf -g 'daemon off;'
