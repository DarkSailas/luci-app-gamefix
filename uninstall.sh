#!/bin/sh
# ==============================================================================
# Uninstaller for luci-app-podkop-autoadd
# https://github.com/DarkSailas/luci-app-podkop-autoadd
#
#   --purge   also remove the settings, the database and the lists
# ==============================================================================

set -e

DATA_DIR="/etc/autoadd"
LIST="/etc/lists/autoadd_ips.lst"
DLIST="/etc/lists/autoadd_domains.lst"
VIEW_DIR="/www/luci-static/resources/view/autoadd"
SYSUPGRADE="/etc/sysupgrade.conf"
PURGE=0

for arg in "$@"; do
    case "$arg" in
        --purge) PURGE=1 ;;
    esac
done

echo "=========================================================="
echo ">>> Removing luci-app-podkop-autoadd..."
echo "=========================================================="

if [ -x /etc/init.d/autoadd ]; then
    /etc/init.d/autoadd stop >/dev/null 2>&1 || true
    /etc/init.d/autoadd disable >/dev/null 2>&1 || true
fi
nft delete table inet autoadd 2>/dev/null || true

echo ">>> Disconnecting from podkop..."
podkop_changed=0
if [ -f /etc/config/podkop ]; then
    for section in $(uci show podkop | sed -n 's/^podkop\.\([0-9A-Za-z_]*\)=section$/\1/p'); do
        if uci -q get "podkop.$section.local_subnet_lists" | tr ' ' '\n' | grep -qxF "$LIST"; then
            uci del_list "podkop.$section.local_subnet_lists=$LIST"
            podkop_changed=1
        fi
        if uci -q get "podkop.$section.local_domain_lists" | tr ' ' '\n' | grep -qxF "$DLIST"; then
            uci del_list "podkop.$section.local_domain_lists=$DLIST"
            podkop_changed=1
        fi
    done
    [ "$podkop_changed" = 0 ] || uci commit podkop
fi

echo ">>> Removing application files..."
rm -f /etc/init.d/autoadd
rm -f /usr/sbin/autoaddd
rm -f /usr/libexec/autoadd-probe
rm -f /usr/libexec/autoadd-update
rm -f /usr/share/luci/menu.d/luci-app-podkop-autoadd.json
rm -f /usr/share/rpcd/acl.d/luci-app-podkop-autoadd.json
rm -rf "$VIEW_DIR"
rm -rf /tmp/autoadd
rm -f "$DATA_DIR/uninstall.sh"
rm -f /etc/sysctl.d/99-autoadd.conf

if [ "$PURGE" = 1 ]; then
    rm -rf "$DATA_DIR"
    rm -f /etc/config/autoadd "$LIST" "$DLIST"
    echo ">>> Settings, database and lists removed."
else
    echo ">>> Settings (/etc/config/autoadd), database ($DATA_DIR) and lists ($LIST, $DLIST) are kept."
fi

if [ -f "$SYSUPGRADE" ]; then
    for path in /etc/init.d/autoadd /etc/rc.d/S99autoadd /etc/rc.d/K10autoadd /usr/sbin/autoaddd /usr/libexec/autoadd-probe /usr/libexec/autoadd-update \
        /usr/share/luci/menu.d/luci-app-podkop-autoadd.json /usr/share/rpcd/acl.d/luci-app-podkop-autoadd.json \
        "$VIEW_DIR/" /etc/sysctl.d/99-autoadd.conf; do
        grep -vxF "$path" "$SYSUPGRADE" > "$SYSUPGRADE.new" || true
        mv "$SYSUPGRADE.new" "$SYSUPGRADE"
    done
    if [ "$PURGE" = 1 ]; then
        for path in "$DATA_DIR/" "$LIST" "$DLIST" /etc/config/autoadd; do
            grep -vxF "$path" "$SYSUPGRADE" > "$SYSUPGRADE.new" || true
            mv "$SYSUPGRADE.new" "$SYSUPGRADE"
        done
    fi
fi

echo ">>> Cleaning LuCI caches..."
rm -rf /tmp/luci-indexcache* /tmp/luci-modulecache*
/etc/init.d/rpcd reload >/dev/null 2>&1 || /etc/init.d/rpcd restart >/dev/null 2>&1 || true

if [ "$podkop_changed" = 1 ]; then
    echo ">>> Restarting podkop so the added sites and addresses go direct again..."
    /etc/init.d/podkop restart >/dev/null 2>&1 || echo "!!! podkop restart failed, restart it manually."
fi

echo "=========================================================="
echo ">>> luci-app-podkop-autoadd has been removed."
echo ">>> Static DHCP leases created on the Podkop AutoAdd page stay in /etc/config/dhcp."
echo "=========================================================="
