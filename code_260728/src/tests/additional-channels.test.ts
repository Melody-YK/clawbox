import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const TEST_ROOT = path.join(os.tmpdir(), `clawbox-extra-channels-${process.pid}-${Date.now()}`);
const OPENCLAW_HOME = path.join(TEST_ROOT, ".openclaw");
const CONFIG_PATH = path.join(OPENCLAW_HOME, "openclaw.json");
const SETUP_CONFIG_PATH = path.join(TEST_ROOT, "data", "config.json");

let discord: typeof import("@/lib/channels/discord");
let zalo: typeof import("@/lib/channels/zalo");
let signal: typeof import("@/lib/channels/signal");
let zalouser: typeof import("@/lib/channels/zalouser");
let clawbot: typeof import("@/lib/channels/zalo-clawbot");
let runtime: typeof import("@/lib/channels/openclaw-runtime");
let qr: typeof import("@/lib/channels/qr-session");

beforeAll(async () => {
  process.env.OPENCLAW_HOME = OPENCLAW_HOME;
  process.env.OPENCLAW_STATE_DIR = OPENCLAW_HOME;
  process.env.CLAWBOX_ROOT = TEST_ROOT;
  await fs.mkdir(OPENCLAW_HOME, { recursive: true });
  vi.resetModules();
  [discord, zalo, signal, zalouser, clawbot, runtime, qr] = await Promise.all([
    import("@/lib/channels/discord"),
    import("@/lib/channels/zalo"),
    import("@/lib/channels/signal"),
    import("@/lib/channels/zalouser"),
    import("@/lib/channels/zalo-clawbot"),
    import("@/lib/channels/openclaw-runtime"),
    import("@/lib/channels/qr-session"),
  ]);
});

beforeEach(async () => {
  await fs.rm(OPENCLAW_HOME, { recursive: true, force: true });
  await fs.mkdir(OPENCLAW_HOME, { recursive: true });
  await fs.rm(path.dirname(SETUP_CONFIG_PATH), { recursive: true, force: true });
});

afterAll(async () => {
  delete process.env.OPENCLAW_HOME;
  delete process.env.OPENCLAW_STATE_DIR;
  delete process.env.CLAWBOX_ROOT;
  await fs.rm(TEST_ROOT, { recursive: true, force: true });
});

describe("Discord channel", () => {
  it("validates the Bot Token without returning it", async () => {
    const proxy = "http://proxy-user:proxy-password@192.168.1.4:7890";
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ id: "123456789012345678", username: "clawbox", global_name: "ClawBox" }), { status: 200 }));
    const result = await discord.validateDiscordBotToken("secret-discord-token", fetcher as typeof fetch, proxy);
    expect(result).toEqual({ id: "123456789012345678", username: "clawbox", globalName: "ClawBox" });
    expect(JSON.stringify(result)).not.toContain("secret-discord-token");
    expect(fetcher).toHaveBeenCalledWith("https://discord.com/api/v10/users/@me", expect.objectContaining({ headers: { Authorization: "Bot secret-discord-token" }, dispatcher: expect.anything() }));
  });

  it("writes token, pairing policy, and a restricted guild entry", async () => {
    const proxy = "http://proxy-user:proxy-password@192.168.1.4:7890";
    const view = await discord.saveDiscordConfig({ token: "secret-discord-token", serverId: "123456789012345678", userId: "987654321098765432", enabled: true, proxy });
    const stored = JSON.parse(await fs.readFile(CONFIG_PATH, "utf8"));
    expect(stored.channels.discord).toMatchObject({ enabled: true, token: "secret-discord-token", proxy, dmPolicy: "pairing", groupPolicy: "allowlist", serverId: "123456789012345678", userId: "987654321098765432", guilds: { "123456789012345678": { requireMention: true, users: ["987654321098765432"] } } });
    expect(view.hasToken).toBe(true);
    expect(view.hasProxy).toBe(true);
    expect(JSON.stringify(view)).not.toContain("secret-discord-token");
    expect(JSON.stringify(view)).not.toContain("proxy-password");

    await discord.saveDiscordConfig({ enabled: true, removeProxy: true });
    expect(JSON.parse(await fs.readFile(CONFIG_PATH, "utf8")).channels.discord).not.toHaveProperty("proxy");
  });
});

