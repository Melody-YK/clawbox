"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { QRCodeSVG } from "qrcode.react";
import type { StepStatus, UpdateState } from "@/lib/updater";
import StatusMessage from "./StatusMessage";
import CredentialGuide from "./CredentialGuide";
import { getLocale, t } from "@/lib/i18n";
import { useI18n } from "./I18nProvider";

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

interface ChannelRuntimeStatus {
  state?: string;
  configured?: boolean;
  enabled?: boolean;
  connected?: boolean;
  linked?: boolean;
  running?: boolean;
  lastError?: string | null;
  publicWebhookUrl?: string | null;
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
  { id: "deepseek", name: "DeepSeek", hasSubscription: false, placeholder: "sk-...", hint: "Get your API key from platform.deepseek.com", tokenUrl: "https://platform.deepseek.com/api_keys" },
] as const;

type ChatChannelId = "wechat" | "feishu" | "qqbot" | "telegram" | "whatsapp" | "line";
type ConfigurableChatChannelId = Exclude<ChatChannelId, "wechat">;

const CHAT_CHANNEL_META: readonly { id: ChatChannelId; tag: string; name: string; description: string }[] = [
  { id: "wechat", tag: "WX", name: "WeChat", description: "Sign in to a Tencent iLink bot with a QR code; direct messages only." },
  { id: "telegram", tag: "TG", name: "Telegram", description: "Create a bot with BotFather, then paste its complete Bot Token." },
  { id: "whatsapp", tag: "WA", name: "WhatsApp", description: "Link a WhatsApp account by scanning a QR code. No Bot Token is needed." },
  { id: "feishu", tag: "FS", name: "Feishu / Lark", description: "Connect an enterprise self-built app over WebSocket." },
  { id: "line", tag: "LN", name: "LINE", description: "Connect a LINE Messaging API bot through a public HTTPS webhook." },
  { id: "qqbot", tag: "QQ", name: "QQ Bot", description: "Connect an official QQ bot with its AppID and AppSecret." },
];

const CHANNEL_STATUS_PATHS: Record<ConfigurableChatChannelId, string> = {
  telegram: "/setup-api/channels/telegram/status",
  whatsapp: "/setup-api/channels/whatsapp/status",
  feishu: "/setup-api/channels/feishu/status",
  line: "/setup-api/channels/line/status",
  qqbot: "/setup-api/channels/qqbot/status",
};

const CONFIGURABLE_CHAT_CHANNELS: readonly ConfigurableChatChannelId[] = [
  "telegram",
  "whatsapp",
  "feishu",
  "line",
  "qqbot",
];

const CHANNEL_COPY = {
  en: {
    title: "Chat Channels", empty: "Select one or more chat channels", optional: "Chat channels are optional. You can enable multiple channels.", appId: "App ID", qrCode: "QR code", feishuDomain: "Feishu", larkDomain: "Lark",
    saved: "configuration saved. The gateway is reloading.", saveFailed: "Save failed", qrFeishu: "Save to let the official Feishu plugin start QR code connection.", qrWhatsapp: "Save the enabled state, then complete QR pairing through the official WhatsApp plugin.",
    names: { wechat: "WeChat", feishu: "Feishu", qqbot: "QQ Bot", telegram: "Telegram", whatsapp: "WhatsApp", line: "LINE" },
    descriptions: { wechat: "Sign in to a Tencent iLink bot with a QR code; direct messages only (external plugin).", feishu: "Use a Feishu/Lark bot over WebSocket; choose the correct regional platform and enter the app credentials.", qqbot: "QQ Bot API with direct messages, groups, and rich media (official plugin).", telegram: "Bot API through grammY; built into the core with group support.", whatsapp: "Connect through Baileys with QR code pairing (official plugin).", line: "LINE Messaging API bot (official plugin)." },
  },
  "zh-CN": {
    title: "聊天渠道", empty: "选择一个或多个聊天渠道", optional: "聊天渠道是可选项，可同时启用多个渠道。", appId: "App ID", qrCode: "二维码", feishuDomain: "飞书", larkDomain: "Lark",
    saved: "配置已保存，网关正在重新加载。", saveFailed: "保存失败", qrFeishu: "保存后由飞书官方插件发起二维码连接。", qrWhatsapp: "保存启用状态后，通过 WhatsApp 官方插件完成二维码配对。",
    names: { wechat: "微信", feishu: "飞书", qqbot: "QQ Bot", telegram: "Telegram", whatsapp: "WhatsApp", line: "LINE" },
    descriptions: { wechat: "通过二维码登录腾讯 iLink 机器人；仅支持私聊（外部插件）。", feishu: "通过 WebSocket 使用 Feishu/Lark 机器人；请选择正确的平台区域并填写应用凭据。", qqbot: "QQ Bot API；支持私聊、群聊和富媒体（官方插件）。", telegram: "通过 grammY 使用 Bot API；包含在核心中并支持群组。", whatsapp: "通过 Baileys 连接，需要二维码配对（官方插件）。", line: "使用 LINE Messaging API 机器人（官方插件）。" },
  },
  "zh-TW": {
    title: "聊天頻道", empty: "選擇一個或多個聊天頻道", optional: "聊天頻道為選用項目，可同時啟用多個頻道。", appId: "App ID", qrCode: "QR Code", feishuDomain: "飛書", larkDomain: "Lark",
    saved: "設定已儲存，閘道正在重新載入。", saveFailed: "儲存失敗", qrFeishu: "儲存後由飛書官方外掛程式啟動 QR Code 連線。", qrWhatsapp: "儲存啟用狀態後，透過 WhatsApp 官方外掛程式完成 QR Code 配對。",
    names: { wechat: "微信", feishu: "飛書", qqbot: "QQ Bot", telegram: "Telegram", whatsapp: "WhatsApp", line: "LINE" },
    descriptions: { wechat: "透過 QR Code 登入騰訊 iLink 機器人；僅支援私人訊息（外部外掛程式）。", feishu: "透過 WebSocket 使用 Feishu/Lark 機器人；請選擇正確的平台區域並填寫應用程式憑據。", qqbot: "QQ Bot API；支援私人訊息、群組與多媒體（官方外掛程式）。", telegram: "透過 grammY 使用 Bot API；內建於核心並支援群組。", whatsapp: "透過 Baileys 連線，需要 QR Code 配對（官方外掛程式）。", line: "使用 LINE Messaging API 機器人（官方外掛程式）。" },
  },
} as const;

