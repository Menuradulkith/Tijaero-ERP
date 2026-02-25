#!/bin/bash
# =============================================================================
# OpenVPN Server Setup Script for TijaeroERP VPS
# =============================================================================
# Run this script as root on the VPS (Ubuntu 20.04 / 22.04 / 24.04 or Debian)
# Usage: sudo bash setup-openvpn.sh
# =============================================================================

set -euo pipefail

# ── Load vpn.env (single source of truth for all configurable values) ─────────
VPN_ENV_FILE="$(dirname "$0")/vpn.env"
if [[ -f "${VPN_ENV_FILE}" ]]; then
  # shellcheck source=vpn.env
  set -a; source "${VPN_ENV_FILE}"; set +a
fi

# ── Configuration (vpn.env values take precedence; these are the defaults) ────
VPN_SUBNET="${VPN_SUBNET:-10.8.0.0}"
VPN_MASK="${VPN_MASK:-255.255.255.0}"
VPN_PORT="${VPN_PORT:-1194}"
VPN_PROTO="${VPN_PROTO:-udp}"
VPN_GATEWAY_IP="${VPN_GATEWAY_IP:-10.8.0.1}"
VPN_DEV="tun0"
EASYRSA_DIR="/etc/openvpn/easy-rsa"
SERVER_NAME="erp-server"
CLIENT_TEMPLATE_DIR="/etc/openvpn/client-templates"
OVPN_DIR="/etc/openvpn/clients"

# Public IP: vpn.env → env var → auto-detect
PUBLIC_IP="${VPS_PUBLIC_IP:-$(curl -s https://api.ipify.org || curl -s https://ifconfig.me)}"

# ── Colors ─────────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
info()    { echo -e "${GREEN}[INFO]${NC}  $*"; }
warn()    { echo -e "${YELLOW}[WARN]${NC}  $*"; }
error()   { echo -e "${RED}[ERROR]${NC} $*"; exit 1; }

# ── Root check ─────────────────────────────────────────────────────────────────
[[ $EUID -ne 0 ]] && error "This script must be run as root."

info "Detected public IP: ${PUBLIC_IP}"
read -rp "Is this correct? [Y/n]: " confirm
[[ ${confirm,,} == "n" ]] && read -rp "Enter the correct VPS public IP: " PUBLIC_IP

# ── 1. Install packages ────────────────────────────────────────────────────────
info "Installing OpenVPN and EasyRSA..."
apt-get update -qq
# iptables-persistent conflicts with ufw on Ubuntu 24.04 – ufw handles its own persistence
DEBIAN_FRONTEND=noninteractive apt-get install -y openvpn easy-rsa ufw curl

# ── 2. Initialize PKI with EasyRSA 3 ──────────────────────────────────────────
info "Setting up PKI with EasyRSA..."
make-cadir "${EASYRSA_DIR}"
cd "${EASYRSA_DIR}"

# Non-interactive PKI init
./easyrsa init-pki

# Generate CA (no password for unattended operation; add --use-algo ec for smaller certs)
echo "TijaeroERP-CA" | ./easyrsa build-ca nopass

# Generate server certificate and key
./easyrsa gen-req "${SERVER_NAME}" nopass
echo "yes" | ./easyrsa sign-req server "${SERVER_NAME}"

# Generate Diffie-Hellman parameters
./easyrsa gen-dh

# Generate TLS-Crypt key (replay protection)
# OpenVPN 2.6+ (Ubuntu 24.04) uses '--genkey tls-crypt'; fall back for older installs
OPENVPN_VER=$(openvpn --version 2>&1 | awk 'NR==1{print $2}')
if [[ "${OPENVPN_VER%%.*}" -ge 2 && "${OPENVPN_VER#*.}" =~ ^[6-9] ]] 2>/dev/null || \
   dpkg --compare-versions "${OPENVPN_VER}" ge "2.6" 2>/dev/null; then
  openvpn --genkey tls-crypt pki/ta.key
else
  openvpn --genkey secret pki/ta.key
fi

# ── 3. Copy server credentials into /etc/openvpn/server ───────────────────────
info "Installing server credentials..."
install -m 600 pki/ca.crt                        /etc/openvpn/server/ca.crt
install -m 600 "pki/issued/${SERVER_NAME}.crt"   /etc/openvpn/server/server.crt
install -m 600 "pki/private/${SERVER_NAME}.key"  /etc/openvpn/server/server.key
install -m 600 pki/dh.pem                        /etc/openvpn/server/dh.pem
install -m 600 pki/ta.key                        /etc/openvpn/server/ta.key

# ── 4. Write server config ─────────────────────────────────────────────────────
info "Writing OpenVPN server config..."
cat > /etc/openvpn/server/server.conf <<EOF
# TijaeroERP OpenVPN Server Configuration
port ${VPN_PORT}
proto ${VPN_PROTO}
dev ${VPN_DEV}

