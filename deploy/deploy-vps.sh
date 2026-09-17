#!/usr/bin/env bash
# ============================================================================
# Smart TP Costing — VPS Deployment Script
# ============================================================================
# Run this script on the VPS (5.223.78.194) via SSH:
#   ssh root@5.223.78.194
#   bash /opt/smart-tp-costing/app/deploy/deploy-vps.sh
# ============================================================================
set -euo pipefail

echo "═══════════════════════════════════════════════════════════"
echo "  Smart TP Costing — VPS Deployment"
echo "═══════════════════════════════════════════════════════════"
echo ""

APP_ROOT="/opt/smart-tp-costing/app"
NGINX_CONF="/etc/nginx/sites-available/smart-tp-costing"
NGINX_ENABLED="/etc/nginx/sites-enabled/smart-tp-costing"

# --- Step 0: Normalize the deploy scripts ---
# A Windows checkout ships these files as CRLF and without the execute bit, and
# cron calls three of them directly. A missing +x does not look like an error —
# cron just writes "/bin/sh: Permission denied" into the log on every run, so the
# job looks scheduled while never doing anything. Repair both here, which makes
# this script the one place that guarantees the schedule survives a fresh copy of
# the app onto the VPS.
echo "▸ Step 0: Normalizing deploy scripts (line endings + execute bit)..."
if [ -d "$APP_ROOT/deploy" ]; then
    CRLF=$(grep -rl "$(printf '\r')" "$APP_ROOT"/deploy/*.sh 2>/dev/null | wc -l | tr -d ' ')
    sed -i 's/\r$//' "$APP_ROOT"/deploy/*.sh 2>/dev/null || true
    chmod +x "$APP_ROOT"/deploy/*.sh 2>/dev/null || true
    echo "  ✅ deploy/*.sh normalized ($CRLF file(s) had CRLF, all now executable)"
else
    echo "  ⚠️  No deploy directory at $APP_ROOT/deploy"
fi
echo ""

# --- Step 1: Install nginx config ---
# Only when there is none. The live file was rewritten by certbot and carries the
# 443/SSL block, so copying this repo copy over it would drop HTTPS and point the
# proxy at a dead port — an outage that `nginx -t` cannot catch. Re-install
# deliberately with FORCE_NGINX=1.
echo "▸ Step 1: Configuring nginx reverse proxy..."
if [ -f "$NGINX_CONF" ] && [ "${FORCE_NGINX:-0}" != "1" ]; then
    echo "  ⚠️  $NGINX_CONF already exists — leaving it untouched."
    echo "      Check it proxies to the app port (3110), or re-install with: FORCE_NGINX=1 bash $0"
elif [ -f "$APP_ROOT/deploy/nginx-smart-tp-costing.conf" ]; then
    if [ -f "$NGINX_CONF" ]; then
        cp -p "$NGINX_CONF" "$NGINX_CONF.bak-$(date -u +%Y%m%dT%H%M%SZ)"
        echo "  Backed up the existing config first."
    fi
    cp "$APP_ROOT/deploy/nginx-smart-tp-costing.conf" "$NGINX_CONF"
    
    # Enable the site (remove default if blocking)
    if [ -f /etc/nginx/sites-enabled/default ]; then
        echo "  Removing default nginx site..."
        rm -f /etc/nginx/sites-enabled/default
    fi
    ln -sf "$NGINX_CONF" "$NGINX_ENABLED"
    
    # Test nginx config
    if nginx -t 2>&1; then
        echo "  ✅ Nginx config valid"
        systemctl reload nginx
        echo "  ✅ Nginx reloaded"
    else
        echo "  ❌ Nginx config invalid! Check: $NGINX_CONF"
        exit 1
    fi
else
    echo "  ⚠️  Nginx config not found at $APP_ROOT/deploy/nginx-smart-tp-costing.conf"
    echo "  Skipping nginx configuration"
fi

echo ""

# --- Step 2: Apply migrations ---
echo "▸ Step 2: Applying database migrations..."
if [ -f "$APP_ROOT/deploy/apply-migrations.sh" ]; then
    chmod +x "$APP_ROOT/deploy/apply-migrations.sh"
    APP_ROOT="$APP_ROOT" bash "$APP_ROOT/deploy/apply-migrations.sh"
    echo "  ✅ Migrations applied"
else
    echo "  ⚠️  Migration script not found, skipping"
fi

echo ""

# --- Step 3: Verify app is running ---
echo "▸ Step 3: Verifying application health..."
sleep 3

HEALTH=$(curl -s --fail --max-time 10 http://127.0.0.1:3110/api/health 2>/dev/null || echo '{"status":"error"}')
if echo "$HEALTH" | grep -q '"status":"ok"'; then
    echo "  ✅ App health: $HEALTH"
else
    echo "  ⚠️  App health response: $HEALTH"
    echo "  Checking Docker container status..."
    docker ps --filter "name=costing" --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"
fi

echo ""

# --- Step 4: Verify nginx proxy ---
echo "▸ Step 4: Verifying nginx proxy..."
PROXY_HEALTH=$(curl -s --fail --max-time 10 http://127.0.0.1:80/api/health 2>/dev/null || echo '{"status":"error"}')
if echo "$PROXY_HEALTH" | grep -q '"ok"' || echo "$PROXY_HEALTH" | grep -q '"status":"ok"'; then
    echo "  ✅ Nginx proxy → app: $PROXY_HEALTH"
else
    echo "  ⚠️  Nginx proxy response: $PROXY_HEALTH"
fi

echo ""

# --- Step 5: Check from outside ---
echo "▸ Step 5: External access check..."
EXTERNAL=$(curl -s --fail --max-time 10 http://5.223.78.194/api/health 2>/dev/null || echo '{"status":"error"}')
echo "  → http://5.223.78.194/api/health → $EXTERNAL"

LOGIN_STATUS=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 http://5.223.78.194/login 2>/dev/null)
echo "  → http://5.223.78.194/login → $LOGIN_STATUS"

echo ""

# --- Summary ---
echo "═══════════════════════════════════════════════════════════"
echo "  DEPLOYMENT COMPLETE"
echo "═══════════════════════════════════════════════════════════"
echo ""
echo "  ✅ Nginx configured (port 80/443 → 3110)"
echo "  ✅ Migrations applied"
echo ""
echo "  Access the app at:"
echo "  → https://smart-tp-costing.5-223-78-194.sslip.io/"
echo "  → https://madison88.online/ (after DNS setup)"
echo "  → https://smarttp.madison88.online/ (after DNS setup)"
echo ""
echo "  Next steps:"
echo "  1. Configure DNS: A record → 5.223.78.194"
echo "  2. Set up SSL with certbot: certbot --nginx -d madison88.online -d smarttp.madison88.online"
echo "  3. Update NEXT_PUBLIC_APP_URL in .env.costing"
echo ""