const CHANNEL_FIELDS: Partial<Record<ChatChannelId, { key: string; label: string; placeholder: string; secret?: boolean }[]>> = {
  feishu: [
    { key: "appId", label: "App ID", placeholder: "cli_xxxxxxxxxxxxxxxx" },
    { key: "appSecret", label: "App Secret", placeholder: "Feishu App Secret", secret: true },
  ],
  qqbot: [
    { key: "appId", label: "App ID", placeholder: "QQ Bot App ID" },
    { key: "clientSecret", label: "Client Secret", placeholder: "QQ Bot Client Secret", secret: true },
  ],
  telegram: [{ key: "botToken", label: "Bot Token", placeholder: "123456:ABC-DEF...", secret: true }],
  line: [
    { key: "channelAccessToken", label: "Channel Access Token", placeholder: "LINE channel access token", secret: true },
    { key: "channelSecret", label: "Channel Secret", placeholder: "LINE channel secret", secret: true },
    { key: "publicBaseUrl", label: "Public HTTPS Base URL", placeholder: "https://bot.example.com" },
  ],
};

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
        {t("status_done")}
      </span>
    );
  }
  return (
    <span className="ml-auto flex items-center gap-1.5 text-[10px] font-semibold text-amber-400 uppercase tracking-wide">
      <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
      {t("status_pending")}
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
    <div id={`section-${id}`} className="card-surface rounded-xl overflow-hidden scroll-mt-24">
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

function isChannelOnline(channel: ChatChannelId, status: ChannelRuntimeStatus | undefined): boolean {
  if (channel === "line") return status?.state === "active";
  return status?.connected === true;
}

function ChannelStatusSummary({
  channel,
  status,
}: {
  channel: ChatChannelId;
  status: ChannelRuntimeStatus | undefined;
}) {
  if (!status) {
    return <p className="text-xs text-[var(--text-muted)]">{t("Checking channel status...")}</p>;
  }

  const online = isChannelOnline(channel, status);
  const label = online
    ? channel === "line"
      ? t("Active: webhook verified")
      : t("Connected")
    : status.state === "not_linked"
      ? t("Waiting for QR pairing")
      : status.state === "configured" || status.state === "ready" || status.state === "running"
        ? t("Configured: waiting for connection")
        : status.state === "disabled"
          ? t("Disabled")
          : status.state === "error"
            ? t("Needs attention")
            : t("Not configured");

  const color = online
    ? "text-[#00e5cc]"
    : status.state === "error"
      ? "text-red-400"
      : "text-amber-400";

  return (
    <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-deep)]/50 px-3 py-2.5">
      <p className={`text-xs font-semibold ${color}`}>{label}</p>
      {status.lastError && <p className="mt-1 break-words text-[11px] leading-relaxed text-red-300">{status.lastError}</p>}
    </div>
  );
}

function LegacyChannelCredentialGuide({
  channel,
}: {
  channel: Exclude<ChatChannelId, "wechat">;
}) {
  const zh = getLocale().startsWith("zh");
  const securityLabel = zh ? "请妥善保管凭据：" : "Keep credentials private:";
  const securityNote = zh
    ? "不要把 Token、Secret、截图或聊天记录提交到 GitHub。"
    : channel === "telegram"
      ? "Never commit the Bot Token to GitHub or include it in screenshots or chat messages."
      : channel === "feishu" || channel === "qqbot"
        ? "Never commit the App Secret to GitHub or include it in screenshots or chat messages."
        : "Never commit them to GitHub or include credentials, QR screenshots or chat messages.";

  if (channel === "telegram") {
    return (
      <CredentialGuide
        title={zh ? "如何获取完整的 Bot Token" : "How to get the complete Bot Token"}
        securityLabel={securityLabel}
        securityNote={securityNote}
        steps={zh ? [
          <>打开 Telegram 的 <a href="https://t.me/BotFather" target="_blank" rel="noreferrer">@BotFather</a>，发送 <code>/newbot</code>。</>,
          <>按提示设置机器人名称和用户名，然后复制 BotFather 返回的完整 Token。</>,
          <>冒号前的数字只是 bot ID；此字段需要完整 Token，而不是只填 bot ID。打开机器人后发送 <code>/start</code> 进行配对。</>,
        ] : [
          <>Open <a href="https://t.me/BotFather" target="_blank" rel="noreferrer">@BotFather</a> and send <code>/newbot</code>.</>,
          <>Use <code>/mybots</code> to find an existing bot, then copy the complete Bot Token.</>,
          <>The digits before the colon are only the bot ID; this field needs the complete token. Open the bot and send <code>/start</code> for pairing.</>,
        ]}
      />
    );
  }

  if (channel === "feishu") {
    return (
      <CredentialGuide
        title={zh ? "如何创建飞书 / Lark 应用并获取凭据" : "How to create the Feishu / Lark app and credentials"}
        securityLabel={securityLabel}
        securityNote={securityNote}
        steps={zh ? [
          <>在 <a href="https://open.feishu.cn/app" target="_blank" rel="noreferrer">飞书开放平台</a> 或 <a href="https://open.larksuite.com/app" target="_blank" rel="noreferrer">Lark Developer Console</a> 创建企业自建应用。</>,
          <>启用机器人能力和 <code>im:message</code>、<code>im:chat</code>、<code>contact:user.base:readonly</code> 权限，事件订阅选择长连接/WebSocket。</>,
          <>发布应用版本后复制 App ID 和 App Secret，再回到此页面保存连接。</>,
        ] : [
          <>Create an enterprise self-built app in the <a href="https://open.feishu.cn/app" target="_blank" rel="noreferrer">Feishu Open Platform</a> or <a href="https://open.larksuite.com/app" target="_blank" rel="noreferrer">Lark Developer Console</a>.</>,
          <>Enable the Bot capability, add <code>im:message</code>, <code>im:chat</code>, and <code>contact:user.base:readonly</code>, then choose long connection/WebSocket for events.</>,
          <>Add <code>im.message.receive_v1</code>, Create and publish an app version, and copy the App ID and App Secret here.</>,
        ]}
      />
    );
  }

  if (channel === "whatsapp") {
    return (
      <CredentialGuide
        title={zh ? "如何关联 WhatsApp" : "How to link WhatsApp"}
        securityLabel={securityLabel}
        securityNote={securityNote}
        steps={zh ? [
          <>不需要 Bot ID、API Token、开发者应用、Webhook 或 ClawBox 账号。</>,
          <>在手机 WhatsApp 打开“设置 → 已关联设备 → 关联设备”，扫描页面二维码。</>,
          <>二维码只授权一个关联设备；保持手机在线，等待页面显示已关联并在线。</>,
        ] : [
          <>No Bot ID, API token, developer app, webhook, or ClawBox account is required.</>,
          <>On Android open Settings → Linked devices → Link a device; on iPhone open the menu, then Linked devices → Link a device.</>,
          <>The QR code authorizes a linked device. Keep the phone online until the page reports that WhatsApp is linked and connected.</>,
        ]}
      />
    );
  }

  if (channel === "line") {
    return (
      <CredentialGuide
        title={zh ? "如何创建 LINE channel 和 Webhook" : "How to create the LINE channel and webhook"}
        securityLabel={securityLabel}
        securityNote={securityNote}
        steps={zh ? [
          <>在 <a href="https://manager.line.biz/" target="_blank" rel="noreferrer">LINE Official Account Manager</a> 启用 Messaging API。</>,
          <>在 <a href="https://developers.line.biz/console/" target="_blank" rel="noreferrer">LINE Developers Console</a> 获取 Channel secret 和 Channel access token (long-lived)。</>,
          <>填写公网 HTTPS domain、reverse proxy 或 tunnel 生成的 Webhook 地址，按 Edit → Update → Verify，然后启用 Use webhook。</>,
          <>页面只有在收到真实入站 Webhook 后才会标记完成。</>,
        ] : [
          <>Create the account in <a href="https://manager.line.biz/" target="_blank" rel="noreferrer">LINE Official Account Manager</a> and enable Messaging API. Use the <a href="https://developers.line.biz/en/docs/messaging-api/getting-started/" target="_blank" rel="noreferrer">official getting-started guide</a> if you need a new account.</>,
          <>Open <a href="https://developers.line.biz/console/" target="_blank" rel="noreferrer">LINE Developers Console</a> and copy the Channel secret and Channel access token (long-lived).</>,
          <>Use a public HTTPS domain, reverse proxy, or tunnel. Set the Webhook URL with Edit → Update → Verify, then enable Use webhook.</>,
          <>This page is marked done only after a real inbound webhook is received.</>,
        ]}
      />
    );
  }

  return (
    <CredentialGuide
      title={zh ? "如何获取 QQ Bot AppID 和 AppSecret" : "How to get QQ Bot AppID and AppSecret"}
      securityLabel={securityLabel}
      securityNote={securityNote}
      steps={zh ? [
        <>打开 <a href="https://q.qq.com/qqbot/openclaw/" target="_blank" rel="noreferrer">QQ Bot 开放平台</a>，扫码登录并 Create Bot。</>,
        <>在机器人设置中复制 AppID 和 AppSecret；这是机器人凭据，不是你的个人 QQ 号码。</>,
        <>OpenClaw 通过 WebSocket 连接，不需要 webhook URL 或 event callback；先用创建者私聊测试，无需向所有人发布。</>,
        <>QQ 不需要单独的 ClawBox pairing approval。</>,
      ] : [
        <>Open <a href="https://q.qq.com/qqbot/openclaw/" target="_blank" rel="noreferrer">QQ Bot Open Platform</a>, scan to sign in, and Create Bot.</>,
        <>Copy the AppID and AppSecret from bot settings. These are bot credentials, not your personal QQ number.</>,
        <>OpenClaw uses WebSocket. No webhook URL or event callback is needed. Test with the owner without publishing it to everyone.</>,
        <>Use the <a href="https://q.qq.com/qqbot/dashboard/" target="_blank" rel="noreferrer">QQ Bot dashboard</a> later to configure visibility and experience users; this is optional for the first private test.</>,
        <>QQ does not need a separate ClawBox pairing approval.</>,
      ]}
    />
  );
}

