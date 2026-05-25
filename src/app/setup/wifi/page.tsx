"use client";

import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import WifiStep from "@/components/WifiStep";

export default function WifiSetupPage() {
  const router = useRouter();
  return (
    <>
      <header className="px-4 py-2.5 sm:px-6 sm:py-4 flex items-center justify-between gap-3 sticky top-0 z-50">
        <Link href="/setup" className="flex items-center gap-2 shrink-0">
          <Image
            src="/clawbox-icon.png"
            alt="ClawBox"
            width={36}
            height={36}
            className="w-9 h-9 object-contain"
            priority
          />
          <span className="text-xl font-bold font-display title-gradient">WiFi Setup</span>
        </Link>
      </header>
      <main className="flex-1 flex flex-col items-center justify-start sm:justify-center px-4 pt-2 pb-4 sm:p-6">
        <WifiStep skipCompleteOnConnect onNext={() => router.push("/setup")} />
      </main>
    </>
  );
}