ca   /etc/openvpn/server/ca.crt
cert /etc/openvpn/server/server.crt
key  /etc/openvpn/server/server.key
dh   /etc/openvpn/server/dh.pem

# TLS extra security
tls-crypt /etc/openvpn/server/ta.key

# VPN subnet – clients get IPs in 10.8.0.x
server ${VPN_SUBNET} ${VPN_MASK}
ifconfig-pool-persist /var/log/openvpn/ipp.txt

# Do NOT push a default gateway (split-tunnel: only VPN subnet routed)
# Clients reach 10.8.0.1 (the VPS) for ERP access
push "route ${VPN_SUBNET} ${VPN_MASK}"

# DNS servers pushed to clients
push "dhcp-option DNS 8.8.8.8"
push "dhcp-option DNS 1.1.1.1"

# Keep connection alive
keepalive 10 120

# Cipher
cipher AES-256-GCM
auth SHA256

# Compression (disabled – security recommendation)
;comp-lzo

# Restrict privileges after startup
user nobody
group nogroup
persist-key
persist-tun

# Logging
status /var/log/openvpn/openvpn-status.log
log-append /var/log/openvpn/openvpn.log
verb 3

# Max clients
max-clients 20

# Client-to-client traffic (enable if clients need to talk to each other)
;client-to-client

# Revocation list (uncomment after revoking first certificate)
;crl-verify /etc/openvpn/server/crl.pem
EOF

mkdir -p /var/log/openvpn

# ── 5. Enable IP forwarding ────────────────────────────────────────────────────
info "Enabling IP forwarding..."
sed -i 's|^#\?net.ipv4.ip_forward.*|net.ipv4.ip_forward=1|' /etc/sysctl.conf
sysctl -p /etc/sysctl.conf

# ── 6. UFW / iptables firewall rules ──────────────────────────────────────────
info "Configuring firewall..."

# Detect primary network interface
NIC=$(ip route | awk '/default/ {print $5; exit}')
info "Primary network interface: ${NIC}"

# Allow SSH (do not lock yourself out)
ufw allow OpenSSH

# Allow OpenVPN
ufw allow "${VPN_PORT}/${VPN_PROTO}"

# Allow all ERP service ports ONLY from the VPN tunnel interface
ufw allow in on "${VPN_DEV}" to any port 80   proto tcp comment "ERP via VPN"
ufw allow in on "${VPN_DEV}" to any port 443  proto tcp comment "ERP HTTPS via VPN"

# Explicitly deny port 80 from the public internet (nginx only serves via VPN)
ufw deny in on "${NIC}" to any port 80   proto tcp

# NAT masquerade for VPN traffic (prepend to /etc/ufw/before.rules)
if ! grep -q "OPENVPN_NAT" /etc/ufw/before.rules; then
  sed -i "1s|^|# OPENVPN_NAT\n*nat\n:POSTROUTING ACCEPT [0:0]\n-A POSTROUTING -s ${VPN_SUBNET}/24 -o ${NIC} -j MASQUERADE\nCOMMIT\n\n|" /etc/ufw/before.rules
fi

# Enable UFW (accept rules)
ufw --force enable

# ── 7. Enable and start OpenVPN ────────────────────────────────────────────────
info "Enabling OpenVPN service..."
systemctl enable openvpn-server@server
systemctl start  openvpn-server@server

sleep 2
systemctl is-active openvpn-server@server \
  && info "OpenVPN is running!" \
  || warn "OpenVPN may not have started – check: journalctl -u openvpn-server@server"

# ── 8. Create client template directory ───────────────────────────────────────
mkdir -p "${CLIENT_TEMPLATE_DIR}" "${OVPN_DIR}"

cat > "${CLIENT_TEMPLATE_DIR}/client-base.conf" <<EOF
client
dev tun
proto ${VPN_PROTO}
remote ${PUBLIC_IP} ${VPN_PORT}

resolv-retry infinite
nobind
persist-key
persist-tun

remote-cert-tls server
cipher AES-256-GCM
auth SHA256

# TLS direction (must match server tls-crypt)
key-direction 1

verb 3
EOF

info "========================================================"
info "OpenVPN server setup complete!"
info "  VPN subnet : ${VPN_SUBNET}/24"
info "  VPS VPN IP : ${VPN_GATEWAY_IP}"
info "  ERP URL    : http://${VPN_GATEWAY_IP}  (after docker-compose up)"
info ""
info "Next steps:"
info "  1. Run docker-compose (with server overlay) to start ERP + Nginx"
info "  2. Run ./add-client.sh <client-name> to create a client config"
info "========================================================"
