#!/usr/bin/env bash
set -euo pipefail

# 自动检测WiFi接口
IFACE="${NETWORK_INTERFACE:-$(iw dev 2>/dev/null | awk '/Interface/ {print $2}' | head -1 || echo 'wlan0')}"
HOTSPOT_ENV_FILE="/home/clawbox/clawbox/data/hotspot.env"
if [ -f "$HOTSPOT_ENV_FILE" ]; then
  # shellcheck disable=SC1090
  . "$HOTSPOT_ENV_FILE"
fi
AP_SSID="${HOTSPOT_SSID:-ClawBox-Setup}"

echo "[AP] Stopping hotspot..."

# 停止热点连接
nmcli connection down "$AP_SSID" 2>/dev/null || true
nmcli connection delete "$AP_SSID" 2>/dev/null || true

echo "[AP] Hotspot stopped"