describe("Zalo Bot channel", () => {
  it("uses the official getMe endpoint and account-scoped schema", async () => {
    const token = "123456789:secret_value";
    const proxy = "http://proxy-user:proxy-password@192.168.1.4:7890";
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ ok: true, result: { id: "42", name: "ClawBox Zalo" } }), { status: 200 }));
    await expect(zalo.validateZaloBotToken(token, fetcher as typeof fetch, proxy)).resolves.toEqual({ id: "42", name: "ClawBox Zalo" });
    expect(fetcher).toHaveBeenCalledWith(expect.stringContaining("bot-api.zaloplatforms.com"), expect.objectContaining({ dispatcher: expect.anything() }));
    await zalo.saveZaloConfig({ botToken: token, enabled: true, proxy });
    const stored = JSON.parse(await fs.readFile(CONFIG_PATH, "utf8"));
    expect(stored.channels.zalo).toEqual({ enabled: true, accounts: { default: { enabled: true, dmPolicy: "pairing", groupPolicy: "disabled", botToken: token, proxy } } });
    expect(await zalo.getZaloConfig()).toEqual({ configured: true, enabled: true, hasToken: true, hasProxy: true, dmPolicy: "pairing", groupPolicy: "disabled" });
    expect(JSON.stringify(await zalo.getZaloConfig())).not.toContain("proxy-password");

    await zalo.saveZaloConfig({ enabled: true, removeProxy: true });
    expect(JSON.parse(await fs.readFile(CONFIG_PATH, "utf8")).channels.zalo.accounts.default).not.toHaveProperty("proxy");
  });
});

describe("Signal channel", () => {
  it("normalizes an E.164 account and writes the external signal-cli configuration", async () => {
    const view = await signal.saveSignalConfig({ account: "+86 138-0000-0000", cliPath: "/usr/local/bin/signal-cli", enabled: true });
    const stored = JSON.parse(await fs.readFile(CONFIG_PATH, "utf8"));
    expect(stored.channels.signal).toMatchObject({ account: "+8613800000000", cliPath: "/usr/local/bin/signal-cli", enabled: true, dmPolicy: "pairing" });
    expect(view).toMatchObject({ configured: true, enabled: true, account: "+8613800000000" });
  });

  it("extracts only a real sgnl link-device URI", () => {
    const uri = "sgnl://linkdevice?uuid=abcd&pub_key=xyz";
    expect(qr.parseSignalLinkOutput(`Scan this QR\n${uri}\nWaiting`)).toBe(uri);
    expect(qr.parseSignalLinkOutput("not a Signal link")).toBeNull();
  });

  it("accepts only signal-cli's explicit linked-account success output", () => {
    expect(qr.parseSignalLinkedAccount("Associated with: +8613800000000\n")).toBe("+8613800000000");
    expect(qr.parseSignalLinkedAccount("sgnl://linkdevice?uuid=abc&pub_key=xyz")).toBeNull();
    expect(qr.parseSignalLinkedAccount("Process exited successfully")).toBeNull();
  });

  it("checks the signal-cli executable before starting a QR session", async () => {
    const runner = vi.fn(async () => ({ stdout: "signal-cli 0.13.20", stderr: "" }));
    await expect(signal.ensureSignalCli("/opt/signal-cli", runner)).resolves.toBeUndefined();
    expect(runner).toHaveBeenCalledWith(
      "/opt/signal-cli",
      ["--version"],
      expect.objectContaining({ timeoutMs: 10_000 }),
    );
  });
});

