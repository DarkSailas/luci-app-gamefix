#!/bin/sh
set -e

# ==============================================================================
# Installer / updater for luci-app-podkop-autoadd
# https://github.com/DarkSailas/luci-app-podkop-autoadd
#
# Environment:
#   AUTOADD_SECTION  podkop section that receives the lists
#                    (default: the first section found in /etc/config/podkop)
#   AUTOADD_PROXY    proxy used when GitHub cannot be reached directly,
#                    for example socks5://127.0.0.1:4534
# ==============================================================================

REPO_BASE="https://raw.githubusercontent.com/DarkSailas/luci-app-podkop-autoadd/main"
DATA_DIR="/etc/autoadd"
LIST="/etc/lists/autoadd_ips.lst"
DLIST="/etc/lists/autoadd_domains.lst"
VIEW_DIR="/www/luci-static/resources/view/autoadd"
SYSUPGRADE="/etc/sysupgrade.conf"

# names used by the previous release of this application (luci-app-gamefix)
OLD_DATA_DIR="/etc/gamefix"
OLD_LIST="/etc/lists/gamefix_auto.lst"
OLD_VIEW_DIR="/www/luci-static/resources/view/gamefix"
OLD_KEEP="
$OLD_DATA_DIR/
$OLD_LIST
/etc/config/gamefix
/etc/init.d/gamefix
/etc/rc.d/S99gamefix
/etc/rc.d/K10gamefix
/usr/sbin/gamefixd
/usr/libexec/gamefix-probe
/usr/share/luci/menu.d/luci-app-gamefix.json
/usr/share/rpcd/acl.d/luci-app-gamefix.json
$OLD_VIEW_DIR/
"

FILES="
root/etc/init.d/autoadd:/etc/init.d/autoadd:755
root/usr/sbin/autoaddd:/usr/sbin/autoaddd:755
root/usr/libexec/autoadd-probe:/usr/libexec/autoadd-probe:755
root/usr/libexec/autoadd-update:/usr/libexec/autoadd-update:755
root/usr/share/luci/menu.d/luci-app-podkop-autoadd.json:/usr/share/luci/menu.d/luci-app-podkop-autoadd.json:644
root/usr/share/rpcd/acl.d/luci-app-podkop-autoadd.json:/usr/share/rpcd/acl.d/luci-app-podkop-autoadd.json:644
htdocs/luci-static/resources/view/autoadd/main.js:$VIEW_DIR/main.js:644
root/etc/config/autoadd:/etc/config/autoadd:600
uninstall.sh:$DATA_DIR/uninstall.sh:755
"

KEEP="
$DATA_DIR/
$LIST
$DLIST
/etc/config/autoadd
/etc/init.d/autoadd
/etc/rc.d/S99autoadd
/etc/rc.d/K10autoadd
/usr/sbin/autoaddd
/usr/libexec/autoadd-probe
/usr/libexec/autoadd-update
/usr/share/luci/menu.d/luci-app-podkop-autoadd.json
/usr/share/rpcd/acl.d/luci-app-podkop-autoadd.json
$VIEW_DIR/
/etc/sysctl.d/99-autoadd.conf
"

die() {
    echo "!!! $*" >&2
    exit 1
}

# fetch URL FILE
fetch() {
    curl -fsSL --connect-timeout 10 --max-time 60 "$1" -o "$2" 2>/dev/null && return 0
    [ -n "$AUTOADD_PROXY" ] || return 1
    curl -fsSL --connect-timeout 10 --max-time 60 -x "$AUTOADD_PROXY" "$1" -o "$2"
}

podkop_sections() {
    uci show podkop | sed -n 's/^podkop\.\([0-9A-Za-z_]*\)=section$/\1/p'
}

# has_list SECTION OPTION FILE
has_list() {
    uci -q get "podkop.$1.$2" | tr ' ' '\n' | grep -qxF "$3"
}

