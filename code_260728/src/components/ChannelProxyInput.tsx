"use client";

import type { MessageKey } from "@/lib/i18n";

const INPUT_CLASS =
  "w-full min-w-0 rounded-lg border border-gray-600 bg-[var(--bg-deep)] px-3.5 py-2.5 text-sm text-gray-200 outline-none transition-colors placeholder-gray-500 focus:border-[var(--coral-bright)] disabled:cursor-not-allowed disabled:opacity-60";

interface ChannelProxyInputProps {
  id: string;
  enabled: boolean;
  hasSavedProxy: boolean;
  value: string;
  disabled?: boolean;
  t: (key: MessageKey) => string;
  onEnabledChange: (enabled: boolean) => void;
  onValueChange: (value: string) => void;
}

export default function ChannelProxyInput({
  id,
  enabled,
  hasSavedProxy,
  value,
  disabled = false,
  t,
  onEnabledChange,
  onValueChange,
}: ChannelProxyInputProps) {
  const helpId = `${id}-proxy-help`;

  return (
    <div className="space-y-3 border-t border-[var(--border-subtle)] pt-3">
      <div className="flex items-center justify-between gap-3">
        <label htmlFor={`${id}-proxy-enabled`} className="text-xs font-semibold text-[var(--text-secondary)]">
          {t("Use a proxy for this channel")}
        </label>
        <label className={`relative inline-flex shrink-0 items-center ${disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer"}`}>
          <input
            id={`${id}-proxy-enabled`}
            type="checkbox"
            checked={enabled}
            onChange={(event) => onEnabledChange(event.target.checked)}
            disabled={disabled}
            className="peer sr-only"
          />
          <span className="h-5 w-9 rounded-full bg-[var(--bg-deep)] peer-checked:bg-[var(--coral-bright)] peer-focus-visible:ring-2 peer-focus-visible:ring-[var(--coral-bright)] peer-checked:after:translate-x-full after:absolute after:left-[2px] after:top-[2px] after:h-4 after:w-4 after:rounded-full after:bg-white after:transition-all" />
        </label>
      </div>

      {enabled && (
        <div>
          <label htmlFor={`${id}-proxy-url`} className="mb-1.5 block text-xs font-semibold text-[var(--text-secondary)]">
            {t("Proxy address")}
          </label>
          <input
            id={`${id}-proxy-url`}
            type="url"
            value={value}
            onChange={(event) => onValueChange(event.target.value)}
            placeholder="http://192.168.1.4:7890"
            aria-describedby={helpId}
            autoComplete="off"
            spellCheck={false}
            disabled={disabled}
            className={INPUT_CLASS}
          />
          <p id={helpId} className="mt-1.5 text-[11px] leading-relaxed text-[var(--text-muted)]">
            {hasSavedProxy && !value.trim()
              ? t("A proxy is already saved. Leave this field empty to keep it unchanged")
              : t("HTTP or HTTPS proxy URL")}
          </p>
        </div>
      )}

      {!enabled && hasSavedProxy && (
        <p className="text-[11px] leading-relaxed text-amber-300">
          {t("The saved proxy will be removed when you save")}
        </p>
      )}
    </div>
  );
}
