#!/usr/bin/env bash
# =============================================================================
# uninstall-openvpn-server.sh
#
# Completely removes OpenVPN from the VPS, restores UFW to a clean state,
# and re-opens port 80 publicly (if you want to revert to non-VPN access).
#
# WARNING: After running this script:
#   - All VPN clients lose access immediately.
#   - Port 80 (the ERP app) will be PUBLIC unless you re-secure manually.
#
# Usage (run on VPS as root):
#   bash uninstall-openvpn-server.sh
# =============================================================================

set -euo pipefail

# ── Sanity checks ─────────────────────────────────────────────────────────────
if [[ $EUID -ne 0 ]]; then
  echo "ERROR: This script must be run as root." >&2
  exit 1
fi

echo ""
echo "!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!"
echo "  WARNING: This will REMOVE OpenVPN and ALL client profiles."
echo "  Port 80 will become PUBLICLY ACCESSIBLE after this."
echo "!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!"
echo ""
read -rp "Type 'yes' to confirm: " CONFIRM
if [[ "$CONFIRM" != "yes" ]]; then
  echo "Aborted."
  exit 0
fi

echo ""
echo "=== [1/5] Stopping and disabling OpenVPN service ==="
systemctl stop  openvpn-server@server || true
systemctl disable openvpn-server@server || true

echo "=== [2/5] Removing OpenVPN and Easy-RSA packages ==="
apt-get remove --purge -y openvpn easy-rsa || true
apt-get autoremove -y || true

echo "=== [3/5] Removing configuration and PKI data ==="
rm -rf /etc/openvpn/server
rm -rf /etc/openvpn/easy-rsa
rm -rf /etc/openvpn/clients
rm -f  /var/log/openvpn/openvpn.log
rm -f  /var/log/openvpn/openvpn-status.log
rm -f  /var/log/openvpn/ipp.txt
echo "   All OpenVPN config and PKI data removed."

echo "=== [4/5] Reverting UFW rules ==="
# Remove NAT masquerade block from /etc/ufw/before.rules
UFW_BEFORE="/etc/ufw/before.rules"
if grep -q "TIJAERO-VPN-NAT" "$UFW_BEFORE"; then
  # Remove the block between # TIJAERO-VPN-NAT and the next blank line after COMMIT
  sed -i '/# TIJAERO-VPN-NAT/,/^COMMIT/{/^COMMIT/{N;d};d}' "$UFW_BEFORE"
  echo "   Removed NAT masquerade from $UFW_BEFORE"
fi

# Restore DEFAULT_FORWARD_POLICY to DROP
sed -i 's/^DEFAULT_FORWARD_POLICY="ACCEPT"/DEFAULT_FORWARD_POLICY="DROP"/' /etc/default/ufw

# Remove VPN-specific rules and open port 80 publicly again
ufw delete allow in on tun0 to any port 80 proto tcp 2>/dev/null || true
ufw delete deny  80/tcp     2>/dev/null || true
ufw delete allow 1194/udp   2>/dev/null || true
ufw allow 80/tcp comment "HTTP (public – VPN removed)"

sysctl -w net.ipv4.ip_forward=0
sed -i 's/^net\.ipv4\.ip_forward=1/#net.ipv4.ip_forward=1/' /etc/sysctl.conf

ufw reload || true

echo "=== [5/5] Reverting IP forwarding ==="
echo "   IP forwarding disabled."

echo ""
echo "============================================================"
echo "  OpenVPN has been REMOVED from this server."
echo ""
echo "  Port 80 is now OPEN to the public internet."
echo "  Re-secure the server if needed before deploying the app."
echo "============================================================"
