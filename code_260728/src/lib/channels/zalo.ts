import { readConfig, restartGateway, writeConfig } from "@/lib/openclaw-config";
import { probeOpenClawChannel, runOpenClaw, type CommandRunner } from "./openclaw-runtime";
import { fetchWithChannelProxy, normalizeChannelProxy } from "./proxy";

const ZALO_API_ROOT = "https://bot-api.zaloplatforms.com";
const REQUEST_TIMEOUT_MS = 12_000;

export interface ZaloBotIdentity { id: string; name: string; }
export interface ZaloConfigView {
  configured: boolean; enabled: boolean; hasToken: boolean; hasProxy: boolean; dmPolicy: string; groupPolicy: string;
}
export interface ZaloChannelStatus extends ZaloConfigView {
  state: "not_configured" | "disabled" | "configured" | "connected" | "error";
  connected: boolean; running: boolean; bot: ZaloBotIdentity | null; lastError: string | null;
}

export class ZaloChannelError extends Error {
  constructor(public readonly code: "invalid_token" | "invalid_proxy" | "unreachable" | "gateway", message: string) {
    super(message);
    this.name = "ZaloChannelError";
  }
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
  const value = config.channels?.zalo;
  return isRecord(value) ? value : {};
}
function defaultAccount(value: Record<string, unknown>): Record<string, unknown> {
  const accounts = isRecord(value.accounts) ? value.accounts : {};
  return isRecord(accounts.default) ? accounts.default : {};
}
export function normalizeZaloBotToken(value: string): string {
  const token = value.trim();
  if (token.length > 512 || !/^\d{3,}:[A-Za-z0-9_-]{6,}$/.test(token)) {
    throw new ZaloChannelError("invalid_token", "The Zalo Bot Token format is invalid. Copy the complete token from Zalo Bot Platform.");
  }
  return token;
}
export async function getZaloBotToken(): Promise<string | null> {
  return readString(defaultAccount(section(await readConfig())).botToken);
}
export async function getZaloProxy(): Promise<string | null> {
  return readString(defaultAccount(section(await readConfig())).proxy);
}
export async function getZaloConfig(): Promise<ZaloConfigView> {
  const channel = section(await readConfig());
  const account = defaultAccount(channel);
  const hasToken = Boolean(readString(account.botToken));
  return {
    configured: hasToken, enabled: hasToken && channel.enabled !== false && account.enabled !== false, hasToken,
    hasProxy: Boolean(readString(account.proxy)),
    dmPolicy: readString(account.dmPolicy) || "pairing", groupPolicy: readString(account.groupPolicy) || "disabled",
  };
}
export async function validateZaloBotToken(
  value: string,
  fetcher: typeof fetch = fetch,
  proxy?: string | null,
): Promise<ZaloBotIdentity> {
  const token = normalizeZaloBotToken(value);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetchWithChannelProxy(`${ZALO_API_ROOT}/bot${token}/getMe`, { method: "POST", headers: { "Content-Type": "application/json" }, cache: "no-store", redirect: "error", signal: controller.signal }, proxy, fetcher);
    const payload = (await response.json().catch(() => null)) as unknown;
    if (!response.ok || !isRecord(payload) || payload.ok !== true || !isRecord(payload.result)) {
      const description = isRecord(payload) ? readString(payload.description) : null;
      if (response.status === 401 || response.status === 403 || (isRecord(payload) && typeof payload.error_code === "number")) {
        throw new ZaloChannelError("invalid_token", description || "Zalo rejected this Bot Token.");
      }
      throw new ZaloChannelError("unreachable", description || `Zalo Bot API validation failed (${response.status}).`);
    }
    const idValue = payload.result.id;
    const id = typeof idValue === "number" || typeof idValue === "string" ? String(idValue) : "";
    const name = readString(payload.result.name) || readString(payload.result.account_name);
    if (!id || !name) throw new ZaloChannelError("unreachable", "Zalo returned an unexpected bot identity response.");
    return { id, name };
  } catch (error) {
    if (error instanceof ZaloChannelError) throw error;
    if (error instanceof DOMException && error.name === "AbortError") throw new ZaloChannelError("unreachable", "Zalo Bot API validation timed out.");
    throw new ZaloChannelError("unreachable", "Cannot reach Zalo Bot API. Check internet or proxy settings.");
  } finally { clearTimeout(timer); }
}
export async function saveZaloConfig(input: { botToken?: string; enabled: boolean; proxy?: string; removeProxy?: boolean }): Promise<ZaloConfigView> {
  const config = await readConfig();
  const channels = isRecord(config.channels) ? { ...config.channels } : {};
  const current = isRecord(channels.zalo) ? channels.zalo : {};
  const accounts = isRecord(current.accounts) ? { ...current.accounts } : {};
  const account = isRecord(accounts.default) ? accounts.default : {};
  const nextAccount: Record<string, unknown> = {
    ...account, enabled: input.enabled, dmPolicy: readString(account.dmPolicy) || "pairing",
    groupPolicy: readString(account.groupPolicy) || "disabled",
    ...(input.botToken !== undefined ? { botToken: normalizeZaloBotToken(input.botToken) } : {}),
  };
  if (input.removeProxy === true) delete nextAccount.proxy;
  else if (input.proxy !== undefined) nextAccount.proxy = normalizeChannelProxy(input.proxy);
  accounts.default = nextAccount;
  channels.zalo = { ...current, enabled: input.enabled, accounts };
  config.channels = channels;
  await writeConfig(config);
  return getZaloConfig();
}
export async function prepareZaloPlugin(runner?: CommandRunner): Promise<void> {
  await runOpenClaw(["plugins", "enable", "zalo"], { timeoutMs: 60_000, runner });
}
export async function restartZaloGateway(): Promise<void> { await restartGateway(); }
export async function getZaloStatus(runner?: CommandRunner): Promise<ZaloChannelStatus> {
  const stored = await getZaloConfig();
  const base: ZaloChannelStatus = { ...stored, state: stored.configured ? stored.enabled ? "configured" : "disabled" : "not_configured", connected: false, running: false, bot: null, lastError: null };
  if (!stored.configured || !stored.enabled) return base;
  const runtime = await probeOpenClawChannel("zalo", runner);
  let bot: ZaloBotIdentity | null = null;
  try { bot = await validateZaloBotToken((await getZaloBotToken()) || "", fetch, await getZaloProxy()); } catch { /* runtime status remains authoritative */ }
  return { ...base, state: runtime.state, connected: runtime.connected, running: runtime.running, bot, lastError: runtime.lastError };
}
