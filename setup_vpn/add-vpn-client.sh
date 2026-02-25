#!/usr/bin/env bash
# =============================================================================
# add-vpn-client.sh
#
# Generates a new OpenVPN client certificate and produces a self-contained
# .ovpn profile file that can be imported directly into any OpenVPN client
# (Windows / macOS / iOS / Android).
#
# Usage (run on VPS as root):
#   bash add-vpn-client.sh <client-name>
#
# Example:
#   bash add-vpn-client.sh alice
#   bash add-vpn-client.sh office-pc
#
# Output:
#   /etc/openvpn/clients/<client-name>.ovpn
# =============================================================================

set -euo pipefail

# ── Config ────────────────────────────────────────────────────────────────────
VPS_IP="51.79.226.133"
VPN_PORT="1194"
VPN_PROTO="udp"
EASYRSA_DIR="/etc/openvpn/easy-rsa"
PKI_DIR="$EASYRSA_DIR/pki"
OUTPUT_DIR="/etc/openvpn/clients"

# ── Sanity checks ─────────────────────────────────────────────────────────────
if [[ $EUID -ne 0 ]]; then
  echo "ERROR: This script must be run as root." >&2
  exit 1
fi

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 <client-name>" >&2
  echo "  Example: $0 alice" >&2
  exit 1
fi

CLIENT="$1"

# Validate client name (alphanumeric + hyphens/underscores only)
if [[ ! "$CLIENT" =~ ^[a-zA-Z0-9_-]+$ ]]; then
  echo "ERROR: Client name must only contain letters, numbers, hyphens, or underscores." >&2
  exit 1
fi

if [[ ! -d "$EASYRSA_DIR" ]]; then
  echo "ERROR: Easy-RSA directory not found at $EASYRSA_DIR" >&2
  echo "       Run install-openvpn-server.sh first." >&2
  exit 1
fi

if [[ -f "$PKI_DIR/issued/${CLIENT}.crt" ]]; then
  echo "ERROR: Certificate for '$CLIENT' already exists." >&2
  echo "       Use a different name or revoke the existing one first." >&2
  exit 1
fi

echo "=== Generating certificate for client: $CLIENT ==="
cd "$EASYRSA_DIR"
./easyrsa --batch build-client-full "$CLIENT" nopass

mkdir -p "$OUTPUT_DIR"
OVPN_FILE="$OUTPUT_DIR/${CLIENT}.ovpn"

echo "=== Building .ovpn profile ==="

# Read file contents for inline embedding
CA_CERT=$(cat "$PKI_DIR/ca.crt")
CLIENT_CERT=$(openssl x509 -in "$PKI_DIR/issued/${CLIENT}.crt")
CLIENT_KEY=$(cat "$PKI_DIR/private/${CLIENT}.key")
TLS_KEY=$(cat "$PKI_DIR/ta.key")

cat > "$OVPN_FILE" <<PROFILE
# TijaeroERP VPN – Client Profile
# Client : $CLIENT
# Server : $VPS_IP:$VPN_PORT/$VPN_PROTO
# Generated: $(date -u +"%Y-%m-%d %H:%M UTC")

client
dev tun
proto $VPN_PROTO
remote $VPS_IP $VPN_PORT
resolv-retry infinite
nobind
persist-key
persist-tun

# TLS hardening
remote-cert-tls server
cipher AES-256-GCM
auth SHA256
tls-version-min 1.2

verb 3

<ca>
$CA_CERT
</ca>

<cert>
$CLIENT_CERT
</cert>

<key>
$CLIENT_KEY
</key>

<tls-crypt>
$TLS_KEY
</tls-crypt>
PROFILE

chmod 600 "$OVPN_FILE"

echo ""
echo "============================================================"
echo "  Client profile created: $OVPN_FILE"
echo ""
echo "  Transfer to the client machine then import into OpenVPN:"
echo ""
echo "  SCP example (run on your LOCAL machine):"
echo "    scp root@$VPS_IP:$OVPN_FILE ./${CLIENT}.ovpn"
echo ""
echo "  Windows  : Import into OpenVPN GUI or OpenVPN Connect"
echo "  macOS    : Import into Tunnelblick or OpenVPN Connect"
echo "  Linux    : sudo openvpn --config ${CLIENT}.ovpn"
echo "  iOS/Android: Import via OpenVPN Connect app"
echo ""
echo "  Once connected the app will be reachable at:"
echo "    http://10.8.0.1"
echo ""
echo "  To revoke access: bash remove-vpn-client.sh $CLIENT"
echo "============================================================"
