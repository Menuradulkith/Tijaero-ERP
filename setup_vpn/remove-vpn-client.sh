#!/usr/bin/env bash
# =============================================================================
# remove-vpn-client.sh
#
# Revokes an existing OpenVPN client certificate so that client can no longer
# connect to the VPN (and therefore can no longer access TijaeroERP).
#
# Usage (run on VPS as root):
#   bash remove-vpn-client.sh <client-name>
#
# Example:
#   bash remove-vpn-client.sh alice
# =============================================================================

set -euo pipefail

# ── Config ────────────────────────────────────────────────────────────────────
EASYRSA_DIR="/etc/openvpn/easy-rsa"
PKI_DIR="$EASYRSA_DIR/pki"
OUTPUT_DIR="/etc/openvpn/clients"
SERVER_CONF_DIR="/etc/openvpn/server"

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

if [[ ! -d "$EASYRSA_DIR" ]]; then
  echo "ERROR: Easy-RSA directory not found at $EASYRSA_DIR" >&2
  exit 1
fi

if [[ ! -f "$PKI_DIR/issued/${CLIENT}.crt" ]]; then
  echo "ERROR: No certificate found for client '$CLIENT'." >&2
  echo "       Available clients:"
  ls "$PKI_DIR/issued/" 2>/dev/null | grep -v "^server\." | sed 's/\.crt$/  /' || echo "  (none)"
  exit 1
fi

echo "=== Revoking certificate for client: $CLIENT ==="
cd "$EASYRSA_DIR"
./easyrsa --batch revoke "$CLIENT"

echo "=== Regenerating Certificate Revocation List (CRL) ==="
./easyrsa gen-crl

# Copy the CRL to the server config directory so OpenVPN picks it up
cp "$PKI_DIR/crl.pem" "$SERVER_CONF_DIR/crl.pem"
chmod 644 "$SERVER_CONF_DIR/crl.pem"

# Add crl-verify directive to server.conf if not already present
if ! grep -q "^crl-verify" "$SERVER_CONF_DIR/server.conf" 2>/dev/null; then
  echo "" >> "$SERVER_CONF_DIR/server.conf"
  echo "# Certificate Revocation List" >> "$SERVER_CONF_DIR/server.conf"
  echo "crl-verify $SERVER_CONF_DIR/crl.pem" >> "$SERVER_CONF_DIR/server.conf"
  echo "  Added crl-verify to server.conf"
fi

echo "=== Reloading OpenVPN server (SIGHUP) to apply CRL ==="
systemctl reload openvpn-server@server 2>/dev/null || systemctl restart openvpn-server@server

# Remove the .ovpn client profile so it's not accidentally reused
if [[ -f "$OUTPUT_DIR/${CLIENT}.ovpn" ]]; then
  rm -f "$OUTPUT_DIR/${CLIENT}.ovpn"
  echo "  Removed client profile: $OUTPUT_DIR/${CLIENT}.ovpn"
fi

echo ""
echo "============================================================"
echo "  Client '$CLIENT' has been REVOKED."
echo ""
echo "  - Their certificate is now on the CRL."
echo "  - Any active connection will be dropped within seconds."
echo "  - The .ovpn profile has been deleted from the server."
echo ""
echo "  To add a replacement client:"
echo "    bash add-vpn-client.sh <new-client-name>"
echo "============================================================"
