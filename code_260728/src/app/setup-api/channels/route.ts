import { NextResponse } from "next/server";
import { getAll, setMany } from "@/lib/config-store";
import {
  MANAGED_CHANNELS,
  getChannelsConfig,
  setChannelConfig,
  type ManagedChannel,
} from "@/lib/channels-config";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const channels = await getChannelsConfig();
    return NextResponse.json({ channels });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to get channel config" },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  // 与微信路由一致：必须先配好 AI provider
  const config = await getAll();
  if (!config.ai_model_configured) {
    return NextResponse.json(
      { error: "Configure your AI provider before setting up chat channels." },
      { status: 409 },
    );
  }

  let body: { channel?: unknown; config?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const channel = body.channel as ManagedChannel;
  if (typeof channel !== "string" || !(MANAGED_CHANNELS as readonly string[]).includes(channel)) {
    return NextResponse.json(
      { error: `Unknown channel. Allowed: ${MANAGED_CHANNELS.join(", ")}` },
      { status: 400 },
    );
  }
  if (!body.config || typeof body.config !== "object" || Array.isArray(body.config)) {
    return NextResponse.json({ error: "Missing config object" }, { status: 400 });
  }
  const incoming = body.config as Record<string, unknown>;

  try {
    // 飞书 App 模式必填校验（QR 模式不需要 appId/appSecret）
    if (channel === "feishu" && incoming.enabled !== false && incoming.connectionMode !== "qr") {
      const existingChannels: Record<string, Record<string, any>> = await getChannelsConfig()
        .catch(() => ({}) as Record<string, Record<string, any>>);
      const existing = existingChannels["feishu"] ?? {};
      const hasAppId =
        (typeof incoming.appId === "string" && incoming.appId.trim().length > 0) ||
        typeof existing.appId === "string";
      const hasAppSecret =
        (typeof incoming.appSecret === "string" && incoming.appSecret.trim().length > 0) ||
        existing.has_appSecret === true;
      if (!hasAppId) {
        return NextResponse.json({ error: "Feishu App ID is required" }, { status: 400 });
      }
      if (!hasAppSecret) {
        return NextResponse.json({ error: "Feishu App Secret is required" }, { status: 400 });
      }
    }

    const merged = await setChannelConfig(channel, incoming);
    await setMany({ channels_last_error: undefined }).catch(() => {}); // ⚠️ 见说明第 3 条

    return NextResponse.json({
      success: true,
      message: `${channel} config updated, gateway restarted`,
      channel,
      config: merged, // ⚠️ 这里含密钥，见说明第 4 条
    });
  } catch (err) {
    const message =
      err instanceof Error
        ? err.message
        : "Failed to save or restart gateway after channel update";
    await setMany({ channels_last_error: message }).catch(() => {}); // ⚠️ 见说明第 3 条
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
