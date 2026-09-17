#!/usr/bin/env bash
# Ship this working tree to the VPS and roll it out.
#
# The VPS half already exists (deploy/rollout-security.sh): extract into
# app_new_<stamp>, preserve deploy/.env.costing, swap directories, migrate,
# rebuild the container, restore the notification cron, health-check, roll back
# on failure. This is the workstation half: package, ship, launch, watch, verify.
#
#   bash deploy/sync-to-vps.sh --dry-run   # list what would ship, no network
#   bash deploy/sync-to-vps.sh --no-wait   # ship and launch, then exit
#   bash deploy/sync-to-vps.sh --watch     # watch a launch that is already running
#   bash deploy/sync-to-vps.sh             # ship, launch, wait, verify
#
# Credentials: export TP_VPS_PASSWORD to run unattended — ssh reads it from the
# environment via deploy/askpass.sh, so it never reaches argv and never reaches a
# file. Without it, ssh prompts. Host/user default to the documented target.
set -euo pipefail

HOST="${TP_VPS_HOST:-5.223.78.194}"
REMOTE_USER="${TP_VPS_USER:-root}"
PUBLIC_HOST="${TP_DEPLOY_PUBLIC_HOST:-smart-tp-costing.5-223-78-194.sslip.io}"
ASKPASS="$(cd "$(dirname "$0")" && pwd)/askpass.sh"
LOCAL_ARCHIVE="${TMPDIR:-/tmp}/smart-tp-costing-deploy.tar.gz"
REMOTE_ARCHIVE="/tmp/smart-tp-costing-security.tar.gz" # what rollout-security.sh expects
REMOTE_TREE="/tmp/tp-rollout"
REMOTE_LOG="/tmp/tp-rollout.log"
# Completion is the rollout's exit status, written here by the launcher.
# Deliberately not a process-name lookup: `pgrep -f rollout-security.sh` also
# matches the polling command itself, so the old check answered "running" even
# with nothing running — every deploy waited out its whole timeout and the real
# outcome was only known by grepping the log afterwards.
REMOTE_STATE="/tmp/tp-rollout.state"
WAIT_SECONDS="${TP_DEPLOY_WAIT_SECONDS:-1200}"
WATCH_ONLY=0
NO_WAIT=0
DRY_RUN=0
case "${1:-}" in
  --dry-run) DRY_RUN=1 ;;
  --no-wait) NO_WAIT=1 ;;
  --watch) WATCH_ONLY=1 ;;
esac

# Everything the container does not need, plus every local secret: the VPS keeps
# its own deploy/.env.costing and that file must never be overwritten from here.
EXCLUDE_ARGS=()
for path in ./node_modules ./.next ./.next-dev ./.git ./coverage ./.env ./.env.local ./.env.development.local ./deploy/.env.costing; do
  EXCLUDE_ARGS+=("--exclude=$path")
done
EXCLUDE_ARGS+=("--exclude=*.log")

SSH_OPTS=(-o ConnectTimeout=20 -o ServerAliveInterval=30 -o StrictHostKeyChecking=accept-new)

if [ "$WATCH_ONLY" = "0" ]; then
  echo "── packaging the app ──"
  tar czf "$LOCAL_ARCHIVE" "${EXCLUDE_ARGS[@]}" -C "$(pwd)" .
  CONTENTS=$(tar tzf "$LOCAL_ARCHIVE")
  SHIPPED=$(printf '%s\n' "$CONTENTS" | wc -l | tr -d ' ')
  SECRETS=""
  for secret in .env .env.local .env.development.local .env.production.local deploy/.env.costing; do
    if printf '%s\n' "$CONTENTS" | grep -qx "./$secret"; then SECRETS="$SECRETS $secret"; fi
  done
  echo "  $(du -h "$LOCAL_ARCHIVE" | cut -f1) · $SHIPPED entries · secrets carried:${SECRETS:- none}"

  if [ "$DRY_RUN" = "1" ]; then
    echo "  --dry-run: nothing shipped"
    exit 0
  fi
  if [ -n "$SECRETS" ]; then
    echo "  ❌ refusing to ship an archive that carries a local secret" >&2
    exit 1
  fi

  echo "── pre-flight: typecheck ──"
  npm run typecheck
fi

if [ -n "${TP_VPS_PASSWORD:-}" ]; then
  export TP_VPS_PASSWORD SSH_ASKPASS="$ASKPASS" SSH_ASKPASS_REQUIRE=force
  chmod +x "$ASKPASS" 2>/dev/null || true
  echo "── credentials: TP_VPS_PASSWORD from the environment (nothing written to disk) ──"
