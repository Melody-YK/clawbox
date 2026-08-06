import { NextResponse } from "next/server";
import { getAll } from "@/lib/config-store";
import { getSignalConfig, restartSignalGateway, saveSignalConfig } from "@/lib/channels/signal";
export const dynamic = "force-dynamic";
export async function GET() { try { return NextResponse.json(await getSignalConfig()); } catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : "Failed to read Signal config." }, { status: 500 }); } }
export async function POST(request: Request) {
  const setup = await getAll();
  if (!setup.ai_model_configured) {
    return NextResponse.json(
      { error: "Configure your AI provider before setting up Signal." },
      { status: 409 },
    );
  }
  let body: { account?: unknown; cliPath?: unknown; httpUrl?: unknown; enabled?: unknown };
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  if (typeof body.account !== "string" || typeof body.enabled !== "boolean") return NextResponse.json({ error: "account and enabled are required" }, { status: 400 });
  if (body.cliPath !== undefined && typeof body.cliPath !== "string") return NextResponse.json({ error: "cliPath must be a string" }, { status: 400 });
  if (body.httpUrl !== undefined && typeof body.httpUrl !== "string") return NextResponse.json({ error: "httpUrl must be a string" }, { status: 400 });

  let config;
  try {
    config = await saveSignalConfig({ account: body.account, cliPath: body.cliPath, httpUrl: body.httpUrl, enabled: body.enabled });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to save Signal config.", saved: false }, { status: 400 });
  }
  try {
    await restartSignalGateway();
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Signal settings were saved, but the Gateway restart failed.", saved: true, ...config }, { status: 502 });
  }
  return NextResponse.json({ success: true, saved: true, ...config });
}