/* ── Main component ── */

function ChannelCredentialGuide({
  channel,
}: {
  channel: ConfigurableChatChannelId;
}) {
  const securityNote = t("Never commit credentials, QR codes, screenshots, or chat logs to GitHub.");
  const props = {
    securityLabel: t("Keep credentials private:"),
    securityNote,
  };

  if (channel === "telegram") {
    return <CredentialGuide
      title={t("How to get a Telegram Bot Token")}
      {...props}
      steps={[
        <><a href="https://t.me/BotFather" target="_blank" rel="noreferrer">@BotFather</a>{t(" Telegram step 1")}</>,
        <>{t("Telegram step 2")}</>,
        <>{t("Telegram step 3")}</>,
      ]}
    />;
  }

  if (channel === "feishu") {
    return <CredentialGuide
      title={t("How to get Feishu / Lark credentials")}
      {...props}
      steps={[
        <>{t("Feishu step 1")} <a href="https://open.feishu.cn/app" target="_blank" rel="noreferrer">Feishu Open Platform</a> {t("or")} <a href="https://open.larksuite.com/app" target="_blank" rel="noreferrer">Lark Developer Console</a>.</>,
        <>{t("Feishu step 2")}</>,
        <>{t("Feishu step 3")}</>,
      ]}
    />;
  }

  if (channel === "whatsapp") {
    return <CredentialGuide
      title={t("How to link WhatsApp")}
      {...props}
      steps={[
        <>{t("WhatsApp step 1")}</>,
        <>{t("WhatsApp step 2")}</>,
        <>{t("WhatsApp step 3")}</>,
      ]}
    />;
  }

  if (channel === "line") {
    return <CredentialGuide
      title={t("How to configure LINE and its webhook")}
      {...props}
      steps={[
        <>{t("LINE step 1")} <a href="https://manager.line.biz/" target="_blank" rel="noreferrer">LINE Official Account Manager</a>.</>,
        <>{t("LINE step 2")} <a href="https://developers.line.biz/console/" target="_blank" rel="noreferrer">LINE Developers Console</a>.</>,
        <>{t("LINE step 3")}</>,
        <>{t("LINE step 4")}</>,
      ]}
    />;
  }

  return <CredentialGuide
    title={t("How to get QQ Bot AppID and AppSecret")}
    {...props}
    steps={[
      <>{t("QQ step 1")} <a href="https://q.qq.com/qqbot/openclaw/" target="_blank" rel="noreferrer">QQ Bot OpenClaw setup page</a>.</>,
      <>{t("QQ step 2")}</>,
      <>{t("QQ step 3")}</>,
    ]}
  />;
}

