#!/usr/bin/env bash
# marketplace-lister-mcp installer
#   curl -fsSL https://raw.githubusercontent.com/noobsplzwin/marketplace-lister-mcp/main/install.sh | bash
#
# Clones (or updates) the server under ~/.marketplace-lister-mcp/app, builds it,
# and registers it with Claude Code. Safe to re-run: it updates in place.

set -euo pipefail

REPO="https://github.com/noobsplzwin/marketplace-lister-mcp.git"
ROOT="${MARKETPLACE_LISTER_HOME:-$HOME/.marketplace-lister-mcp}"
APP="$ROOT/app"
NAME="marketplace-lister"

say()  { printf '\033[36m==>\033[0m %s\n' "$1"; }
warn() { printf '\033[33m warn\033[0m %s\n' "$1"; }
die()  { printf '\033[31merror\033[0m %s\n' "$1" >&2; exit 1; }

# --- prerequisites -----------------------------------------------------------
command -v git >/dev/null 2>&1 || die "git is required. Install it and re-run."
command -v node >/dev/null 2>&1 || die "Node.js 18+ is required. Install it from https://nodejs.org and re-run."

NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
[ "$NODE_MAJOR" -ge 18 ] || die "Node.js 18+ is required (found $(node --version))."

command -v npm >/dev/null 2>&1 || die "npm is required. It ships with Node.js."

# --- fetch -------------------------------------------------------------------
if [ -d "$APP/.git" ]; then
  say "Updating existing install in $APP"
  git -C "$APP" fetch --quiet origin main
  git -C "$APP" reset --quiet --hard origin/main
else
  say "Cloning into $APP"
  mkdir -p "$ROOT"
  rm -rf "$APP"
  git clone --quiet --depth 1 "$REPO" "$APP"
fi

# --- build -------------------------------------------------------------------
say "Installing dependencies and building"
( cd "$APP" && npm install --silent --no-fund --no-audit )
[ -f "$APP/dist/index.js" ] || die "Build did not produce dist/index.js. Run 'npm install' in $APP to see why."

# --- browser check -----------------------------------------------------------
if ! node -e '
const { execSync } = require("child_process");
const p = process.platform;
const probes = p === "darwin"
  ? ["/Applications/Google Chrome.app", "/Applications/Microsoft Edge.app"]
  : p === "win32"
    ? [process.env["ProgramFiles"] + "\\Google\\Chrome\\Application\\chrome.exe",
       process.env["ProgramFiles(x86)"] + "\\Google\\Chrome\\Application\\chrome.exe",
       process.env["ProgramFiles(x86)"] + "\\Microsoft\\Edge\\Application\\msedge.exe"]
    : [];
const fs = require("fs");
let found = probes.some(f => { try { return fs.existsSync(f); } catch { return false; } });
if (!found && p === "linux") {
  for (const c of ["google-chrome", "chromium", "microsoft-edge"]) {
    try { execSync("command -v " + c, { stdio: "ignore" }); found = true; break; } catch {}
  }
}
process.exit(found ? 0 : 1);
' 2>/dev/null; then
  warn "No Chrome or Edge detected. Downloading Playwright's Chromium instead (~150 MB)."
  ( cd "$APP" && npx --yes playwright install chromium )
fi

# --- register with Claude Code ----------------------------------------------
ENTRY="$APP/dist/index.js"
if command -v claude >/dev/null 2>&1; then
  claude mcp remove "$NAME" >/dev/null 2>&1 || true
  if claude mcp add "$NAME" -- node "$ENTRY"; then
    say "Registered with Claude Code as \"$NAME\""
  else
    warn "Could not register automatically. Add it manually:"
    printf '\n  claude mcp add %s -- node "%s"\n\n' "$NAME" "$ENTRY"
  fi
else
  warn "Claude Code CLI not found. Add this to your MCP client's config:"
  cat <<JSON

  {
    "mcpServers": {
      "$NAME": {
        "command": "node",
        "args": ["$ENTRY"]
      }
    }
  }

JSON
fi

cat <<'DONE'

Installed. Next:

  1. Start Claude and say: "log in to Facebook Marketplace"
     A browser window opens. Sign in once; the session is saved for future runs.

  2. Put each item's photos in its own folder, then say:
     "post everything in <that folder> to Marketplace"

You confirm every price, and nothing publishes until you approve the preview.

DONE
