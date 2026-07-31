#!/bin/bash
# ═══════════════════════════════════════════════════════════════════
# Hermes Web UI — One-click installer
# Works WITH Hermes CLI (full agent) OR WITHOUT (local API chat)
# Usage: bash install.sh [PORT] [RAILWAY_URL]
# ═══════════════════════════════════════════════════════════════════
set -e

PORT="${1:-3000}"
RAILWAY_URL="${2:-}"
HERMES_DIR="${HERMES_DIR:-/data/.hermes}"
WEB_DIR="/data/hermes-web-ui"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

echo -e "${CYAN}════════════════════════════════════════${NC}"
echo -e "${CYAN}   🚀 Hermes Web UI Installer          ${NC}"
echo -e "${CYAN}════════════════════════════════════════${NC}"
echo ""

# ─── Step 1: Check Hermes ─────────────────────────────────────────
echo -e "${YELLOW}[1/6] Checking Hermes installation...${NC}"
HERMES_MODE=false
if command -v hermes &>/dev/null; then
  echo -e "${GREEN}✅ Hermes found: $(hermes --version 2>/dev/null || echo 'installed')${NC}"
  HERMES_MODE=true
else
  echo -e "${YELLOW}⚠️  Hermes CLI not found — running in local mode${NC}"
  echo -e "   (Chat only, no server tools. Install Hermes for full agent features)"
fi

# ─── Step 2: Detect or ask for API config ─────────────────────────
echo -e "${YELLOW}[2/6] Detecting API configuration...${NC}"

MODEL=""
PROVIDER=""
BASE_URL=""
API_KEY=""
HERMES_DIR_EXISTS=false

if [ "$HERMES_MODE" = true ]; then
  # Read from Hermes config
  ENV_FILE="$HERMES_DIR/.env"
  CONFIG_FILE="$HERMES_DIR/config.yaml"
  HERMES_DIR_EXISTS=true

  if [ -f "$ENV_FILE" ]; then
    # shellcheck disable=SC1090
    g() { grep -E "^$1=" "$ENV_FILE" 2>/dev/null | head -1 | cut -d= -f2- | tr -d '"' | tr -d "'"; }
    MODEL=$(g 'LLM_MODEL')
    MODEL=${MODEL:-$(g 'MODEL')}
    PROVIDER=$(g 'CUSTOM_PROVIDER_NAME')
    PROVIDER=${PROVIDER:-$(g 'PROVIDER')}
    BASE_URL=$(g 'CUSTOM_PROVIDER_BASE_URL')
    BASE_URL=${BASE_URL:-$(g 'HERMES_BASE_URL')}
    API_KEY=$(g 'CUSTOM_PROVIDER_API_KEY')
    API_KEY=${API_KEY:-$(g 'HERMES_API_KEY')}
  fi

  # Fallback: config.yaml
  if [ -z "$PROVIDER" ] && [ -f "$CONFIG_FILE" ]; then
    PROVIDER=$(grep -E "^\s*provider:" "$CONFIG_FILE" | head -1 | awk '{print $2}' | tr -d '"')
  fi

  # Fallback: hermes status
  if [ -z "$MODEL" ]; then
    MODEL=$(hermes status 2>&1 | grep -oP 'Model:\s+\K.*' | head -1 | xargs)
  fi
  if [ -z "$PROVIDER" ]; then
    PROVIDER=$(hermes status 2>&1 | grep -oP 'Provider:\s+\K.*' | head -1 | xargs)
  fi
fi

# If no model detected (or no Hermes), try reading from local .env
if [ -z "$MODEL" ]; then
  # Check if there's a .env in the project directory
  if [ -f "$WEB_DIR/.env" ]; then
    MODEL=$(grep -E "^LLM_MODEL=|^MODEL=" "$WEB_DIR/.env" 2>/dev/null | head -1 | cut -d= -f2- | tr -d '"')
    API_KEY=$(grep -E "^API_KEY=|^CUSTOM_PROVIDER_API_KEY=" "$WEB_DIR/.env" 2>/dev/null | head -1 | cut -d= -f2- | tr -d '"')
    BASE_URL=$(grep -E "^BASE_URL=|^CUSTOM_PROVIDER_BASE_URL=" "$WEB_DIR/.env" 2>/dev/null | head -1 | cut -d= -f2- | tr -d '"')
  fi
fi

# If still no model, ask user
if [ -z "$MODEL" ]; then
  echo ""
  echo -e "${CYAN}Enter your LLM configuration:${NC}"
  read -rp "  Model name (e.g. gpt-4o, claude-sonnet-4, llama-3): " MODEL
  read -rp "  API Base URL (e.g. https://api.openai.com/v1): " BASE_URL
  read -rp "  API Key: " API_KEY
  PROVIDER="custom"
