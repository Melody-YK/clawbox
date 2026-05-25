"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import Image from "next/image";
import ProgressBar from "./ProgressBar";
import WifiStep from "./WifiStep";
import DoneStep from "./DoneStep";

function applyStatusData(
  data: Record<string, unknown>,
  setSetupComplete: (v: boolean) => void,
  setCurrentStep: (v: number) => void
) {
  if (data.setup_complete) {
    setSetupComplete(true);
    setCurrentStep(2);
  } else if (data.wifi_configured) {
    setCurrentStep(2);
  }
}

export default function SetupWizard() {
  const [currentStep, setCurrentStep] = useState(1);
  const [setupComplete, setSetupComplete] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [setupError, setSetupError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);

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

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="spinner" role="status" aria-label="Loading" />
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
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
      <header className="px-4 py-2.5 sm:px-6 sm:py-4 flex items-center justify-between gap-3 sticky top-0 z-50">
        <Link href="/" className="flex items-center gap-2 shrink-0">
          <Image
            src="/clawbox-icon.png"
            alt="ClawBox"
            width={36}
            height={36}
            className="w-9 h-9 object-contain"
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
        {currentStep < 2 && <ProgressBar currentStep={currentStep} />}
      </header>

      <main
        className="flex-1 flex flex-col items-center justify-start sm:justify-center px-4 pt-2 pb-4 sm:p-6"
      >
        {currentStep === 1 && (
          <WifiStep onNext={() => setCurrentStep(2)} />
        )}
        {currentStep === 2 && <DoneStep setupComplete={setupComplete} />}
      </main>

      <footer className="px-4 py-3 flex items-center justify-center gap-3">
        <a
          href="https://openclawhardware.dev/"
          target="_blank"
          rel="noopener noreferrer"
          aria-label="ClawBox website"
          className="flex items-center justify-center w-9 h-9 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] transition transform hover:scale-105"
        >
          <Image src="/clawbox-logo.png" alt="ClawBox" width={28} height={28} className="w-7 h-7 object-contain" />
        </a>
      </footer>
    </>
  );
}
