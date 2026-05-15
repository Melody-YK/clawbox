import { getAll, setMany } from "@/lib/config-store";
import { getWifiRuntimeState } from "@/lib/network";

export interface SetupStatus {
  setup_complete: boolean;
  password_configured: boolean;
  wifi_configured: boolean;
  ai_model_configured: boolean;
  ai_model_provider?: string;
  wifi_connecting: boolean;
  wifi_target_ssid: string | null;
  wifi_last_error: string | null;
  ai_model_last_error: string | null;
}

function getString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

export async function getSetupStatus(): Promise<SetupStatus> {
  const [config, runtime] = await Promise.all([getAll(), getWifiRuntimeState()]);

  const runtimeWifiConfigured = runtime.connected && !!runtime.ipv4;
  const storedWifiConfigured = !!config.wifi_configured;
  const wifiConfigured = storedWifiConfigured || runtimeWifiConfigured;
  const wifiConnecting = !!config.wifi_connecting && !runtimeWifiConfigured;
  const wifiTargetSsid =
    getString(config.wifi_target_ssid) ?? runtime.ssid ?? null;
  const wifiLastError = runtimeWifiConfigured
    ? null
    : getString(config.wifi_last_error);
  const aiModelLastError = getString(config.ai_model_last_error);

  if (runtimeWifiConfigured && (!storedWifiConfigured || !!config.wifi_connecting || wifiLastError)) {
    await setMany({
      wifi_configured: true,
      hotspot_enabled: false,
      wifi_connecting: false,
      wifi_target_ssid: runtime.ssid ?? wifiTargetSsid ?? undefined,
      wifi_last_error: undefined,
    }).catch(() => {});
  }

  return {
    setup_complete: !!config.setup_complete,
    password_configured: !!config.password_configured,
    wifi_configured: wifiConfigured,
    ai_model_configured: !!config.ai_model_configured,
    ai_model_provider:
      typeof config.ai_model_provider === "string"
        ? config.ai_model_provider
        : undefined,
    wifi_connecting: wifiConnecting,
    wifi_target_ssid: wifiTargetSsid,
    wifi_last_error: wifiLastError,
    ai_model_last_error: aiModelLastError,
  };
}