fi

if [ -z "$MODEL" ]; then
  echo -e "${RED}❌ Model name is required!${NC}"
  exit 1
fi

echo -e "${GREEN}✅ Model: ${CYAN}${MODEL}${NC}"
echo -e "${GREEN}✅ Provider: ${CYAN}${PROVIDER:-custom}${NC}"

# ─── Step 3: Install dependencies ─────────────────────────────────
echo -e "${YELLOW}[3/6] Installing dependencies...${NC}"

mkdir -p "$WEB_DIR"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cp "$SCRIPT_DIR/server.js" "$WEB_DIR/"
cp "$SCRIPT_DIR/package.json" "$WEB_DIR/"
cp -r "$SCRIPT_DIR/public" "$WEB_DIR/"

cd "$WEB_DIR"

if [ ! -d "node_modules" ]; then
  npm install --production 2>&1 | tail -3
fi
echo -e "${GREEN}✅ Dependencies installed${NC}"

# ─── Step 4: Detect Railway proxy ─────────────────────────────────
echo -e "${YELLOW}[4/6] Detecting proxy configuration...${NC}"

if [ -n "$RAILWAY_URL" ]; then
  PROXY_URL="$RAILWAY_URL"
  echo -e "${GREEN}✅ Railway proxy: ${CYAN}${PROXY_URL}${NC}"
elif [ -n "$RAILWAY_PUBLIC_DOMAIN" ]; then
  PROXY_URL="https://${RAILWAY_PUBLIC_DOMAIN}"
  echo -e "${GREEN}✅ Railway auto-detected: ${CYAN}${PROXY_URL}${NC}"
else
  PROXY_URL=""
  echo -e "${YELLOW}⚠️  No TCP proxy detected${NC}"
  if [ "$PORT" != "3000" ] || [ "$PORT" != "8080" ]; then
    echo -e "   Run locally: ${CYAN}http://localhost:${PORT}${NC}"
  else
    echo -e "   Run locally: ${CYAN}http://localhost:${PORT}${NC}"
  fi
fi

# ─── Step 5: Write config ─────────────────────────────────────────
echo -e "${YELLOW}[5/6] Writing configuration...${NC}"

cat > "$WEB_DIR/.env" << EOF
# Auto-configured by installer
PORT=$PORT
LLM_MODEL=$MODEL
BASE_URL=$BASE_URL
API_KEY=$API_KEY
HERMES_MODE=$HERMES_MODE
HERMES_DIR=$HERMES_DIR
EOF

if [ -n "$PROXY_URL" ]; then
  echo "PROXY_URL=$PROXY_URL" >> "$WEB_DIR/.env"
fi

echo -e "${GREEN}✅ Configuration saved${NC}"

# ─── Step 6: Start ────────────────────────────────────────────────
echo -e "${YELLOW}[6/6] Starting server...${NC}"

pm2 delete hermes-web 2>/dev/null || true
sleep 1

cd "$WEB_DIR"
PORT=$PORT pm2 start server.js --name hermes-web --no-autorestart 2>&1 | tail -3

sleep 2
STATUS=$(pm2 list 2>/dev/null | grep hermes-web | awk '{print $18}')
if [ "$STATUS" = "online" ]; then
  pm2 save 2>/dev/null || true
  echo ""
  echo -e "${GREEN}════════════════════════════════════════${NC}"
  echo -e "${GREEN}   ✅ Hermes Web UI is running!         ${NC}"
  echo -e "${GREEN}════════════════════════════════════════${NC}"
  echo ""
  echo -e "  Mode:     ${CYAN}$([ "$HERMES_MODE" = true ] && echo "Full Agent (Hermes CLI)" || echo "Local Chat (API direct)")${NC}"
  echo -e "  Model:    ${CYAN}${MODEL}${NC}"
  echo -e "  🌐 Local:  ${CYAN}http://localhost:${PORT}${NC}"
  if [ -n "$PROXY_URL" ]; then
    echo -e "  🌍 Public: ${CYAN}${PROXY_URL}${NC}"
  fi
  echo -e "  📊 Status: ${CYAN}pm2 status${NC}"
  echo -e "  📋 Logs:   ${CYAN}pm2 logs hermes-web${NC}"
  echo -e "  🔄 Restart:${CYAN}pm2 restart hermes-web${NC}"
  echo ""
else
  echo -e "${RED}❌ Server failed to start. Check: pm2 logs hermes-web${NC}"
  exit 1
fi
