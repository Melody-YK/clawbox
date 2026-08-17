import { NextResponse } from "next/server";
import { getAll, setMany } from "@/lib/config-store";
import { getDiscordConfig, getDiscordProxyFromConfig, getDiscordTokenFromConfig, restartDiscordGateway, saveDiscordConfig, validateDiscordBotToken } from "@/lib/channels/discord";
import { readConfig } from "@/lib/openclaw-config";
import { resolveChannelProxyUpdate } from "@/lib/channels/proxy";

export const dynamic = "force-dynamic";
const message = (error: unknown, fallback: string) => error instanceof Error ? error.message : fallback;
const status = (error: unknown) => error && typeof error === "object" && "code" in error && (error.code === "invalid_token" || error.code === "invalid_id" || error.code === "invalid_proxy") ? 400 : 502;

export async function GET() {
  try { return NextResponse.json({ ...(await getDiscordConfig()), lastError: null }); }
  catch (error) { return NextResponse.json({ error: message(error, "Failed to read Discord config.") }, { status: 500 }); }
}

export async function POST(request: Request) {
  const setup = await getAll();
  if (!setup.ai_model_configured) return NextResponse.json({ error: "Configure your AI provider before setting up Discord." }, { status: 409 });
  let body: { token?: unknown; serverId?: unknown; userId?: unknown; enabled?: unknown; proxy?: unknown; removeProxy?: unknown };
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  if (body.enabled !== undefined && typeof body.enabled !== "boolean") return NextResponse.json({ error: "enabled must be a boolean" }, { status: 400 });
  for (const [key, value] of [["token", body.token], ["serverId", body.serverId], ["userId", body.userId], ["proxy", body.proxy]] as const) if (value !== undefined && typeof value !== "string") return NextResponse.json({ error: `${key} must be a string` }, { status: 400 });
  if (body.removeProxy !== undefined && typeof body.removeProxy !== "boolean") return NextResponse.json({ error: "removeProxy must be a boolean" }, { status: 400 });
  const incomingToken = typeof body.token === "string" && body.token.trim() ? body.token.trim() : undefined;
  const incomingProxy = typeof body.proxy === "string" && body.proxy.trim() ? body.proxy.trim() : undefined;
  const storedConfig = await readConfig();
  const existingToken = getDiscordTokenFromConfig(storedConfig);
  let effectiveProxy: string | null;
  try { effectiveProxy = resolveChannelProxyUpdate(getDiscordProxyFromConfig(storedConfig), { proxy: incomingProxy, removeProxy: body.removeProxy === true }); }
  catch (error) { return NextResponse.json({ error: message(error, "Invalid proxy URL."), saved: false }, { status: 400 }); }
  const enabled = body.enabled !== false;
  if (enabled && !incomingToken && !existingToken) return NextResponse.json({ error: "Discord Bot Token is required." }, { status: 400 });
  let bot = null;
  try { bot = await validateDiscordBotToken(incomingToken || existingToken || "", fetch, effectiveProxy); }
  catch (error) { const errorText = message(error, "Discord Bot Token validation failed."); await setMany({ discord_last_error: errorText }).catch(() => {}); return NextResponse.json({ error: errorText, saved: false }, { status: status(error) }); }
  try {
    const config = await saveDiscordConfig({ token: incomingToken, serverId: typeof body.serverId === "string" && body.serverId.trim() ? body.serverId : undefined, userId: typeof body.userId === "string" && body.userId.trim() ? body.userId : undefined, enabled, proxy: incomingProxy, removeProxy: body.removeProxy === true });
    await restartDiscordGateway();
    await setMany({ discord_last_error: undefined }).catch(() => {});
    return NextResponse.json({ success: true, saved: true, bot, ...config, connected: false, state: enabled ? "configured" : "disabled" });
  } catch (error) { const errorText = message(error, "Failed to save Discord config."); await setMany({ discord_last_error: errorText }).catch(() => {}); return NextResponse.json({ error: errorText, saved: false }, { status: status(error) }); }
}
