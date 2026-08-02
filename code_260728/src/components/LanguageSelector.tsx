"use client";

import { useState, useEffect } from "react";
import { i18n, LocaleCode } from "@/i18n.config";

export default function LanguageSelector() {
  const [isOpen, setIsOpen] = useState(false);
  const [currentLocale, setCurrentLocale] = useState<LocaleCode>("en");

  useEffect(() => {
    const storedLocale = localStorage.getItem("locale") as LocaleCode | null;
    if (storedLocale && i18n.locales.some((l) => l.code === storedLocale)) {
      setCurrentLocale(storedLocale);
    } else {
      const browserLocale = navigator.language;
      const matchedLocale = i18n.locales.find(
        (l) =>
          l.code === browserLocale || l.code.startsWith(browserLocale.split("-")[0])
      );
      if (matchedLocale) {
        setCurrentLocale(matchedLocale.code);
        document.documentElement.lang = matchedLocale.code;
        document.documentElement.dir = ["ar", "fa"].includes(matchedLocale.code) ? "rtl" : "ltr";
      }
    }
  }, []);

  useEffect(() => {
    document.documentElement.lang = currentLocale;
    document.documentElement.dir = ["ar", "fa"].includes(currentLocale) ? "rtl" : "ltr";
  }, [currentLocale]);

  const handleLocaleChange = (locale: LocaleCode) => {
    setCurrentLocale(locale);
    localStorage.setItem("locale", locale);
    setIsOpen(false);
    window.location.reload();
  };

  const currentLocaleData = i18n.locales.find((l) => l.code === currentLocale);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] hover:border-[var(--border-accent)] transition-all duration-200 cursor-pointer"
        aria-haspopup="true"
        aria-expanded={isOpen}
      >
        <span className="text-xs font-semibold text-[var(--text-secondary)] uppercase">
          {currentLocaleData?.flag}
        </span>
        <span className="text-sm font-medium text-[var(--text-primary)]">
          {currentLocaleData?.name}
        </span>
        <svg
          className={`w-4 h-4 text-[var(--text-secondary)] transition-transform duration-200 ${
            isOpen ? "rotate-180" : ""
          }`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M19 9l-7 7-7-7"
          />
        </svg>
      </button>

      {isOpen && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setIsOpen(false)}
          />
          <div className="absolute top-full right-0 mt-2 flex w-56 max-h-80 origin-top flex-col overflow-y-auto rounded-xl bg-[var(--bg-elevated)] border border-[var(--border-subtle)] shadow-lg z-50">
            {i18n.locales.map((locale) => (
              <button
                key={locale.code}
                type="button"
                onClick={() => handleLocaleChange(locale.code)}
                className={`w-full px-4 py-2.5 text-left flex items-center gap-3 transition-colors duration-150 cursor-pointer ${
                  currentLocale === locale.code
                    ? "bg-[var(--coral-bright)]/10 text-[var(--text-primary)]"
                    : "text-[var(--text-secondary)] hover:bg-[var(--bg-surface)]"
                }`}
              >
                <span
                  className={`text-xs font-semibold uppercase w-6 ${
                    currentLocale === locale.code
                      ? "text-[var(--coral-bright)]"
                      : "text-[var(--text-muted)]"
                  }`}
                >
                  {locale.flag}
                </span>
                <span className="text-sm">{locale.name}</span>
                {currentLocale === locale.code && (
                  <svg
                    className="w-4 h-4 text-[var(--coral-bright)] ml-auto"
                    fill="currentColor"
                    viewBox="0 0 20 20"
                  >
                    <path
                      fillRule="evenodd"
                      d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                      clipRule="evenodd"
                    />
                  </svg>
                )}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
