#!/bin/bash
# =============================================================================
# Revoke an OpenVPN client certificate
# =============================================================================
# Usage: sudo bash revoke-client.sh <client-name>
# =============================================================================

set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
info()  { echo -e "${GREEN}[INFO]${NC}  $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC}  $*"; }
error() { echo -e "${RED}[ERROR]${NC} $*"; exit 1; }

[[ $EUID -ne 0 ]] && error "This script must be run as root."
[[ -z "${1:-}" ]] && error "Usage: $0 <client-name>"

CLIENT_NAME="$1"
EASYRSA_DIR="/etc/openvpn/easy-rsa"
OVPN_DIR="/etc/openvpn/clients"
SERVER_CONF_DIR="/etc/openvpn/server"

[[ ! -d "${EASYRSA_DIR}" ]] && error "EasyRSA not found. Run setup-openvpn.sh first."

if [[ ! -f "${EASYRSA_DIR}/pki/issued/${CLIENT_NAME}.crt" ]]; then
  error "No certificate found for client '${CLIENT_NAME}'."
fi

warn "Revoking certificate for client: ${CLIENT_NAME}"
read -rp "Are you sure? [y/N]: " confirm
[[ ${confirm,,} != "y" ]] && error "Aborted."

cd "${EASYRSA_DIR}"
echo "yes" | ./easyrsa revoke "${CLIENT_NAME}"
./easyrsa gen-crl

# Copy updated CRL to OpenVPN server directory
install -m 640 pki/crl.pem "${SERVER_CONF_DIR}/crl.pem"

# Enable CRL in server config if not already active
if grep -q "^;crl-verify" "${SERVER_CONF_DIR}/server.conf"; then
  sed -i 's|^;crl-verify|crl-verify|' "${SERVER_CONF_DIR}/server.conf"
  info "CRL verification enabled in server.conf"
fi

# Remove the .ovpn bundle
if [[ -f "${OVPN_DIR}/${CLIENT_NAME}.ovpn" ]]; then
  rm -f "${OVPN_DIR}/${CLIENT_NAME}.ovpn"
  info "Removed: ${OVPN_DIR}/${CLIENT_NAME}.ovpn"
fi

# Reload OpenVPN to apply CRL
systemctl reload openvpn-server@server 2>/dev/null || systemctl restart openvpn-server@server

info "========================================================"
info "Certificate for '${CLIENT_NAME}' has been revoked."
info "The client can no longer connect to the VPN."
info "========================================================"