else
  echo "── credentials: interactive ssh prompt ──"
fi

remote() { ssh "${SSH_OPTS[@]}" "$REMOTE_USER@$HOST" "$@"; }

# Waits on the state file the launcher writes, and reports the terminal state.
# Exits non-zero when the rollout failed or outlived WAIT_SECONDS.
wait_for_rollout() {
  local started deadline state
  started=$(date +%s)
  deadline=$(( started + WAIT_SECONDS ))
  while :; do
    sleep 15
    state=$(remote "cat $REMOTE_STATE 2>/dev/null | tr -d '\r'" || true)
    if printf '%s' "$state" | grep -qE '^[0-9]+$'; then
      echo "  rollout exited $state after $(( $(date +%s) - started ))s"
      remote "tail -n 4 $REMOTE_LOG"
      if [ "$state" = "0" ]; then return 0; fi
      echo "  ❌ rollout failed (exit $state) — the VPS rolled back if the health check failed" >&2
      return 1
    fi
    if [ "$(date +%s)" -ge "$deadline" ]; then
      echo "  ❌ rollout still running after ${WAIT_SECONDS}s — watch it with: ssh $REMOTE_USER@$HOST 'tail -f $REMOTE_LOG'" >&2
      remote "tail -n 15 $REMOTE_LOG"
      return 1
    fi
    echo "  [$(date -u +%H:%M:%SZ)] running…"
  done
}

if [ "$WATCH_ONLY" = "0" ]; then
  echo "── uploading ──"
  scp "${SSH_OPTS[@]}" "$LOCAL_ARCHIVE" "$REMOTE_USER@$HOST:$REMOTE_ARCHIVE"

  echo "── launching the rollout on the VPS (detached) ──"
  # Run the rollout from the archive, not from the deployed copy (that copy may
  # predate this change), and detached: it traps HUP/TERM with a rollback, so a
  # dropped ssh connection must not be able to interrupt a docker build.
  remote "
    set -eu
    rm -rf $REMOTE_TREE && mkdir -p $REMOTE_TREE
    tar -xzf $REMOTE_ARCHIVE -C $REMOTE_TREE
    test -s $REMOTE_TREE/deploy/rollout-security.sh
    rm -f $REMOTE_LOG $REMOTE_STATE
    nohup setsid sh -c 'sh $REMOTE_TREE/deploy/rollout-security.sh > $REMOTE_LOG 2>&1; echo \$? > $REMOTE_STATE' >/dev/null 2>&1 </dev/null &
    echo '  launched'
  "
  if [ "$NO_WAIT" = "1" ]; then
    echo "  watch it with: bash $0 --watch"
    exit 0
  fi
fi

wait_for_rollout || exit 1
remote "rm -rf $REMOTE_TREE"

# Verify from the VPS: the loopback check is the app itself, and the Host-header
# check is the public path through nginx. Checking the bare IP from a workstation
# would be checking the wrong app — port 80's default server belongs to another
# service on this host.
echo "── verifying on the VPS ──"
remote "
  printf '  app      127.0.0.1:3110/api/health → '
  curl -s --max-time 20 http://127.0.0.1:3110/api/health
  echo
  # 443, not 80: the port-80 block only redirects to https, so checking it would
  # measure the redirect instead of the proxy. -k because this is a wiring check,
  # not a certificate check.
  printf '  nginx    443 + Host: $PUBLIC_HOST/login → '
  curl -sk -o /dev/null -w '%{http_code}\n' --max-time 20 -H 'Host: $PUBLIC_HOST' https://127.0.0.1/login
"
remote "curl -s --max-time 20 http://127.0.0.1:3110/api/health" | grep -q '"ok":true' ||
  { echo "  ❌ the app is not healthy after the rollout" >&2; exit 1; }
remote "curl -sk -o /dev/null -w '%{http_code}' --max-time 20 -H 'Host: $PUBLIC_HOST' https://127.0.0.1/login" | grep -q '^200$' ||
  { echo "  ❌ nginx is not serving the app at $PUBLIC_HOST" >&2; exit 1; }

echo "── done ──"
echo "  Public URL: https://$PUBLIC_HOST/"
echo "  Rollback: stop the container, mv /opt/smart-tp-costing/app_prev_* back to app, rebuild."
