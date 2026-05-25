"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { QRCodeSVG } from "qrcode.react";
import type { StepStatus, UpdateState } from "@/lib/updater";
import StatusMessage from "./StatusMessage";

import { parseAuthInput, tryCloseOAuthWindow } from "@/lib/oauth-utils";

/* ── Types ── */

interface SystemInfo {
  hostname: string;
  cpus: number;
  memoryTotal: string;
  memoryFree: string;
  memoryUsedPercent: number;
  cpuLoadPercent: number;
  temperature: string;
  temperatureValue: number | null;
  uptime: string;
  diskUsed: string;
  diskFree: string;
  diskTotal: string;
  diskUsedPercent: number;
  gpuLoadPercent: number;
  networkIp: string;
  networkInterface: string;
  networkRxBytes: number;
  networkTxBytes: number;
  mdnsHost: string;
  accessUrl: string;
  localDnsAlias: string | null;
  mdnsReady: boolean;
}

interface SetupStatusResponse {
  setup_complete: boolean;
  password_configured: boolean;
  wifi_configured: boolean;
  ai_model_configured: boolean;
  ai_model_provider?: string;
  wifi_connecting?: boolean;
  wifi_target_ssid?: string | null;
  wifi_last_error?: string | null;
  ai_model_last_error?: string | null;
}

interface StatsSnapshot {
  cpu: number;
  gpu: number;
  memory: number;
  temp: number | null;
  rxBytes: number;
  txBytes: number;
  time: number;
}


interface DoneStepProps {
  setupComplete?: boolean;
}

interface SectionStatusMessage {
  type: "success" | "error";
  message: string;
}

/* ── Constants ── */

const MAX_HISTORY = 30;

const RESET_STEPS = [
  "Clearing configuration...",
  "Removing credentials...",
  "Finalizing...",
  "Restarting device...",
];

const INPUT_CLASS =
  "w-full px-3.5 py-2.5 bg-[var(--bg-deep)] border border-gray-600 rounded-lg text-sm text-gray-200 outline-none focus:border-[var(--coral-bright)] transition-colors placeholder-gray-500";

const INPUT_WITH_TOGGLE_CLASS = `${INPUT_CLASS} pr-10`;

const SAVE_BUTTON_CLASS =
  "px-6 py-2.5 btn-gradient text-white rounded-lg text-sm font-semibold cursor-pointer disabled:opacity-50";

const TOGGLE_BUTTON_CLASS =
  "absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)] hover:text-[var(--text-primary)] bg-transparent border-none cursor-pointer p-0.5";

const SECTION_HEADER_CLASS =
  "flex items-center gap-2.5 w-full py-3.5 px-5 text-sm font-medium text-[var(--text-primary)] hover:text-gray-100 hover:bg-[var(--bg-surface)]/30 bg-transparent border-none cursor-pointer text-left transition-colors";

const SECTION_BODY_CLASS =
  "px-5 pb-5 border-t border-[var(--border-subtle)]/30 pt-4 space-y-4";

const LABEL_CLASS =
  "block text-xs font-semibold text-[var(--text-secondary)] mb-1.5";

const WIDGET_LABEL_CLASS =
  "text-[10px] font-semibold text-[var(--text-muted)] uppercase tracking-wider";

const AI_PROVIDERS = [
  { id: "anthropic", name: "Anthropic Claude", hasSubscription: true, placeholder: "sk-ant-api03-...", hint: "Get your API key from console.anthropic.com", tokenUrl: "https://console.anthropic.com/settings/keys" },
  { id: "openai", name: "OpenAI GPT", hasSubscription: true, placeholder: "sk-...", hint: "Get your API key from platform.openai.com", tokenUrl: "https://platform.openai.com/api-keys" },
  { id: "google", name: "Google Gemini", hasSubscription: true, placeholder: "AIza...", hint: "Get your API key from Google AI Studio.", tokenUrl: "https://aistudio.google.com/apikey" },
  { id: "openrouter", name: "OpenRouter", hasSubscription: false, placeholder: "sk-or-v1-...", hint: "Get your API key from OpenRouter.", tokenUrl: "https://openrouter.ai/keys" },
] as const;

/* ── Helper functions ── */

function thresholdColor(value: number, low: number, high: number): string {
  if (value > high) return "#ef4444";
  if (value > low) return "#f59e0b";
  return "#00e5cc";
}

/* ── Shared SVG icons ── */

const EyeOpen = (
  <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
);
const EyeClosed = (
  <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
);

const ButtonSpinner = (
  <span className="inline-block w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
);

/* ── Reusable components ── */

function UsageBar({ percent, color = "var(--coral-bright)" }: { percent: number; color?: string }) {
  return (
    <div className="w-full h-1.5 rounded-full bg-[var(--bg-deep)] mt-2 overflow-hidden">
      <div
        className="h-full rounded-full transition-all duration-700 ease-out"
        style={{ width: `${Math.min(100, Math.max(0, percent))}%`, backgroundColor: color }}
      />
    </div>
  );
}

function Sparkline({ data, color = "var(--coral-bright)", height = 32 }: { data: number[]; color?: string; height?: number }) {
  if (data.length < 2) return null;
  const max = Math.max(...data, 1);
  const w = 120;
  const h = height;
  const step = w / (data.length - 1);
  const points = data.map((v, i) => `${i * step},${h - (v / max) * (h - 4) - 2}`).join(" ");
  const fillPoints = `0,${h} ${points} ${(data.length - 1) * step},${h}`;
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="w-full" preserveAspectRatio="none">
      <polygon points={fillPoints} fill={color} opacity="0.1" />
      <polyline points={points} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      aria-hidden="true"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`transition-transform ${open ? "rotate-90" : ""}`}
    >
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );
}

function SectionBadge({ done }: { done: boolean }) {
  if (done) {
    return (
      <span className="ml-auto flex items-center gap-1.5 text-[10px] font-semibold text-[#00e5cc] uppercase tracking-wide">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5"/></svg>
        Done
      </span>
    );
  }
  return (
    <span className="ml-auto flex items-center gap-1.5 text-[10px] font-semibold text-amber-400 uppercase tracking-wide">
      <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
      Pending
    </span>
  );
}

