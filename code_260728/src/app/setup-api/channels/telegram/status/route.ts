import { NextResponse } from "next/server";
import { setMany } from "@/lib/config-store";
import { probeTelegramChannel } from "@/lib/channels/telegram";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const status = await probeTelegramChannel();
    if (status.connected || status.state === "disabled" || status.state === "not_configured") {
      await setMany({ telegram_last_error: undefined }).catch(() => {});
    }
    return NextResponse.json(status);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to check Telegram status.";
    await setMany({ telegram_last_error: message }).catch(() => {});
    return NextResponse.json(
      {
        state: "error",
        configured: true,
        enabled: true,
        connected: false,
        running: false,
        probeOk: false,
        botId: null,
        botUsername: null,
        lastError: message,
      },
      { status: 502 },
    );
  }
}
