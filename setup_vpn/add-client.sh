#!/bin/bash
# =============================================================================
# Add a new OpenVPN client and generate a .ovpn bundle file
# =============================================================================
# Usage: sudo bash add-client.sh <client-name>
# Output: /etc/openvpn/clients/<client-name>.ovpn
# =============================================================================

set -euo pipefail

# ── Load vpn.env ──────────────────────────────────────────────────────────────
VPN_ENV_FILE="$(dirname "$0")/vpn.env"
[[ -f "${VPN_ENV_FILE}" ]] && { set -a; source "${VPN_ENV_FILE}"; set +a; }
VPN_GATEWAY_IP="${VPN_GATEWAY_IP:-10.8.0.1}"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
info()  { echo -e "${GREEN}[INFO]${NC}  $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC}  $*"; }
error() { echo -e "${RED}[ERROR]${NC} $*"; exit 1; }

[[ $EUID -ne 0 ]] && error "This script must be run as root."
[[ -z "${1:-}" ]] && error "Usage: $0 <client-name>"

CLIENT_NAME="$1"
EASYRSA_DIR="/etc/openvpn/easy-rsa"
OVPN_DIR="/etc/openvpn/clients"
TEMPLATE_DIR="/etc/openvpn/client-templates"
OUTPUT_FILE="${OVPN_DIR}/${CLIENT_NAME}.ovpn"

[[ ! -d "${EASYRSA_DIR}" ]] && error "EasyRSA not found. Run setup-openvpn.sh first."

# Validate name (alphanumeric, dash, underscore only)
[[ ! "${CLIENT_NAME}" =~ ^[a-zA-Z0-9_-]+$ ]] && \
  error "Client name must be alphanumeric (dashes and underscores allowed)."

# Check if certificate already exists
if [[ -f "${EASYRSA_DIR}/pki/issued/${CLIENT_NAME}.crt" ]]; then
  warn "Certificate for '${CLIENT_NAME}' already exists."
  read -rp "Re-issue? This will revoke the existing cert. [y/N]: " confirm
  [[ ${confirm,,} != "y" ]] && error "Aborted."
  bash "$(dirname "$0")/revoke-client.sh" "${CLIENT_NAME}" || true
fi

info "Generating certificate for client: ${CLIENT_NAME}"
cd "${EASYRSA_DIR}"
./easyrsa gen-req "${CLIENT_NAME}" nopass
echo "yes" | ./easyrsa sign-req client "${CLIENT_NAME}"

mkdir -p "${OVPN_DIR}"

info "Building .ovpn bundle: ${OUTPUT_FILE}"

# Inline all credentials into a single portable .ovpn file
cat > "${OUTPUT_FILE}" <<EOF
# TijaeroERP VPN – Client: ${CLIENT_NAME}
# Generated: $(date -u +"%Y-%m-%dT%H:%M:%SZ")

$(cat "${TEMPLATE_DIR}/client-base.conf")

<ca>
$(cat "${EASYRSA_DIR}/pki/ca.crt")
</ca>

<cert>
$(openssl x509 -in "${EASYRSA_DIR}/pki/issued/${CLIENT_NAME}.crt")
</cert>

<key>
$(cat "${EASYRSA_DIR}/pki/private/${CLIENT_NAME}.key")
</key>

<tls-crypt>
$(cat /etc/openvpn/server/ta.key)
</tls-crypt>
EOF

chmod 600 "${OUTPUT_FILE}"

info "========================================================"
info "Client config created: ${OUTPUT_FILE}"
info ""
info "Transfer this file securely to the client machine and"
info "import it with any OpenVPN-compatible client:"
info "  - OpenVPN GUI (Windows)"
info "  - Tunnelblick (macOS)"
info "  - OpenVPN Connect (iOS / Android)"
info "  - network-manager-openvpn (Linux)"
info ""
info "Once connected, access the ERP at: http://${VPN_GATEWAY_IP}"
info "========================================================"
