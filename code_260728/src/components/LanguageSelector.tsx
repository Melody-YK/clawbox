"use client";

import { useI18n } from "./I18nProvider";
import type { Locale } from "@/lib/i18n";

const OPTIONS: readonly { locale: Locale; label: string }[] = [
  { locale: "en", label: "EN" },
  { locale: "zh-CN", label: "中文" },
];

export default function LanguageSelector() {
  const { locale, setLocale, t } = useI18n();

  return (
    <div
      className="flex h-9 shrink-0 items-center rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-0.5"
      role="group"
      aria-label={t("Change language")}
    >
      {OPTIONS.map((option) => (
        <button
          key={option.locale}
          type="button"
          onClick={() => setLocale(option.locale)}
          aria-pressed={locale === option.locale}
          className={`h-8 min-w-10 rounded-md px-2 text-xs font-semibold transition-colors ${
            locale === option.locale
              ? "bg-[var(--coral-bright)] text-white"
              : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
