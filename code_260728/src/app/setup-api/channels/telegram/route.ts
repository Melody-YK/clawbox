import { NextResponse } from "next/server";
import { getAll, setMany } from "@/lib/config-store";
import { restartGateway } from "@/lib/openclaw-config";
import {
  getTelegramBotToken,
  getTelegramConfig,
  getTelegramProxy,
  saveTelegramConfig,
  validateTelegramBotToken,
  type TelegramErrorCode,
} from "@/lib/channels/telegram";
import { resolveChannelProxyUpdate } from "@/lib/channels/proxy";

export const dynamic = "force-dynamic";

function errorCode(error: unknown): TelegramErrorCode | null {
  if (!error || typeof error !== "object" || !("code" in error)) return null;
  const code = error.code;
  return typeof code === "string" ? (code as TelegramErrorCode) : null;
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function statusForTelegramError(error: unknown): number {
  const code = errorCode(error);
  if (code === "invalid_token" || code === "invalid_pairing_code" || code === "invalid_proxy") return 400;
  return 502;
}

export async function GET() {
  try {
    const [config, setupConfig] = await Promise.all([
      getTelegramConfig(),
      getAll(),
    ]);
    return NextResponse.json({
      ...config,
      lastError:
        typeof setupConfig.telegram_last_error === "string"
          ? setupConfig.telegram_last_error
          : null,
    });
  } catch (error) {
    return NextResponse.json(
      { error: errorMessage(error, "Failed to read Telegram config.") },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  const setupConfig = await getAll();
  if (!setupConfig.ai_model_configured) {
    return NextResponse.json(
      { error: "Configure your AI provider before setting up Telegram." },
      { status: 409 },
    );
  }

  let body: { botToken?: unknown; enabled?: unknown; proxy?: unknown; removeProxy?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (body.enabled !== undefined && typeof body.enabled !== "boolean") {
    return NextResponse.json(
      { error: "enabled must be a boolean" },
      { status: 400 },
    );
  }
  if (body.botToken !== undefined && typeof body.botToken !== "string") {
    return NextResponse.json(
      { error: "botToken must be a string" },
      { status: 400 },
    );
  }
  if (body.proxy !== undefined && typeof body.proxy !== "string") {
    return NextResponse.json(
      { error: "proxy must be a string" },
      { status: 400 },
    );
  }
  if (body.removeProxy !== undefined && typeof body.removeProxy !== "boolean") {
    return NextResponse.json(
      { error: "removeProxy must be a boolean" },
      { status: 400 },
    );
  }

  const enabled = body.enabled !== false;
  const incomingToken =
    typeof body.botToken === "string" && body.botToken.trim()
      ? body.botToken.trim()
      : undefined;
  const existingToken = await getTelegramBotToken();
  const existingProxy = await getTelegramProxy();
  const incomingProxy =
    typeof body.proxy === "string" && body.proxy.trim()
      ? body.proxy.trim()
      : undefined;
  let effectiveProxy: string | null;
  try {
    effectiveProxy = resolveChannelProxyUpdate(existingProxy, {
      proxy: incomingProxy,
      removeProxy: body.removeProxy === true,
    });
  } catch (error) {
    return NextResponse.json(
      { error: errorMessage(error, "Invalid proxy URL."), saved: false },
      { status: 400 },
    );
  }

  if (enabled && !incomingToken && !existingToken) {
    return NextResponse.json(
      { error: "Telegram Bot Token is required." },
      { status: 400 },
    );
  }

  let bot: Awaited<ReturnType<typeof validateTelegramBotToken>> | null = null;
  const tokenToValidate = incomingToken || existingToken;
  const proxyChanged = incomingProxy !== undefined || body.removeProxy === true;
  if (tokenToValidate && (incomingToken !== undefined || (enabled && proxyChanged))) {
    try {
      bot = await validateTelegramBotToken(tokenToValidate, fetch, effectiveProxy);
    } catch (error) {
      const message = errorMessage(error, "Telegram Bot Token validation failed.");
      await setMany({ telegram_last_error: message }).catch(() => {});
      return NextResponse.json(
        { error: message, saved: false },
        { status: statusForTelegramError(error) },
      );
    }
  }

  let savedConfig: Awaited<ReturnType<typeof saveTelegramConfig>>;
  try {
    savedConfig = await saveTelegramConfig({
      botToken: incomingToken,
      enabled,
      proxy: incomingProxy,
      removeProxy: body.removeProxy === true,
    });
  } catch (error) {
    const message = errorMessage(error, "Failed to save Telegram config.");
    await setMany({ telegram_last_error: message }).catch(() => {});
    return NextResponse.json(
      { error: message, saved: false },
      { status: statusForTelegramError(error) },
    );
  }

  await setMany({
    telegram_last_error: undefined,
    telegram_reload_started_at: enabled ? Date.now() : undefined,
  }).catch(() => {});

  try {
    await restartGateway();
  } catch (error) {
    const message = `Telegram config was saved, but OpenClaw Gateway restart failed: ${errorMessage(error, "unknown error")}`;
    await setMany({
      telegram_last_error: message,
      telegram_reload_started_at: undefined,
    }).catch(() => {});
    return NextResponse.json(
      { error: message, saved: true, ...savedConfig },
      { status: 502 },
    );
  }

  if (!enabled) {
    return NextResponse.json({
      success: true,
      saved: true,
      state: "disabled",
      connected: false,
      reloading: false,
      bot,
      ...savedConfig,
    });
  }

  return NextResponse.json({
    success: true,
    saved: true,
    ...savedConfig,
    state: "configured",
    connected: false,
    reloading: true,
    lastError: null,
    bot,
  });
}