export default function DoneStep({ setupComplete = false }: DoneStepProps) {
  const { locale } = useI18n();
  void locale;
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
  const [activeChatChannel, setActiveChatChannel] = useState<ChatChannelId>("wechat");
  const [channelPickerOpen, setChannelPickerOpen] = useState(true);
  const toggle = (id: string) => setOpenSection((prev) => (prev === id ? null : id));

  useEffect(() => {
    const requestedSection = new URLSearchParams(window.location.search).get("section");
    if (!requestedSection) return;
    const requestedChannel = CHAT_CHANNEL_META.find((channel) => channel.id === requestedSection);
    const targetSection = requestedChannel ? "channels" : requestedSection;
    if (requestedChannel) {
      setActiveChatChannel(requestedChannel.id);
      setChannelPickerOpen(false);
    }
    setOpenSection(targetSection);
    window.setTimeout(() => document.getElementById(`section-${targetSection}`)?.scrollIntoView({ behavior: "smooth", block: "start" }), 100);
  }, []);

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
  const [wechatLinkCopied, setWechatLinkCopied] = useState(false);
  const [channelConfigs, setChannelConfigs] = useState<Record<string, Record<string, string | boolean>>>({});
  const [channelSaving, setChannelSaving] = useState<ConfigurableChatChannelId | null>(null);
  const [channelStatuses, setChannelStatuses] = useState<Record<string, SectionStatusMessage>>({});
  const [channelRuntimeStatuses, setChannelRuntimeStatuses] = useState<Partial<Record<ConfigurableChatChannelId, ChannelRuntimeStatus>>>({});
  const [feishuDomain, setFeishuDomain] = useState<"feishu" | "lark">("feishu");
  const [whatsappMode, setWhatsappMode] = useState<"dedicated" | "personal">("dedicated");
  const [whatsappOwnerNumber, setWhatsappOwnerNumber] = useState("");
  const [whatsappQrDataUrl, setWhatsappQrDataUrl] = useState<string | null>(null);
  const [whatsappQrLoading, setWhatsappQrLoading] = useState(false);

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
  const chatChannelsDone = wechatDone || CONFIGURABLE_CHAT_CHANNELS.some((channel) =>
    isChannelOnline(channel, channelRuntimeStatuses[channel]),
  );
  const activeChatChannelMeta = CHAT_CHANNEL_META.find((channel) => channel.id === activeChatChannel)!;
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

  const refreshWechatState = useCallback(async (signal?: AbortSignal) => {
    const r = await fetch("/setup-api/wechat/configure", { signal, cache: "no-store" });
    if (!r.ok) return null;
    const data = await r.json().catch(() => null as any);
    if (!data) return null;

    if (typeof data.enabled === "boolean") setWechatEnabled(data.enabled);
    // masked token from backend is expected; do not overwrite user input with non-string
    if (typeof data.botToken === "string" && data.botToken) setWechatToken(data.botToken);

    const connected = data.connected === true;
    setWechatDone(connected);
    return data as { enabled?: boolean; connected?: boolean; accountIds?: string[] };
  }, []);

  const refreshChannelRuntimeStatus = useCallback(async (
    channel: ConfigurableChatChannelId,
    signal?: AbortSignal,
  ) => {
    try {
      const response = await fetch(CHANNEL_STATUS_PATHS[channel], {
        signal,
        cache: "no-store",
      });
      const data = (await response.json().catch(() => null)) as ChannelRuntimeStatus | null;
      if (!data || signal?.aborted) return;
      setChannelRuntimeStatuses((current) => ({ ...current, [channel]: data }));
    } catch {
      // Status probes are informational; saving a channel remains available.
    }
  }, []);

  const refreshAllChannelRuntimeStatuses = useCallback(async (signal?: AbortSignal) => {
    await Promise.all(CONFIGURABLE_CHAT_CHANNELS.map((channel) => refreshChannelRuntimeStatus(channel, signal)));
  }, [refreshChannelRuntimeStatus]);

  /* ── Fetch WeChat config on mount ── */
  useEffect(() => {
    const controller = new AbortController();
    refreshWechatState(controller.signal).catch(() => {});
    void refreshAllChannelRuntimeStatuses(controller.signal);
    fetch("/setup-api/channels/whatsapp", { signal: controller.signal, cache: "no-store" })
      .then((response) => response.ok ? response.json() : null)
      .then((data: { mode?: unknown; ownerNumber?: unknown; enabled?: unknown } | null) => {
        if (!data || controller.signal.aborted) return;
        if (data.mode === "dedicated" || data.mode === "personal") setWhatsappMode(data.mode);
        if (typeof data.ownerNumber === "string") setWhatsappOwnerNumber(data.ownerNumber);
        if (typeof data.enabled === "boolean") updateChannelField("whatsapp", "enabled", data.enabled);
      })
      .catch(() => {});
    fetch("/setup-api/channels", { signal: controller.signal, cache: "no-store" })
      .then((response) => response.ok ? response.json() : null)
      .then((data) => {
        if (!data?.channels || controller.signal.aborted) return;
        setChannelConfigs((current) => ({ ...current, ...data.channels }));
        if (data.channels.feishu?.domain === "lark") setFeishuDomain("lark");
      })
      .catch(() => {});
    return () => controller.abort();
  }, [refreshAllChannelRuntimeStatuses, refreshWechatState]);

  const updateChannelField = (channel: ChatChannelId, field: string, value: string | boolean) => {
    setChannelConfigs((current) => ({ ...current, [channel]: { ...(current[channel] || {}), [field]: value } }));
  };

  const saveChatChannel = async (channel: ConfigurableChatChannelId) => {
    setChannelSaving(channel);
    setChannelStatuses((current) => { const next = { ...current }; delete next[channel]; return next; });
    try {
      const config: Record<string, string | boolean> = {
        ...(channelConfigs[channel] || {}),
        enabled: channelConfigs[channel]?.enabled !== false,
      };
      if (channel === "feishu") {
        config.domain = feishuDomain;
        config.connectionMode = "websocket";
      }
      const response = await fetch(`/setup-api/channels/${channel}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config),
      });
      const data = (await response.json().catch(() => ({}))) as ChannelRuntimeStatus & {
        saved?: boolean;
        error?: string;
      };
      const statusMessage = response.ok
        ? t("Channel settings saved. The gateway is reloading.")
        : data.saved === true
          ? `${t("Channel settings saved. The gateway is reloading.")} ${data.error || t("The channel is not online yet.")}`
          : data.error || t("Unable to save channel settings.");
      setChannelStatuses((current) => ({
        ...current,
        [channel]: { type: response.ok ? "success" : "error", message: statusMessage },
      }));
      if (typeof data.state === "string") {
        setChannelRuntimeStatuses((current) => ({ ...current, [channel]: data }));
      }
      if (response.ok) {
        window.setTimeout(() => void refreshChannelRuntimeStatus(channel), 1000);
      }
    } catch (error) {
      setChannelStatuses((current) => ({
        ...current,
        [channel]: {
          type: "error",
          message: `${t("Unable to save channel settings.")}: ${error instanceof Error ? error.message : error}`,
        },
      }));
    } finally {
      setChannelSaving(null);
    }
  };

  const requestWhatsAppQr = async (force = false) => {
    setWhatsappQrLoading(true);
    setChannelStatuses((current) => {
      const next = { ...current };
      delete next.whatsapp;
      return next;
    });
    try {
      const response = await fetch("/setup-api/channels/whatsapp/qrcode", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ force }),
        cache: "no-store",
      });
      const data = (await response.json().catch(() => ({}))) as {
        connected?: boolean;
        qrDataUrl?: string | null;
        message?: string;
        error?: string;
      };
      if (!response.ok) {
        setChannelStatuses((current) => ({
          ...current,
          whatsapp: { type: "error", message: data.error || t("Unable to generate a WhatsApp QR code.") },
        }));
        return;
      }
      if (data.connected) {
        setWhatsappQrDataUrl(null);
        await refreshChannelRuntimeStatus("whatsapp");
        return;
      }
      if (!data.qrDataUrl) {
        setChannelStatuses((current) => ({
          ...current,
          whatsapp: { type: "error", message: data.message || t("WhatsApp did not return a QR code.") },
        }));
        return;
      }
      setWhatsappQrDataUrl(data.qrDataUrl);
      setChannelStatuses((current) => ({
        ...current,
        whatsapp: { type: "success", message: t("QR code is ready. Scan it from WhatsApp Linked devices, then check status.") },
      }));
    } catch (error) {
      setChannelStatuses((current) => ({
        ...current,
        whatsapp: {
          type: "error",
          message: `${t("Unable to generate a WhatsApp QR code.")}: ${error instanceof Error ? error.message : error}`,
        },
      }));
    } finally {
      setWhatsappQrLoading(false);
    }
  };

  const prepareWhatsApp = async () => {
    if (!canConfigureWechat) {
      setChannelStatuses((current) => ({
        ...current,
        whatsapp: { type: "error", message: t("Configure an AI provider before setting up chat channels.") },
      }));
      return;
    }
    const enabled = channelConfigs.whatsapp?.enabled !== false;
    setChannelSaving("whatsapp");
    setChannelStatuses((current) => {
      const next = { ...current };
      delete next.whatsapp;
      return next;
    });
    try {
      const response = await fetch("/setup-api/channels/whatsapp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          enabled,
          mode: whatsappMode,
          ownerNumber: whatsappOwnerNumber.trim() || undefined,
        }),
        cache: "no-store",
      });
      const data = (await response.json().catch(() => ({}))) as ChannelRuntimeStatus & {
        message?: string;
        error?: string;
      };
      if (!response.ok) {
        setChannelStatuses((current) => ({
          ...current,
          whatsapp: { type: "error", message: data.error || t("Unable to prepare WhatsApp.") },
        }));
        return;
      }
      if (!enabled) {
        setWhatsappQrDataUrl(null);
        setChannelRuntimeStatuses((current) => ({ ...current, whatsapp: data }));
        setChannelStatuses((current) => ({
          ...current,
          whatsapp: { type: "success", message: t("WhatsApp is disabled.") },
        }));
        return;
      }
      setChannelStatuses((current) => ({
        ...current,
        whatsapp: { type: "success", message: t("WhatsApp is prepared. Generating a QR code now.") },
      }));
      await requestWhatsAppQr();
    } catch (error) {
      setChannelStatuses((current) => ({
        ...current,
        whatsapp: {
          type: "error",
          message: `${t("Unable to prepare WhatsApp.")}: ${error instanceof Error ? error.message : error}`,
        },
      }));
    } finally {
      setChannelSaving(null);
    }
  };

  useEffect(() => {
    if (providerDone && !wechatDone) {
      setOpenSection((prev) => (prev === "ai" || prev === null ? "channels" : prev));
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
      const data = await res.json().catch(() => ({} as any));
      if (!res.ok) {
        setWechatStatus({ type: "error", message: data.error || "Failed to save" });
        return;
      }
      const connected = data.connected === true;
      setWechatDone(connected);
      setWechatStatus({
        type: "success",
        message: connected
          ? "WeChat bot settings saved and channel is connected."
          : "WeChat bot settings saved. Use QR login to complete channel connection.",
      });
    } catch (err) {
      setWechatStatus({
        type: "error",
        message: `Failed: ${err instanceof Error ? err.message : err}`,
      });
    } finally {
      setWechatSaving(false);
    }
  };

  const waitWechatConnected = async (maxMs = 90_000) => {
    const started = Date.now();
    while (Date.now() - started < maxMs) {
      try {
        const r = await fetch("/setup-api/wechat/login-status", { cache: "no-store" });
        if (r.ok) {
          const s = (await r.json().catch(() => null as any)) as { connected?: boolean; accountIds?: string[] } | null;
          if (s?.connected) {
            setWechatDone(true);
            await refreshWechatState().catch(() => {});
            setWechatStatus({
              type: "success",
              message: `WeChat connected${s.accountIds?.[0] ? ` (account: ${s.accountIds[0]})` : ""}.`,
            });
            return true;
          }
        }
      } catch {
        // keep waiting
      }
      await new Promise((r) => setTimeout(r, 2000));
    }
    return false;
  };

  const requestWechatQrCode = async () => {
    if (!canConfigureWechat) {
      setWechatStatus({
        type: "error",
        message: "Configure your AI provider before setting up WeChat.",
      });
      return;
    }

      // 如果已有连接，先提示用户
    if (wechatDone) {
      const confirm = window.confirm(
        "WeChat is already connected. Getting a new QR code will disconnect the existing connection. Continue?"
      );
      if (!confirm) return;
    }
  
  // ... 继续原有逻辑

    setWechatQrLoading(true);
    setWechatStatus(null);

    const applyQr = (qrUrl: string) => {
      setWechatQrUrl(qrUrl);
      setWechatLinkCopied(false);
      setWechatStatus({
        type: "success",
        message: "QR code refreshed. Please scan now, then click Check status.",
      });
    };

    try {
      const qrEndpoint = wechatQrUrl
        ? "/setup-api/wechat/qrcode?force=1&nowait=1"
        : "/setup-api/wechat/qrcode?nowait=1";
      const res = await fetch(qrEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const data = await res.json().catch(() => ({} as any));

      if (res.ok && data?.qrUrl) {
        applyQr(data.qrUrl);
        return;
      }

      if (!(res.status === 202 && data?.pending)) {
        setWechatStatus({ type: "error", message: data.error || "Failed to refresh QR code" });
        return;
      }

      setWechatStatus({
        type: "success",
        message: "Generating a fresh QR code… please wait a few seconds.",
      });

      const deadline = Date.now() + 75_000;
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 1500));
        const poll = await fetch("/setup-api/wechat/qrcode?nowait=1", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
        });
        const pd = await poll.json().catch(() => ({} as any));
        if (poll.ok && pd?.qrUrl) {
          applyQr(pd.qrUrl);
          return;
        }
      }

      setWechatStatus({
        type: "error",
        message: "Still generating QR code. Please click Refresh QR once more.",
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

  const openWechatMcpLink = () => {
    if (!wechatQrUrl) {
      setWechatStatus({ type: "error", message: "Please click Get QR first." });
      return;
    }
    setWechatStatus({
      type: "success",
      message: "Opening WeChat login link. After authorization, return to this page and click 'Check Status'.",
    });
    window.location.href = wechatQrUrl;
  };
  const copyWechatMcpLink = async () => {
    if (!wechatQrUrl) {
      setWechatStatus({ type: "error", message: "Please click Get QR first." });
      return;
    }

    const markCopied = () => {
      setWechatLinkCopied(true);
      setWechatStatus({
        type: "success",
        message: "Link copied. Open WeChat and paste the link in any chat, then tap it to authorize.",
      });
    };

    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(wechatQrUrl);
        markCopied();
        return;
      }

      const textarea = document.createElement("textarea");
      textarea.value = wechatQrUrl;
      textarea.setAttribute("readonly", "");
      textarea.style.position = "fixed";
      textarea.style.left = "-9999px";
      textarea.style.top = "0";
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();
      const copied = document.execCommand("copy");
      document.body.removeChild(textarea);

      if (copied) {
        markCopied();
        return;
      }

      throw new Error("execCommand-copy-failed");
    } catch {
      setWechatStatus({
        type: "error",
        message: "Copy failed in current webview. Use 'Open QR link' below, or manually select and copy the URL text box.",
      });
    }
  };

  const verifyWechatNow = async () => {
    setWechatStatus({ type: "success", message: "Checking WeChat connection status..." });
    const ok = await waitWechatConnected(12_000);
    if (!ok) {
      setWechatStatus({
        type: "error",
        message: "Not connected yet. Complete authorization in WeChat, then click Check Status again.",
      });
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
        {t("dashboard_recommended_order")}
      </div>

      {/* Primary actions */}
      <div className="grid grid-cols-2 gap-3 mb-6">
          <button
            type="button"
            onClick={setupComplete ? () => (window.location.href = "/dashboard") : completeSetup}
            disabled={finishButtonDisabled}
            className="py-3 btn-gradient text-white rounded-xl text-sm font-semibold transition transform cursor-pointer hover:scale-105 shadow-lg shadow-[rgba(249,115,22,0.25)] disabled:opacity-50 disabled:hover:scale-100 flex items-center justify-center gap-2"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10 10-4.5 10-10S17.5 2 12 2"/><path d="M8 12c0-2.2 1.8-4 4-4"/><path d="M16 12c0 2.2-1.8 4-4 4"/><circle cx="12" cy="12" r="1.5"/></svg>
            {finishing ? t("finishing") : setupComplete ? t("open_dashboard") : t("finish_setup")}
          </button>
          <button
            type="button"
            onClick={isUpdateRunning ? undefined : openUpdateConfirm}
            disabled={isUpdateRunning}
            className="py-3 bg-emerald-600 text-white rounded-xl text-sm font-semibold hover:bg-emerald-500 hover:scale-105 transition-all cursor-pointer disabled:opacity-50 disabled:hover:scale-100 flex items-center justify-center gap-2 shadow-lg shadow-emerald-600/25"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"/><path d="M16 16h5v5"/></svg>
            {isUpdateRunning ? t("updating") : t("system_update")}
          </button>
          <button
            type="button"
            onClick={() => setBetaConfirm(true)}
            disabled={isUpdateRunning}
            className="py-3 bg-purple-600 text-white rounded-xl text-sm font-semibold hover:bg-purple-500 hover:scale-105 transition-all cursor-pointer disabled:opacity-50 disabled:hover:scale-100 flex items-center justify-center gap-2 shadow-lg shadow-purple-600/25"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2v20"/><path d="m17 5-5-3-5 3"/><path d="m17 19-5 3-5-3"/><path d="M2 12h20"/></svg>
            {t("beta_update")}
          </button>
          <button
            type="button"
            onClick={() => setResetConfirm(true)}
            className="py-3 bg-red-500/10 text-red-400 rounded-xl text-sm font-semibold hover:bg-red-500/20 hover:scale-105 transition-all cursor-pointer flex items-center justify-center gap-2 border border-red-500/20"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
            {t("factory_reset")}
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
          title={t("ai_model_cloud")}
          done={providerDone}
          open={openSection === "ai"}
          onToggle={toggle}
        >
          <div>
            <label htmlFor="ai-provider-select" className={LABEL_CLASS}>
              {t("provider")}
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
                {t("subscription_oauth")}
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
                {t("api_key")}
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
                {t("api_key")}
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
                {t("get_api_key")}
              </a>
              <button
                type="button"
                onClick={saveAiProvider}
                disabled={aiSaving}
                className={`${SAVE_BUTTON_CLASS} flex items-center gap-2`}
              >
                {aiSaving && ButtonSpinner}
                {aiSaving ? t("saving") : t("save")}
              </button>
            </div>
          )}

          {aiStatus && <StatusMessage type={aiStatus.type} message={aiStatus.message} />}
        </CollapsibleSection>

        {/* Chat channels */}
        <CollapsibleSection
          id="channels"
          title={t("Chat channels")}
          done={chatChannelsDone}
          open={openSection === "channels"}
          onToggle={toggle}
        >
          <div className="overflow-hidden rounded-lg border border-gray-700 bg-[var(--bg-deep)]">
            <button
              type="button"
              onClick={() => setChannelPickerOpen((open) => !open)}
              aria-expanded={channelPickerOpen}
              aria-controls="chat-channel-picker"
              className="flex w-full min-w-0 items-center gap-3 px-3 py-3 text-left text-sm font-semibold text-[var(--text-primary)] transition-colors hover:bg-[var(--bg-surface)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--coral-bright)]"
            >
              <span className="inline-flex h-9 w-11 shrink-0 items-center justify-center rounded-md bg-[var(--coral-bright)]/20 text-xs font-bold text-[var(--coral-bright)]">
                {activeChatChannelMeta.tag}
              </span>
              <span className="min-w-0 flex-1 truncate">{t(activeChatChannelMeta.name)}</span>
              <Chevron open={channelPickerOpen} />
            </button>

            {channelPickerOpen && (
              <div id="chat-channel-picker" className="border-t border-gray-700/80">
                {CHAT_CHANNEL_META.map((channel, index) => {
                  const selected = channel.id === activeChatChannel;

                  return (
                    <button
                      key={channel.id}
                      type="button"
                      onClick={() => {
                        setActiveChatChannel(channel.id);
                        setChannelPickerOpen(false);
                      }}
                      aria-pressed={selected}
                      className={`flex w-full min-w-0 items-start gap-3 px-3 py-4 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--coral-bright)] ${
                        index > 0 ? "border-t border-gray-700/70" : ""
                      } ${
                        selected
                          ? "bg-[var(--coral-bright)]/10"
                          : "hover:bg-[var(--bg-surface)]"
                      }`}
                    >
                      <span className={`inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md text-xs font-bold ${
                        selected
                          ? "bg-[var(--coral-bright)] text-white"
                          : "bg-slate-900 text-[var(--text-secondary)]"
                      }`}>
                        {channel.tag}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-semibold text-[var(--text-primary)]">{t(channel.name)}</span>
                        <span className="mt-1 block break-words text-xs leading-relaxed text-[var(--text-muted)]">{t(channel.description)}</span>
                      </span>
                      <span
                        aria-hidden="true"
                        className={`mt-1 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border text-sm font-semibold ${
                          selected
                            ? "border-[var(--coral-bright)] bg-[var(--coral-bright)] text-white"
                            : "border-gray-600 text-transparent"
                        }`}
                      >
                        &#10003;
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {activeChatChannel === "wechat" && (
            <>
              <p className="text-xs leading-relaxed text-[var(--text-muted)]">{t("Sign in to a Tencent iLink bot with a QR code; direct messages only.")}</p>

              <div className="space-y-4">
          {!canConfigureWechat ? (
            <div className="rounded-lg border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-xs leading-relaxed text-amber-300">
              {t("wechat_requires_ai")}
            </div>
          ) : (
            <p className="text-xs text-[var(--text-muted)] leading-relaxed">
              {t("wechat_optional")}
            </p>
          )}
          <div className="flex items-center gap-2 mb-4">
            <span className="text-xs text-[var(--text-secondary)]">{t("enable_wechat")}</span>
            <label className={`relative inline-flex items-center ${canConfigureWechat ? "cursor-pointer" : "cursor-not-allowed opacity-60"}`}>
              <input type="checkbox" checked={wechatEnabled} onChange={(e) => setWechatEnabled(e.target.checked)} disabled={!canConfigureWechat} className="sr-only peer" />
              <div className="w-9 h-5 bg-[var(--bg-deep)] peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-[var(--coral-bright)] rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-[var(--coral-bright)]"></div>
            </label>
          </div>
          <p className="text-xs text-[var(--text-muted)] mb-3 leading-relaxed">
            {t("wechat_disable_note")}
          </p>
          <div className="rounded-lg border border-gray-700 bg-[var(--bg-surface)] p-3 space-y-3">
            <div className="flex flex-wrap items-center gap-2 justify-between">
              <div>
                <p className="text-xs font-semibold text-[var(--text-secondary)]">{t("qr_login_recommended")}</p>
                <p className="text-xs text-[var(--text-muted)] mt-1">{t("qr_refresh_help")}</p>
              </div>
              <button
                type="button"
                onClick={requestWechatQrCode}
                disabled={wechatQrLoading || !canConfigureWechat}
                className={`${SAVE_BUTTON_CLASS} flex items-center gap-2`}
              >
                {wechatQrLoading && ButtonSpinner}
                {wechatQrLoading ? t("refreshing") : wechatQrUrl ? t("refresh_qr") : t("get_qr")}
              </button>
            </div>

            {wechatQrUrl && (
              <div className="rounded-lg border border-gray-700/70 bg-[var(--bg-deep)] p-3 space-y-2">
                <div className="w-full flex justify-center">
                  <div className="bg-white p-2 rounded-md">
                    <QRCodeSVG value={wechatQrUrl} size={170} level="M" />
                  </div>
                </div>
                <div className="space-y-2">
                  <p className="text-[11px] text-[var(--text-muted)]">
                    {t("wechat_mcp_help")}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={openWechatMcpLink}
                      className="px-3 py-1.5 rounded-md text-[11px] font-semibold bg-[#00e5cc]/20 text-[#00e5cc] hover:bg-[#00e5cc]/30"
                    >
                      {t("open_in_wechat")}
                    </button>
                    <button
                      type="button"
                      onClick={copyWechatMcpLink}
                      className="px-3 py-1.5 rounded-md text-[11px] font-semibold bg-gray-700 text-gray-200 hover:bg-gray-600"
                    >
                      {wechatLinkCopied ? t("copied") : t("copy_link")}
                    </button>
                    <button
                      type="button"
                      onClick={verifyWechatNow}
                      className="px-3 py-1.5 rounded-md text-[11px] font-semibold bg-[var(--coral-bright)]/20 text-[var(--coral-bright)] hover:bg-[var(--coral-bright)]/30"
                    >
                      {t("check_status")}
                    </button>
                  </div>
                  <div className="space-y-1.5">
                    <p className="text-[11px] text-[var(--text-muted)]">
                      {t("wechat_auth_url")}:
                    </p>
                    <input
                      type="text"
                      readOnly
                      value={wechatQrUrl}
                      onFocus={(e) => e.currentTarget.select()}
                      className="w-full px-2.5 py-1.5 text-[11px] rounded border border-gray-700 bg-[var(--bg-deep)] text-gray-200"
                    />
                    <p className="text-[11px] text-[var(--text-muted)] break-all">
                      {t("qr_manual_fallback")}
                      <a href={wechatQrUrl} target="_blank" rel="noopener noreferrer" className="ml-1 text-[#00e5cc] underline">{t("open_qr_link")}</a>
                    </p>
                  </div>
                </div>
              </div>
            )}
          </div>

          <div>
            <label htmlFor="wechat-token" className={LABEL_CLASS}>{t("bot_token_fallback")}</label>
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
            {t("token_fallback_help")}
          </p>
          {wechatStatus && <StatusMessage type={wechatStatus.type} message={wechatStatus.message} />}
          <button type="button" onClick={saveWechat} disabled={wechatSaving || !canConfigureWechat} className={`${SAVE_BUTTON_CLASS} flex items-center gap-2`}>{wechatSaving && ButtonSpinner}{wechatSaving ? t("saving") : t("save")}</button>
          </div>

            </>
          )}

        {CONFIGURABLE_CHAT_CHANNELS.filter((channelId) => channelId === activeChatChannel).map((channelId) => {
          const channel = CHAT_CHANNEL_META.find((item) => item.id === channelId)!;
          const fields = CHANNEL_FIELDS[channelId] || [];
          const enabled = channelConfigs[channelId]?.enabled !== false;
          const runtimeStatus = channelRuntimeStatuses[channelId];

          return (
            <div key={channelId} className="space-y-4">
              <p className="text-xs leading-relaxed text-[var(--text-muted)]">{t(channel.description)}</p>

              {!canConfigureWechat && (
                <div className="rounded-lg border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-xs leading-relaxed text-amber-300">
                  {t("Configure an AI provider before setting up chat channels.")}
                </div>
              )}

              <div className="flex items-center justify-between gap-3">
                <span className="text-xs font-semibold text-[var(--text-secondary)]">{t("Enable this channel")}</span>
                <label className={`relative inline-flex shrink-0 items-center ${canConfigureWechat ? "cursor-pointer" : "cursor-not-allowed opacity-60"}`}>
                  <input
                    type="checkbox"
                    checked={enabled}
                    onChange={(event) => updateChannelField(channelId, "enabled", event.target.checked)}
                    disabled={!canConfigureWechat}
                    className="sr-only peer"
                  />
                  <div className="w-9 h-5 rounded-full bg-[var(--bg-deep)] peer-focus:ring-2 peer-focus:ring-[var(--coral-bright)] peer-checked:bg-[var(--coral-bright)] peer-checked:after:translate-x-full after:absolute after:left-[2px] after:top-[2px] after:h-4 after:w-4 after:rounded-full after:bg-white after:transition-all" />
                </label>
              </div>

              {channelId === "whatsapp" ? (
                <>
                  <ChannelCredentialGuide channel="whatsapp" />
                  <div>
                    <p className={LABEL_CLASS}>{t("WhatsApp account mode")}</p>
                    <div className="grid grid-cols-2 gap-2 rounded-lg bg-[var(--bg-deep)] p-1">
                      <button type="button" onClick={() => setWhatsappMode("dedicated")} className={`rounded-md px-3 py-2 text-xs font-semibold ${whatsappMode === "dedicated" ? "bg-[var(--coral-bright)] text-white" : "text-[var(--text-muted)]"}`}>{t("Dedicated account")}</button>
                      <button type="button" onClick={() => setWhatsappMode("personal")} className={`rounded-md px-3 py-2 text-xs font-semibold ${whatsappMode === "personal" ? "bg-[var(--coral-bright)] text-white" : "text-[var(--text-muted)]"}`}>{t("Personal account")}</button>
                    </div>
                    <p className="mt-1.5 text-[11px] leading-relaxed text-[var(--text-muted)]">{t("Use a dedicated account for a shared assistant. A personal account can be linked for private use.")}</p>
                  </div>
                  <div>
                    <label htmlFor="whatsapp-owner-number" className={LABEL_CLASS}>{t("Owner phone number (optional)")}</label>
                    <input id="whatsapp-owner-number" value={whatsappOwnerNumber} onChange={(event) => setWhatsappOwnerNumber(event.target.value)} placeholder="+8613800000000" inputMode="tel" autoComplete="tel" disabled={!canConfigureWechat} className={INPUT_CLASS} />
                  </div>
                  {whatsappQrDataUrl && (
                    <div className="rounded-lg border border-gray-700 bg-[var(--bg-deep)] p-4">
                      <img src={whatsappQrDataUrl} alt={t("WhatsApp linking QR code")} className="mx-auto aspect-square w-full max-w-[220px] rounded-md bg-white p-2" />
                      <p className="mt-3 text-center text-xs leading-relaxed text-[var(--text-muted)]">{t("Open WhatsApp on your phone, choose Linked devices, then scan this QR code.")}</p>
                    </div>
                  )}
                  <ChannelStatusSummary channel="whatsapp" status={runtimeStatus} />
                  {channelStatuses.whatsapp && <StatusMessage type={channelStatuses.whatsapp.type} message={channelStatuses.whatsapp.message} />}
                  <div className="flex flex-wrap gap-2">
                    <button type="button" onClick={prepareWhatsApp} disabled={!canConfigureWechat || channelSaving === "whatsapp" || whatsappQrLoading} className={`${SAVE_BUTTON_CLASS} flex items-center gap-2`}>{(channelSaving === "whatsapp" || whatsappQrLoading) && ButtonSpinner}{channelSaving === "whatsapp" || whatsappQrLoading ? t("Preparing...") : enabled ? t("Prepare and show QR code") : t("Save disabled state")}</button>
                    {whatsappQrDataUrl && <button type="button" onClick={() => requestWhatsAppQr(true)} disabled={whatsappQrLoading} className="px-4 py-2.5 rounded-lg border border-gray-600 text-sm font-semibold text-[var(--text-secondary)] hover:border-[var(--coral-bright)] hover:text-[var(--text-primary)] disabled:opacity-50">{t("Refresh QR code")}</button>}
                    <button type="button" onClick={() => void refreshChannelRuntimeStatus("whatsapp")} className="px-4 py-2.5 rounded-lg border border-gray-600 text-sm font-semibold text-[var(--text-secondary)] hover:border-[var(--coral-bright)] hover:text-[var(--text-primary)]">{t("Check status")}</button>
                  </div>
                </>
              ) : (
                <>
                  <ChannelCredentialGuide channel={channelId} />
                  {channelId === "feishu" && (
                    <div>
                      <p className={LABEL_CLASS}>{t("Platform")}</p>
                      <div className="grid grid-cols-2 gap-2 rounded-lg bg-[var(--bg-deep)] p-1">
                        <button type="button" onClick={() => setFeishuDomain("feishu")} className={`rounded-md px-3 py-2 text-xs font-semibold ${feishuDomain === "feishu" ? "bg-[var(--coral-bright)] text-white" : "text-[var(--text-muted)]"}`}>{t("Feishu")}</button>
                        <button type="button" onClick={() => setFeishuDomain("lark")} className={`rounded-md px-3 py-2 text-xs font-semibold ${feishuDomain === "lark" ? "bg-[var(--coral-bright)] text-white" : "text-[var(--text-muted)]"}`}>{t("Lark")}</button>
                      </div>
                    </div>
                  )}
                  {fields.map((field) => (
                    <div key={field.key}>
                      <label className={LABEL_CLASS}>{t(field.label)}</label>
                      <input type={field.secret ? "password" : "text"} value={String(channelConfigs[channelId]?.[field.key] || "")} onChange={(event) => updateChannelField(channelId, field.key, event.target.value)} placeholder={field.placeholder} autoComplete="off" spellCheck={false} disabled={!canConfigureWechat} className={INPUT_CLASS} />
                    </div>
                  ))}
                  {channelId === "line" && (
                    runtimeStatus?.publicWebhookUrl ? (
                      <div className="rounded-lg border border-gray-700 bg-[var(--bg-deep)] p-3">
                        <p className="text-xs font-semibold text-[var(--text-secondary)]">{t("Webhook URL to paste into LINE")}</p>
                        <code className="mt-2 block break-all rounded-md bg-black/20 px-2.5 py-2 text-[11px] text-[#00e5cc]">{runtimeStatus.publicWebhookUrl}</code>
                      </div>
                    ) : (
                      <div className="rounded-lg border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-xs leading-relaxed text-amber-300">{t("Save a public HTTPS base URL to generate the webhook URL for LINE Developers Console.")}</div>
                    )
                  )}
                  <ChannelStatusSummary channel={channelId} status={runtimeStatus} />
                  {channelStatuses[channelId] && <StatusMessage type={channelStatuses[channelId].type} message={channelStatuses[channelId].message} />}
                  <div className="flex flex-wrap gap-2">
                    <button type="button" onClick={() => saveChatChannel(channelId)} disabled={!canConfigureWechat || channelSaving === channelId} className={`${SAVE_BUTTON_CLASS} flex items-center gap-2`}>{channelSaving === channelId && ButtonSpinner}{channelSaving === channelId ? t("Saving...") : channelId === "line" ? t("Save and validate") : t("Save and connect")}</button>
                    <button type="button" onClick={() => void refreshChannelRuntimeStatus(channelId)} className="px-4 py-2.5 rounded-lg border border-gray-600 text-sm font-semibold text-[var(--text-secondary)] hover:border-[var(--coral-bright)] hover:text-[var(--text-primary)]">{t("Check status")}</button>
                  </div>
                </>
              )}
            </div>
          );
        })}
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
              {t("currently_connected")}: <strong>{wifiConnectedSSID}</strong>
            </p>
          )}
          <div className="flex justify-end mb-2">
            <button
              type="button"
              onClick={scanWifiNetworks}
              disabled={wifiScanning}
              className="text-xs text-[var(--coral-bright)] hover:underline cursor-pointer disabled:opacity-50"
            >
              {wifiScanning ? t("scanning") : t("scan_networks")}
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
            {t("network_name")}
          </label>
          <input
            id="wifi-ssid-dash"
            type="text"
            value={wifiSSID}
            onChange={(e) => setWifiSSID(e.target.value)}
            className={INPUT_CLASS}
            placeholder={t("wifi_name")}
            autoComplete="off"
          />
          <label htmlFor="wifi-pass-dash" className={LABEL_CLASS}>
            {t("password")}
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
            {t("wifi_reconnect_note")}
          </p>
          <p className="text-xs mt-2">
            <a href="/setup/wifi" className="text-[#00e5cc] underline">
              {t("open_wifi_setup")}
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
            {wifiConnecting ? t("connecting") : t("connect")}
          </button>
        </CollapsibleSection>

        {/* Security & Hotspot */}
        <CollapsibleSection id="security" title={t("security_hotspot")} done={securityDone} open={openSection === "security"} onToggle={toggle}>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="password" className={LABEL_CLASS}>{t("set_password")}</label>
              <PasswordInput
                id="password"
                value={password}
                onChange={setPassword}
                visible={showPassword}
                onToggle={() => setShowPassword((v) => !v)}
                placeholder={t("min_8_chars")}
              />
            </div>
            <div>
              <label htmlFor="confirm" className={LABEL_CLASS}>{t("confirm_password")}</label>
              <PasswordInput
                id="confirm"
                value={confirmPassword}
                onChange={setConfirmPassword}
                visible={showConfirm}
                onToggle={() => setShowConfirm((v) => !v)}
                placeholder={t("confirm_password")}
              />
            </div>
          </div>
          <div>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={hotspotEnabled} onChange={(e) => setHotspotEnabled(e.target.checked)} className="w-4 h-4 rounded border-gray-600 bg-[var(--bg-deep)] text-[var(--coral-bright)] focus:ring-[var(--coral-bright)] cursor-pointer" />
              <span className="text-sm text-[var(--text-primary)]">{t("enable_setup_hotspot")}</span>
            </label>
          </div>
          {hotspotEnabled && (
            <>
              <div>
                <label htmlFor="hotspot-name" className={LABEL_CLASS}>{t("hotspot_name")}</label>
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
                <label htmlFor="hotspot-password" className={LABEL_CLASS}>{t("hotspot_password_optional")}</label>
                <PasswordInput
                  id="hotspot-password"
                  value={hotspotPassword}
                  onChange={setHotspotPassword}
                  visible={showHotspotPassword}
                  onToggle={() => setShowHotspotPassword((v) => !v)}
                  placeholder={t("leave_empty_open")}
                />
              </div>
            </>
          )}
          {secStatus && <StatusMessage type={secStatus.type} message={secStatus.message} />}
          <button type="button" onClick={saveSecurity} disabled={secSaving} className={`${SAVE_BUTTON_CLASS} flex items-center gap-2`}>{secSaving && ButtonSpinner}{secSaving ? t("saving") : t("save")}</button>
        </CollapsibleSection>

        {/* System Info Widgets — 2 rows × 3 items */}
        {info && (
          <div className="space-y-3">
            <div className="card-surface rounded-xl p-4">
              <p className={WIDGET_LABEL_CLASS}>{t("access")}</p>
              <p className="text-sm font-semibold text-gray-100 break-all">{info.accessUrl}</p>
              <p className="text-xs text-[var(--text-secondary)] mt-2">
                {t("ipv4_fallback")}: <span className="font-medium text-gray-200">{info.networkIp}</span>
              </p>
              {info.localDnsAlias && (
                <p className="text-xs text-[var(--text-secondary)] mt-1">
                  {t("optional_dns_alias")}: <span className="font-medium text-gray-200">{info.localDnsAlias}</span>
                </p>
              )}
            </div>
            <div className="grid grid-cols-3 gap-3">
              {/* Row 1 */}
              <SystemInfoWidget
                label="CPU"
                detail={`${info.cpus} ${t("cores")}`}
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
                label={t("memory")}
                detail={`${info.memoryFree} ${t("free")}`}
                value={String(info.memoryUsedPercent)}
                unit="%"
                bar={{ percent: info.memoryUsedPercent, color: thresholdColor(info.memoryUsedPercent, 60, 85) }}
              />
              {/* Row 2 */}
              <SystemInfoWidget
                label={t("storage")}
                detail={`${info.diskFree} ${t("free")}`}
                value={String(info.diskUsedPercent)}
                unit="%"
                bar={{ percent: info.diskUsedPercent, color: thresholdColor(info.diskUsedPercent, 70, 90) }}
              />
              <SystemInfoWidget
                label={t("temperature")}
                value={info.temperature}
                bar={info.temperatureValue != null ? {
                  percent: Math.min(100, (info.temperatureValue / 85) * 100),
                  color: thresholdColor(info.temperatureValue, 55, 75),
                } : undefined}
              />
              <SparklineWidget
                label={t("cpu_timeline")}
                currentValue={statsHistory.length >= 1 ? `${statsHistory[statsHistory.length - 1].cpu}%` : "—"}
                data={statsHistory.map((s) => s.cpu)}
                color="#f97316"
              />
            </div>
          </div>
        )}
        {!info && !loadError && (
          <div className="flex items-center justify-center gap-2.5 py-4 text-[var(--text-secondary)] text-sm">
            <div className="spinner" /> {t("loading_system_info")}
          </div>
        )}
      </div>
    </div>
  );
}

