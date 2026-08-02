// 复用 openclaw-config.ts 已有的读写和重启函数，保持行为与微信完全一致
import { readConfig, writeConfig, restartGateway } from "./openclaw-config";

/* ── 渠道定义 ── */

export const MANAGED_CHANNELS = ["feishu", "qqbot", "telegram", "whatsapp", "line"] as const;
export type ManagedChannel = (typeof MANAGED_CHANNELS)[number];

// channels 段里每个渠道的实际键名。
// ⚠️ 微信的先例是 "openclaw-weixin"（插件包名），飞书键名需验证，见说明第五部分
const CHANNEL_CONFIG_KEY: Record<ManagedChannel, string> = {
  feishu:   "feishu",
  qqbot:    "qqbot",
  telegram: "telegram",
  whatsapp: "whatsapp",
  line:     "line",
};

// 每个渠道允许写入的字段（与前端 CHANNEL_FIELDS 一一对应）
const FIELD_WHITELIST: Record<ManagedChannel, string[]> = {
  feishu:   ["enabled", "appId", "appSecret", "connectionMode", "domain"],
  qqbot:    ["enabled", "appId", "clientSecret"],
  telegram: ["enabled", "botToken"],
  whatsapp: ["enabled"],
  line:     ["enabled", "channelAccessToken", "channelSecret"],
};

// 密钥字段：GET 不回传；POST 传空字符串 = 保持已存储的旧值
const SECRET_FIELDS: Record<ManagedChannel, string[]> = {
  feishu:   ["appSecret"],
  qqbot:    ["clientSecret"],
  telegram: ["botToken"],
  whatsapp: [],
  line:     ["channelAccessToken", "channelSecret"],
};

/* ── GET 用：读出 channels 段并脱敏 ── */

export async function getChannelsConfig(): Promise<Record<string, Record<string, any>>> {
  const config = await readConfig();
  const stored = config.channels ?? {};

  const channels: Record<string, Record<string, any>> = {};
  for (const channel of MANAGED_CHANNELS) {
    const existing = stored[CHANNEL_CONFIG_KEY[channel]] as Record<string, any> | undefined;
    if (!existing || typeof existing !== "object") continue; // 没配置过的渠道不返回

    const view: Record<string, any> = {};
    for (const key of FIELD_WHITELIST[channel]) {
      if (!(key in existing)) continue;
      if (SECRET_FIELDS[channel].includes(key)) {
        view[key] = "";                                // 密钥永远不回传
        if (existing[key]) view[`has_${key}`] = true;  // 但标记"已存过"
      } else {
        view[key] = existing[key];
      }
    }
    channels[channel] = view;
  }
  return channels;
}

/* ── POST 用：白名单清洗 → 合并 → 写入 → 重启（与微信同一套读写和重启路径） ── */

export async function setChannelConfig(
  channel: ManagedChannel,
  incoming: Record<string, unknown>,
): Promise<Record<string, any>> {
  const config = await readConfig();
  if (!config.channels) {
    config.channels = {};
  }
  const configKey = CHANNEL_CONFIG_KEY[channel];
  const existing = (config.channels[configKey] ?? {}) as Record<string, any>;
  const merged: Record<string, any> = { ...existing };

  for (const key of FIELD_WHITELIST[channel]) {
    if (!(key in incoming)) continue; // 前端没传的字段不动
    const value = incoming[key];

    if (key === "enabled") {
      merged[key] = value !== false; // 缺省视为启用
      continue;
    }
    if (typeof value === "string") {
      const trimmed = value.trim();
      // 密钥字段传空 = 用户没改，保留旧值（防止空串覆盖真密钥）
      if (trimmed === "" && SECRET_FIELDS[channel].includes(key)) continue;
      merged[key] = trimmed;
    }
  }

  // 飞书官方插件的 connectionMode 取值是 "websocket"（CLI 向导写入的），
  // 前端 App ID 模式传的是 "app"，统一映射，避免覆盖成插件不认识的值
  if (channel === "feishu" && merged.connectionMode === "app") {
    merged.connectionMode = "websocket";
  }
  config.channels[configKey] = merged as NonNullable<typeof config.channels>[string];
  await writeConfig(config);
  await restartGateway(); // 复用 openclaw-config 的 best-effort 重启，不会抛错
  return merged;
}