describe("QR-backed Zalo channels", () => {
  it("keeps the Zalo Personal risk acknowledgement out of the strict OpenClaw schema", async () => {
    const view = await zalouser.saveZaloPersonalConfig({ enabled: false, riskAccepted: true });
    const openclaw = JSON.parse(await fs.readFile(CONFIG_PATH, "utf8"));
    const setup = JSON.parse(await fs.readFile(SETUP_CONFIG_PATH, "utf8"));

    expect(openclaw.channels.zalouser).toEqual({ enabled: false, dmPolicy: "pairing" });
    expect(openclaw.channels.zalouser).not.toHaveProperty("riskAccepted");
    expect(setup.zalouser_risk_accepted).toBe(true);
    expect(view).toMatchObject({ configured: false, enabled: false, riskAccepted: true });
  });

  it("reads a delayed Zalo Personal QR image and removes only the trusted temp artifact", async () => {
    const qrPath = path.join(
      os.tmpdir(),
      `openclaw-zalouser-qr-test-${process.pid}-${Date.now()}.png`,
    );
    const delayedWrite = new Promise<void>((resolve, reject) => {
      setTimeout(() => {
        fs.writeFile(qrPath, Buffer.from("small-qr-image")).then(resolve, reject);
      }, 150);
    });

    await expect(qr.parsePngPathOutput(`Scan QR image: ${qrPath}\n`)).resolves.toMatch(
      /^data:image\/png;base64,/,
    );
    await delayedWrite;
    await qr.cleanupPngPathOutput(`Scan QR image: ${qrPath}\n`);
    await expect(fs.stat(qrPath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("extracts only the official plugin's fallback login URL", () => {
    const url = "https://bot.zaloplatforms.com/agent/login?zbsk=temporary";
    expect(clawbot.CLAWBOT_PLUGIN_SPEC).toBe("@zalo-platforms/openclaw-zaloclawbot@0.1.4");
    expect(qr.parseClawBotLoginUrl(`If the QR didn't render, open this URL: ${url}`)).toBe(url);
    expect(qr.parseClawBotLoginUrl("Connected to Zalo. account clawbot-1")).toBeNull();
  });
});

describe("runtime evidence", () => {
  const configured = { gatewayReachable: true, channelAccounts: { discord: [{ running: true, connected: false }] } };

  it("does not call a merely running account connected without a successful probe", () => {
    expect(runtime.parseRuntimeChannelStatus(configured, "discord")).toMatchObject({ state: "configured", running: true, connected: false });
  });

  it("requires explicit connected or running plus a successful probe", () => {
    expect(runtime.parseRuntimeChannelStatus({ gatewayReachable: true, channelAccounts: { discord: [{ running: true, probe: { ok: true } }] } }, "discord")).toMatchObject({ state: "connected", connected: true });
  });

  it("redacts QR links and token-shaped values from command errors", () => {
    const sanitized = runtime.sanitizeChannelOutput("failed sgnl://linkdevice?uuid=secret 123456:ABCDEFGHIJKLMNOPQRSTUVWXYZ");
    expect(sanitized).not.toContain("uuid=secret");
    expect(sanitized).not.toContain("ABCDEFGHIJKLMNOPQRSTUVWXYZ");
  });
});

describe("channel setup UI", () => {
  it("contains the additional channels, unified Zalo modes, bilingual copy, and QR routes", async () => {
    const source = await fs.readFile(path.join(process.cwd(), "components/ChannelSetupExtras.tsx"), "utf8");
    for (const label of ["Discord", "Zalo", "Official Bot", "Official ClawBot", "Personal account", "Signal"]) expect(source).toContain(label);
    expect(source).toContain('role="tablist"');
    expect(source).toContain("Existing configurations for other modes are preserved");
    expect(source).toContain("https://discord.com/developers/applications");
    expect(source).toContain("https://bot.zaloplatforms.com");
    expect(source).toContain("/setup-api/channels/zalo-clawbot/login-status");
    expect(source).toContain("/setup-api/channels/zalouser/login-status");
    expect(source).toContain("/setup-api/channels/signal/login-status");
    expect(source).toContain('locale === "zh-CN"');
    expect(source).toContain("I understand the unofficial Zalo Personal account risk");
    expect(source).toContain("<ChannelProxyInput id=\"discord\"");
    expect(source).toContain("<ChannelProxyInput id=\"zalo\"");
  });

  it("exposes one unified Zalo channel through the chat-channel picker", async () => {
    const source = await fs.readFile(
      path.join(process.cwd(), "components/DoneStep.tsx"),
      "utf8",
    );

    for (const id of ["discord", "zalo", "signal"]) {
      expect(source).toContain(`id: "${id}"`);
    }
    expect(source).toContain('tag: "ZL", name: "Zalo"');
    expect(source).toContain('description: "Use one of three Zalo connection modes: official Bot, official ClawBot, or personal-account QR login"');
    expect(source).not.toContain('id: "zalo-clawbot", tag');
    expect(source).not.toContain('id: "zalouser", tag');
    expect(source).toContain("isAdditionalChatChannel(activeChatChannel)");
    expect(source).toContain("<ChannelSetupExtras");
    expect(source).toContain("activeChannel={activeChatChannel}");
    expect(source).toContain("onCompletionChange={handleAdditionalChannelCompletion}");
    expect(source).toContain("refreshAllAdditionalChannelStatuses(controller.signal)");
    expect(source).toContain("<ChannelProxyInput");
  });
});
