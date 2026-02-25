#!/bin/bash
# =============================================================================
# Remove / Uninstall OpenVPN Server for TijaeroERP VPS
# =============================================================================
# Usage: sudo bash remove-vpn.sh [--purge]
#
#   --purge   Also uninstall the openvpn and easy-rsa packages
#
# This script reverses everything done by setup-openvpn.sh:
#   • Stops and disables the OpenVPN service
#   • Removes UFW rules added for VPN
#   • Removes the NAT masquerade block from /etc/ufw/before.rules
#   • Reverts net.ipv4.ip_forward in /etc/sysctl.conf
#   • Deletes all OpenVPN config, PKI, client files, and log data
#   • Optionally purges the openvpn / easy-rsa packages (--purge)
# =============================================================================

set -euo pipefail

# ── Load vpn.env (so we use the same values that were set during setup) ────────
VPN_ENV_FILE="$(dirname "$0")/vpn.env"
if [[ -f "${VPN_ENV_FILE}" ]]; then
  set -a; source "${VPN_ENV_FILE}"; set +a
fi

# ── Configuration (must match setup-openvpn.sh defaults) ──────────────────────
VPN_PORT="${VPN_PORT:-1194}"
VPN_PROTO="${VPN_PROTO:-udp}"
VPN_SUBNET="${VPN_SUBNET:-10.8.0.0}"
VPN_DEV="tun0"
EASYRSA_DIR="/etc/openvpn/easy-rsa"
OVPN_DIR="/etc/openvpn/clients"
CLIENT_TEMPLATE_DIR="/etc/openvpn/client-templates"

# ── Colors / helpers ───────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
info()  { echo -e "${GREEN}[INFO]${NC}  $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC}  $*"; }
error() { echo -e "${RED}[ERROR]${NC} $*"; exit 1; }

# ── Argument parsing ───────────────────────────────────────────────────────────
PURGE_PACKAGES=false
for arg in "$@"; do
  [[ "${arg}" == "--purge" ]] && PURGE_PACKAGES=true
done

# ── Root check ─────────────────────────────────────────────────────────────────
[[ $EUID -ne 0 ]] && error "This script must be run as root."

# ── Confirmation ───────────────────────────────────────────────────────────────
echo ""
warn "=========================================================="
warn " WARNING: This will COMPLETELY remove OpenVPN from this"
warn " server, including all PKI data and client certificates."
warn " This action CANNOT be undone."
warn "=========================================================="
echo ""
read -rp "Type YES to confirm removal: " confirm
[[ "${confirm}" != "YES" ]] && error "Aborted – you must type YES (uppercase) to continue."

# ── 1. Stop and disable the OpenVPN service ────────────────────────────────────
info "Stopping OpenVPN service..."
if systemctl is-active --quiet openvpn-server@server 2>/dev/null; then
  systemctl stop openvpn-server@server
  info "Service stopped."
else
  warn "openvpn-server@server was not running (skipping stop)."
fi

if systemctl is-enabled --quiet openvpn-server@server 2>/dev/null; then
  systemctl disable openvpn-server@server
  info "Service disabled."
fi

# ── 2. Remove UFW rules added by setup-openvpn.sh ─────────────────────────────
info "Removing UFW rules..."

# Detect primary NIC (same logic as setup)
NIC=$(ip route 2>/dev/null | awk '/default/ {print $5; exit}')

# Delete rules silently; ufw returns non-zero if the rule doesn't exist, so we allow failure
ufw delete allow "${VPN_PORT}/${VPN_PROTO}"        2>/dev/null || true
ufw delete allow in on "${VPN_DEV}" to any port 80  proto tcp  2>/dev/null || true
ufw delete allow in on "${VPN_DEV}" to any port 443 proto tcp  2>/dev/null || true
ufw delete deny  in on "${NIC}"     to any port 80  proto tcp  2>/dev/null || true

