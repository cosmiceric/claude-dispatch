#!/usr/bin/env bash
set -euo pipefail

# ─── Dispatch Setup Wizard ───

BOLD='\033[1m'
DIM='\033[2m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
RED='\033[0;31m'
CYAN='\033[0;36m'
NC='\033[0m'

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

info()  { echo -e "${CYAN}ℹ${NC}  $1"; }
ok()    { echo -e "${GREEN}✓${NC}  $1"; }
warn()  { echo -e "${YELLOW}⚠${NC}  $1"; }
fail()  { echo -e "${RED}✗${NC}  $1"; exit 1; }

echo ""
echo -e "${BOLD}Dispatch Setup${NC}"
echo -e "${DIM}Discord-powered remote approvals for Claude Code${NC}"
echo ""

# ─── Prerequisites ───

info "Checking prerequisites..."

command -v node  >/dev/null 2>&1 || fail "node is required. Install from https://nodejs.org"
command -v npm   >/dev/null 2>&1 || fail "npm is required (comes with node)"
command -v npx   >/dev/null 2>&1 || fail "npx is required (comes with node)"

# Check for wrangler — installed globally or locally
if command -v wrangler >/dev/null 2>&1; then
  WRANGLER="wrangler"
elif npx wrangler --version >/dev/null 2>&1; then
  WRANGLER="npx wrangler"
else
  fail "wrangler is required. Install with: npm i -g wrangler"
fi

ok "Prerequisites met (node, npm, wrangler)"

# ─── Display Name ───

echo ""
read -rp "$(echo -e "${CYAN}?${NC}")  Your display name (shown in Discord messages): " DISPLAY_NAME
DISPLAY_NAME="${DISPLAY_NAME:-User}"
ok "Display name: ${DISPLAY_NAME}"

# ─── Cloudflare Account ───

echo ""
info "Detecting Cloudflare account..."

ACCOUNT_ID=""
# Try to get account ID from wrangler whoami
WHOAMI_OUTPUT=$($WRANGLER whoami 2>&1 || true)
DETECTED_ID=$(echo "$WHOAMI_OUTPUT" | grep -oE '[a-f0-9]{32}' | head -1 || true)

if [ -n "$DETECTED_ID" ]; then
  echo -e "  ${DIM}Detected account ID: ${DETECTED_ID}${NC}"
  read -rp "$(echo -e "${CYAN}?${NC}")  Use this account ID? [Y/n]: " USE_DETECTED
  if [[ "${USE_DETECTED:-Y}" =~ ^[Yy]?$ ]]; then
    ACCOUNT_ID="$DETECTED_ID"
  fi
fi

if [ -z "$ACCOUNT_ID" ]; then
  read -rp "$(echo -e "${CYAN}?${NC}")  Cloudflare account ID: " ACCOUNT_ID
  [ -z "$ACCOUNT_ID" ] && fail "Account ID is required"
fi
ok "Account ID: ${ACCOUNT_ID}"

# ─── Install Dependencies ───

echo ""
info "Installing dependencies..."
(cd "$REPO_ROOT" && npm install --silent)
ok "Dependencies installed"

# ─── Create D1 Database ───

echo ""
info "Creating D1 database..."

D1_OUTPUT=$($WRANGLER d1 create dispatch 2>&1 || true)

if echo "$D1_OUTPUT" | grep -q "already exists"; then
  warn "D1 database 'dispatch' already exists"
  read -rp "$(echo -e "${CYAN}?${NC}")  Enter existing database_id: " DATABASE_ID
  [ -z "$DATABASE_ID" ] && fail "Database ID is required"
else
  DATABASE_ID=$(echo "$D1_OUTPUT" | grep -oE 'database_id\s*=\s*"[^"]*"' | grep -oE '[a-f0-9-]{36}' || true)
  if [ -z "$DATABASE_ID" ]; then
    echo "$D1_OUTPUT"
    fail "Could not parse database_id from wrangler output. Create manually and re-run."
  fi
  ok "D1 database created: ${DATABASE_ID}"
fi

# ─── Generate wrangler.toml ───

echo ""
info "Generating wrangler.toml..."

cat > "$REPO_ROOT/packages/server/wrangler.toml" <<EOF
name = "dispatch"
main = "src/index.ts"
compatibility_date = "2025-03-01"
account_id = "${ACCOUNT_ID}"

[[d1_databases]]
binding = "DB"
database_name = "dispatch"
database_id = "${DATABASE_ID}"

[durable_objects]
bindings = [
  { name = "SESSION_DO", class_name = "SessionDO" }
]

[[migrations]]
tag = "v1"
new_classes = ["SessionDO"]

[vars]
DISPATCH_USER_NAME = "${DISPLAY_NAME}"
EOF

ok "Generated packages/server/wrangler.toml"

# ─── Run D1 Migration ───

echo ""
info "Running D1 schema migration..."
(cd "$REPO_ROOT/packages/server" && $WRANGLER d1 execute dispatch --remote --file=schema.sql)
ok "Database schema applied"

# ─── Discord Credentials ───

echo ""
echo -e "${BOLD}Discord Bot Setup${NC}"
echo -e "${DIM}You'll need a Discord app with a bot. See README.md for instructions.${NC}"
echo ""

