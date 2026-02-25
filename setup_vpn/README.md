# TijaeroERP – OpenVPN Setup

Restricts access to the ERP application so that **only users connected to the OpenVPN tunnel** can reach it.

| Item | Value |
|------|-------|
| VPS public IP | `51.79.226.133` |
| VPN port | `1194/UDP` |
| VPN subnet | `10.8.0.0/24` |
| VPN gateway (tun0) | `10.8.0.1` |
| App URL (via VPN) | `http://10.8.0.1` |

---

## Architecture

```
Internet
   │
   │  port 1194/UDP  (OpenVPN)
   ▼
VPS 51.79.226.133
   │
   │  tun0 10.8.0.1
   ▼
UFW – only tun0 → port 80 allowed
   │
   ▼
Nginx (Docker) on port 80
   ├── /api/      → backend:8000
   ├── /adminer/  → adminer:8080
   ├── /pgadmin/  → pgadmin:80
   └── /          → frontend:80
```

Port 80 is **blocked** from the public internet by UFW.  
All other Docker service ports are not exposed publicly.

---

## Scripts

| Script | Purpose |
|--------|---------|
| `install-openvpn-server.sh` | Install & configure OpenVPN server + UFW firewall rules |
| `add-vpn-client.sh <name>` | Generate a `.ovpn` profile for a new client |
| `remove-vpn-client.sh <name>` | Revoke a client's certificate (blocks access immediately) |
| `uninstall-openvpn-server.sh` | Remove OpenVPN entirely and restore UFW |

---

## Step-by-step Deployment

### 1 — SSH into the VPS

```bash
ssh root@51.79.226.133
```

### 2 — Upload the project

```bash
# From your local machine
scp -r . root@51.79.226.133:/opt/tijaero-erp
```

Or clone via git:

```bash
git clone <your-repo-url> /opt/tijaero-erp
cd /opt/tijaero-erp
```

### 3 — Install OpenVPN server

```bash
cd /opt/tijaero-erp/setup_vpn
bash install-openvpn-server.sh
```

This script:
- Installs `openvpn` + `easy-rsa`
- Creates the PKI (CA, server cert, DH params, TLS-crypt key)
- Writes `/etc/openvpn/server/server.conf`
- Enables IP forwarding and NAT masquerade
- Configures UFW: port 1194/UDP open, port 80 **only from tun0**, SSH preserved

### 4 — Create a VPN client profile

```bash
bash add-vpn-client.sh your-username
```

Download the generated `.ovpn` file to your local machine:

```bash
# Run on your LOCAL machine
scp root@51.79.226.133:/etc/openvpn/clients/your-username.ovpn .
```

### 5 — Deploy the application

```bash
cd /opt/tijaero-erp

# Copy the vpn.env values into .env.server (GATEWAY_IP=10.8.0.1)
cp /etc/openvpn/server/vpn.env .env.server

docker compose -f docker-compose.yml -f docker-compose.server.yml up -d --build
```

### 6 — Connect to VPN and access the app

Import `your-username.ovpn` into your OpenVPN client, connect, then open:

```
http://10.8.0.1          ← ERP frontend
http://10.8.0.1/api/     ← REST API
http://10.8.0.1/adminer/ ← Adminer (DB browser)
http://10.8.0.1/pgadmin/ ← pgAdmin
```

---

## Managing Clients

### Add a new user

```bash
bash add-vpn-client.sh colleague-name
```

### Remove / revoke a user

```bash
bash remove-vpn-client.sh colleague-name
```

The user's certificate is added to the CRL and OpenVPN is reloaded.  
Their active connection is terminated within seconds.

### List active connections

```bash
cat /var/log/openvpn/openvpn-status.log
```

---

## Uninstalling

```bash
bash uninstall-openvpn-server.sh
```

> **Warning:** This opens port 80 to the public internet.  
> Re-secure the server before running the application again.

---

## UFW Rules Summary

| Rule | Direction | Source | Port | Action |
|------|-----------|--------|------|--------|
| SSH | in | any | 22/tcp | ALLOW |
| OpenVPN | in | any | 1194/udp | ALLOW |
| ERP app | in | tun0 | 80/tcp | ALLOW |
| HTTP public | in | any | 80/tcp | DENY |

---

## Client Software

| Platform | App |
|----------|-----|
| Windows | [OpenVPN GUI](https://openvpn.net/community-downloads/) or [OpenVPN Connect](https://openvpn.net/client/) |
| macOS | [Tunnelblick](https://tunnelblick.net/) or OpenVPN Connect |
| Linux | `sudo apt install openvpn && sudo openvpn --config client.ovpn` |
| iOS | OpenVPN Connect (App Store) |
| Android | OpenVPN Connect (Play Store) |
