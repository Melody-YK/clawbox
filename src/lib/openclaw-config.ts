import fs from "fs/promises";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";

const exec = promisify(execFile);
const OPENCLAW_HOME = process.env.OPENCLAW_HOME || "/home/clawbox/.openclaw";
const CONFIG_PATH = path.join(OPENCLAW_HOME, "openclaw.json");

interface OpenClawConfig {
  [key: string]: unknown;
  channels?: {
    [name: string]: {
      enabled?: boolean;
      botToken?: string;
      dmPolicy?: string;
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

// 微信机器人配置（合并写入，避免只改开关时清空 token）
export async function setWechatConfig(botToken?: string, enabled?: boolean): Promise<void> {
  const config = await readConfig();
  if (!config.channels) {
    config.channels = {};
  }
  const prev = (config.channels.wechat || {}) as Record<string, unknown>;
  const next: Record<string, unknown> = {
    ...prev,
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
  config.channels.wechat = next as NonNullable<OpenClawConfig["channels"]>[string];
  await writeConfig(config);
  await restartGateway();
}

// 获取微信机器人配置
export async function getWechatConfig(): Promise<{ enabled?: boolean; botToken?: string }> {
  const config = await readConfig();
  return config.channels?.wechat || {};
}

// 启用/禁用微信机器人
export async function toggleWechatBot(enabled: boolean): Promise<void> {
  const currentConfig = await getWechatConfig();
  await setWechatConfig(currentConfig.botToken, enabled);
}

export async function restartServices(): Promise<void> {
  await restartGateway();
}
