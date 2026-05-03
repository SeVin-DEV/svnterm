#!/usr/bin/env bash
# ============================================================
#  Terminal AI — Self-Host Install Script
#  Supports: Ubuntu 22.04+ / Debian 12+
#  Run as root or a user with sudo access.
#  Usage:  bash install.sh
# ============================================================

set -euo pipefail

# ── Colours ─────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
BLUE='\033[0;34m'; CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'

info()    { echo -e "${CYAN}[INFO]${NC}  $*"; }
success() { echo -e "${GREEN}[OK]${NC}    $*"; }
warn()    { echo -e "${YELLOW}[WARN]${NC}  $*"; }
error()   { echo -e "${RED}[ERROR]${NC} $*" >&2; exit 1; }
step()    { echo -e "\n${BOLD}${BLUE}━━━ $* ${NC}"; }

# ── Banner ───────────────────────────────────────────────────
echo -e "${BOLD}${CYAN}"
cat <<'EOF'
  _____ _____  __  __ ___ _  _   _   _        _   ___ 
 |_   _| __\ \/ / |  \/  |_ _| \| | /_\  | |   /_\ |_ _|
   | | | _| >  <  | |\/| || || .` |/ _ \ | |__/ _ \ | | 
   |_| |___/_/\_\ |_|  |_|___|_|\_/_/ \_\|____/_/ \_\___|
                                                           
  Self-Host Installer  ·  SSH Terminal + AI Coding Assistant
EOF
echo -e "${NC}"

# ── Pre-flight ───────────────────────────────────────────────
step "Pre-flight checks"

[[ "$OSTYPE" == "linux-gnu"* ]] || error "This script requires Linux (Ubuntu/Debian)."

if ! command -v apt-get &>/dev/null; then
  error "apt-get not found. Only Ubuntu/Debian is supported."
fi

SUDO=""
if [[ "$EUID" -ne 0 ]]; then
  command -v sudo &>/dev/null || error "Please run as root or install sudo."
  SUDO="sudo"
fi
success "OS check passed"

# ── Gather config from user ───────────────────────────────────
step "Configuration"

read -rp "$(echo -e "${BOLD}GitHub repo URL${NC} (e.g. https://github.com/you/terminal-ai): ")" REPO_URL
[[ -n "$REPO_URL" ]] || error "Repo URL is required."

read -rp "$(echo -e "${BOLD}Install directory${NC} [/opt/terminal-ai]: ")" INSTALL_DIR
INSTALL_DIR="${INSTALL_DIR:-/opt/terminal-ai}"

read -rp "$(echo -e "${BOLD}Domain / IP${NC} for nginx (e.g. terminal.example.com or your server IP): ")" DOMAIN
[[ -n "$DOMAIN" ]] || error "Domain/IP is required."

read -rp "$(echo -e "${BOLD}API server port${NC} [3001]: ")" API_PORT
API_PORT="${API_PORT:-3001}"

read -rp "$(echo -e "${BOLD}PostgreSQL database name${NC} [terminalai]: ")" DB_NAME
DB_NAME="${DB_NAME:-terminalai}"

read -rp "$(echo -e "${BOLD}PostgreSQL user${NC} [terminalai]: ")" DB_USER
DB_USER="${DB_USER:-terminalai}"

read -srp "$(echo -e "${BOLD}PostgreSQL password${NC} (input hidden): ")" DB_PASS
echo
[[ -n "$DB_PASS" ]] || error "Database password is required."

# Generate a random session secret if not provided
SESSION_SECRET=$(openssl rand -hex 32)
info "Generated random SESSION_SECRET (saved to .env)"

read -rp "$(echo -e "${BOLD}Set up SSL with Let's Encrypt?${NC} (requires a real domain, not an IP) [y/N]: ")" SETUP_SSL
SETUP_SSL="${SETUP_SSL,,}"

DATABASE_URL="postgresql://${DB_USER}:${DB_PASS}@localhost:5432/${DB_NAME}"

echo ""
echo -e "${BOLD}Summary:${NC}"
echo "  Install dir : $INSTALL_DIR"
echo "  Domain/IP   : $DOMAIN"
echo "  API port    : $API_PORT"
echo "  Database    : $DB_NAME @ localhost:5432"
echo "  SSL         : ${SETUP_SSL}"
echo ""
read -rp "Continue? [Y/n]: " CONFIRM
CONFIRM="${CONFIRM,,}"
[[ "$CONFIRM" == "n" ]] && exit 0

# ── System packages ───────────────────────────────────────────
step "Installing system packages"

$SUDO apt-get update -qq
$SUDO apt-get install -y -qq \
  curl git build-essential ca-certificates gnupg lsb-release \
  nginx postgresql postgresql-contrib openssl

success "System packages installed"

# ── Piper TTS ─────────────────────────────────────────────────
step "Installing Piper TTS (local neural text-to-speech)"

PIPER_DIR="/opt/piper"
PIPER_BINARY="/usr/local/bin/piper"
PIPER_MODEL_PATH="${PIPER_DIR}/en_US-lessac-medium.onnx"
PIPER_VERSION="2023.11.14-2"

if [[ -x "$PIPER_BINARY" && -f "$PIPER_MODEL_PATH" ]]; then
  success "Piper TTS already installed"
else
  $SUDO mkdir -p "$PIPER_DIR"

  # Download and extract piper binary
  if [[ ! -x "$PIPER_BINARY" ]]; then
    info "Downloading piper binary..."
    TMP_PIPER="/tmp/piper_linux.tar.gz"
    curl -fsSL \
      "https://github.com/rhasspy/piper/releases/download/${PIPER_VERSION}/piper_linux_x86_64.tar.gz" \
      -o "$TMP_PIPER"
    $SUDO tar -xzf "$TMP_PIPER" -C "$PIPER_DIR" --strip-components=1
    $SUDO ln -sf "${PIPER_DIR}/piper" "$PIPER_BINARY"
    rm -f "$TMP_PIPER"
    success "Piper binary installed at $PIPER_BINARY"
  fi

  # Download voice model (en_US-lessac-medium, ~63 MB)
  if [[ ! -f "$PIPER_MODEL_PATH" ]]; then
    info "Downloading en_US-lessac-medium voice model (~63 MB)..."
    VOICE_BASE="https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/en/en_US/lessac/medium"
    $SUDO curl -fsSL "${VOICE_BASE}/en_US-lessac-medium.onnx"      -o "$PIPER_MODEL_PATH"
    $SUDO curl -fsSL "${VOICE_BASE}/en_US-lessac-medium.onnx.json" \
      -o "${PIPER_MODEL_PATH}.json"
    success "Voice model downloaded to $PIPER_MODEL_PATH"
  fi
fi

# ── Node.js ───────────────────────────────────────────────────
step "Installing Node.js 22 (LTS)"

if ! command -v node &>/dev/null || [[ "$(node --version | cut -d. -f1 | tr -d 'v')" -lt 20 ]]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | $SUDO -E bash -
  $SUDO apt-get install -y nodejs
  success "Node.js $(node --version) installed"
else
  success "Node.js $(node --version) already installed"
fi

# ── pnpm ──────────────────────────────────────────────────────
step "Installing pnpm"

if ! command -v pnpm &>/dev/null; then
  npm install -g pnpm
  success "pnpm $(pnpm --version) installed"
else
  success "pnpm $(pnpm --version) already installed"
fi

# ── PM2 ───────────────────────────────────────────────────────
step "Installing PM2 (process manager)"

if ! command -v pm2 &>/dev/null; then
  npm install -g pm2
  success "PM2 installed"
else
  success "PM2 already installed"
fi

# ── PostgreSQL ────────────────────────────────────────────────
step "Configuring PostgreSQL"

$SUDO systemctl enable --now postgresql

# Helper — works whether running as root or a sudo user
pg() { sudo -u postgres psql "$@"; }

# Create DB user and database (idempotent)
pg -tc "SELECT 1 FROM pg_roles WHERE rolname='${DB_USER}'" | grep -q 1 || \
  pg -c "CREATE USER \"${DB_USER}\" WITH PASSWORD '${DB_PASS}';"

pg -tc "SELECT 1 FROM pg_database WHERE datname='${DB_NAME}'" | grep -q 1 || \
  pg -c "CREATE DATABASE \"${DB_NAME}\" OWNER \"${DB_USER}\";"

pg -c "GRANT ALL PRIVILEGES ON DATABASE \"${DB_NAME}\" TO \"${DB_USER}\";" >/dev/null

success "PostgreSQL database '${DB_NAME}' ready"

# ── Clone / update repo ───────────────────────────────────────
step "Cloning repository"

if [[ -d "$INSTALL_DIR/.git" ]]; then
  warn "Existing installation found — pulling latest code"
  git -C "$INSTALL_DIR" pull
else
  $SUDO git clone "$REPO_URL" "$INSTALL_DIR"
  # Make install dir owned by current user so we don't need sudo for pnpm
  if [[ "$EUID" -ne 0 ]]; then
    $SUDO chown -R "$USER:$USER" "$INSTALL_DIR"
  fi
fi

success "Code ready at $INSTALL_DIR"

# ── Environment file ──────────────────────────────────────────
step "Writing .env"

ENV_FILE="$INSTALL_DIR/.env"

cat > "$ENV_FILE" <<EOF
NODE_ENV=production
DATABASE_URL=${DATABASE_URL}
SESSION_SECRET=${SESSION_SECRET}

# API server port — nginx proxies /api here
PORT=${API_PORT}

# Frontend build vars (used at build time only)
BASE_PATH=/
EOF

success ".env written to $ENV_FILE"
warn "Your SESSION_SECRET is in $ENV_FILE — keep this file private."

# ── Install dependencies ──────────────────────────────────────
step "Installing pnpm dependencies"

cd "$INSTALL_DIR"
pnpm install --frozen-lockfile

success "Dependencies installed"

# ── Database migrations ───────────────────────────────────────
step "Running database migrations"

cd "$INSTALL_DIR"
DATABASE_URL="$DATABASE_URL" pnpm --filter @workspace/db run push

success "Database schema up to date"

# ── Build frontend ────────────────────────────────────────────
step "Building frontend (React + Vite)"

cd "$INSTALL_DIR"
# PORT is required by vite.config.ts validation but not used during `build`
PORT=1 BASE_PATH=/ NODE_ENV=production \
  pnpm --filter @workspace/terminal-ai run build

FRONTEND_DIST="$INSTALL_DIR/artifacts/terminal-ai/dist/public"
[[ -d "$FRONTEND_DIST" ]] || error "Frontend build output not found at $FRONTEND_DIST"
success "Frontend built → $FRONTEND_DIST"

# ── Build API server ──────────────────────────────────────────
step "Building API server"

cd "$INSTALL_DIR"
pnpm --filter @workspace/api-server run build

success "API server built → $INSTALL_DIR/artifacts/api-server/dist/"

# ── PM2 ecosystem file ────────────────────────────────────────
step "Configuring PM2"

PM2_CONFIG="$INSTALL_DIR/ecosystem.config.cjs"

cat > "$PM2_CONFIG" <<EOF
module.exports = {
  apps: [
    {
      name: "terminal-ai-api",
      script: "./artifacts/api-server/dist/index.mjs",
      cwd: "${INSTALL_DIR}",
      interpreter: "node",
      interpreter_args: "--enable-source-maps",
      env: {
        NODE_ENV: "production",
        PORT: "${API_PORT}",
        DATABASE_URL: "${DATABASE_URL}",
        SESSION_SECRET: "${SESSION_SECRET}",
        PIPER_BINARY: "${PIPER_BINARY}",
        PIPER_MODEL: "${PIPER_MODEL_PATH}",
      },
      max_memory_restart: "512M",
      restart_delay: 3000,
      log_date_format: "YYYY-MM-DD HH:mm:ss",
    },
  ],
};
EOF

# Start or reload
if pm2 list | grep -q "terminal-ai-api"; then
  pm2 reload "$PM2_CONFIG" --update-env
else
  pm2 start "$PM2_CONFIG"
fi

pm2 save
# Set PM2 to start on boot
pm2 startup | tail -1 | $SUDO bash || warn "Run the 'pm2 startup' command shown above manually to enable auto-start."

success "PM2 running. Check with: pm2 status"

# ── nginx ─────────────────────────────────────────────────────
step "Configuring nginx"

NGINX_CONF="/etc/nginx/sites-available/terminal-ai"

$SUDO tee "$NGINX_CONF" > /dev/null <<EOF
server {
    listen 80;
    server_name ${DOMAIN};

    # ── Static frontend ──────────────────────────────────────
    root ${FRONTEND_DIST};
    index index.html;

    # ── API + WebSocket proxy ────────────────────────────────
    location /api/ {
        proxy_pass http://127.0.0.1:${API_PORT};
        proxy_http_version 1.1;

        # WebSocket upgrade (SSH terminal)
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";

        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;

        # Longer timeouts for SSH sessions
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;

        # Disable buffering for streaming responses
        proxy_buffering off;
    }

    # ── SPA fallback (React Router) ──────────────────────────
    location / {
        try_files \$uri \$uri/ /index.html;
    }

    # ── Security headers ─────────────────────────────────────
    add_header X-Frame-Options SAMEORIGIN;
    add_header X-Content-Type-Options nosniff;
    add_header Referrer-Policy strict-origin-when-cross-origin;

    # ── Gzip ─────────────────────────────────────────────────
    gzip on;
    gzip_types text/plain text/css application/json application/javascript
               text/xml application/xml application/xml+rss text/javascript
               application/wasm;
    gzip_min_length 1024;
}
EOF

$SUDO ln -sf "$NGINX_CONF" /etc/nginx/sites-enabled/terminal-ai
$SUDO rm -f /etc/nginx/sites-enabled/default

$SUDO nginx -t
$SUDO systemctl enable --now nginx
$SUDO systemctl reload nginx

success "nginx configured and reloaded"

# ── SSL with Let's Encrypt ────────────────────────────────────
if [[ "$SETUP_SSL" == "y" ]]; then
  step "Setting up SSL (Let's Encrypt / Certbot)"

  if ! command -v certbot &>/dev/null; then
    $SUDO apt-get install -y certbot python3-certbot-nginx
  fi

  read -rp "Email address for Let's Encrypt notifications: " LE_EMAIL
  [[ -n "$LE_EMAIL" ]] || error "Email is required for Let's Encrypt."

  $SUDO certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos -m "$LE_EMAIL"
  $SUDO systemctl reload nginx
  success "SSL certificate issued and nginx updated"
fi

# ── Update script ─────────────────────────────────────────────
cat > "$INSTALL_DIR/update.sh" <<'UPDATEEOF'
#!/usr/bin/env bash
# Run this script to pull the latest code and redeploy.
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR"

echo "→ Pulling latest code..."
git pull

echo "→ Installing dependencies..."
pnpm install --frozen-lockfile

echo "→ Running migrations..."
source "$DIR/.env"
DATABASE_URL="$DATABASE_URL" pnpm --filter @workspace/db run push

echo "→ Building frontend..."
PORT=1 BASE_PATH=/ NODE_ENV=production pnpm --filter @workspace/terminal-ai run build

echo "→ Building API server..."
pnpm --filter @workspace/api-server run build

echo "→ Reloading PM2..."
pm2 reload ecosystem.config.cjs --update-env

echo "✓ Update complete"
UPDATEEOF
chmod +x "$INSTALL_DIR/update.sh"

# ── Done ──────────────────────────────────────────────────────
step "Installation complete"

echo -e "${GREEN}${BOLD}"
echo "  ╔══════════════════════════════════════════════════════╗"
echo "  ║          Terminal AI is running!                     ║"
echo "  ╚══════════════════════════════════════════════════════╝"
echo -e "${NC}"

PROTO="http"
[[ "$SETUP_SSL" == "y" ]] && PROTO="https"

echo -e "  ${BOLD}App URL    :${NC}  ${PROTO}://${DOMAIN}"
echo -e "  ${BOLD}API health :${NC}  ${PROTO}://${DOMAIN}/api/healthz"
echo -e "  ${BOLD}Logs       :${NC}  pm2 logs terminal-ai-api"
echo -e "  ${BOLD}Status     :${NC}  pm2 status"
echo -e "  ${BOLD}Update     :${NC}  bash ${INSTALL_DIR}/update.sh"
echo -e "  ${BOLD}.env file  :${NC}  ${ENV_FILE}"
echo ""
echo -e "  ${YELLOW}⚠  Keep your .env file private — it contains your DB password"
echo -e "     and session secret.${NC}"
echo ""
