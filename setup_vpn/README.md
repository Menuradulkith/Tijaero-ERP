# OpenVPN Setup for TijaeroERP

This directory contains everything needed to run TijaeroERP exclusively over an
OpenVPN tunnel, so the application is never exposed to the public internet.

## Architecture

```
Internet
   │
   │  UDP 1194 (OpenVPN only)
   ▼
┌──────────────────────────────────────────────┐
│  VPS                                         │
│                                              │
│  tun0  ──  10.8.0.1  (VPN interface)        │
│                │                             │
│         Nginx  :80                           │
│                ├─ /         ──► frontend :80 │
│                ├─ /api/     ──► backend  :8000│
│                ├─ /adminer/ ──► adminer  :8080│
│                └─ /pgadmin/ ──► pgadmin  :80 │
└──────────────────────────────────────────────┘
         ▲
         │  OpenVPN tunnel
         │
      Client  10.8.0.x
   (browser → http://10.8.0.1)
```

**Key points:**
- The ERP ports are bound to `10.8.0.1` (VPN interface) only — **not reachable from the internet**.
- OpenVPN itself listens on UDP 1194 (needs to be open in the firewall / VPS control panel).
- SSH port 22 stays open for administration.

---

## Files

| File | Purpose |
|---|---|
| `setup-openvpn.sh` | One-time server setup: installs OpenVPN, EasyRSA, configures UFW |
| `add-client.sh` | Generates a self-contained `.ovpn` client config file |
| `revoke-client.sh` | Revokes a client certificate (blocks future connections) |
| `nginx/erp-vpn.conf` | Nginx reverse-proxy config (mounted into the nginx container) |

---

## Quick Start

### Step 1 – VPS firewall check

`setup-openvpn.sh` configures **UFW** directly on the VPS, which is the
authoritative firewall for this setup. A separate cloud-level firewall
(Hetzner, DigitalOcean, etc.) is not required.

**OVHcloud (this VPS):** OVH does not enable their Network Firewall product by
default, so all ports are reachable at the cloud level. UFW on the VPS is
all that is needed — `setup-openvpn.sh` handles it automatically.

If you ever activate the OVH Network Firewall later, make sure to allow:
- **UDP 1194** – OpenVPN
- **TCP 22** – SSH

### Step 2 – Run the server setup script

SSH into the VPS as root, then:

```bash
# Upload the setup_vpn directory to the VPS, e.g.:
scp -r setup_vpn/ root@YOUR_VPS_IP:/opt/tijaero-erp/

cd /opt/tijaero-erp/setup_vpn
chmod +x setup-openvpn.sh add-client.sh revoke-client.sh
sudo bash setup-openvpn.sh
```

The script will:
1. Install `openvpn`, `easy-rsa`, `ufw`
2. Create a PKI / CA and sign a server certificate
3. Write `/etc/openvpn/server/server.conf`
4. Configure UFW (allow SSH + UDP 1194; allow HTTP only from `10.8.0.0/24`)
5. Start and enable `openvpn-server@server`

### Step 3 – Start the ERP stack with Nginx

```bash
cd /opt/tijaero-erp   # project root on VPS

# Use both compose files: base + server overrides (includes nginx)
docker compose \
  -f docker-compose.yml \
  -f docker-compose.server.yml \
  up -d --build
```

Nginx will listen on `10.8.0.1:80` only. Adminer and pgAdmin are served as subpaths.

### Step 4 – Create a client config

```bash
sudo bash setup_vpn/add-client.sh alice
# Output: /etc/openvpn/clients/alice.ovpn
```

Download `alice.ovpn` to Alice's machine:

```bash
scp root@YOUR_VPS_IP:/etc/openvpn/clients/alice.ovpn ~/Downloads/
```

### Step 5 – Connect and access the ERP

Import `alice.ovpn` into any OpenVPN client and connect.

| Service | URL (after VPN connect) |
|---|---|
| **ERP App** | http://10.8.0.1 |
| **API docs** | http://10.8.0.1/docs |
| **Adminer** | http://10.8.0.1/adminer/ |
| **pgAdmin** | http://10.8.0.1/pgadmin/ |

---

## Managing Clients

```bash
# Add a new client
sudo bash setup_vpn/add-client.sh bob

# Revoke a client (blocks them from connecting)
sudo bash setup_vpn/revoke-client.sh bob
```

---

## Troubleshooting

```bash
# Check OpenVPN status
systemctl status openvpn-server@server

# Live log
journalctl -u openvpn-server@server -f

# Check connected clients
cat /var/log/openvpn/openvpn-status.log

# Verify Nginx is up
docker compose -f docker-compose.yml -f docker-compose.server.yml ps nginx
docker logs erp_nginx

# Test Nginx config
docker exec erp_nginx nginx -t
```

---

## Security Notes

- The server uses **AES-256-GCM** cipher and **tls-crypt** for replay protection.
- Client certificates are valid for **10 years** by default; reduce `EASYRSA_CERT_EXPIRE`
  in `setup-openvpn.sh` for stricter environments.
- This is a **split-tunnel** setup — only `10.8.0.0/24` traffic goes through the VPN.
  Regular internet traffic on the client goes through their own gateway.
- Change to full-tunnel by adding `push "redirect-gateway def1 bypass-dhcp"` in
  `server.conf` if you want all client traffic to route through the VPS.