# Carries settings, devices and added addresses over from luci-app-gamefix
# and removes its files
migrate_gamefix() {
    [ -e /etc/init.d/gamefix ] || [ -e /etc/config/gamefix ] || [ -d "$OLD_DATA_DIR" ] || [ -e "$OLD_LIST" ] || return 0
    echo "Found luci-app-gamefix, migrating its settings and addresses..."

    if [ -x /etc/init.d/gamefix ]; then
        /etc/init.d/gamefix stop >/dev/null 2>&1 || true
        /etc/init.d/gamefix disable >/dev/null 2>&1 || true
    fi
    nft delete table inet gamefix 2>/dev/null || true

    mkdir -p "$DATA_DIR" /etc/lists
    if [ -s /etc/config/gamefix ] && [ ! -s /etc/config/autoadd ]; then
        sed 's/^config gamefix /config autoadd /' /etc/config/gamefix > /etc/config/autoadd
        chmod 600 /etc/config/autoadd
    fi
    if [ -s "$OLD_DATA_DIR/db.json" ] && [ ! -s "$DATA_DIR/db.json" ]; then
        cp "$OLD_DATA_DIR/db.json" "$DATA_DIR/db.json"
    fi
    if [ -s "$OLD_LIST" ] && [ ! -s "$LIST" ]; then
        cp "$OLD_LIST" "$LIST"
    fi

    for s in $(podkop_sections); do
        if has_list "$s" local_subnet_lists "$OLD_LIST"; then
            uci del_list "podkop.$s.local_subnet_lists=$OLD_LIST"
            uci commit podkop
            podkop_changed=1
        fi
    done

    rm -f /etc/init.d/gamefix /etc/rc.d/S99gamefix /etc/rc.d/K10gamefix /etc/config/gamefix
    rm -f /usr/sbin/gamefixd /usr/libexec/gamefix-probe "$OLD_LIST"
    rm -f /usr/share/luci/menu.d/luci-app-gamefix.json /usr/share/rpcd/acl.d/luci-app-gamefix.json
    rm -rf "$OLD_VIEW_DIR" "$OLD_DATA_DIR" /tmp/gamefix

    if [ -f "$SYSUPGRADE" ]; then
        for path in $OLD_KEEP; do
            grep -vxF "$path" "$SYSUPGRADE" > "$SYSUPGRADE.new" || true
            mv "$SYSUPGRADE.new" "$SYSUPGRADE"
        done
    fi
}

echo "=========================================================="
echo ">>> Installing luci-app-podkop-autoadd on OpenWrt..."
echo "=========================================================="

[ "$(id -u)" = 0 ] || die "Run this script as root."
[ -f /etc/openwrt_release ] || die "This is not an OpenWrt system."
[ -f /etc/config/podkop ] || die "podkop is not installed. Install and configure podkop first."

# 1. Dependencies
echo ">>> [1/6] Checking system dependencies..."
missing=""
command -v curl >/dev/null 2>&1 || missing="$missing curl"
command -v ucode >/dev/null 2>&1 || missing="$missing ucode"
for mod in fs uci ubus uloop socket; do
    [ -e "/usr/lib/ucode/$mod.so" ] || missing="$missing ucode-mod-$mod"
done
nft -j list tables >/dev/null 2>&1 || missing="$missing nftables-json"

if [ -n "$missing" ]; then
    echo "Installing:$missing"
    if command -v apk >/dev/null 2>&1; then
        apk update >/dev/null 2>&1 || true
        # shellcheck disable=SC2086
        apk add $missing || die "Could not install:$missing"
    elif command -v opkg >/dev/null 2>&1; then
        opkg update >/dev/null 2>&1 || true
        # shellcheck disable=SC2086
        opkg install $missing || die "Could not install:$missing"
    else
        die "No package manager found. Install manually:$missing"
    fi
fi

