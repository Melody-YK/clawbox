import { NextResponse } from "next/server";
import { getAll, setMany } from "@/lib/config-store";
import { getZaloBotToken, getZaloConfig, getZaloProxy, restartZaloGateway, saveZaloConfig, validateZaloBotToken } from "@/lib/channels/zalo";
import { resolveChannelProxyUpdate } from "@/lib/channels/proxy";
export const dynamic = "force-dynamic";
const msg = (e: unknown, f: string) => e instanceof Error ? e.message : f;
const codeStatus = (e: unknown) => e && typeof e === "object" && "code" in e && (e.code === "invalid_token" || e.code === "invalid_proxy") ? 400 : 502;
export async function GET() { try { return NextResponse.json({ ...(await getZaloConfig()), lastError: null }); } catch (e) { return NextResponse.json({ error: msg(e, "Failed to read Zalo config.") }, { status: 500 }); } }
export async function POST(request: Request) {
  const setup = await getAll(); if (!setup.ai_model_configured) return NextResponse.json({ error: "Configure your AI provider before setting up Zalo Bot." }, { status: 409 });
  let body: { botToken?: unknown; enabled?: unknown; proxy?: unknown; removeProxy?: unknown }; try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  if (body.enabled !== undefined && typeof body.enabled !== "boolean") return NextResponse.json({ error: "enabled must be a boolean" }, { status: 400 });
  if (body.botToken !== undefined && typeof body.botToken !== "string") return NextResponse.json({ error: "botToken must be a string" }, { status: 400 });
  if (body.proxy !== undefined && typeof body.proxy !== "string") return NextResponse.json({ error: "proxy must be a string" }, { status: 400 });
  if (body.removeProxy !== undefined && typeof body.removeProxy !== "boolean") return NextResponse.json({ error: "removeProxy must be a boolean" }, { status: 400 });
  const incoming = typeof body.botToken === "string" && body.botToken.trim() ? body.botToken.trim() : undefined; const existing = await getZaloBotToken(); const enabled = body.enabled !== false;
  const incomingProxy = typeof body.proxy === "string" && body.proxy.trim() ? body.proxy.trim() : undefined;
  let effectiveProxy: string | null;
  try { effectiveProxy = resolveChannelProxyUpdate(await getZaloProxy(), { proxy: incomingProxy, removeProxy: body.removeProxy === true }); }
  catch (e) { return NextResponse.json({ error: msg(e, "Invalid proxy URL."), saved: false }, { status: 400 }); }
  if (enabled && !incoming && !existing) return NextResponse.json({ error: "Zalo Bot Token is required." }, { status: 400 });
  let bot; try { bot = await validateZaloBotToken(incoming || existing || "", fetch, effectiveProxy); } catch (e) { const text = msg(e, "Zalo Bot Token validation failed."); await setMany({ zalo_last_error: text }).catch(() => {}); return NextResponse.json({ error: text, saved: false }, { status: codeStatus(e) }); }
  try { const config = await saveZaloConfig({ botToken: incoming, enabled, proxy: incomingProxy, removeProxy: body.removeProxy === true }); await restartZaloGateway(); await setMany({ zalo_last_error: undefined }).catch(() => {}); return NextResponse.json({ success: true, saved: true, bot, ...config, connected: false, state: enabled ? "configured" : "disabled" }); }
  catch (e) { const text = msg(e, "Failed to save Zalo config."); await setMany({ zalo_last_error: text }).catch(() => {}); return NextResponse.json({ error: text, saved: false }, { status: codeStatus(e) }); }
}