read -rp "$(echo -e "${CYAN}?${NC}")  Discord bot token: " DISCORD_BOT_TOKEN
[ -z "$DISCORD_BOT_TOKEN" ] && fail "Bot token is required"

read -rp "$(echo -e "${CYAN}?${NC}")  Discord app public key: " DISCORD_PUBLIC_KEY
[ -z "$DISCORD_PUBLIC_KEY" ] && fail "Public key is required"

read -rp "$(echo -e "${CYAN}?${NC}")  Discord channel ID (for notifications): " DISCORD_CHANNEL_ID
[ -z "$DISCORD_CHANNEL_ID" ] && fail "Channel ID is required"

# ─── Generate API Key ───

API_KEY="dispatch_$(openssl rand -hex 24)"
ok "Generated API key: ${API_KEY}"

# ─── Set Wrangler Secrets ───

echo ""
info "Setting Cloudflare Worker secrets..."

echo "$API_KEY" | $WRANGLER secret put COMPANION_API_KEY --name dispatch
echo "$DISCORD_BOT_TOKEN" | $WRANGLER secret put DISCORD_BOT_TOKEN --name dispatch
echo "$DISCORD_PUBLIC_KEY" | $WRANGLER secret put DISCORD_PUBLIC_KEY --name dispatch
echo "$DISCORD_CHANNEL_ID" | $WRANGLER secret put DISCORD_CHANNEL_ID --name dispatch

ok "Secrets configured"

# ─── Deploy Worker ───

echo ""
info "Deploying Cloudflare Worker..."

DEPLOY_OUTPUT=$(cd "$REPO_ROOT/packages/server" && $WRANGLER deploy 2>&1)
WORKER_URL=$(echo "$DEPLOY_OUTPUT" | grep -oE 'https://[^ ]*\.workers\.dev' | head -1 || true)

if [ -z "$WORKER_URL" ]; then
  echo "$DEPLOY_OUTPUT"
  warn "Could not detect worker URL from output. Check above for the URL."
  read -rp "$(echo -e "${CYAN}?${NC}")  Enter worker URL (e.g. https://dispatch.you.workers.dev): " WORKER_URL
fi

ok "Worker deployed: ${WORKER_URL}"

# ─── Build Hooks ───

echo ""
info "Building hooks..."
(cd "$REPO_ROOT" && npm run build -w packages/hooks)
ok "Hooks built"

# ─── Configure Claude Code Settings ───

echo ""
info "Configuring Claude Code settings..."

HOOKS_DIR="$REPO_ROOT/packages/hooks/dist"

node -e "
const fs = require('fs');
const path = require('path');
const os = require('os');

const settingsPath = path.join(os.homedir(), '.claude', 'settings.json');
let settings = {};

try {
  settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
} catch {}

// Ensure hooks structure
if (!settings.hooks) settings.hooks = {};

// PreToolUse hook
const preToolUse = {
  type: 'command',
  command: 'node ${HOOKS_DIR}/pre-tool-use.js',
};
if (!settings.hooks.PreToolUse) settings.hooks.PreToolUse = [];
const hasPreTool = settings.hooks.PreToolUse.some(h => h.command && h.command.includes('dispatch'));
if (!hasPreTool) settings.hooks.PreToolUse.push(preToolUse);

// Elicitation hook
const elicitation = {
  type: 'command',
  command: 'node ${HOOKS_DIR}/elicitation.js',
};
if (!settings.hooks.Elicitation) settings.hooks.Elicitation = [];
const hasElicit = settings.hooks.Elicitation.some(h => h.command && h.command.includes('dispatch'));
if (!hasElicit) settings.hooks.Elicitation.push(elicitation);

// Environment variables
if (!settings.env) settings.env = {};
settings.env.DISPATCH_URL = '${WORKER_URL}';
settings.env.DISPATCH_API_KEY = '${API_KEY}';
settings.env.DISPATCH_USER_NAME = '${DISPLAY_NAME}';

fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n');
"

ok "Claude Code settings updated (~/.claude/settings.json)"

# ─── Copy Command Template ───

info "Installing /dispatch command..."
mkdir -p "$HOME/.claude/commands"
cp "$REPO_ROOT/commands/dispatch.md" "$HOME/.claude/commands/dispatch.md"
ok "Installed /dispatch command"

# ─── Create Toggle File ───

echo "false" > "$HOME/.dispatch-enabled"
ok "Created ~/.dispatch-enabled (initially off)"

# ─── Summary ───

echo ""
echo -e "${BOLD}${GREEN}Setup complete!${NC}"
echo ""
echo -e "  Worker URL:       ${CYAN}${WORKER_URL}${NC}"
echo -e "  Interactions URL: ${CYAN}${WORKER_URL}/discord/interactions${NC}"
echo -e "  API Key:          ${DIM}${API_KEY}${NC}"
echo ""
echo -e "${BOLD}Next steps:${NC}"
echo -e "  1. Go to your Discord app settings → General Information"
echo -e "     Set ${CYAN}Interactions Endpoint URL${NC} to:"
echo -e "     ${CYAN}${WORKER_URL}/discord/interactions${NC}"
echo ""
echo -e "  2. Start Claude Code and run ${CYAN}/dispatch${NC} to toggle notifications on"
echo ""
