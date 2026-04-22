#!/bin/sh
# Setup Sync Temple in the 'sync' jail
# Run as: doas sh ~/setup-sync-jail.sh

set -e

JAIL="sync"
# Token: override with SYNC_TEMPLE_TOKEN env var, else generate a fresh 32-char
# alphanumeric token each run. Printed at the end of the script — save it.
TOKEN="${SYNC_TEMPLE_TOKEN:-$(head -c 48 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 32)}"
JAIL_ROOT="/usr/local/bastille/jails/${JAIL}/root"
HOME_DIR="/home/hexerat"

log() { printf "\n\033[1;34m==> %s\033[0m\n" "$1"; }
ok()  { printf "\033[1;32m    OK\033[0m\n"; }
err() { printf "\033[1;31m    FAIL: %s\033[0m\n" "$1"; exit 1; }

# ── 1. Install binary ──
log "Installing sync-temple binary into jail"
cp ${HOME_DIR}/sync-temple "${JAIL_ROOT}/usr/local/bin/sync-temple" || err "copy binary"
chmod 755 "${JAIL_ROOT}/usr/local/bin/sync-temple"
ok

# ── 2. Install rc.d service ──
log "Installing rc.d service script"
cp ${HOME_DIR}/sync_temple.rc "${JAIL_ROOT}/usr/local/etc/rc.d/sync_temple" || err "copy rc script"
chmod 755 "${JAIL_ROOT}/usr/local/etc/rc.d/sync_temple"
ok

# ── 3. Configure service ──
log "Configuring service in jail"
bastille sysrc ${JAIL} sync_temple_enable="YES"
bastille sysrc ${JAIL} sync_temple_token="${TOKEN}"
bastille sysrc ${JAIL} sync_temple_addr=":8787"
ok

# ── 4. Start service ──
log "Starting sync_temple service"
bastille service ${JAIL} sync_temple start || err "service start"
sleep 1

log "Checking service is listening"
bastille cmd ${JAIL} sockstat -l4 | grep 8787
if [ $? -eq 0 ]; then
    ok
else
    err "sync-temple not listening on 8787"
fi

# ── 5. pf.conf ──
log "Updating pf.conf — adding sync jail rules"
PF="/etc/pf.conf"

if grep -q "sync_ip" "${PF}"; then
    echo "    sync_ip already in pf.conf, skipping"
else
    # Add variable after build_ip line
    sed -i '' '/^build_ip/a\
sync_ip     = "127.0.1.7"
' "${PF}"

    # Add comment to IP allocation block
    sed -i '' 's/^#   build:      127.0.1.6/&\
#   sync:       127.0.1.7  — sync temple/' "${PF}"

    # Add caddy → sync rule after the caddy → web rule
    sed -i '' '/caddy_ip to \$web_ip port 3001/a\
\
# Caddy → Sync Temple jail (port 8787)\
pass quick on lo1 proto tcp from $caddy_ip to $sync_ip port 8787 keep state
' "${PF}"

    ok

    log "Reloading pf ruleset"
    pfctl -f "${PF}" || err "pfctl reload"
    ok
fi

# ── 6. Caddy config ──
log "Adding sync.0xxi.cloud to Caddyfile"
CADDYFILE="${JAIL_ROOT}/../caddy/root/usr/local/etc/caddy/Caddyfile"
# Try alternate path if that doesn't exist
if [ ! -f "${CADDYFILE}" ]; then
    CADDYFILE="/usr/local/bastille/jails/caddy/root/usr/local/etc/caddy/Caddyfile"
fi

if [ ! -f "${CADDYFILE}" ]; then
    echo "    Could not find Caddyfile automatically."
    echo "    Add this block manually inside the caddy jail:"
    echo ""
    echo '    sync.0xxi.cloud {'
    echo '        reverse_proxy 127.0.1.7:8787'
    echo '    }'
    echo ""
    echo "    Then reload: bastille service caddy caddy reload"
else
    if grep -q "sync.0xxi.cloud" "${CADDYFILE}"; then
        echo "    sync.0xxi.cloud already in Caddyfile, skipping"
    else
        cat >> "${CADDYFILE}" << 'CADDY'

sync.0xxi.cloud {
    reverse_proxy 127.0.1.7:8787
}
CADDY
        ok

        log "Reloading Caddy"
        bastille service caddy caddy reload || bastille service caddy caddy restart || echo "    Reload caddy manually: bastille service caddy caddy reload"
    fi
fi

# ── 7. Summary ──
log "Setup complete!"
echo ""
echo "    URL:   https://sync.0xxi.cloud"
echo "    Token: ${TOKEN}"
echo ""
echo "    DNS: Add A record in Cloudflare:"
echo "      Name:   sync"
echo "      Target: 159.195.29.107"
echo "      Proxy:  OFF (DNS only)"
echo ""
echo "    Local machine:"
echo "      export SYNC_TEMPLE_URL=https://sync.0xxi.cloud"
echo "      export SYNC_TEMPLE_TOKEN=${TOKEN}"
echo ""
