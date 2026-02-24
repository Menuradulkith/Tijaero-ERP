#!/bin/bash
# =============================================================================
# Start TijaeroERP with server overrides + Nginx bound to the VPN interface
# Usage: bash setup_vpn/docker-server-up.sh [extra docker compose args]
#   e.g. bash setup_vpn/docker-server-up.sh --build
#        bash setup_vpn/docker-server-up.sh down
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(dirname "${SCRIPT_DIR}")"

# Load vpn.env so VPN_GATEWAY_IP etc. are available for docker compose
# port-binding substitution (${VPN_GATEWAY_IP:-10.8.0.1})
VPN_ENV_FILE="${SCRIPT_DIR}/vpn.env"
if [[ -f "${VPN_ENV_FILE}" ]]; then
  set -a
  source "${VPN_ENV_FILE}"
  set +a
  echo "[vpn]  Loaded: ${VPN_ENV_FILE}"
  echo "[vpn]  VPN_GATEWAY_IP = ${VPN_GATEWAY_IP:-10.8.0.1}"
  echo "[vpn]  VPS_PUBLIC_IP  = ${VPS_PUBLIC_IP:-<not set>}"
fi

exec docker compose \
  --project-directory "${PROJECT_ROOT}" \
  -f "${PROJECT_ROOT}/docker-compose.yml" \
  -f "${PROJECT_ROOT}/docker-compose.server.yml" \
  "$@"
