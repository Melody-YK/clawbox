import fs from "node:fs/promises";
import path from "node:path";
import { readConfig, restartGateway } from "@/lib/openclaw-config";
import {
  cancelQrSession,
  createCliQrSession,
  getQrSession,
  parseClawBotLoginUrl,
  type QrSessionView,
} from "./qr-session";
import { OPENCLAW_STATE_DIR, runOpenClaw } from "./openclaw-runtime";

export const CLAWBOT_PLUGIN_SPEC = "@zalo-platforms/openclaw-zaloclawbot@0.1.4";

export interface ClawBotConfigView {
  configured: boolean;
  enabled: boolean;
  accountIds: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function clawBotStateDir(): string {
  return path.join(OPENCLAW_STATE_DIR, "openclaw-zaloclawbot");
}

async function configuredAccountIds(): Promise<string[]> {
  let indexed: unknown;
  try {
    indexed = JSON.parse(
      await fs.readFile(path.join(clawBotStateDir(), "accounts.json"), "utf8"),
    ) as unknown;
  } catch {
    return [];
  }
  if (!Array.isArray(indexed)) return [];

  const configured: string[] = [];
  for (const accountId of indexed) {
    if (typeof accountId !== "string" || !accountId.trim()) continue;
    try {
      const raw = JSON.parse(
        await fs.readFile(
          path.join(clawBotStateDir(), "accounts", `${accountId}.json`),
          "utf8",
        ),
      ) as unknown;
      if (isRecord(raw) && readString(raw.botToken)) configured.push(accountId);
    } catch {
      // Ignore stale index entries; the official plugin does the same.
    }
  }
  return configured;
}

export async function getClawBotConfig(): Promise<ClawBotConfigView> {
  const accountIds = await configuredAccountIds();
  const config = await readConfig();
  const channel = config.channels?.["openclaw-zaloclawbot"];
  return {
    configured: accountIds.length > 0,
    enabled: accountIds.length > 0 && channel?.enabled !== false,
    accountIds,
  };
}

export async function prepareClawBotPlugin(): Promise<void> {
  let installed = false;
  try {
    const { stdout } = await runOpenClaw(["plugins", "list", "--json"], {
      timeoutMs: 30_000,
    });
    const payload = JSON.parse(stdout) as unknown;
    const plugins = isRecord(payload) && Array.isArray(payload.plugins) ? payload.plugins : [];
    installed = plugins.some(
      (plugin) => isRecord(plugin) && readString(plugin.id) === "openclaw-zaloclawbot",
    );
  } catch {
    // The pinned install command below will provide the actionable error.
  }

  if (!installed) {
    await runOpenClaw(["plugins", "install", CLAWBOT_PLUGIN_SPEC], {
      timeoutMs: 120_000,
    });
  }
  await runOpenClaw(["plugins", "enable", "openclaw-zaloclawbot"], {
    timeoutMs: 60_000,
  });
}

export async function startClawBotQrLogin(): Promise<QrSessionView> {
  await prepareClawBotPlugin();
  return createCliQrSession({
    kind: "zalo-clawbot",
    args: ["channels", "login", "--channel", "openclaw-zaloclawbot"],
    parseOutput: async (output) => parseClawBotLoginUrl(output),
    isConnected: (output) => /Connected to Zalo\.\s+account(?:Id=|\s+)/i.test(output),
    onConnected: async () => {
      await restartGateway();
    },
  });
}

export function getClawBotQrLogin(
  sessionId: string,
  ownerToken: string,
): QrSessionView | null {
  return getQrSession(sessionId, ownerToken);
}

export function cancelClawBotQrLogin(
  sessionId: string,
  ownerToken: string,
): boolean {
  return cancelQrSession(sessionId, ownerToken);
}
