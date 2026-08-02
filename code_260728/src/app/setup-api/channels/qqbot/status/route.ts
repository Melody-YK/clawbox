import { NextResponse } from "next/server";
import { setMany } from "@/lib/config-store";
import { probeQQBotChannel } from "@/lib/channels/qqbot";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const status = await probeQQBotChannel();
    if (
      status.connected ||
      status.state === "disabled" ||
      status.state === "not_configured"
    ) {
      await setMany({ qqbot_last_error: undefined }).catch(() => {});
    }
    return NextResponse.json(status);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to check QQ Bot status.";
    await setMany({ qqbot_last_error: message }).catch(() => {});
    return NextResponse.json(
      {
        state: "error",
        configured: true,
        enabled: true,
        hasClientSecret: true,
        appId: null,
        connected: false,
        running: false,
        lastError: message,
      },
      { status: 502 },
    );
  }
}
