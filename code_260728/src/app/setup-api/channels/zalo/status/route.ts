import { NextResponse } from "next/server";
import { getZaloStatus } from "@/lib/channels/zalo";
export const dynamic = "force-dynamic";
export async function GET() { try { return NextResponse.json(await getZaloStatus()); } catch (e) { return NextResponse.json({ state: "error", connected: false, running: false, lastError: e instanceof Error ? e.message : "Failed to check Zalo status." }, { status: 502 }); } }
