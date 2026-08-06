import { NextResponse } from "next/server";
import { getAll } from "@/lib/config-store";
import { getClawBotConfig, startClawBotQrLogin } from "@/lib/channels/zalo-clawbot";
export const dynamic = "force-dynamic";
export async function GET() {
  try {
    return NextResponse.json(await getClawBotConfig(), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to read Zalo ClawBot config." },
      { status: 500 },
    );
  }
}
export async function POST() { const setup = await getAll(); if (!setup.ai_model_configured) return NextResponse.json({ error: "Configure your AI provider before setting up Zalo ClawBot." }, { status: 409 }); try { return NextResponse.json({ success: true, ...(await startClawBotQrLogin()) }, { headers: { "Cache-Control": "no-store" } }); } catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : "Failed to start Zalo ClawBot QR login." }, { status: 502 }); } }
