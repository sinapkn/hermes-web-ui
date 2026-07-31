#!/bin/bash
# ═══════════════════════════════════════════════════════════════════
# Hermes Web UI — One-click installer
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

# ─── Step 1: Check Hermes is installed ────────────────────────────
echo -e "${YELLOW}[1/5] Checking Hermes installation...${NC}"
if ! command -v hermes &>/dev/null; then
  echo -e "${RED}❌ Hermes CLI not found!${NC}"
  echo -e "Install Hermes first: https://hermes-agent.nousresearch.com/docs"
  exit 1
fi
echo -e "${GREEN}✅ Hermes found: $(hermes --version 2>/dev/null || echo 'installed')${NC}"

# ─── Step 2: Detect model & provider from config ──────────────────
echo -e "${YELLOW}[2/5] Detecting model & provider...${NC}"

# Read from .env file
ENV_FILE="$HERMES_DIR/.env"
if [ -f "$ENV_FILE" ]; then
  # Extract model
  MODEL=$(grep -E "^LLM_MODEL=|^MODEL=" "$ENV_FILE" 2>/dev/null | head -1 | cut -d= -f2- | tr -d '"' | tr -d "'")
  # Extract provider
  PROVIDER=$(grep -E "^CUSTOM_PROVIDER_NAME=|^PROVIDER=" "$ENV_FILE" 2>/dev/null | head -1 | cut -d= -f2- | tr -d '"' | tr -d "'")
  # Extract base URL
  BASE_URL=$(grep -E "^CUSTOM_PROVIDER_BASE_URL=|^HERMES_BASE_URL=|^BASE_URL=" "$ENV_FILE" 2>/dev/null | head -1 | cut -d= -f2- | tr -d '"' | tr -d "'")
  API_KEY=$(grep -E "^CUSTOM_PROVIDER_API_KEY=|^HERMES_API_KEY=|^API_KEY=" "$ENV_FILE" 2>/dev/null | head -1 | cut -d= -f2- | tr -d '"' | tr -d "'")
else
  echo -e "${RED}❌ No .env file found at $ENV_FILE${NC}"
  echo -e "Create one with your provider settings first."
  exit 1
fi

# Fallback: check config.yaml
if [ -z "$MODEL" ]; then
  CONFIG="$HERMES_DIR/config.yaml"
  if [ -f "$CONFIG" ]; then
    MODEL=$(grep -E "^\s*model:" "$CONFIG" | head -1 | awk '{print $2}' | tr -d '"')
  fi
fi

if [ -z "$MODEL" ]; then
  echo -e "${RED}❌ Could not detect model!${NC}"
  echo -e "Set LLM_MODEL in $ENV_FILE"
  exit 1
fi

echo -e "${GREEN}✅ Model: ${CYAN}${MODEL}${NC}"
echo -e "${GREEN}✅ Provider: ${CYAN}${PROVIDER:-auto}${NC}"
echo -e "${GREEN}✅ Base URL: ${CYAN}${BASE_URL:-auto}${NC}"

# ─── Step 3: Install Node.js dependencies ─────────────────────────
echo -e "${YELLOW}[3/5] Installing dependencies...${NC}"

if [ ! -d "$WEB_DIR" ]; then
  mkdir -p "$WEB_DIR"
fi

# Copy files from installer directory (where this script lives)
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cp "$SCRIPT_DIR/server.js" "$WEB_DIR/"
cp "$SCRIPT_DIR/package.json" "$WEB_DIR/"
cp -r "$SCRIPT_DIR/public" "$WEB_DIR/"

cd "$WEB_DIR"

if [ ! -d "node_modules" ]; then
  npm install --production 2>&1 | tail -3
fi
echo -e "${GREEN}✅ Dependencies installed${NC}"

# ─── Step 4: Auto-detect Railway TCP proxy ────────────────────────
echo -e "${YELLOW}[4/5] Detecting proxy configuration...${NC}"

# Check if Railway TCP proxy is configured
if [ -n "$RAILWAY_URL" ]; then
  PROXY_URL="$RAILWAY_URL"
  echo -e "${GREEN}✅ Railway proxy: ${CYAN}${PROXY_URL}${NC}"
else
  # Auto-detect from Railway environment
  if [ -n "$RAILWAY_PUBLIC_DOMAIN" ]; then
    PROXY_URL="https://${RAILWAY_PUBLIC_DOMAIN}"
    echo -e "${GREEN}✅ Railway auto-detected: ${CYAN}${PROXY_URL}${NC}"
  else
    # Try to find existing proxy config
    PROXY_URL=$(grep -E "^RAILWAY_URL=|^PROXY_URL=" "$WEB_DIR/.env" 2>/dev/null | head -1 | cut -d= -f2-)
    if [ -n "$PROXY_URL" ]; then
      echo -e "${GREEN}✅ Existing proxy: ${CYAN}${PROXY_URL}${NC}"
    else
      echo -e "${YELLOW}⚠️  No TCP proxy detected${NC}"
      echo -e "To expose publicly, set up a Railway TCP proxy:"
      echo -e "  1. Go to railway.app → New Project"
      echo -e "  2. Add TCP proxy service"
      echo -e "  3. Run: bash install.sh $PORT <your-railway-url>"
      PROXY_URL=""
    fi
  fi
fi

# Create .env for the web UI
cat > "$WEB_DIR/.env" << EOF
# Auto-detected by installer
PORT=$PORT
LLM_MODEL=$MODEL
HERMES_DIR=$HERMES_DIR
EOF

if [ -n "$PROXY_URL" ]; then
  echo "PROXY_URL=$PROXY_URL" >> "$WEB_DIR/.env"
fi

echo -e "${GREEN}✅ Configuration saved${NC}"

# ─── Step 5: Start with pm2 ──────────────────────────────────────
echo -e "${YELLOW}[5/5] Starting server...${NC}"

# Kill existing instance if running
pm2 delete hermes-web 2>/dev/null || true
sleep 1

# Start the server
cd "$WEB_DIR"
PORT=$PORT pm2 start server.js --name hermes-web 2>&1 | tail -3

sleep 2
STATUS=$(pm2 list 2>/dev/null | grep hermes-web | awk '{print $18}')
if [ "$STATUS" = "online" ]; then
  echo ""
  echo -e "${GREEN}════════════════════════════════════════${NC}"
  echo -e "${GREEN}   ✅ Hermes Web UI is running!         ${NC}"
  echo -e "${GREEN}════════════════════════════════════════${NC}"
  echo ""
  echo -e "  🌐 Local:  ${CYAN}http://localhost:${PORT}${NC}"
  if [ -n "$PROXY_URL" ]; then
    echo -e "  🌍 Public: ${CYAN}${PROXY_URL}${NC}"
  fi
  echo -e "  📊 Status: ${CYAN}pm2 status${NC}"
  echo -e "  📋 Logs:   ${CYAN}pm2 logs hermes-web${NC}"
  echo -e "  🔄 Restart:${CYAN}pm2 restart hermes-web${NC}"
  echo ""
  pm2 save 2>/dev/null
else
  echo -e "${RED}❌ Server failed to start. Check: pm2 logs hermes-web${NC}"
  exit 1
fi
