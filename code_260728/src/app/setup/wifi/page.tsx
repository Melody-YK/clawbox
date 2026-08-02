"use client";

import Link from "next/link";
import Image from "next/image";
import WifiStep from "@/components/WifiStep";
import LanguageSelector from "@/components/LanguageSelector";

export default function WifiSetupPage() {
  return (
    <>
      <header className="sticky top-0 z-50 mx-auto mt-3 flex w-[calc(100%-1.5rem)] max-w-6xl items-center justify-between gap-3 rounded-2xl border border-white/10 bg-[#111827]/80 px-3 py-2.5 shadow-2xl shadow-black/20 backdrop-blur-xl sm:px-5">
        <Link href="/setup" className="flex items-center gap-2 shrink-0">
          <Image
            src="/headless-claw-box.png"
            alt="ClawBox"
            width={36}
            height={36}
            className="h-11 w-11 rounded-xl border border-white/10 object-cover shadow-lg shadow-orange-950/30"
            priority
          />
          <span className="text-xl font-bold font-display title-gradient">WiFi Setup</span>
        </Link>
        <LanguageSelector />
      </header>
      <main className="relative z-10 flex flex-1 flex-col items-center justify-start px-4 pb-8 pt-8 sm:justify-center sm:p-8">
        <WifiStep />
      </main>
    </>
  );
}
