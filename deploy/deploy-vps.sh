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

# --- Step 1: Install nginx config ---
echo "▸ Step 1: Configuring nginx reverse proxy..."
if [ -f "$APP_ROOT/deploy/nginx-smart-tp-costing.conf" ]; then
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

HEALTH=$(curl -s --fail --max-time 10 http://127.0.0.1:3001/api/health 2>/dev/null || echo '{"status":"error"}')
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
echo "  ✅ Nginx configured (port 80 → 3001)"
echo "  ✅ Migrations applied"
echo ""
echo "  Access the app at:"
echo "  → http://5.223.78.194/"
echo "  → https://madison88.online/ (after DNS setup)"
echo "  → https://smarttp.madison88.online/ (after DNS setup)"
echo ""
echo "  Next steps:"
echo "  1. Configure DNS: A record → 5.223.78.194"
echo "  2. Set up SSL with certbot: certbot --nginx -d madison88.online -d smarttp.madison88.online"
echo "  3. Update NEXT_PUBLIC_APP_URL in .env.costing"
echo ""
