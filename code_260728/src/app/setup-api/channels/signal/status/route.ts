import { NextResponse } from "next/server";
import { getSignalStatus } from "@/lib/channels/signal";
export const dynamic = "force-dynamic";
export async function GET() { try { return NextResponse.json(await getSignalStatus()); } catch (e) { return NextResponse.json({ state: "error", connected: false, running: false, lastError: e instanceof Error ? e.message : "Failed to check Signal status." }, { status: 502 }); } }
