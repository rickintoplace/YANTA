#!/usr/bin/env bash
# ============================================================
# Deploy the YANTA Cloud Worker.
#
# Wraps `wrangler deploy` with the three things that bit us:
#   1. auth — an API token if one is available, otherwise OAuth
#   2. the OAuth callback binds [::1] only, but browsers here
#      resolve localhost to 127.0.0.1 → a bridge fixes that
#   3. a deploy replaces ALL plain-text vars, so the live ones are
#      diffed against wrangler.toml before anything is uploaded
#
# Usage: npm run deploy            (from yanta-cloud-worker/)
#        scripts/deploy-worker.sh --skip-checks
# ============================================================
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORKER_DIR="$REPO/yanta-cloud-worker"
TOKEN_FILE="${CLOUDFLARE_TOKEN_FILE:-$HOME/.config/yanta/cloudflare-token}"
SKIP_CHECKS=0

for arg in "$@"; do
  [ "$arg" = "--skip-checks" ] && SKIP_CHECKS=1
done

wrangler() { (cd "$WORKER_DIR" && npx -y wrangler@4 "$@"); }

# ---- 1. auth ------------------------------------------------
# An API token needs no browser and never expires; the file is the
# fallback so the token does not have to live in the shell config.
if [ -z "${CLOUDFLARE_API_TOKEN:-}" ] && [ -r "$TOKEN_FILE" ]; then
  CLOUDFLARE_API_TOKEN="$(tr -d '[:space:]' < "$TOKEN_FILE")"
  export CLOUDFLARE_API_TOKEN
  echo "→ using API token from $TOKEN_FILE"
fi

if [ -n "${CLOUDFLARE_API_TOKEN:-}" ]; then
  echo "→ authenticating with CLOUDFLARE_API_TOKEN"
elif wrangler whoami >/dev/null 2>&1; then
  echo "→ using the stored OAuth login"
else
  echo "→ not logged in, starting OAuth login"

  # ---- 2. the localhost callback bridge --------------------
  # wrangler listens on [::1]:8976 only. Browsers that resolve
  # localhost to 127.0.0.1 then fail with "unable to connect", so
  # forward IPv4 → IPv6 for the duration of the login.
  BRIDGE_PID=""
  if ! (exec 3<>/dev/tcp/127.0.0.1/8976) 2>/dev/null; then
    node -e '
      const net = require("net");
      net.createServer((c) => {
        const up = net.connect(8976, "::1");
        c.pipe(up); up.pipe(c);
        const bye = () => { c.destroy(); up.destroy(); };
        c.on("error", bye); up.on("error", bye);
      }).listen(8976, "127.0.0.1");
    ' &
    BRIDGE_PID=$!
    trap '[ -n "$BRIDGE_PID" ] && kill "$BRIDGE_PID" 2>/dev/null || true' EXIT
    echo "  (bridging 127.0.0.1:8976 → [::1]:8976 for the callback)"
  fi

  wrangler login
fi

# ---- 3. do not silently wipe live vars ----------------------
if [ "$SKIP_CHECKS" = "0" ]; then
  echo
  node "$REPO/scripts/check-worker-vars.mjs" --dir "$WORKER_DIR"
  echo
fi

wrangler deploy
