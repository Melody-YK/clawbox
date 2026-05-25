import fs from "fs/promises";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";

const exec = promisify(execFile);
const OPENCLAW_HOME = process.env.OPENCLAW_HOME || "/home/clawbox/.openclaw";
const CONFIG_PATH = path.join(OPENCLAW_HOME, "openclaw.json");
const WECHAT_CHANNEL_KEY = "openclaw-weixin";
const LEGACY_WECHAT_CHANNEL_KEY = "wechat";

interface OpenClawConfig {
  [key: string]: unknown;
  channels?: {
    [name: string]: {
      enabled?: boolean;
      botToken?: string;
      dmPolicy?: string;
      accounts?: Record<string, unknown>;
      [key: string]: unknown;
    };
  };
}

async function readConfig(): Promise<OpenClawConfig> {
  try {
    const raw = await fs.readFile(CONFIG_PATH, "utf-8");
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

async function writeConfig(config: OpenClawConfig): Promise<void> {
  await fs.mkdir(OPENCLAW_HOME, { recursive: true });
  const tmpPath = CONFIG_PATH + ".tmp";
  await fs.writeFile(tmpPath, JSON.stringify(config, null, 2), "utf-8");
  await fs.rename(tmpPath, CONFIG_PATH);
}

/** Best-effort gateway restart after AI / channel config changes. */
export async function restartGateway(): Promise<void> {
  await exec("systemctl", ["try-restart", "clawbox-gateway.service"], {
    timeout: 25_000,
  });
}

async function readWeixinAccountStatus(): Promise<{ connected: boolean; accountIds: string[] }> {
  const accountsDir = path.join(OPENCLAW_HOME, WECHAT_CHANNEL_KEY, "accounts");
  try {
    const ents = await fs.readdir(accountsDir, { withFileTypes: true });
    const accountIds: string[] = [];
    let connected = false;

    for (const ent of ents) {
      if (!ent.isFile() || !ent.name.endsWith(".json")) continue;
      if (ent.name.endsWith(".sync.json") || ent.name.endsWith(".context-tokens.json")) continue;
      const accountId = ent.name.replace(/\.json$/, "");
      accountIds.push(accountId);
      try {
        const raw = await fs.readFile(path.join(accountsDir, ent.name), "utf-8");
        const parsed = JSON.parse(raw) as { token?: string };
        if (typeof parsed.token === "string" && parsed.token.trim()) {
          connected = true;
        }
      } catch {
        // ignore bad file
      }
    }

    return { connected, accountIds };
  } catch {
    return { connected: false, accountIds: [] };
  }
}

// 微信机器人配置（合并写入，避免只改开关时清空 token）
export async function setWechatConfig(botToken?: string, enabled?: boolean): Promise<void> {
  const config = await readConfig();
  if (!config.channels) {
    config.channels = {};
  }

  const current = (config.channels[WECHAT_CHANNEL_KEY] ||
    config.channels[LEGACY_WECHAT_CHANNEL_KEY] ||
    {}) as Record<string, unknown>;

  const next: Record<string, unknown> = {
    ...current,
    dmPolicy: "open",
    allowFrom: ["*"],
  };

  if (botToken !== undefined) {
    next.botToken = botToken || undefined;
  }
  if (enabled !== undefined) {
    next.enabled = enabled;
  } else if (next.enabled === undefined) {
    next.enabled = true;
  }

  config.channels[WECHAT_CHANNEL_KEY] = next as NonNullable<OpenClawConfig["channels"]>[string];
  if (config.channels[LEGACY_WECHAT_CHANNEL_KEY]) {
    delete config.channels[LEGACY_WECHAT_CHANNEL_KEY];
  }

  await writeConfig(config);
  await restartGateway();
}

// 获取微信机器人配置（不回传明文 token）
export async function getWechatConfig(): Promise<{
  enabled?: boolean;
  botToken?: string;
  connected?: boolean;
  accountIds?: string[];
}> {
  const config = await readConfig();
  const ch =
    (config.channels?.[WECHAT_CHANNEL_KEY] as Record<string, unknown> | undefined) ||
    (config.channels?.[LEGACY_WECHAT_CHANNEL_KEY] as Record<string, unknown> | undefined) ||
    {};

  const status = await readWeixinAccountStatus();

  return {
    enabled: typeof ch.enabled === "boolean" ? ch.enabled : undefined,
    botToken: typeof ch.botToken === "string" && ch.botToken ? "********" : undefined,
    connected: status.connected,
    accountIds: status.accountIds,
  };
}

export async function getWechatLoginStatus(): Promise<{
  connected: boolean;
  accountIds: string[];
}> {
  return readWeixinAccountStatus();
}

// 启用/禁用微信机器人
export async function toggleWechatBot(enabled: boolean): Promise<void> {
  await setWechatConfig(undefined, enabled);
}

export async function restartServices(): Promise<void> {
  await restartGateway();
}
