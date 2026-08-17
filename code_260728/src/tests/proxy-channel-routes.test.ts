import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

type RoutePost = (request: Request) => Promise<Response>;

const getAllMock = vi.fn();
const setManyMock = vi.fn();
const readConfigMock = vi.fn();

const discordMocks = {
  getDiscordConfig: vi.fn(),
  getDiscordTokenFromConfig: vi.fn(),
  getDiscordProxyFromConfig: vi.fn(),
  validateDiscordBotToken: vi.fn(),
  saveDiscordConfig: vi.fn(),
  restartDiscordGateway: vi.fn(),
};

const zaloMocks = {
  getZaloConfig: vi.fn(),
  getZaloBotToken: vi.fn(),
  getZaloProxy: vi.fn(),
  validateZaloBotToken: vi.fn(),
  saveZaloConfig: vi.fn(),
  restartZaloGateway: vi.fn(),
};

let discordPost: RoutePost;
let zaloPost: RoutePost;

function jsonRequest(body: unknown): Request {
  return new Request("http://localhost/test", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeAll(async () => {
  vi.resetModules();
  vi.doMock("@/lib/config-store", () => ({ getAll: getAllMock, setMany: setManyMock }));
  vi.doMock("@/lib/openclaw-config", () => ({ readConfig: readConfigMock }));
  vi.doMock("@/lib/channels/discord", () => discordMocks);
  vi.doMock("@/lib/channels/zalo", () => zaloMocks);

  ({ POST: discordPost } = await import("@/app/setup-api/channels/discord/route"));
  ({ POST: zaloPost } = await import("@/app/setup-api/channels/zalo/route"));
});

beforeEach(() => {
  vi.clearAllMocks();
  getAllMock.mockResolvedValue({ ai_model_configured: true });
  setManyMock.mockResolvedValue(undefined);
  readConfigMock.mockResolvedValue({ channels: {} });

  discordMocks.getDiscordTokenFromConfig.mockReturnValue("discord-secret-token");
  discordMocks.getDiscordProxyFromConfig.mockReturnValue(null);
  discordMocks.validateDiscordBotToken.mockResolvedValue({ id: "1", username: "clawbox", globalName: null });
  discordMocks.saveDiscordConfig.mockResolvedValue({ configured: true, enabled: true, hasToken: true, hasProxy: true });
  discordMocks.restartDiscordGateway.mockResolvedValue(undefined);

  zaloMocks.getZaloBotToken.mockResolvedValue("123456789:secret_value");
  zaloMocks.getZaloProxy.mockResolvedValue("http://192.168.1.4:7890");
  zaloMocks.validateZaloBotToken.mockResolvedValue({ id: "42", name: "ClawBox Zalo" });
  zaloMocks.saveZaloConfig.mockResolvedValue({ configured: true, enabled: true, hasToken: true, hasProxy: false });
  zaloMocks.restartZaloGateway.mockResolvedValue(undefined);
});

describe("proxy-aware channel routes", () => {
  it("validates and saves Discord with the final proxy without echoing credentials", async () => {
    const proxy = "http://proxy-user:proxy-password@192.168.1.4:7890";
    const response = await discordPost(jsonRequest({ enabled: true, proxy }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(discordMocks.validateDiscordBotToken).toHaveBeenCalledWith(
      "discord-secret-token",
      expect.any(Function),
      proxy,
    );
    expect(discordMocks.saveDiscordConfig).toHaveBeenCalledWith(
      expect.objectContaining({ proxy, removeProxy: false }),
    );
    expect(body.hasProxy).toBe(true);
    expect(JSON.stringify(body)).not.toContain("proxy-password");
  });

  it("removes the Zalo account proxy while retaining the bot token", async () => {
    const response = await zaloPost(jsonRequest({ enabled: true, removeProxy: true }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(zaloMocks.validateZaloBotToken).toHaveBeenCalledWith(
      "123456789:secret_value",
      expect.any(Function),
      null,
    );
    expect(zaloMocks.saveZaloConfig).toHaveBeenCalledWith({
      botToken: undefined,
      enabled: true,
      proxy: undefined,
      removeProxy: true,
    });
    expect(body.hasProxy).toBe(false);
  });

  it("rejects unsupported proxy schemes before validating credentials", async () => {
    const response = await discordPost(jsonRequest({ enabled: true, proxy: "socks5://192.168.1.4:7891" }));

    expect(response.status).toBe(400);
    expect(discordMocks.validateDiscordBotToken).not.toHaveBeenCalled();
    expect(discordMocks.saveDiscordConfig).not.toHaveBeenCalled();
  });
});
