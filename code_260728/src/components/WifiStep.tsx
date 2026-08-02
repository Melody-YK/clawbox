"use client";

import { useState, useEffect, useRef } from "react";
import Image from "next/image";
import StatusMessage from "./StatusMessage";
import { t, tf } from "@/lib/i18n";
import { useI18n } from "./I18nProvider";

interface WifiNetwork {
  ssid: string;
  signal: number;
  security: string;
  freq: string;
}

interface ScanResponse {
  scanning?: boolean;
  networks?: WifiNetwork[] | null;
  error?: string | null;
}

interface ErrorResponse {
  error?: string;
}

interface ConnectResponse {
  message?: string;
  mdnsHost?: string;
  nextUrlHint?: string;
}

interface WifiStatusHint {
  type: "success" | "error";
  message: string;
  readyUrl?: string;
  ipv4Url?: string;
  ipv4?: string;
  connected?: boolean;
}

interface WifiStatusSnapshot {
  hostname?: string;
  mdnsHost?: string;
  accessUrl?: string;
}

function isScanResponse(value: unknown): value is ScanResponse {
  return typeof value === "object" && value !== null;
}

function getErrorMessage(value: unknown): string | undefined {
  if (typeof value !== "object" || value === null || !("error" in value)) {
    return undefined;
  }
  const candidate = (value as ErrorResponse).error;
  return typeof candidate === "string" ? candidate : undefined;
}

function getConnectResponse(value: unknown): ConnectResponse | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  return value as ConnectResponse;
}

