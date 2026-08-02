import fs from "fs/promises";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";

const exec = promisify(execFile);
const OPENCLAW_STATE_DIR =
  process.env.OPENCLAW_STATE_DIR ||
  process.env.OPENCLAW_HOME ||
  "/home/clawbox/.openclaw";
const CONFIG_PATH =
  process.env.OPENCLAW_CONFIG_PATH ||
  path.join(OPENCLAW_STATE_DIR, "openclaw.json");
const WECHAT_CHANNEL_KEY = "openclaw-weixin";
const LEGACY_WECHAT_CHANNEL_KEY = "wechat";
const ILINK_BASE_URL = "https://ilinkai.weixin.qq.com";

export interface OpenClawConfig {
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

export async function readConfig(): Promise<OpenClawConfig> {
  try {
    const raw = await fs.readFile(CONFIG_PATH, "utf-8");
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

export async function writeConfig(config: OpenClawConfig): Promise<void> {
  await fs.mkdir(path.dirname(CONFIG_PATH), { recursive: true });
  const tmpPath = CONFIG_PATH + ".tmp";
  await fs.writeFile(tmpPath, JSON.stringify(config, null, 2), {
    encoding: "utf-8",
    mode: 0o600,
  });
  await fs.rename(tmpPath, CONFIG_PATH);
  await fs.chmod(CONFIG_PATH, 0o600);
}


/**
 * Best-effort gateway reload/restart after AI / channel config changes.
 *
 * setup 服务以普通用户运行，很多设备上会被 systemd/polkit 拒绝直接 try-restart。
 * 这里不要把“无权限重启”当作配置失败：
 * - 先尝试 systemctl try-restart
 * - 若被拒绝，回退为同用户向 openclaw 进程发送 USR1（触发就地重载）
 * - 再失败也只记录日志，不抛异常，避免前端一直卡在 pending
 */
export async function restartGateway(): Promise<void> {
  try {
    await exec("systemctl", ["try-restart", "clawbox-gateway.service"], {
      timeout: 25_000,
    });
    return;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const authDenied = /Interactive authentication required|Access denied|polkit/i.test(message);

    if (!authDenied) {
      console.warn("[openclaw-config] systemctl try-restart failed:", message);
    } else {
      console.info("[openclaw-config] systemctl try-restart denied; fallback to USR1 reload");
    }

    try {
      await exec("pkill", ["-USR1", "-x", "openclaw"], { timeout: 8_000 });
    } catch (signalErr) {
      console.warn(
        "[openclaw-config] fallback USR1 reload failed:",
        signalErr instanceof Error ? signalErr.message : signalErr,
      );
    }
  }
}

async function readWeixinAccountStatus(): Promise<{ connected: boolean; accountIds: string[] }> {
  const accountsDir = path.join(OPENCLAW_STATE_DIR, WECHAT_CHANNEL_KEY, "accounts");
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

export async function saveWeixinAccount(
  accountId: string,
  botToken: string,
  userId: string,
): Promise<void> {
  const accountsDir = path.join(OPENCLAW_STATE_DIR, WECHAT_CHANNEL_KEY, "accounts");
  await fs.mkdir(accountsDir, { recursive: true });
  // 1. 保存账号详情文件
  const accountPath = path.join(accountsDir, `${accountId}.json`);
  const data = { token: botToken, userId, baseUrl: ILINK_BASE_URL };
  await fs.writeFile(accountPath, JSON.stringify(data, null, 2), "utf-8");

  // 2. 【关键】更新 accounts.json 索引
  const stateDir = path.join(OPENCLAW_STATE_DIR, WECHAT_CHANNEL_KEY);
  await fs.mkdir(stateDir, { recursive: true });
  const indexPath = path.join(stateDir, "accounts.json");

  // 从 openclaw.json 读取当前所有有效账号 ID
  const config = await readConfig();
  const channel = (config.channels?.[WECHAT_CHANNEL_KEY] || {}) as Record<string, any>;
  const validAccounts = (channel.accounts || {}) as Record<string, any>;
  const validIds = Object.keys(validAccounts);

  // 清理 accounts/ 目录下不在 openclaw.json 中的旧文件
  
  // 清理 accounts/ 目录下不在 openclaw.json 中的旧文件
  try {
    const files = await fs.readdir(accountsDir);
    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      if (file.endsWith(".sync.json") || file.endsWith(".context-tokens.json")) continue;
      const id = path.basename(file, ".json");
      if (!validIds.includes(id)) {
        const filePath = path.join(accountsDir, file);
        try{
          await fs.unlink(path.join(accountsDir, file));
          console.log(`[openclaw-config] Removed stale account file: ${file}`);
        }
        catch (unlinkErr: any) {
        // 权限不足时尝试 sudo 兜底
          if (unlinkErr.code === "EACCES" || unlinkErr.code === "EPERM") {
            try {
              await exec("sudo", ["rm", "-f", filePath], { timeout: 5_000 });
              console.log(`[openclaw-config] Removed stale account file via sudo: ${file}`);
            } catch (sudoErr) {
              console.error(`[openclaw-config] Failed to remove ${file} even with sudo:`, sudoErr);
            }
          } else {
            throw unlinkErr; // 其他错误继续抛
          }
        }
      }
    }
  } catch (err: any) {
    if (err.code !== "ENOENT") {
      console.error("[openclaw-config] Error cleaning accounts dir:", err);
    }
  }
  // let index: string[] = [];
  // try {
  //   const raw = await fs.readFile(indexPath, "utf-8");
  //   const parsed = JSON.parse(raw);
  //   if (Array.isArray(parsed)) index = parsed;
  // } catch {
  //   // 文件不存在或解析失败，用空数组
  // }
  
  // 重建accounts.json索引（严格对其openclaw.json）
  await fs.writeFile(indexPath, JSON.stringify(validIds, null, 2), "utf-8");
  console.log(`[openclaw-config] Rebuilt accounts.json index: ${validIds.join(", ") || "(empty)"}`);
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
