import { NextResponse } from "next/server";
import { getAll, setMany } from "@/lib/config-store";
import { probeTelegramChannel } from "@/lib/channels/telegram";

export const dynamic = "force-dynamic";

const TELEGRAM_RELOAD_GRACE_MS = 90_000;

function reloadStartedAt(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : null;
}

function isWithinReloadGracePeriod(startedAt: number | null): boolean {
  if (startedAt === null) return false;
  const elapsed = Date.now() - startedAt;
  return elapsed >= 0 && elapsed <= TELEGRAM_RELOAD_GRACE_MS;
}

function reloadingStatus() {
  return {
    state: "configured",
    configured: true,
    enabled: true,
    connected: false,
    running: false,
    probeOk: null,
    botId: null,
    botUsername: null,
    lastError: null,
    reloading: true,
  };
}

export async function GET() {
  const setupConfig: Record<string, unknown> = await getAll().catch(() => ({}));
  const startedAt = reloadStartedAt(setupConfig.telegram_reload_started_at);
  const reloading = isWithinReloadGracePeriod(startedAt);

  try {
    const status = await probeTelegramChannel();
    if (status.connected || status.state === "disabled" || status.state === "not_configured") {
      await setMany({
        telegram_last_error: undefined,
        telegram_reload_started_at: undefined,
      }).catch(() => {});
    } else if (reloading) {
      await setMany({ telegram_last_error: undefined }).catch(() => {});
      return NextResponse.json({
        ...status,
        state: "configured",
        connected: false,
        lastError: null,
        reloading: true,
      });
    } else if (startedAt !== null) {
      await setMany({
        telegram_last_error: status.lastError || undefined,
        telegram_reload_started_at: undefined,
      }).catch(() => {});
    }
    return NextResponse.json({ ...status, reloading: false });
  } catch (error) {
    if (reloading) {
      await setMany({ telegram_last_error: undefined }).catch(() => {});
      return NextResponse.json(reloadingStatus());
    }

    const message =
      error instanceof Error ? error.message : "Failed to check Telegram status.";
    await setMany({
      telegram_last_error: message,
      telegram_reload_started_at: undefined,
    }).catch(() => {});
    return NextResponse.json(
      {
        state: "error",
        configured: true,
        enabled: true,
        connected: false,
        running: false,
        probeOk: false,
        botId: null,
        botUsername: null,
        lastError: message,
        reloading: false,
      },
      { status: 502 },
    );
  }
}