export default function WifiStep({
  externalStatus = null,
}: {
  externalStatus?: WifiStatusHint | null;
}) {
  const { locale } = useI18n();
  void locale;
  const [ssid, setSsid] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [networks, setNetworks] = useState<WifiNetwork[]>([]);
  const [showNetworkList, setShowNetworkList] = useState(false);
  const [status, setStatus] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);
  const [statusSnapshot, setStatusSnapshot] = useState<WifiStatusSnapshot | null>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const visibleStatus = status ?? externalStatus;
  const openDeviceUrl =
    externalStatus?.readyUrl || externalStatus?.ipv4Url || statusSnapshot?.accessUrl || null;
  const ipv4FallbackText = externalStatus?.ipv4 || null;

  useEffect(() => {
    const controller = new AbortController();
    const loadStatusSnapshot = async () => {
      try {
        const res = await fetch("/setup-api/wifi/status", {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!res.ok) return;
        const data: unknown = await res.json().catch(() => null);
        if (typeof data !== "object" || data === null) return;
        const snapshot = data as WifiStatusSnapshot;
        setStatusSnapshot({
          hostname: snapshot.hostname,
          mdnsHost: snapshot.mdnsHost,
          accessUrl: snapshot.accessUrl,
        });
      } catch {
        // ignore
      }
    };

    void loadStatusSnapshot();
    return () => {
      controller.abort();
      controllerRef.current?.abort();
    };
  }, []);

  const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  const scanWifi = async () => {
    setScanning(true);
    setStatus(null);
    try {
      const trigger = await fetch("/setup-api/wifi/scan", { method: "POST" });
      if (!trigger.ok) {
        throw new Error(`Scan failed (${trigger.status})`);
      }

      let data: ScanResponse | null = null;
      for (let attempt = 0; attempt < 20; attempt++) {
        await wait(attempt === 0 ? 800 : 1000);
        const poll = await fetch("/setup-api/wifi/scan", { cache: "no-store" });
        if (!poll.ok) {
          throw new Error(`Scan failed (${poll.status})`);
        }
        const payload: unknown = await poll.json();
        if (!isScanResponse(payload)) {
          throw new Error("Invalid scan response");
        }
        data = payload;
        if (!data?.scanning) {
          break;
        }
      }

      if (!data || data.scanning) {
        throw new Error("Scan timed out");
      }

      if (data.error) {
        throw new Error(data.error);
      }

      const list = data.networks || [];
      setNetworks(list);
      setShowNetworkList(true);
      if (list.length === 0) {
        setStatus({
          type: "error",
          message: "No networks found. Move closer to the router and try Scan Networks again.",
        });
      }
    } catch (err) {
      setStatus({
        type: "error",
        message: `Scan failed: ${err instanceof Error ? err.message : err}`,
      });
    } finally {
      setScanning(false);
    }
  };

  const connectWifi = async () => {
    if (!ssid.trim()) return;

    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;

    setConnecting(true);
    setStatus(null);
    try {
      const res = await fetch("/setup-api/wifi/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ssid: ssid.trim(), password }),
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      if (!res.ok) {
        const errData: unknown = await res.json().catch(() => null);
        throw new Error(getErrorMessage(errData) || `Connection failed (${res.status})`);
      }
      await res.json().catch(() => null);

      setConnecting(false);
      setStatus({
        type: "success",
        message: tf("wifi_switching_status", { ssid: ssid.trim() }),
      });
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      if (err instanceof TypeError && err.message.includes("fetch")) {
        setConnecting(false);
        const mdnsHint =
          statusSnapshot?.accessUrl ||
          (statusSnapshot?.mdnsHost ? `http://${statusSnapshot.mdnsHost}/` : "");
        const hostnameHint = statusSnapshot?.hostname
          ? `路由器客户端列表里找主机名 ${statusSnapshot.hostname}`
          : "路由器客户端列表里找 clawbox-xxxxxx 主机";

        setStatus({
          type: "success",
          message:
            `连接过程中热点断开是正常现象。请把手机切到目标 WiFi 后访问 ${mdnsHint || "设备的 .local 地址"}。如果 .local 无法访问，请用设备屏幕显示的 IPv4，或在 ${hostnameHint}。`,
        });
        return;
      }
      setStatus({
        type: "error",
        message: `Connection failed: ${err instanceof Error ? err.message : err}`,
      });
    } finally {
      if (!controller.signal.aborted) setConnecting(false);
    }
  };

  const selectNetwork = (network: WifiNetwork) => {
    setSsid(network.ssid);
    setPassword("");
    setShowNetworkList(false);
  };

  const getSignalBars = (signal: number) => {
    if (signal >= 80) return "●●●●●";
    if (signal >= 60) return "●●●●○";
    if (signal >= 40) return "●●●○○";
    if (signal >= 20) return "●●○○○";
    return "●○○○○";
  };

  return (
    <div className="w-full max-w-[560px]">
      <div className="card-surface relative overflow-hidden rounded-[28px] p-5 shadow-2xl shadow-black/30 sm:p-8">
        <div aria-hidden="true" className="pointer-events-none absolute -right-20 -top-24 h-56 w-56 rounded-full bg-orange-500/10 blur-3xl" />
        <div className="relative flex flex-col items-center gap-3 mb-6">
          <Image
            src="/headless-claw-box.png"
            alt="ClawBox"
            width={120}
            height={120}
            className="h-24 w-24 rounded-2xl border border-white/10 object-cover shadow-xl shadow-orange-950/30 sm:h-28 sm:w-28"
            priority
          />
          <h1 className="text-2xl font-bold font-display text-center sm:text-3xl">
            {t("wifi_step_title")}
          </h1>
        </div>
        <p className="relative text-[var(--text-secondary)] mb-7 leading-relaxed text-center">
          {t("wifi_step_description")}
        </p>

        <div className="relative flex flex-col gap-5">
          <div>
            <div className="flex justify-between items-center mb-1.5">
              <label
                htmlFor="wifi-ssid"
                className="text-xs font-semibold text-[var(--text-secondary)]"
              >
                {t("wifi_ssid")}
              </label>
              <button
                type="button"
                onClick={scanWifi}
                disabled={scanning}
                className="text-xs text-[var(--coral-bright)] hover:underline cursor-pointer disabled:opacity-50"
              >
                {scanning ? t("scanning") : t("scan_wifi")}
              </button>
            </div>
            <input
              id="wifi-ssid"
              type="text"
              value={ssid}
              onChange={(e) => setSsid(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") connectWifi();
              }}
              placeholder={t("wifi_ssid_placeholder")}
              autoComplete="off"
              className="w-full rounded-xl border border-white/10 bg-black/20 px-4 py-3.5 text-sm text-gray-100 outline-none transition-all placeholder:text-gray-600 hover:border-white/20 focus:border-[var(--coral-bright)] focus:ring-4 focus:ring-orange-500/10"
            />
            
            {showNetworkList && networks.length > 0 && (
              <div className="mt-2 bg-[var(--bg-surface)] border border-gray-700 rounded-lg max-h-48 overflow-y-auto">
                {networks.map((network, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => selectNetwork(network)}
                    className="w-full px-3 py-2 text-left hover:bg-[var(--bg-elevated)] text-sm text-gray-200 flex justify-between items-center border-b border-gray-700 last:border-b-0"
                  >
                    <span>{network.ssid}</span>
                    <span className="text-xs text-gray-500">{getSignalBars(network.signal)}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div>
            <label
              htmlFor="wifi-password"
              className="block text-xs font-semibold text-[var(--text-secondary)] mb-1.5"
            >
              {t("password")}
            </label>
            <div className="relative">
              <input
                id="wifi-password"
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") connectWifi();
                }}
                placeholder={t("wifi_password_placeholder")}
                autoComplete="off"
                className="w-full rounded-xl border border-white/10 bg-black/20 px-4 py-3.5 pr-11 text-sm text-gray-100 outline-none transition-all placeholder:text-gray-600 hover:border-white/20 focus:border-[var(--coral-bright)] focus:ring-4 focus:ring-orange-500/10"
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? "Hide password" : "Show password"}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)] hover:text-[var(--text-primary)] bg-transparent border-none cursor-pointer p-0.5"
              >
                {showPassword ? (
                  <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                ) : (
                  <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                )}
              </button>
            </div>
          </div>
        </div>

        {visibleStatus && (
          <div className="mt-4">
            <StatusMessage
              type={visibleStatus.type}
              message={visibleStatus.message}
            />
            {visibleStatus.type === "success" && externalStatus?.connected && openDeviceUrl && (
              <div className="mt-3 p-3 rounded-lg border border-green-500/20 bg-[#00e5cc]/5">
                <p className="text-xs text-[#00e5cc] mb-2">Direct access address is ready.</p>
                <p className="text-xs text-gray-300 break-all mb-3">{openDeviceUrl}</p>
                {ipv4FallbackText && (
                  <p className="text-xs text-gray-400 mb-3">IPv4: {ipv4FallbackText}</p>
                )}
                <a
                  href={openDeviceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex px-4 py-2 rounded-md btn-gradient text-white text-xs font-semibold"
                >
                  {t("open_device")}
                </a>
              </div>
            )}
          </div>
        )}

        <p className="relative mt-5 rounded-xl border border-amber-400/10 bg-amber-400/5 px-4 py-3 text-xs leading-relaxed text-amber-200/80">
          <span className="font-semibold">{t("wifi_connection_note")}</span>
        </p>

        <div className="relative mt-5 flex items-center gap-3">
          <button
            type="button"
            onClick={connectWifi}
            disabled={connecting || !ssid.trim()}
            className="w-full cursor-pointer rounded-xl px-7 py-3.5 text-sm font-semibold text-white shadow-lg shadow-[rgba(249,115,22,0.25)] transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0 btn-gradient"
          >
            {connecting ? t("connecting") : t("connect")}
          </button>
        </div>
      </div>
    </div>
  );
}
