"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import Image from "next/image";
import ProgressBar from "./ProgressBar";
import WifiStep from "./WifiStep";
import DoneStep from "./DoneStep";
import LanguageSelector from "./LanguageSelector";
import { isLocalChannelPreview, resolveSetupFlowState } from "@/lib/setup-flow";
import { t, tf } from "@/lib/i18n";
import { useI18n } from "./I18nProvider";

function applyStatusData(
  data: Record<string, unknown>,
  setSetupComplete: (v: boolean) => void,
  setCurrentStep: (v: number) => void
) {
  const nextState = resolveSetupFlowState(data);
  setSetupComplete(nextState.setupComplete);
  setCurrentStep(nextState.currentStep);
}

export default function SetupWizard() {
  const { locale } = useI18n();
  void locale;
  const [currentStep, setCurrentStep] = useState(1);
  const [setupComplete, setSetupComplete] = useState(false);
  const [localChannelPreview, setLocalChannelPreview] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [setupError, setSetupError] = useState<string | null>(null);
  const [wifiStatusHint, setWifiStatusHint] = useState<{
    type: "success" | "error";
    message: string;
    readyUrl?: string;
    ipv4Url?: string;
    ipv4?: string;
    connected?: boolean;
  } | null>(null);
  const [retryCount, setRetryCount] = useState(0);

  useEffect(() => {
    setLocalChannelPreview(isLocalChannelPreview(window.location));
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const poll = async () => {
      try {
        const r = await fetch("/setup-api/setup/status", {
          signal: controller.signal,
          cache: "no-store",
        });
        if (!r.ok) {
          throw new Error(`Status check failed (${r.status})`);
        }
        const data = await r.json();
        if (cancelled) return;
        applyStatusData(data, setSetupComplete, setCurrentStep);
        if (typeof data?.wifi_last_error === "string" && data.wifi_last_error.trim()) {
          setWifiStatusHint({
            type: "error",
            message: data.wifi_last_error,
          });
        } else if (data?.wifi_connecting) {
          const targetSsid =
            typeof data?.wifi_target_ssid === "string" && data.wifi_target_ssid.trim()
              ? data.wifi_target_ssid
              : "the selected WiFi";
          setWifiStatusHint({
            type: "success",
            message: tf("wifi_switching_status", { ssid: targetSsid }),
          });
        } else if (data?.wifi_configured && data?.wifi_mode === "client") {
          const connectedSsid =
            typeof data?.wifi_target_ssid === "string" && data.wifi_target_ssid.trim()
              ? data.wifi_target_ssid
              : "your WiFi";
          const readyUrl =
            typeof data?.wifi_ready_url === "string" && data.wifi_ready_url.trim()
              ? data.wifi_ready_url
              : undefined;
          const ipv4Url =
            typeof data?.wifi_ipv4_url === "string" && data.wifi_ipv4_url.trim()
              ? data.wifi_ipv4_url
              : undefined;
          const ipv4 =
            typeof data?.wifi_ipv4 === "string" && data.wifi_ipv4.trim()
              ? data.wifi_ipv4
              : undefined;

          setWifiStatusHint({
            type: "success",
            connected: true,
            readyUrl,
            ipv4Url,
            ipv4,
            message:
              readyUrl || ipv4Url
                ? `Connected to ${connectedSsid}. Tap “Open Device” to jump directly.`
                : `Connected to ${connectedSsid}. You can continue setup on this network.`,
          });
        } else {
          setWifiStatusHint(null);
        }
        setSetupError(null);
        if (data?.wifi_connecting) {
          timer = setTimeout(poll, 2000);
        }
      } catch (err) {
        if (cancelled || (err instanceof DOMException && err.name === "AbortError")) return;
        console.error("[SetupWizard] Failed to fetch setup status:", err);
        setSetupError(err instanceof Error ? err.message : "Failed to load setup status");
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };

    void poll();
    return () => {
      cancelled = true;
      controller.abort();
      if (timer) {
        clearTimeout(timer);
      }
    };
  }, [retryCount]);

  const visibleStep = localChannelPreview ? 2 : currentStep;

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="spinner" role="status" aria-label={t("loading")} />
      </div>
    );
  }

  if (setupError) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <div className="text-center max-w-md">
          <p className="text-[var(--coral-bright)] text-sm mb-4">{setupError}</p>
          <button
            type="button"
            onClick={() => setRetryCount((c) => c + 1)}
            className="px-6 py-2.5 btn-gradient text-white rounded-lg text-sm font-semibold cursor-pointer transition transform hover:scale-105"
          >
            {t("retry")}
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
      <header className="sticky top-0 z-50 mx-auto mt-3 flex w-[calc(100%-1.5rem)] max-w-6xl items-center justify-between gap-3 rounded-2xl border border-white/10 bg-[#111827]/80 px-3 py-2.5 shadow-2xl shadow-black/20 backdrop-blur-xl sm:px-5">
        <Link href="/" className="flex items-center gap-2 shrink-0">
          <Image
            src="/headless-claw-box.png"
            alt="ClawBox"
            width={36}
            height={36}
            className="h-11 w-11 rounded-xl border border-white/10 object-cover shadow-lg shadow-orange-950/30"
            priority
          />
          <div className="flex flex-col leading-tight">
            <span className="text-xl font-bold font-display title-gradient">
              ClawBox
            </span>
            <span className="text-[10px] text-green-400 -mt-1">
              {process.env.NEXT_PUBLIC_APP_VERSION?.match(/^(v\d+\.\d+\.\d+)/)?.[1] ?? process.env.NEXT_PUBLIC_APP_VERSION}
            </span>
          </div>
        </Link>
        <div className="flex items-center gap-3">
          {visibleStep < 2 && <ProgressBar currentStep={visibleStep} />}
          <LanguageSelector />
        </div>
      </header>

      <main
        className="flex-1 flex flex-col items-center justify-start sm:justify-center px-4 pt-2 pb-4 sm:p-6"
      >
        {visibleStep === 1 && <WifiStep externalStatus={wifiStatusHint} />}
        {visibleStep === 2 && <DoneStep setupComplete={setupComplete} />}
      </main>

      <footer className="px-4 py-3 flex items-center justify-center gap-3">
        <a
          href="https://openclawhardware.dev/"
          target="_blank"
          rel="noopener noreferrer"
          aria-label="ClawBox website"
          className="flex items-center justify-center w-9 h-9 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] transition transform hover:scale-105"
        >
          <Image src="/headless-claw-box.png" alt="ClawBox" width={28} height={28} className="h-7 w-7 rounded-md object-cover" />
        </a>
      </footer>
    </>
  );
}