function PasswordInput({
  id,
  value,
  onChange,
  visible,
  onToggle,
  placeholder,
  autoComplete,
  disabled = false,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  visible: boolean;
  onToggle: () => void;
  placeholder?: string;
  autoComplete?: string;
  disabled?: boolean;
}) {
  return (
    <div className="relative">
      <input
        id={id}
        type={visible ? "text" : "password"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete={autoComplete}
        spellCheck={false}
        disabled={disabled}
        className={`${INPUT_WITH_TOGGLE_CLASS} ${disabled ? "opacity-60 cursor-not-allowed" : ""}`}
      />
      <button
        type="button"
        onClick={onToggle}
        aria-label={visible ? "Hide" : "Show"}
        disabled={disabled}
        className={`${TOGGLE_BUTTON_CLASS} ${disabled ? "opacity-60 cursor-not-allowed" : ""}`}
      >
        {visible ? EyeClosed : EyeOpen}
      </button>
    </div>
  );
}

function CollapsibleSection({
  id,
  title,
  done,
  open,
  onToggle,
  children,
}: {
  id: string;
  title: string;
  done: boolean;
  open: boolean;
  onToggle: (id: string) => void;
  children: React.ReactNode;
}) {
  return (
    <div className="card-surface rounded-xl overflow-hidden">
      <button type="button" onClick={() => onToggle(id)} className={SECTION_HEADER_CLASS}>
        <Chevron open={open} />
        {title}
        <SectionBadge done={done} />
      </button>
      {open && <div className={SECTION_BODY_CLASS}>{children}</div>}
    </div>
  );
}

function SystemInfoWidget({
  label,
  detail,
  value,
  unit,
  bar,
  className,
}: {
  label: string;
  detail?: string;
  value: string;
  unit?: string;
  bar?: { percent: number; color: string };
  className?: string;
}) {
  return (
    <div className={`card-surface rounded-xl p-3.5 ${className ?? ""}`}>
      <div className="flex items-center justify-between mb-1">
        <p className={WIDGET_LABEL_CLASS}>{label}</p>
        {detail && <p className="text-[10px] font-semibold text-[var(--text-muted)]">{detail}</p>}
      </div>
      <p className="text-lg font-bold text-gray-100">
        {value}
        {unit && <span className="text-xs font-normal text-[var(--text-muted)]">{unit}</span>}
      </p>
      {bar && <UsageBar percent={bar.percent} color={bar.color} />}
    </div>
  );
}

function SparklineWidget({
  label,
  currentValue,
  data,
  color,
}: {
  label: string;
  currentValue: string;
  data: number[];
  color: string;
}) {
  return (
    <div className="card-surface rounded-xl p-3.5">
      <div className="flex items-center justify-between mb-2">
        <p className={WIDGET_LABEL_CLASS}>{label}</p>
        <p className="text-[10px] font-bold text-gray-300">{currentValue}</p>
      </div>
      <Sparkline data={data} color={color} height={36} />
    </div>
  );
}

/* ── Update step helpers ── */

function updateStepTextClass(status: StepStatus): string {
  switch (status) {
    case "running": return "text-[var(--coral-bright)] font-medium";
    case "completed": return "text-[var(--text-secondary)]";
    case "failed": return "text-red-400";
    default: return "text-[var(--text-muted)]";
  }
}

function UpdateStepIcon({ status }: { status: StepStatus }) {
  if (status === "running") {
    return <div className="spinner !w-4 !h-4 !border-2" />;
  }
  if (status === "completed") {
    return (
      <div className="w-4 h-4 rounded-full bg-[#00e5cc] flex items-center justify-center text-white text-[10px] font-bold">
        &#10003;
      </div>
    );
  }
  if (status === "failed") {
    return (
      <div className="w-4 h-4 rounded-full bg-red-500 flex items-center justify-center text-white text-[10px] font-bold">
        &#10005;
      </div>
    );
  }
  return <div className="w-4 h-4 rounded-full bg-gray-600" />;
}

function UpdateProgressHeading({ phase }: { phase: UpdateState["phase"] | undefined }) {
  if (phase === "completed") return <span className="text-[#00e5cc]">Update Complete</span>;
  if (phase === "failed") return <span className="text-red-400">Update Failed</span>;
  return <>System Update</>;
}

/* ── Main component ── */

export default function DoneStep({ setupComplete = false }: DoneStepProps) {
  /* ── System info ── */
  const [info, setInfo] = useState<SystemInfo | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [statsHistory, setStatsHistory] = useState<StatsSnapshot[]>([]);
  const statsPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  /* ── Finish ── */
  const [finishing, setFinishing] = useState(false);
  const [completeError, setCompleteError] = useState<string | null>(null);

  /* ── System update ── */
  const [updateState, setUpdateState] = useState<UpdateState | null>(null);
  const [updateStarted, setUpdateStarted] = useState(false);
  const [updateError, setUpdateError] = useState<string | null>(null);
  const updatePollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const updatePollControllerRef = useRef<AbortController | null>(null);
  const oauthWindowRef = useRef<Window | null>(null);
  const aiSaveControllerRef = useRef<AbortController | null>(null);
  const aiExchangeControllerRef = useRef<AbortController | null>(null);
  const aiOauthStartControllerRef = useRef<AbortController | null>(null);
  const aiPollControllerRef = useRef<AbortController | null>(null);

  /* ── Collapsible sections ── */
  const [openSection, setOpenSection] = useState<string | null>("ai");
  const toggle = (id: string) => setOpenSection((prev) => (prev === id ? null : id));

  /* ── AI Provider ── */
  const [aiProvider, setAiProvider] = useState<string>("anthropic");
  const [aiAuthMode, setAiAuthMode] = useState<"token" | "subscription">("token");
  const [aiApiKey, setAiApiKey] = useState("");
  const [showAiKey, setShowAiKey] = useState(false);
  const [aiSaving, setAiSaving] = useState(false);
  const [aiStatus, setAiStatus] = useState<SectionStatusMessage | null>(null);
  const [aiOauthStarted, setAiOauthStarted] = useState(false);
  const [aiAuthCode, setAiAuthCode] = useState("");
  const [aiExchanging, setAiExchanging] = useState(false);
  const [providerDone, setProviderDone] = useState(false);
  const [providerName, setProviderName] = useState<string | null>(null);
  const [deviceCode, setDeviceCode] = useState<string | null>(null);
  const [deviceUrl, setDeviceUrl] = useState<string | null>(null);
  const [devicePolling, setDevicePolling] = useState(false);
  const [deviceSaving, setDeviceSaving] = useState(false);
  const devicePollRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /* ── Security (system password + hotspot) ── */
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [hotspotName, setHotspotName] = useState("ClawBox-Setup");
  const [hotspotPassword, setHotspotPassword] = useState("");
  const [showHotspotPassword, setShowHotspotPassword] = useState(false);
  const [hotspotEnabled, setHotspotEnabled] = useState(true);
  const [secSaving, setSecSaving] = useState(false);
  const [secStatus, setSecStatus] = useState<SectionStatusMessage | null>(null);

  /* ── Confirmations ── */
  const [updateConfirm, setUpdateConfirm] = useState(false);
  const [versionInfo, setVersionInfo] = useState<{ clawbox: { current: string; target: string | null }; openclaw: { current: string | null; target: string | null } } | null>(null);
  const [versionLoading, setVersionLoading] = useState(false);
  const [updateBranch, setUpdateBranch] = useState<string | null>(null);
  const [branchInput, setBranchInput] = useState("");
  const [branchSaving, setBranchSaving] = useState(false);
  const [branchError, setBranchError] = useState<string | null>(null);
  const [betaConfirm, setBetaConfirm] = useState(false);
  const [resetConfirm, setResetConfirm] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [resetStep, setResetStep] = useState(0);
  const [resetProgress, setResetProgress] = useState(0);

  /* ── WeChat Bot ── */
  const [wechatToken, setWechatToken] = useState("");
  const [showWechatToken, setShowWechatToken] = useState(false);
  const [wechatEnabled, setWechatEnabled] = useState(false);
  const [wechatSaving, setWechatSaving] = useState(false);
  const [wechatQrLoading, setWechatQrLoading] = useState(false);
  const [wechatQrUrl, setWechatQrUrl] = useState<string | null>(null);
  const [wechatStatus, setWechatStatus] = useState<SectionStatusMessage | null>(null);
  const [wechatDone, setWechatDone] = useState(false);

  /* ── WiFi ── */
  const [wifiDone, setWifiDone] = useState(false);
  const [wifiConnectedSSID, setWifiConnectedSSID] = useState<string | null>(null);
  const [wifiSSID, setWifiSSID] = useState("");
  const [wifiPassword, setWifiPassword] = useState("");
  const [showWifiPassword, setShowWifiPassword] = useState(false);
  const [wifiConnecting, setWifiConnecting] = useState(false);
  const [wifiStatus, setWifiStatus] = useState<SectionStatusMessage | null>(null);
  const [wifiTargetSSID, setWifiTargetSSID] = useState<string | null>(null);
  const [wifiNetworks, setWifiNetworks] = useState<
    { ssid: string; signal: number; security: string; freq: string }[]
  >([]);
  const [wifiScanning, setWifiScanning] = useState(false);
  const wifiControllerRef = useRef<AbortController | null>(null);

  /* ── Section completion status ── */
  const [securityDone, setSecurityDone] = useState(false);

  const selectedAiProvider = AI_PROVIDERS.find((p) => p.id === aiProvider);
  const isAiSubscription = aiAuthMode === "subscription" && (selectedAiProvider?.hasSubscription ?? false);
  const useDeviceAuth = isAiSubscription && aiProvider === "openai";
  const canConfigureWechat = providerDone;
  const canFinishSetup = wifiDone && providerDone;
  const finishButtonDisabled = finishing || (!setupComplete && !canFinishSetup);

  const aiOauthLabels: Record<string, { button: string; description: string; success: string; steps: string[]; inputLabel: string; inputPlaceholder: string }> = {
    anthropic: {
      button: "Connect with Claude",
      description: "Connect your Claude Pro or Max subscription via OAuth.",
      success: "Claude subscription connected!",
      steps: ["Authorize in the browser tab.", "Copy the authorization code.", "Paste it below."],
      inputLabel: "Authorization Code",
      inputPlaceholder: "Paste code here...",
    },
    openai: {
      button: "Connect to GPT",
      description: "Connect your ChatGPT Plus or Pro subscription via OAuth.",
      success: "GPT subscription connected!",
      steps: [
        "Sign in and authorize in the browser tab.",
        "After approval, the page will redirect to a URL that won\u2019t load \u2014 this is expected.",
        "Copy the full URL from the address bar and paste it below.",
      ],
      inputLabel: "Callback URL",
      inputPlaceholder: "Paste the full URL here...",
    },
    google: {
      button: "Connect to Gemini",
      description: "Connect your Google Gemini subscription via OAuth.",
      success: "Gemini subscription connected!",
      steps: ["Sign in with your Google account in the browser tab.", "Copy the authorization code shown after approval.", "Paste it below."],
      inputLabel: "Authorization Code",
      inputPlaceholder: "Paste code here...",
    },
  };
  const currentAiOAuth = aiOauthLabels[aiProvider] ?? aiOauthLabels.anthropic;
  const isUpdateRunning = updateStarted && updateState?.phase === "running";

  /* ── Fetch section status on mount ── */
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | null = null;

    const poll = async () => {
      try {
        const response = await fetch("/setup-api/setup/status", {
          signal: controller.signal,
          cache: "no-store",
        });
        const data = response.ok
          ? ((await response.json()) as SetupStatusResponse)
          : null;
        if (!active || !data) {
          return;
        }

        setSecurityDone(!!data.password_configured);
        setProviderDone(!!data.ai_model_configured);
        setWifiDone(!!data.wifi_configured);
        setWifiConnecting(!!data.wifi_connecting);
        setWifiTargetSSID(data.wifi_target_ssid ?? null);

        if (data.wifi_target_ssid) {
          setWifiConnectedSSID(data.wifi_target_ssid);
        }

        if (data.wifi_last_error) {
          setWifiStatus({
            type: "error",
            message: data.wifi_last_error,
          });
        } else if (data.wifi_connecting) {
          setWifiStatus({
            type: "success",
            message: `Connecting to ${data.wifi_target_ssid ?? "the selected WiFi"} and waiting for a DHCP address. Reopen the device in a system browser after your phone rejoins the same network.`,
          });
        } else if (data.wifi_configured) {
          setWifiStatus((prev) =>
            prev?.type === "error"
              ? null
              : {
                  type: "success",
                  message:
                    "WiFi is connected. Open the device?s .local address in a system browser, or use the IP shown on the device screen if this client does not resolve .local.",
                },
          );
        }

        if (data.ai_model_provider) {
          setProviderName(data.ai_model_provider);
          setAiProvider(data.ai_model_provider);
        }

        if (data.ai_model_last_error) {
          setAiStatus({
            type: "error",
            message: data.ai_model_last_error,
          });
        }

        if (data.wifi_connecting) {
          timer = setTimeout(poll, 2000);
        }
      } catch {
        // best-effort polling
      }
    };

    void poll();
    return () => {
      active = false;
      controller.abort();
      if (timer) {
        clearTimeout(timer);
      }
    };
  }, []);

  /* ── Fetch WeChat config on mount ── */
  useEffect(() => {
    const controller = new AbortController();
    fetch("/setup-api/wechat/configure", { signal: controller.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data && !controller.signal.aborted) {
          if (data.botToken) setWechatToken(data.botToken);
          if (typeof data.enabled === "boolean") setWechatEnabled(data.enabled);
          setWechatDone(data.enabled === true);
        }
      })
      .catch(() => {});
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (providerDone && !wechatDone) {
      setOpenSection((prev) => (prev === "ai" || prev === null ? "wechat" : prev));
    }
  }, [providerDone, wechatDone]);

  /* ── Fetch system info on mount + poll every 5s ── */
  useEffect(() => {
    let alive = true;
    const fetchInfo = async () => {
      try {
        const r = await fetch("/setup-api/system/info");
        if (!r.ok) throw new Error("Failed to load");
        const data: SystemInfo = await r.json();
        if (!alive) return;
        setInfo(data);
        setStatsHistory((prev) => {
          const next = [...prev, { cpu: data.cpuLoadPercent, gpu: data.gpuLoadPercent, memory: data.memoryUsedPercent, temp: data.temperatureValue, rxBytes: data.networkRxBytes, txBytes: data.networkTxBytes, time: Date.now() }];
          return next.length > MAX_HISTORY ? next.slice(-MAX_HISTORY) : next;
        });
      } catch {
        if (!alive) return;
        setLoadError(true);
      }
    };
    fetchInfo();
    statsPollRef.current = setInterval(fetchInfo, 5000);
    return () => {
      alive = false;
      if (statsPollRef.current) clearInterval(statsPollRef.current);
    };
  }, []);

  /* ── Fetch hotspot defaults on mount ── */
  useEffect(() => {
    const controller = new AbortController();
    fetch("/setup-api/system/hotspot", { signal: controller.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data && !controller.signal.aborted) {
          if (data.ssid) setHotspotName(data.ssid);
          if (typeof data.enabled === "boolean") setHotspotEnabled(data.enabled);
        }
      })
      .catch(() => {});
    return () => controller.abort();
  }, []);

  /* ── Fetch current WiFi connection on mount ── */
  useEffect(() => {
    const controller = new AbortController();
    fetch("/setup-api/wifi/status", { signal: controller.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (
          data &&
          !controller.signal.aborted &&
          typeof data.ssid === "string" &&
          data.ssid.trim()
        ) {
          setWifiConnectedSSID(data.ssid);
        }
      })
      .catch(() => {});
    return () => controller.abort();
  }, []);

  /* ── Update polling ── */
  const stopUpdatePolling = useCallback(() => {
    if (updatePollRef.current) {
      clearInterval(updatePollRef.current);
      updatePollRef.current = null;
    }
    updatePollControllerRef.current?.abort();
    updatePollControllerRef.current = null;
  }, []);

  const startUpdatePolling = useCallback(() => {
    if (updatePollRef.current) return;
    const controller = new AbortController();
    updatePollControllerRef.current = controller;
    let failureCount = 0;
    let serverWentDown = false;
    updatePollRef.current = setInterval(async () => {
      try {
        const res = await fetch("/setup-api/update/status", {
          signal: controller.signal,
        });
        if (controller.signal.aborted) return;
        if (!res.ok) {
          failureCount++;
          if (failureCount >= 3) serverWentDown = true;
          return;
        }
        if (serverWentDown) {
          window.location.reload();
          return;
        }
        failureCount = 0;
        const data: UpdateState = await res.json();
        if (controller.signal.aborted) return;
        setUpdateState(data);
        if (data.phase !== "running") stopUpdatePolling();
      } catch {
        if (controller.signal.aborted) return;
        failureCount++;
        if (failureCount >= 3) serverWentDown = true;
      }
    }, 2000);
  }, [stopUpdatePolling]);

  useEffect(() => () => stopUpdatePolling(), [stopUpdatePolling]);

  /* ── Actions ── */

  const openUpdateConfirm = async () => {
    setVersionLoading(true);
    setUpdateConfirm(true);
    try {
      const [statusRes, branchRes] = await Promise.all([
        fetch("/setup-api/update/status"),
        fetch("/setup-api/system/update-branch"),
      ]);
      if (statusRes.ok) {
        const data = await statusRes.json();
        if (data.versions) setVersionInfo(data.versions);
      }
      if (branchRes.ok) {
        const data = await branchRes.json();
        setUpdateBranch(data.branch ?? null);
        setBranchInput(data.branch ?? "");
      }
    } catch {
      // versions are nice-to-have, dialog still works without them
    } finally {
      setVersionLoading(false);
    }
  };

  const saveUpdateBranch = async (branch: string) => {
    setBranchSaving(true);
    setBranchError(null);
    try {
      const res = await fetch("/setup-api/system/update-branch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ branch: branch || null }),
      });
      const data = await res.json();
      if (res.ok) {
        setUpdateBranch(data.branch ?? null);
      } else {
        setBranchError(data.error || "Failed to set branch");
      }
    } catch (err) {
      setBranchError(err instanceof Error ? err.message : "Failed to set branch");
    } finally {
      setBranchSaving(false);
    }
  };

  const triggerUpdate = async (branch?: string) => {
    setUpdateStarted(true);
    setUpdateError(null);
    setUpdateState(null);
    try {
      if (branch) {
        const branchRes = await fetch("/setup-api/system/update-branch", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ branch }),
        });
        if (!branchRes.ok) {
          setUpdateError("Failed to set update branch");
          return;
        }
      }
      const res = await fetch("/setup-api/update/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ force: true }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setUpdateError(typeof data.error === "string" ? data.error : "Failed to start update");
        return;
      }
      startUpdatePolling();
    } catch (err) {
      setUpdateError(err instanceof Error ? err.message : "Failed to start update");
    }
  };

  const completeSetup = async () => {
    if (!canFinishSetup) {
      setCompleteError("Finish setup is available after WiFi and AI are configured.");
      return;
    }

    setFinishing(true);
    setCompleteError(null);
    try {
      const res = await fetch("/setup-api/setup/complete", { method: "POST" });
      if (res.ok) {
        window.location.href = "/";
        return;
      }
      const data = await res.json().catch(() => ({}));
      setCompleteError(data.error || "Failed to complete setup");
    } catch (err) {
      setCompleteError(err instanceof Error ? err.message : "Failed to complete setup");
    } finally {
      setFinishing(false);
    }
  };

  const saveSecurity = async () => {
    if (password || confirmPassword) {
      if (password.length < 8) {
        setSecStatus({ type: "error", message: "Password must be at least 8 characters" });
        return;
      }
      if (password !== confirmPassword) {
        setSecStatus({ type: "error", message: "Passwords do not match" });
        return;
      }
    }
    if (hotspotEnabled && !hotspotName.trim()) {
      setSecStatus({ type: "error", message: "Hotspot name is required" });
      return;
    }
    if (hotspotPassword && hotspotPassword.length < 8) {
      setSecStatus({ type: "error", message: "Hotspot password must be at least 8 characters" });
      return;
    }

    setSecSaving(true);
    setSecStatus(null);
    try {
      if (password) {
        const res = await fetch("/setup-api/system/credentials", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ password }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          setSecStatus({ type: "error", message: data.error || "Failed to set password" });
          return;
        }
      }
      const hotspotRes = await fetch("/setup-api/system/hotspot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ssid: hotspotName.trim(),
          password: hotspotPassword || undefined,
          enabled: hotspotEnabled,
        }),
      });
      if (!hotspotRes.ok) {
        const data = await hotspotRes.json().catch(() => ({}));
        setSecStatus({ type: "error", message: data.error || "Failed to save hotspot settings" });
        return;
      }
      setSecStatus({ type: "success", message: "Settings saved!" });
      if (password) setSecurityDone(true);
      setPassword("");
      setConfirmPassword("");
    } catch (err) {
      setSecStatus({
        type: "error",
        message: `Failed: ${err instanceof Error ? err.message : err}`,
      });
    } finally {
      setSecSaving(false);
    }
  };

  const saveWechat = async () => {
    if (!canConfigureWechat) {
      setWechatStatus({
        type: "error",
        message: "Configure your AI provider before setting up WeChat.",
      });
      return;
    }

    setWechatSaving(true);
    setWechatStatus(null);
    try {
      const res = await fetch("/setup-api/wechat/configure", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ botToken: wechatToken.trim() || undefined, enabled: wechatEnabled }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setWechatStatus({ type: "error", message: data.error || "Failed to save" });
        return;
      }
      setWechatStatus({ type: "success", message: "WeChat bot settings saved!" });
      setWechatDone(wechatEnabled);
    } catch (err) {
      setWechatStatus({
        type: "error",
        message: `Failed: ${err instanceof Error ? err.message : err}`,
      });
    } finally {
      setWechatSaving(false);
    }
  };

  const requestWechatQrCode = async () => {
    if (!canConfigureWechat) {
      setWechatStatus({
        type: "error",
        message: "Configure your AI provider before setting up WeChat.",
      });
      return;
    }

    setWechatQrLoading(true);
    setWechatStatus(null);
    try {
      const res = await fetch("/setup-api/wechat/qrcode", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.qrUrl) {
        setWechatStatus({ type: "error", message: data.error || "Failed to refresh QR code" });
        return;
      }
      setWechatQrUrl(data.qrUrl);
      setWechatStatus({
        type: "success",
        message: "QR code refreshed. Please scan soon; if it expires, click refresh again.",
      });
    } catch (err) {
      setWechatStatus({
        type: "error",
        message: `Failed: ${err instanceof Error ? err.message : err}`,
      });
    } finally {
      setWechatQrLoading(false);
    }
  };

  const stopDevicePolling = useCallback(() => {
    setDevicePolling(false);
    if (devicePollRef.current) {
      clearTimeout(devicePollRef.current);
      devicePollRef.current = null;
    }
    aiPollControllerRef.current?.abort();
  }, []);
  useEffect(() => {
    return () => {
      stopDevicePolling();
      aiSaveControllerRef.current?.abort();
      aiExchangeControllerRef.current?.abort();
      aiOauthStartControllerRef.current?.abort();
      wifiControllerRef.current?.abort();
    };
  }, [stopDevicePolling]);

  const resetAiFields = () => {
    stopDevicePolling();
    setAiApiKey("");
    setShowAiKey(false);
    setAiStatus(null);
    setAiOauthStarted(false);
    setAiAuthCode("");
    setDeviceCode(null);
    setDeviceUrl(null);
    setDeviceSaving(false);
  };

  const saveDeviceToken = async (tokenData: { access_token: string; refresh_token?: string; expires_in?: number }) => {
    aiSaveControllerRef.current?.abort();
    const controller = new AbortController();
    aiSaveControllerRef.current = controller;

    setDeviceSaving(true);
    try {
      const saveRes = await fetch("/setup-api/ai-models/configure", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: aiProvider, apiKey: tokenData.access_token, authMode: "subscription", refreshToken: tokenData.refresh_token, expiresIn: tokenData.expires_in }),
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      if (!saveRes.ok) {
        const data = await saveRes.json().catch(() => ({}));
        setAiStatus({ type: "error", message: data.error || "Failed to save token" });
        return;
      }
      const saveData = await saveRes.json();
      if (controller.signal.aborted) return;
      if (saveData.success) {
        const { closeHint } = tryCloseOAuthWindow(oauthWindowRef);
        setAiStatus({ type: "success", message: "GPT subscription connected!" + closeHint });
        setProviderDone(true);
        setProviderName(aiProvider);
        setDeviceCode(null);
        setDeviceUrl(null);
        setTimeout(() => { setAiStatus(null); }, 1500);
      } else {
        setAiStatus({ type: "error", message: saveData.error || "Failed to save token" });
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      setAiStatus({ type: "error", message: `Failed: ${err instanceof Error ? err.message : err}` });
    } finally {
      if (!controller.signal.aborted) setDeviceSaving(false);
    }
  };

  const pollDeviceAuth = useCallback(async (interval: number) => {
    aiPollControllerRef.current?.abort();
    const controller = new AbortController();
    aiPollControllerRef.current = controller;

    try {
      const res = await fetch("/setup-api/ai-models/oauth/device-poll", {
        method: "POST",
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        stopDevicePolling();
        setAiStatus({ type: "error", message: data.error || "Polling failed" });
        return;
      }
      const data = await res.json();
      if (controller.signal.aborted) return;
      if (data.status === "complete" && data.access_token) {
        stopDevicePolling();
        await saveDeviceToken(data);
        return;
      }
      if (data.status === "pending") {
        devicePollRef.current = setTimeout(() => pollDeviceAuth(interval), interval * 1000);
        return;
      }
      if (data.error) {
        stopDevicePolling();
        setAiStatus({ type: "error", message: data.error });
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      // Network error — retry
      devicePollRef.current = setTimeout(() => pollDeviceAuth(interval), interval * 1000);
    }
  }, [stopDevicePolling, aiProvider]); // eslint-disable-line react-hooks/exhaustive-deps

  const startDeviceAuth = async () => {
    stopDevicePolling();
    aiOauthStartControllerRef.current?.abort();
    const controller = new AbortController();
    aiOauthStartControllerRef.current = controller;

    setAiStatus(null);
    setDeviceCode(null);
    setDeviceUrl(null);
    try {
      const res = await fetch("/setup-api/ai-models/oauth/device-start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: aiProvider }),
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setAiStatus({ type: "error", message: data.error || "Failed to start device auth" });
        return;
      }
      const data = await res.json();
      if (controller.signal.aborted) return;
      if (data.user_code && data.verification_url) {
        setDeviceCode(data.user_code);
        setDeviceUrl(data.verification_url);
        setDevicePolling(true);
        const interval = data.interval || 5;
        devicePollRef.current = setTimeout(() => pollDeviceAuth(interval), interval * 1000);
      } else {
        setAiStatus({ type: "error", message: "Unexpected response from device auth" });
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      setAiStatus({ type: "error", message: `Failed: ${err instanceof Error ? err.message : err}` });
    }
  };

  const saveAiProvider = async () => {
    if (!aiApiKey.trim()) {
      setAiStatus({ type: "error", message: "Please enter your API key" });
      return;
    }

    aiSaveControllerRef.current?.abort();
    const controller = new AbortController();
    aiSaveControllerRef.current = controller;

    setAiSaving(true);
    setAiStatus(null);
    try {
      const res = await fetch("/setup-api/ai-models/configure", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: aiProvider, apiKey: aiApiKey.trim(), authMode: aiAuthMode }),
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setAiStatus({ type: "error", message: data.error || "Failed to configure" });
        return;
      }
      const data = await res.json();
      if (controller.signal.aborted) return;
      if (data.success) {
        setAiStatus({ type: "success", message: "AI provider configured!" });
        setProviderDone(true);
        setProviderName(aiProvider);
        setAiApiKey("");
        setTimeout(() => { setAiStatus(null); }, 1500);
      } else {
        setAiStatus({ type: "error", message: data.error || "Failed to configure" });
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      setAiStatus({ type: "error", message: `Failed: ${err instanceof Error ? err.message : err}` });
    } finally {
      if (!controller.signal.aborted) setAiSaving(false);
    }
  };

  const startAiOAuth = async () => {
    aiOauthStartControllerRef.current?.abort();
    const controller = new AbortController();
    aiOauthStartControllerRef.current = controller;

    setAiStatus(null);
    setAiOauthStarted(false);
    setAiAuthCode("");
    try {
      const res = await fetch("/setup-api/ai-models/oauth/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: aiProvider }),
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setAiStatus({ type: "error", message: data.error || "Failed to start OAuth" });
        return;
      }
      const data = await res.json();
      if (controller.signal.aborted) return;
      if (data.url) {
        oauthWindowRef.current = window.open(data.url, "_blank");
        setAiOauthStarted(true);
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      setAiStatus({ type: "error", message: `Failed: ${err instanceof Error ? err.message : err}` });
    }
  };

  const exchangeAiCode = async () => {
    if (!aiAuthCode.trim()) {
      setAiStatus({ type: "error", message: `Please paste the ${currentAiOAuth.inputLabel.toLowerCase()}` });
      return;
    }
    const parsedCode = parseAuthInput(aiAuthCode);
    if (!parsedCode) {
      setAiStatus({ type: "error", message: "Could not extract authorization code from input" });
      return;
    }

    aiExchangeControllerRef.current?.abort();
    const controller = new AbortController();
    aiExchangeControllerRef.current = controller;

    setAiExchanging(true);
    setAiStatus(null);
    try {
      const exchangeRes = await fetch("/setup-api/ai-models/oauth/exchange", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: parsedCode }),
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      if (!exchangeRes.ok) {
        const data = await exchangeRes.json().catch(() => ({}));
        setAiStatus({ type: "error", message: data.error || "Token exchange failed" });
        return;
      }
      const tokenData = await exchangeRes.json();
      if (controller.signal.aborted) return;
      if (!tokenData.access_token) {
        setAiStatus({ type: "error", message: "No access token received" });
        return;
      }
      const saveRes = await fetch("/setup-api/ai-models/configure", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: aiProvider, apiKey: tokenData.access_token, authMode: "subscription", refreshToken: tokenData.refresh_token, expiresIn: tokenData.expires_in, ...(tokenData.projectId ? { projectId: tokenData.projectId } : {}) }),
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      if (!saveRes.ok) {
        const data = await saveRes.json().catch(() => ({}));
        setAiStatus({ type: "error", message: data.error || "Failed to save token" });
        return;
      }
      const saveData = await saveRes.json();
      if (controller.signal.aborted) return;
      if (saveData.success) {
        const { tabClosed, closeHint } = tryCloseOAuthWindow(oauthWindowRef);
        setAiStatus({ type: "success", message: currentAiOAuth.success + closeHint });
        setProviderDone(true);
        setProviderName(aiProvider);
        setAiOauthStarted(false);
        setAiAuthCode("");
        setTimeout(() => { setAiStatus(null); }, tabClosed ? 1500 : 3000);
      } else {
        setAiStatus({ type: "error", message: saveData.error || "Failed to save token" });
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      setAiStatus({ type: "error", message: `Failed: ${err instanceof Error ? err.message : err}` });
    } finally {
      if (!controller.signal.aborted) setAiExchanging(false);
    }
  };

  const scanWifiNetworks = async () => {
    setWifiScanning(true);
    setWifiStatus(null);
    try {
      const trigger = await fetch("/setup-api/wifi/scan", { method: "POST" });
      if (!trigger.ok) throw new Error(`Scan failed (${trigger.status})`);

      let data: { scanning?: boolean; networks?: typeof wifiNetworks } | null = null;
      for (let attempt = 0; attempt < 20; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, attempt === 0 ? 800 : 1000));
        const poll = await fetch("/setup-api/wifi/scan", { cache: "no-store" });
        if (!poll.ok) throw new Error(`Scan failed (${poll.status})`);
        data = (await poll.json()) as { scanning?: boolean; networks?: typeof wifiNetworks };
        if (!data?.scanning) break;
      }

      if (!data || data.scanning) {
        throw new Error("Scan timed out");
      }

      setWifiNetworks(data.networks || []);
    } catch (err) {
      setWifiStatus({
        type: "error",
        message: `Scan failed: ${err instanceof Error ? err.message : err}`,
      });
    } finally {
      setWifiScanning(false);
    }
  };

  const connectWifi = async () => {
    if (!wifiSSID.trim()) return;

    wifiControllerRef.current?.abort();
    const controller = new AbortController();
    wifiControllerRef.current = controller;

    setWifiConnecting(true);
    setWifiStatus(null);
    try {
      const res = await fetch("/setup-api/wifi/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ssid: wifiSSID.trim(), password: wifiPassword }),
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setWifiStatus({ type: "error", message: data.error || "Connection failed" });
        return;
      }
      const data = await res.json().catch(() => ({}));
      setWifiConnecting(true);
      setWifiTargetSSID(wifiSSID.trim());
      setWifiStatus({
        type: "success",
        message:
          typeof data.message === "string"
            ? data.message
            : "The device is switching WiFi and waiting for a DHCP address. Reconnect to the same network, then open the device?s .local address in a system browser, or use the IP shown on the screen.",
      });
      setWifiConnectedSSID(wifiSSID.trim());
      setWifiSSID("");
      setWifiPassword("");
      setTimeout(() => {
        setOpenSection(null);
      }, 1500);
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      if (err instanceof TypeError && err.message.includes("fetch")) {
        setWifiStatus({
          type: "error",
          message:
            "Lost connection. If WiFi switched successfully, reconnect to the same WiFi and open the device?s .local address in a system browser, or use the IP shown on the screen if this client does not resolve .local.",
        });
        return;
      }
      setWifiStatus({ type: "error", message: `Failed: ${err instanceof Error ? err.message : err}` });
    } finally {
      if (!controller.signal.aborted) setWifiConnecting(false);
    }
  };

  const resetSetup = async () => {
    setResetting(true);
    setResetStep(0);
    setResetProgress(0);

    // Single timer: advance step + derive progress from step index
    const stepDuration = 800;
    let currentStep = 0;
    const stepInterval = setInterval(() => {
      currentStep++;
      if (currentStep < RESET_STEPS.length) {
        setResetStep(currentStep);
        setResetProgress(Math.round((currentStep / RESET_STEPS.length) * 100));
      }
    }, stepDuration);

    try {
      const res = await fetch("/setup-api/setup/reset", { method: "POST" });
      clearInterval(stepInterval);

      if (res.ok) {
        // Show final "Restarting device..." step
        setResetStep(RESET_STEPS.length - 1);
        setResetProgress(100);
        // Device is rebooting — wait then try to reload (page will come back after reboot)
        await new Promise((r) => setTimeout(r, 3000));
        window.location.href = "/setup";
        return;
      }
      setCompleteError("Factory reset failed");
    } catch {
      setCompleteError("Factory reset failed");
    } finally {
      clearInterval(stepInterval);
      setResetting(false);
      setResetConfirm(false);
      setResetStep(0);
      setResetProgress(0);
    }
  };

  /* ── Render ── */

  return (
    <div className="w-full max-w-2xl mx-auto">
      {completeError && (
        <div className="mb-4 p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-xs text-red-400">{completeError}</div>
      )}

      <div className="mb-4 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)]/70 px-4 py-3 text-xs leading-relaxed text-[var(--text-secondary)]">
        Recommended order: connect WiFi, configure your AI provider, then optionally enable the WeChat bot. Finish setup unlocks after WiFi and AI are ready.
      </div>

      {/* Primary actions */}
      <div className="grid grid-cols-2 gap-3 mb-6">
          <button
            type="button"
            onClick={setupComplete ? () => (window.location.href = "/setup") : completeSetup}
            disabled={finishButtonDisabled}
            className="py-3 btn-gradient text-white rounded-xl text-sm font-semibold transition transform cursor-pointer hover:scale-105 shadow-lg shadow-[rgba(249,115,22,0.25)] disabled:opacity-50 disabled:hover:scale-100 flex items-center justify-center gap-2"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10 10-4.5 10-10S17.5 2 12 2"/><path d="M8 12c0-2.2 1.8-4 4-4"/><path d="M16 12c0 2.2-1.8 4-4 4"/><circle cx="12" cy="12" r="1.5"/></svg>
            {finishing ? "Finishing..." : setupComplete ? "Open Dashboard" : "Finish Setup"}
          </button>
          <button
            type="button"
            onClick={isUpdateRunning ? undefined : openUpdateConfirm}
            disabled={isUpdateRunning}
            className="py-3 bg-emerald-600 text-white rounded-xl text-sm font-semibold hover:bg-emerald-500 hover:scale-105 transition-all cursor-pointer disabled:opacity-50 disabled:hover:scale-100 flex items-center justify-center gap-2 shadow-lg shadow-emerald-600/25"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"/><path d="M16 16h5v5"/></svg>
            {isUpdateRunning ? "Updating..." : "System Update"}
          </button>
          <button
            type="button"
            onClick={() => setBetaConfirm(true)}
            disabled={isUpdateRunning}
            className="py-3 bg-purple-600 text-white rounded-xl text-sm font-semibold hover:bg-purple-500 hover:scale-105 transition-all cursor-pointer disabled:opacity-50 disabled:hover:scale-100 flex items-center justify-center gap-2 shadow-lg shadow-purple-600/25"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2v20"/><path d="m17 5-5-3-5 3"/><path d="m17 19-5 3-5-3"/><path d="M2 12h20"/></svg>
            Beta Update
          </button>
          <button
            type="button"
            onClick={() => setResetConfirm(true)}
            className="py-3 bg-red-500/10 text-red-400 rounded-xl text-sm font-semibold hover:bg-red-500/20 hover:scale-105 transition-all cursor-pointer flex items-center justify-center gap-2 border border-red-500/20"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
            Factory Reset
          </button>
      </div>

      {/* Update confirmation popup */}
      {updateConfirm && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm px-4">
          <div className="card-surface rounded-2xl p-6 max-w-sm w-full shadow-2xl">
            <h3 className="text-lg font-bold text-gray-100 mb-2">System Update</h3>
            <p className="text-sm text-[var(--text-secondary)] mb-4 leading-relaxed">
              This will pull the latest updates and restart the device. The process may take a few minutes.
            </p>
            {versionLoading ? (
              <div className="mb-4 text-xs text-[var(--text-muted)]">Checking versions...</div>
            ) : versionInfo && (
              <div className="mb-4 space-y-2 text-xs">
                <div className="flex items-center justify-between bg-[var(--bg-deep)] rounded-lg px-3 py-2">
                  <span className="text-[var(--text-secondary)] font-medium">ClawBox</span>
                  <span className="text-[var(--text-primary)]">
                    {versionInfo.clawbox.current}
                    {versionInfo.clawbox.target && versionInfo.clawbox.target !== versionInfo.clawbox.current && (
                      <span className="text-[var(--text-muted)]">{" → "}<span className="text-emerald-400">{versionInfo.clawbox.target}</span></span>
                    )}
                  </span>
                </div>
                <div className="flex items-center justify-between bg-[var(--bg-deep)] rounded-lg px-3 py-2">
                  <span className="text-[var(--text-secondary)] font-medium">OpenClaw</span>
                  <span className="text-[var(--text-primary)]">
                    {versionInfo.openclaw.current ?? "not installed"}
                    {versionInfo.openclaw.target && versionInfo.openclaw.target !== versionInfo.openclaw.current && (
                      <span className="text-[var(--text-muted)]">{" → "}<span className="text-emerald-400">{versionInfo.openclaw.target}</span></span>
                    )}
                  </span>
                </div>
              </div>
            )}
            {/* Branch selector — only visible in dev (non-tag version) or when a branch is pinned */}
            {!versionLoading && (updateBranch || /^v\d+\.\d+\.\d+-.+/.test(versionInfo?.clawbox.current ?? "")) && (
              <div className="mb-4">
                <label htmlFor="update-branch-input" className="text-xs text-[var(--text-muted)] mb-1 block">Update branch</label>
                <div className="flex gap-2">
                  <input
                    id="update-branch-input"
                    type="text"
                    value={branchInput}
                    onChange={(e) => { setBranchInput(e.target.value); setBranchError(null); }}
                    placeholder="main"
                    className="flex-1 bg-[var(--bg-deep)] border border-gray-600 rounded-lg px-3 py-1.5 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none focus:border-[#00e5cc]"
                  />
                  <button
                    type="button"
                    disabled={branchSaving || branchInput === (updateBranch ?? "")}
                    onClick={() => saveUpdateBranch(branchInput)}
                    className="px-3 py-1.5 text-xs font-semibold text-white btn-gradient rounded-lg cursor-pointer disabled:opacity-40"
                  >
                    {branchSaving ? "..." : "Set"}
                  </button>
                </div>
                {branchError && (
                  <p className="mt-1 text-xs text-red-400">{branchError}</p>
                )}
                {updateBranch && (
                  <div className="mt-1 flex items-center gap-2">
                    <span className="text-xs text-emerald-400">Pinned: {updateBranch}</span>
                    <button
                      type="button"
                      onClick={() => { setBranchInput(""); saveUpdateBranch(""); }}
                      className="text-xs text-red-400 hover:text-red-300 cursor-pointer"
                    >
                      Unpin
                    </button>
                  </div>
                )}
              </div>
            )}
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setUpdateConfirm(false)}
                className="flex-1 py-2.5 text-sm font-semibold text-[var(--text-secondary)] hover:text-gray-100 transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => { triggerUpdate(branchInput || undefined); setUpdateConfirm(false); }}
                disabled={isUpdateRunning}
                className="flex-1 py-2.5 text-sm font-semibold text-white btn-gradient rounded-lg cursor-pointer disabled:opacity-50"
              >
                Update Now
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Beta update confirmation */}
      {betaConfirm && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm px-4">
          <div className="card-surface rounded-2xl p-6 max-w-sm w-full shadow-2xl">
            <h3 className="text-lg font-bold text-gray-100 mb-2">Switch to Beta</h3>
            <p className="text-sm text-[var(--text-secondary)] mb-4 leading-relaxed">
              This will switch to the beta update channel. Beta versions may contain bugs or incomplete features.
            </p>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setBetaConfirm(false)}
                className="flex-1 py-2.5 text-sm font-semibold text-[var(--text-secondary)] hover:text-gray-100 transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => { triggerUpdate("beta"); setBetaConfirm(false); }}
                disabled={isUpdateRunning}
                className="flex-1 py-2.5 text-sm font-semibold text-white bg-purple-600 hover:bg-purple-500 rounded-lg transition-colors cursor-pointer disabled:opacity-50"
              >
                Switch to Beta
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Reset confirmation */}
      {resetConfirm && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm px-4">
          <div className="card-surface rounded-2xl p-6 max-w-sm w-full shadow-2xl">
            <h3 className="text-lg font-bold text-red-400 mb-2">Factory Reset</h3>
            <p className="text-sm text-[var(--text-secondary)] mb-4 leading-relaxed">
              This will erase all configuration, credentials, and AI model data. The device will restart afterward. Are you sure?
            </p>
            {resetting && (
              <div className="mb-4">
                <div className="w-full h-2 rounded-full bg-[var(--bg-deep)] overflow-hidden mb-2">
                  <div className="h-full bg-[var(--coral-bright)] rounded-full transition-all" style={{ width: `${resetProgress}%` }} />
                </div>
                <p className="text-xs text-[var(--text-secondary)]">{RESET_STEPS[resetStep]}</p>
              </div>
            )}
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setResetConfirm(false)}
                disabled={resetting}
                className="flex-1 py-2.5 text-sm font-semibold text-[var(--text-secondary)] hover:text-gray-100 transition-colors cursor-pointer disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={resetSetup}
                disabled={resetting}
                className="flex-1 py-2.5 text-sm font-semibold text-white bg-red-500 hover:bg-red-400 rounded-lg transition-colors cursor-pointer disabled:opacity-50"
              >
                Reset
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Update progress overlay */}
      {updateStarted && updateState && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm px-4">
          <div className="card-surface rounded-2xl p-6 max-w-md w-full shadow-2xl">
            <h3 className="text-lg font-bold text-gray-100 mb-2">
              <UpdateProgressHeading phase={updateState.phase} />
            </h3>
            {updateError && (
              <p className="text-sm text-red-400 mb-4">{updateError}</p>
            )}
            {updateState.progress !== undefined && (
              <div className="mb-4">
                <div className="w-full h-2 rounded-full bg-[var(--bg-deep)] overflow-hidden mb-2">
                  <div className="h-full bg-[var(--coral-bright)] rounded-full transition-all" style={{ width: `${updateState.progress}%` }} />
                </div>
                <p className="text-xs text-[var(--text-secondary)]">{updateState.status || "Updating..."}</p>
              </div>
            )}
            {updateState.steps && (
              <div className="space-y-2 mb-4">
                {updateState.steps.map((step, idx) => (
                  <div key={idx} className="flex items-center gap-2 text-xs">
                    <UpdateStepIcon status={step.status} />
                    <span className={updateStepTextClass(step.status)}>{step.label}</span>
                  </div>
                ))}
              </div>
            )}
            {updateState.phase === "completed" && (
              <button
                type="button"
                onClick={() => { window.location.reload(); }}
                className="w-full py-2.5 text-sm font-semibold text-white btn-gradient rounded-lg cursor-pointer"
              >
                Refresh
              </button>
            )}
            {updateState.phase === "failed" && (
              <button
                type="button"
                onClick={() => { setUpdateStarted(false); setUpdateState(null); }}
                className="w-full py-2.5 text-sm font-semibold text-white btn-gradient rounded-lg cursor-pointer"
              >
                Close
              </button>
            )}
          </div>
        </div>
      )}

      {/* Collapsible sections */}
      <div className="space-y-3">
        {/* AI Model (cloud API only) */}
        <CollapsibleSection
          id="ai"
          title="AI Model (Cloud API)"
          done={providerDone}
          open={openSection === "ai"}
          onToggle={toggle}
        >
          <div>
            <label htmlFor="ai-provider-select" className={LABEL_CLASS}>
              Provider
            </label>
            <select
              id="ai-provider-select"
              value={aiProvider}
              onChange={(e) => {
                setAiProvider(e.target.value);
                resetAiFields();
              }}
              className={INPUT_CLASS}
            >
              {AI_PROVIDERS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>

          {selectedAiProvider && (
            <div className="flex flex-wrap gap-4 text-sm text-[var(--text-primary)]">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="ai-auth"
                  checked={aiAuthMode === "subscription"}
                  onChange={() => {
                    setAiAuthMode("subscription");
                    resetAiFields();
                  }}
                  className="accent-[var(--coral-bright)]"
                />
                Subscription (OAuth)
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="ai-auth"
                  checked={aiAuthMode === "token"}
                  onChange={() => {
                    setAiAuthMode("token");
                    resetAiFields();
                  }}
                  className="accent-[var(--coral-bright)]"
                />
                API key
              </label>
            </div>
          )}

          {isAiSubscription && !useDeviceAuth && (
            <div className="space-y-3">
              <p className="text-xs text-[var(--text-muted)] leading-relaxed">
                {currentAiOAuth.steps.join(" ")}
              </p>
              <button
                type="button"
                onClick={startAiOAuth}
                disabled={aiOauthStarted}
                className={`${SAVE_BUTTON_CLASS} flex items-center gap-2`}
              >
                {currentAiOAuth.button}
              </button>
              {aiOauthStarted && (
                <div className="space-y-2">
                  <label htmlFor="ai-auth-code" className={LABEL_CLASS}>
                    {currentAiOAuth.inputLabel}
                  </label>
                  <textarea
                    id="ai-auth-code"
                    value={aiAuthCode}
                    onChange={(e) => setAiAuthCode(e.target.value)}
                    placeholder={currentAiOAuth.inputPlaceholder}
                    rows={3}
                    className={`${INPUT_CLASS} min-h-[72px] resize-y`}
                  />
                  <button
                    type="button"
                    onClick={exchangeAiCode}
                    disabled={aiExchanging}
                    className={`${SAVE_BUTTON_CLASS} flex items-center gap-2`}
                  >
                    {aiExchanging && ButtonSpinner}
                    {aiExchanging ? "Connecting..." : "Complete connection"}
                  </button>
                </div>
              )}
            </div>
          )}

          {isAiSubscription && useDeviceAuth && (
            <div className="space-y-3">
              <p className="text-xs text-[var(--text-muted)] leading-relaxed">
                Sign in on another device with the code below, then keep this page open while we connect.
              </p>
              {!deviceCode ? (
                <button type="button" onClick={startDeviceAuth} className={SAVE_BUTTON_CLASS}>
                  Start device login
                </button>
              ) : (
                <div className="space-y-3 flex flex-col items-center">
                  <p className="text-sm font-mono tracking-widest text-[var(--coral-bright)]">{deviceCode}</p>
                  {deviceUrl && (
                    <a
                      href={deviceUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-[#00e5cc] underline break-all text-center"
                    >
                      {deviceUrl}
                    </a>
                  )}
                  {devicePolling && <p className="text-xs text-[var(--text-muted)]">Waiting for authorization…</p>}
                  {deviceUrl && (
                    <div className="p-3 bg-white rounded-lg">
                      <QRCodeSVG value={deviceUrl} size={160} level="M" />
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {!isAiSubscription && (
            <div className="space-y-3">
              <p className="text-xs text-[var(--text-muted)]">{selectedAiProvider?.hint}</p>
              <label htmlFor="ai-api-key" className={LABEL_CLASS}>
                API key
              </label>
              <PasswordInput
                id="ai-api-key"
                value={aiApiKey}
                onChange={setAiApiKey}
                visible={showAiKey}
                onToggle={() => setShowAiKey((v) => !v)}
                placeholder={selectedAiProvider?.placeholder}
                autoComplete="off"
              />
              <a
                href={selectedAiProvider?.tokenUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-[#00e5cc] underline"
              >
                Get API key
              </a>
              <button
                type="button"
                onClick={saveAiProvider}
                disabled={aiSaving}
                className={`${SAVE_BUTTON_CLASS} flex items-center gap-2`}
              >
                {aiSaving && ButtonSpinner}
                {aiSaving ? "Saving..." : "Save"}
              </button>
            </div>
          )}

          {aiStatus && <StatusMessage type={aiStatus.type} message={aiStatus.message} />}
        </CollapsibleSection>

        {/* WeChat Bot */}
        <CollapsibleSection id="wechat" title="WeChat Bot" done={wechatDone} open={openSection === "wechat"} onToggle={toggle}>
          {!canConfigureWechat ? (
            <div className="rounded-lg border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-xs leading-relaxed text-amber-300">
              Configure your AI provider first. WeChat bot setup unlocks after AI credentials are saved.
            </div>
          ) : (
            <p className="text-xs text-[var(--text-muted)] leading-relaxed">
              Optional after AI setup. Enable this if the device will receive tasks through WeChat.
            </p>
          )}
          <div className="flex items-center gap-2 mb-4">
            <span className="text-xs text-[var(--text-secondary)]">Enable WeChat Bot</span>
            <label className={`relative inline-flex items-center ${canConfigureWechat ? "cursor-pointer" : "cursor-not-allowed opacity-60"}`}>
              <input type="checkbox" checked={wechatEnabled} onChange={(e) => setWechatEnabled(e.target.checked)} disabled={!canConfigureWechat} className="sr-only peer" />
              <div className="w-9 h-5 bg-[var(--bg-deep)] peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-[var(--coral-bright)] rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-[var(--coral-bright)]"></div>
            </label>
          </div>
          <p className="text-xs text-[var(--text-muted)] mb-3 leading-relaxed">
            Disabling saves config and restarts the OpenClaw gateway so the bot stops until you turn it back on.
          </p>
          <div className="rounded-lg border border-gray-700 bg-[var(--bg-surface)] p-3 space-y-3">
            <div className="flex flex-wrap items-center gap-2 justify-between">
              <div>
                <p className="text-xs font-semibold text-[var(--text-secondary)]">QR code login (recommended)</p>
                <p className="text-xs text-[var(--text-muted)] mt-1">Click refresh to generate a new QR code, then scan immediately in WeChat.</p>
              </div>
              <button
                type="button"
                onClick={requestWechatQrCode}
                disabled={wechatQrLoading || !canConfigureWechat}
                className={`${SAVE_BUTTON_CLASS} flex items-center gap-2`}
              >
                {wechatQrLoading && ButtonSpinner}
                {wechatQrLoading ? "Refreshing..." : wechatQrUrl ? "Refresh QR" : "Get QR"}
              </button>
            </div>

            {wechatQrUrl && (
              <div className="rounded-lg border border-gray-700/70 bg-[var(--bg-deep)] p-3 space-y-2">
                <div className="w-full flex justify-center">
                  <div className="bg-white p-2 rounded-md">
                    <QRCodeSVG value={wechatQrUrl} size={170} level="M" />
                  </div>
                </div>
                <p className="text-[11px] text-[var(--text-muted)] break-all">
                  If scanning fails in this webview, open this link directly:
                  <a href={wechatQrUrl} target="_blank" rel="noopener noreferrer" className="ml-1 text-[#00e5cc] underline">Open QR link</a>
                </p>
              </div>
            )}
          </div>

          <div>
            <label htmlFor="wechat-token" className={LABEL_CLASS}>Bot Token (fallback)</label>
            <PasswordInput
              id="wechat-token"
              value={wechatToken}
              onChange={setWechatToken}
              visible={showWechatToken}
              onToggle={() => setShowWechatToken((v) => !v)}
              placeholder="WeChat bot token"
              autoComplete="off"
              disabled={!canConfigureWechat}
            />
          </div>
          <p className="text-xs text-[var(--text-muted)]">
            Fallback only: use token mode if QR login is unavailable.
          </p>
          {wechatStatus && <StatusMessage type={wechatStatus.type} message={wechatStatus.message} />}
          <button type="button" onClick={saveWechat} disabled={wechatSaving || !canConfigureWechat} className={`${SAVE_BUTTON_CLASS} flex items-center gap-2`}>{wechatSaving && ButtonSpinner}{wechatSaving ? "Saving..." : "Save"}</button>
        </CollapsibleSection>

        {/* WiFi — change network / re-provision */}
        <CollapsibleSection
          id="wifi"
          title="WiFi"
          done={wifiDone}
          open={openSection === "wifi"}
          onToggle={toggle}
        >
          {wifiConnectedSSID && (
            <p className="text-xs text-[var(--text-secondary)] mb-3">
              Currently connected: <strong>{wifiConnectedSSID}</strong>
            </p>
          )}
          <div className="flex justify-end mb-2">
            <button
              type="button"
              onClick={scanWifiNetworks}
              disabled={wifiScanning}
              className="text-xs text-[var(--coral-bright)] hover:underline cursor-pointer disabled:opacity-50"
            >
              {wifiScanning ? "Scanning…" : "Scan networks"}
            </button>
          </div>
          {wifiNetworks.length > 0 && (
            <div className="mb-3 max-h-40 overflow-y-auto rounded-lg border border-gray-700 bg-[var(--bg-surface)]">
              {wifiNetworks.map((n, i) => (
                <button
                  key={`${n.ssid}-${i}`}
                  type="button"
                  onClick={() => {
                    setWifiSSID(n.ssid);
                    setWifiPassword("");
                  }}
                  className="w-full px-3 py-2 text-left text-sm text-gray-200 hover:bg-[var(--bg-elevated)] border-b border-gray-700 last:border-b-0"
                >
                  {n.ssid}
                  <span className="float-right text-xs text-gray-500">{n.signal} dBm</span>
                </button>
              ))}
            </div>
          )}
          <label htmlFor="wifi-ssid-dash" className={LABEL_CLASS}>
            Network name (SSID)
          </label>
          <input
            id="wifi-ssid-dash"
            type="text"
            value={wifiSSID}
            onChange={(e) => setWifiSSID(e.target.value)}
            className={INPUT_CLASS}
            placeholder="Your WiFi name"
            autoComplete="off"
          />
          <label htmlFor="wifi-pass-dash" className={LABEL_CLASS}>
            Password
          </label>
          <PasswordInput
            id="wifi-pass-dash"
            value={wifiPassword}
            onChange={setWifiPassword}
            visible={showWifiPassword}
            onToggle={() => setShowWifiPassword((v) => !v)}
            placeholder="WiFi password (empty if open)"
            autoComplete="off"
          />
          <p className="text-xs text-amber-400/80 leading-relaxed mt-2">
            Connecting may drop this page briefly. After the device joins your router, open the device’s `.local` address first. If your client does not resolve `.local`, use the IPv4 shown on the device screen.
          </p>
          <p className="text-xs mt-2">
            <a href="/setup/wifi" className="text-[#00e5cc] underline">
              Open dedicated WiFi setup page
            </a>
          </p>
          {wifiStatus && <StatusMessage type={wifiStatus.type} message={wifiStatus.message} />}
          <button
            type="button"
            onClick={connectWifi}
            disabled={wifiConnecting || !wifiSSID.trim()}
            className={`${SAVE_BUTTON_CLASS} flex items-center gap-2 mt-2`}
          >
            {wifiConnecting && ButtonSpinner}
            {wifiConnecting ? "Connecting…" : "Connect"}
          </button>
        </CollapsibleSection>

        {/* Security & Hotspot */}
        <CollapsibleSection id="security" title="Security & Hotspot" done={securityDone} open={openSection === "security"} onToggle={toggle}>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="password" className={LABEL_CLASS}>Set Password</label>
              <PasswordInput
                id="password"
                value={password}
                onChange={setPassword}
                visible={showPassword}
                onToggle={() => setShowPassword((v) => !v)}
                placeholder="At least 8 characters"
              />
            </div>
            <div>
              <label htmlFor="confirm" className={LABEL_CLASS}>Confirm Password</label>
              <PasswordInput
                id="confirm"
                value={confirmPassword}
                onChange={setConfirmPassword}
                visible={showConfirm}
                onToggle={() => setShowConfirm((v) => !v)}
                placeholder="Confirm password"
              />
            </div>
          </div>
          <div>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={hotspotEnabled} onChange={(e) => setHotspotEnabled(e.target.checked)} className="w-4 h-4 rounded border-gray-600 bg-[var(--bg-deep)] text-[var(--coral-bright)] focus:ring-[var(--coral-bright)] cursor-pointer" />
              <span className="text-sm text-[var(--text-primary)]">Enable Setup Hotspot</span>
            </label>
          </div>
          {hotspotEnabled && (
            <>
              <div>
                <label htmlFor="hotspot-name" className={LABEL_CLASS}>Hotspot Name</label>
                <input
                  id="hotspot-name"
                  type="text"
                  value={hotspotName}
                  onChange={(e) => setHotspotName(e.target.value)}
                  placeholder="ClawBox-Setup"
                  className={INPUT_CLASS}
                />
              </div>
              <div>
                <label htmlFor="hotspot-password" className={LABEL_CLASS}>Hotspot Password (optional)</label>
                <PasswordInput
                  id="hotspot-password"
                  value={hotspotPassword}
                  onChange={setHotspotPassword}
                  visible={showHotspotPassword}
                  onToggle={() => setShowHotspotPassword((v) => !v)}
                  placeholder="Leave empty for open network"
                />
              </div>
            </>
          )}
          {secStatus && <StatusMessage type={secStatus.type} message={secStatus.message} />}
          <button type="button" onClick={saveSecurity} disabled={secSaving} className={`${SAVE_BUTTON_CLASS} flex items-center gap-2`}>{secSaving && ButtonSpinner}{secSaving ? "Saving..." : "Save"}</button>
        </CollapsibleSection>

        {/* System Info Widgets — 2 rows × 3 items */}
        {info && (
          <div className="space-y-3">
            <div className="card-surface rounded-xl p-4">
              <p className={WIDGET_LABEL_CLASS}>Access</p>
              <p className="text-sm font-semibold text-gray-100 break-all">{info.accessUrl}</p>
              <p className="text-xs text-[var(--text-secondary)] mt-2">
                IPv4 fallback: <span className="font-medium text-gray-200">{info.networkIp}</span>
              </p>
              {info.localDnsAlias && (
                <p className="text-xs text-[var(--text-secondary)] mt-1">
                  Optional local DNS alias: <span className="font-medium text-gray-200">{info.localDnsAlias}</span>
                </p>
              )}
            </div>
            <div className="grid grid-cols-3 gap-3">
              {/* Row 1 */}
              <SystemInfoWidget
                label="CPU"
                detail={`${info.cpus} cores`}
                value={String(info.cpuLoadPercent)}
                unit="%"
                bar={{ percent: info.cpuLoadPercent, color: thresholdColor(info.cpuLoadPercent, 50, 80) }}
              />
              <SystemInfoWidget
                label="GPU"
                value={String(info.gpuLoadPercent)}
                unit="%"
                bar={{ percent: info.gpuLoadPercent, color: thresholdColor(info.gpuLoadPercent, 50, 80) }}
              />
              <SystemInfoWidget
                label="Memory"
                detail={`${info.memoryFree} free`}
                value={String(info.memoryUsedPercent)}
                unit="%"
                bar={{ percent: info.memoryUsedPercent, color: thresholdColor(info.memoryUsedPercent, 60, 85) }}
              />
              {/* Row 2 */}
              <SystemInfoWidget
                label="Storage"
                detail={`${info.diskFree} free`}
                value={String(info.diskUsedPercent)}
                unit="%"
                bar={{ percent: info.diskUsedPercent, color: thresholdColor(info.diskUsedPercent, 70, 90) }}
              />
              <SystemInfoWidget
                label="Temperature"
                value={info.temperature}
                bar={info.temperatureValue != null ? {
                  percent: Math.min(100, (info.temperatureValue / 85) * 100),
                  color: thresholdColor(info.temperatureValue, 55, 75),
                } : undefined}
              />
              <SparklineWidget
                label="CPU Timeline"
                currentValue={statsHistory.length >= 1 ? `${statsHistory[statsHistory.length - 1].cpu}%` : "—"}
                data={statsHistory.map((s) => s.cpu)}
                color="#f97316"
              />
            </div>
          </div>
        )}
        {!info && !loadError && (
          <div className="flex items-center justify-center gap-2.5 py-4 text-[var(--text-secondary)] text-sm">
            <div className="spinner" /> Loading system info...
          </div>
        )}
      </div>
    </div>
  );
}
