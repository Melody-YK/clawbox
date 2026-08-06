import { NextResponse } from "next/server";
import { getAll, setMany } from "@/lib/config-store";
import { getZaloBotToken, getZaloConfig, restartZaloGateway, saveZaloConfig, validateZaloBotToken } from "@/lib/channels/zalo";
export const dynamic = "force-dynamic";
const msg = (e: unknown, f: string) => e instanceof Error ? e.message : f;
const codeStatus = (e: unknown) => e && typeof e === "object" && "code" in e && e.code === "invalid_token" ? 400 : 502;
export async function GET() { try { return NextResponse.json({ ...(await getZaloConfig()), lastError: null }); } catch (e) { return NextResponse.json({ error: msg(e, "Failed to read Zalo config.") }, { status: 500 }); } }
export async function POST(request: Request) {
  const setup = await getAll(); if (!setup.ai_model_configured) return NextResponse.json({ error: "Configure your AI provider before setting up Zalo Bot." }, { status: 409 });
  let body: { botToken?: unknown; enabled?: unknown }; try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  if (body.enabled !== undefined && typeof body.enabled !== "boolean") return NextResponse.json({ error: "enabled must be a boolean" }, { status: 400 });
  if (body.botToken !== undefined && typeof body.botToken !== "string") return NextResponse.json({ error: "botToken must be a string" }, { status: 400 });
  const incoming = typeof body.botToken === "string" && body.botToken.trim() ? body.botToken.trim() : undefined; const existing = await getZaloBotToken(); const enabled = body.enabled !== false;
  if (enabled && !incoming && !existing) return NextResponse.json({ error: "Zalo Bot Token is required." }, { status: 400 });
  let bot; try { bot = await validateZaloBotToken(incoming || existing || ""); } catch (e) { const text = msg(e, "Zalo Bot Token validation failed."); await setMany({ zalo_last_error: text }).catch(() => {}); return NextResponse.json({ error: text, saved: false }, { status: codeStatus(e) }); }
  try { const config = await saveZaloConfig({ botToken: incoming, enabled }); await restartZaloGateway(); await setMany({ zalo_last_error: undefined }).catch(() => {}); return NextResponse.json({ success: true, saved: true, bot, ...config, connected: false, state: enabled ? "configured" : "disabled" }); }
  catch (e) { const text = msg(e, "Failed to save Zalo config."); await setMany({ zalo_last_error: text }).catch(() => {}); return NextResponse.json({ error: text, saved: false }, { status: codeStatus(e) }); }
}
