include $(TOPDIR)/rules.mk

LUCI_TITLE:=Podkop AutoAdd - routes sites and addresses that fail directly through podkop
LUCI_DEPENDS:=+curl +nftables-json +ucode +ucode-mod-fs +ucode-mod-uci +ucode-mod-ubus +ucode-mod-uloop +ucode-mod-socket
LUCI_PKGARCH:=all
PKG_VERSION:=3.0.9
PKG_RELEASE:=1

include $(TOPDIR)/feeds/luci/luci.mk

# call BuildPackage - OpenWrt buildroot signature