# ── 3. Remove NAT masquerade block from /etc/ufw/before.rules ─────────────────
if [[ -f /etc/ufw/before.rules ]] && grep -q "OPENVPN_NAT" /etc/ufw/before.rules; then
  info "Removing NAT masquerade rules from /etc/ufw/before.rules..."
  # Remove the block that starts with "# OPENVPN_NAT" up through the COMMIT line
  sed -i '/^# OPENVPN_NAT$/,/^COMMIT$/{
    /^# OPENVPN_NAT$/d
    /^\*nat$/d
    /^:POSTROUTING ACCEPT/d
    /^-A POSTROUTING.*MASQUERADE$/d
    /^COMMIT$/d
  }' /etc/ufw/before.rules
  # Clean up any blank lines left at the very top
  sed -i '/./,$!d' /etc/ufw/before.rules
  info "NAT rules removed."
else
  warn "No OPENVPN_NAT block found in /etc/ufw/before.rules (already clean)."
fi

# ── 4. Reload UFW to apply rule changes ───────────────────────────────────────
info "Reloading UFW..."
ufw reload || warn "UFW reload returned non-zero; check 'ufw status' manually."

# ── 5. Revert net.ipv4.ip_forward in /etc/sysctl.conf ────────────────────────
info "Disabling IP forwarding..."
if grep -q "^net.ipv4.ip_forward=1" /etc/sysctl.conf; then
  sed -i 's|^net.ipv4.ip_forward=1|#net.ipv4.ip_forward=1|' /etc/sysctl.conf
  sysctl -p /etc/sysctl.conf
  info "IP forwarding disabled."
else
  warn "ip_forward entry not found in /etc/sysctl.conf (skipping)."
fi

# ── 6. Remove OpenVPN configuration and PKI data ──────────────────────────────
info "Removing OpenVPN files..."

declare -a DIRS_TO_REMOVE=(
  "${EASYRSA_DIR}"          # PKI / EasyRSA workspace
  "${OVPN_DIR}"             # Generated .ovpn bundles
  "${CLIENT_TEMPLATE_DIR}"  # Client base config template
  "/etc/openvpn/server"     # Server credentials & server.conf
  "/var/log/openvpn"        # OpenVPN log files
)

for dir in "${DIRS_TO_REMOVE[@]}"; do
  if [[ -d "${dir}" ]]; then
    rm -rf "${dir}"
    info "Removed directory: ${dir}"
  else
    warn "Directory not found (already removed): ${dir}"
  fi
done

# Remove any stray .conf files in /etc/openvpn (but preserve the directory itself)
find /etc/openvpn -maxdepth 1 -name "*.conf" -delete 2>/dev/null || true

# ── 7. Optionally purge packages ──────────────────────────────────────────────
if [[ "${PURGE_PACKAGES}" == "true" ]]; then
  info "Purging openvpn and easy-rsa packages..."
  DEBIAN_FRONTEND=noninteractive apt-get purge -y openvpn easy-rsa
  apt-get autoremove -y
  info "Packages purged."
else
  info "Packages NOT removed (pass --purge to also uninstall openvpn / easy-rsa)."
fi

# ── 8. Remove tun0 interface if still present ─────────────────────────────────
if ip link show "${VPN_DEV}" &>/dev/null; then
  ip link delete "${VPN_DEV}" 2>/dev/null || warn "Could not remove ${VPN_DEV} interface."
  info "Removed network interface: ${VPN_DEV}"
fi

# ── Done ───────────────────────────────────────────────────────────────────────
echo ""
info "=========================================================="
info "OpenVPN has been fully removed from this server."
if [[ "${PURGE_PACKAGES}" == "true" ]]; then
  info "  Packages  : purged"
else
  info "  Packages  : kept  (re-run with --purge to remove them)"
fi
info "  PKI data  : deleted  (/etc/openvpn/easy-rsa)"
info "  Client configs deleted  (${OVPN_DIR})"
info "  UFW rules : removed"
info "  Firewall  : reloaded"
info "=========================================================="
echo ""
warn "All client .ovpn files are gone. Clients will no longer be"
warn "able to connect. To reinstall, run setup-openvpn.sh again."
echo ""