# 2. Fetch files into a temporary directory first, so a failed download
#    never leaves a half-updated installation behind
echo ">>> [2/6] Fetching application files..."
SRC=""
case "$0" in
*/*) [ -f "$(dirname "$0")/root/usr/sbin/autoaddd" ] && SRC="$(cd "$(dirname "$0")" && pwd)" ;;
esac

TMP="$(mktemp -d /tmp/autoadd-install.XXXXXX)"
trap 'rm -rf "$TMP"' EXIT

n=0
for entry in $FILES; do
    n=$((n + 1))
    src="${entry%%:*}"
    if [ -n "$SRC" ]; then
        cp "$SRC/$src" "$TMP/$n" || die "Missing file: $SRC/$src"
    else
        fetch "$REPO_BASE/$src" "$TMP/$n" || die "Download failed: $REPO_BASE/$src"
    fi
    [ -s "$TMP/$n" ] || die "Empty file: $src"
    # a daemon that does not compile must not replace the running one
    if [ "$src" = "root/usr/sbin/autoaddd" ] && command -v ucode >/dev/null 2>&1; then
        ucode -c -o /dev/null "$TMP/$n" || die "Syntax check failed: $src"
    fi
done

# 3. Install
echo ">>> [3/6] Installing application files..."
podkop_changed=0
migrate_gamefix
mkdir -p "$DATA_DIR" /etc/lists /usr/libexec /usr/share/luci/menu.d /usr/share/rpcd/acl.d "$VIEW_DIR"

n=0
for entry in $FILES; do
    n=$((n + 1))
    rest="${entry#*:}"
    dst="${rest%%:*}"
    mode="${rest##*:}"
    # the existing configuration holds the list of watched devices
    if [ "$dst" = /etc/config/autoadd ] && [ -s "$dst" ]; then
        continue
    fi
    tr -d '\r' < "$TMP/$n" > "$dst.new"
    chmod "$mode" "$dst.new"
    mv "$dst.new" "$dst"
done

[ -f "$LIST" ] || : > "$LIST"
[ -f "$DLIST" ] || : > "$DLIST"

mkdir -p /etc/sysctl.d
echo "net.netfilter.nf_conntrack_acct=1" > /etc/sysctl.d/99-autoadd.conf
sysctl -q -w net.netfilter.nf_conntrack_acct=1 2>/dev/null || true

# 4. Connect to podkop
echo ">>> [4/6] Connecting to podkop..."
section="$AUTOADD_SECTION"
[ -n "$section" ] || section="$(uci -q get autoadd.main.section || true)"
if [ -z "$section" ] || [ "$(uci -q get "podkop.$section")" != section ]; then
    [ -z "$AUTOADD_SECTION" ] || die "podkop has no section named '$AUTOADD_SECTION'."
    section="$(podkop_sections | head -n 1)"
fi
[ -n "$section" ] || die "No section found in /etc/config/podkop. Configure podkop first."

uci set autoadd.main.section="$section"
uci commit autoadd
echo "podkop section: $section"

if ! has_list "$section" local_subnet_lists "$LIST"; then
    uci add_list "podkop.$section.local_subnet_lists=$LIST"
    uci commit podkop
    podkop_changed=1
    echo "Added $LIST to podkop.$section.local_subnet_lists"
fi
if ! has_list "$section" local_domain_lists "$DLIST"; then
    uci add_list "podkop.$section.local_domain_lists=$DLIST"
    uci commit podkop
    podkop_changed=1
    echo "Added $DLIST to podkop.$section.local_domain_lists"
fi

# 5. Keep the installation across sysupgrade
echo ">>> [5/6] Registering files in $SYSUPGRADE..."
touch "$SYSUPGRADE"
for path in $KEEP; do
    grep -qxF "$path" "$SYSUPGRADE" || echo "$path" >> "$SYSUPGRADE"
done

# 6. Start
echo ">>> [6/6] Starting the service..."
rm -rf /tmp/luci-indexcache* /tmp/luci-modulecache*
/etc/init.d/rpcd reload >/dev/null 2>&1 || /etc/init.d/rpcd restart >/dev/null 2>&1 || true

if [ "$podkop_changed" = 1 ]; then
    echo "Restarting podkop to pick up the new lists..."
    /etc/init.d/podkop restart >/dev/null 2>&1 || echo "!!! podkop restart failed, restart it manually."
fi

/etc/init.d/autoadd enable
/etc/init.d/autoadd restart >/dev/null 2>&1

# the daemon registers on ubus only after it has replayed its lists into podkop
n=0
while ! ubus list autoadd >/dev/null 2>&1 && [ "$n" -lt 30 ]; do
    sleep 2
    n=$((n + 1))
done
if ubus list autoadd >/dev/null 2>&1; then
    echo "=========================================================="
    echo ">>> luci-app-podkop-autoadd is installed and running."
    echo ">>> Open LuCI: Services -> Podkop AutoAdd (refresh the page with Ctrl+F5)"
    echo ">>> and choose the devices to watch in the \"Devices\" section."
    echo "=========================================================="
else
    echo "!!! The service did not start. Check: logread -e autoadd" >&2
    exit 1
fi
