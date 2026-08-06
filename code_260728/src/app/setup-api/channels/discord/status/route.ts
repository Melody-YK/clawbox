import { NextResponse } from "next/server";
import { getDiscordStatus } from "@/lib/channels/discord";
export const dynamic = "force-dynamic";
export async function GET() { try { return NextResponse.json(await getDiscordStatus()); } catch (error) { return NextResponse.json({ state: "error", connected: false, running: false, lastError: error instanceof Error ? error.message : "Failed to check Discord status." }, { status: 502 }); } }
