import { NextResponse } from "next/server";
import { setMany } from "@/lib/config-store";
import { probeFeishuChannel } from "@/lib/channels/feishu";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const status = await probeFeishuChannel();
    if (status.connected || status.state === "disabled" || status.state === "not_configured") await setMany({ feishu_last_error: undefined }).catch(() => {});
    return NextResponse.json(status);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to check Feishu status.";
    await setMany({ feishu_last_error: message }).catch(() => {});
    return NextResponse.json({ state: "error", configured: true, enabled: true, connected: false, running: false, probeOk: false, botName: null, botOpenId: null, lastError: message }, { status: 502 });
  }
}
