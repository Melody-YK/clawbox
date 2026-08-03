import fs from "fs/promises";
import os from "os";
import path from "path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const ROOT = path.join(
  os.tmpdir(),
  `clawbox-channel-concurrency-${process.pid}-${Date.now()}`,
);
const CONFIG_PATH = path.join(ROOT, "openclaw.json");
const FEISHU_APP_ID = "cli_1234567890";
const FEISHU_APP_SECRET = "abcdefghijklmnopqrstuvwxyz123456";
const QQ_APP_ID = "1023456789";
const QQ_APP_SECRET = "qq-client-secret-1234567890";
const originalConfigPath = process.env.OPENCLAW_CONFIG_PATH;

let feishu: typeof import("@/lib/channels/feishu");
let qqbot: typeof import("@/lib/channels/qqbot");

beforeAll(async () => {
  process.env.OPENCLAW_CONFIG_PATH = CONFIG_PATH;
  await fs.mkdir(ROOT, { recursive: true });
  vi.resetModules();
  [feishu, qqbot] = await Promise.all([
    import("@/lib/channels/feishu"),
    import("@/lib/channels/qqbot"),
  ]);
});

afterAll(async () => {
  if (originalConfigPath === undefined) {
    delete process.env.OPENCLAW_CONFIG_PATH;
  } else {
    process.env.OPENCLAW_CONFIG_PATH = originalConfigPath;
  }
  vi.resetModules();
  await fs.rm(ROOT, { recursive: true, force: true });
});

describe("OpenClaw channel config concurrency", () => {
  it("keeps Feishu and QQ Bot when both channels save concurrently", async () => {
    await fs.writeFile(
      CONFIG_PATH,
      JSON.stringify({ preserved: true, channels: {} }),
      "utf-8",
    );

    await Promise.all([
      feishu.saveFeishuConfig({
        appId: FEISHU_APP_ID,
        appSecret: FEISHU_APP_SECRET,
        domain: "feishu",
        enabled: true,
      }),
      qqbot.saveQQBotConfig({
        appId: QQ_APP_ID,
        clientSecret: QQ_APP_SECRET,
        enabled: true,
      }),
    ]);

    const stored = JSON.parse(await fs.readFile(CONFIG_PATH, "utf-8"));
    expect(stored).toMatchObject({
      preserved: true,
      channels: {
        feishu: {
          appId: FEISHU_APP_ID,
          appSecret: FEISHU_APP_SECRET,
          enabled: true,
        },
        qqbot: {
          appId: QQ_APP_ID,
          clientSecret: QQ_APP_SECRET,
          enabled: true,
        },
      },
    });
  });
});
