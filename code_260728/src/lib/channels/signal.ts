import { readConfig, restartGateway, writeConfig } from "@/lib/openclaw-config";
import {
  cancelQrSession,
  createCliQrSession,
  getQrSession,
  parseSignalLinkedAccount,
  parseSignalLinkOutput,
  type QrSessionView,
} from "./qr-session";
import {
  getOpenClawEnvironment,
  probeOpenClawChannel,
  runCommand,
  type CommandRunner,
} from "./openclaw-runtime";

export interface SignalConfigView {
  configured: boolean;
  enabled: boolean;
  account: string | null;
  cliPath: string;
  httpUrl: string | null;
  hasKeys: boolean;
}

export interface SignalStatus extends SignalConfigView {
  state: "not_configured" | "disabled" | "configured" | "connected" | "error";
  connected: boolean;
  running: boolean;
  lastError: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function section(config: Awaited<ReturnType<typeof readConfig>>): Record<string, unknown> {
  const value = config.channels?.signal;
  return isRecord(value) ? value : {};
}

function normalizeAccount(value: string): string {
  const account = value.trim().replace(/[\s().-]/g, "");
  if (!/^\+[1-9]\d{7,14}$/.test(account)) {
    throw new Error(
      "Signal account must use E.164 format, for example +8613800000000.",
    );
  }
  return account;
}

export async function getSignalConfig(): Promise<SignalConfigView> {
  const channel = section(await readConfig());
  const account = readString(channel.account);
  const cliPath = readString(channel.cliPath) || "signal-cli";
  const httpUrl = readString(channel.httpUrl);
  return {
    configured: Boolean(account),
    enabled: Boolean(account && channel.enabled !== false),
    account,
    cliPath,
    httpUrl,
    hasKeys: Boolean(account),
  };
}

export async function saveSignalConfig(input: {
  account: string;
  cliPath?: string;
  httpUrl?: string;
  enabled: boolean;
}): Promise<SignalConfigView> {
  const config = await readConfig();
  const channels = isRecord(config.channels) ? { ...config.channels } : {};
  const current = isRecord(channels.signal) ? channels.signal : {};
  const next: Record<string, unknown> = {
    ...current,
    account: normalizeAccount(input.account),
    cliPath: input.cliPath?.trim() || readString(current.cliPath) || "signal-cli",
    enabled: input.enabled,
    dmPolicy: readString(current.dmPolicy) || "pairing",
  };

  if (input.httpUrl !== undefined) {
    const httpUrl = input.httpUrl.trim();
    if (httpUrl) {
      next.httpUrl = httpUrl;
      next.autoStart = false;
    } else {
      delete next.httpUrl;
      delete next.autoStart;
    }
  }

  channels.signal = next;
  config.channels = channels;
  await writeConfig(config);
  return getSignalConfig();
}

export async function ensureSignalCli(
  cliPath: string,
  runner: CommandRunner = runCommand,
): Promise<void> {
  try {
    await runner(cliPath, ["--version"], {
      timeoutMs: 10_000,
      env: getOpenClawEnvironment(),
    });
  } catch {
    throw new Error(
      `signal-cli was not found or could not run at "${cliPath}". Install a current signal-cli release first.`,
    );
  }
}

export async function startSignalQrLogin(
  input: { cliPath?: string; timeoutMs?: number } = {},
): Promise<QrSessionView> {
  const cliPath = input.cliPath?.trim() || (await getSignalConfig()).cliPath || "signal-cli";
  await ensureSignalCli(cliPath);
  return createCliQrSession({
    kind: "signal",
    executable: cliPath,
    args: ["link", "-n", "OpenClaw"],
    timeoutMs: input.timeoutMs,
    parseOutput: async (output) => parseSignalLinkOutput(output),
    isConnected: (output) => parseSignalLinkedAccount(output) !== null,
    onConnected: async (output) => {
      const account = parseSignalLinkedAccount(output);
      if (!account) throw new Error("signal-cli did not report the linked account number.");
      await saveSignalConfig({ account, cliPath, enabled: true });
      await restartGateway();
    },
  });
}

export function getSignalQrLogin(
  sessionId: string,
  ownerToken: string,
): QrSessionView | null {
  return getQrSession(sessionId, ownerToken);
}

export function cancelSignalQrLogin(sessionId: string, ownerToken: string): boolean {
  return cancelQrSession(sessionId, ownerToken);
}

export async function restartSignalGateway(): Promise<void> {
  await restartGateway();
}

export async function getSignalStatus(): Promise<SignalStatus> {
  const config = await getSignalConfig();
  const base: SignalStatus = {
    ...config,
    state: config.configured ? (config.enabled ? "configured" : "disabled") : "not_configured",
    connected: false,
    running: false,
    lastError: null,
  };
  if (!config.configured || !config.enabled) return base;
  const runtime = await probeOpenClawChannel("signal");
  return {
    ...base,
    state: runtime.state,
    connected: runtime.connected,
    running: runtime.running,
    lastError: runtime.lastError,
  };
}
