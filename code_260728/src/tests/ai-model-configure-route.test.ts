import { EventEmitter } from "events";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  spawn: vi.fn(),
  readFile: vi.fn(),
  mkdir: vi.fn(),
  writeFile: vi.fn(),
  rename: vi.fn(),
  chown: vi.fn(),
  setMany: vi.fn(),
  restartGateway: vi.fn(),
  updateConfig: vi.fn(),
}));

vi.mock("child_process", () => ({ spawn: mocks.spawn }));
vi.mock("fs/promises", () => ({
  default: {
    readFile: mocks.readFile,
    mkdir: mocks.mkdir,
    writeFile: mocks.writeFile,
    rename: mocks.rename,
    chown: mocks.chown,
  },
}));
vi.mock("@/lib/config-store", () => ({ setMany: mocks.setMany }));
vi.mock("@/lib/openclaw-config", () => ({
  restartGateway: mocks.restartGateway,
  updateConfig: mocks.updateConfig,
}));

let post: (request: Request) => Promise<Response>;

function createSuccessfulChild() {
  const child = new EventEmitter() as EventEmitter & {
    stderr: EventEmitter;
    stdin: { end: ReturnType<typeof vi.fn> };
    kill: ReturnType<typeof vi.fn>;
  };
  child.stderr = new EventEmitter();
  child.stdin = { end: vi.fn(() => queueMicrotask(() => child.emit("close", 0))) };
  child.kill = vi.fn();
  return child;
}

function request(body: unknown): Request {
  return new Request("http://localhost/setup-api/ai-models/configure", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeAll(async () => {
  vi.useFakeTimers();
  ({ POST: post } = await import("@/app/setup-api/ai-models/configure/route"));
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.readFile.mockResolvedValue(JSON.stringify({ version: 1, profiles: {} }));
  mocks.mkdir.mockResolvedValue(undefined);
  mocks.writeFile.mockResolvedValue(undefined);
  mocks.rename.mockResolvedValue(undefined);
  mocks.chown.mockResolvedValue(undefined);
  mocks.setMany.mockResolvedValue(undefined);
  mocks.restartGateway.mockResolvedValue(undefined);
  mocks.updateConfig.mockImplementation(async (update) => update({}));
  mocks.spawn.mockImplementation(() => createSuccessfulChild());
});

afterAll(() => {
  vi.useRealTimers();
});

describe("AI model configure route", () => {
  it("writes the authoritative credential store and reloads after responding", async () => {
    const response = await post(
      request({ provider: "deepseek", apiKey: "test-api-key", authMode: "token" }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ success: true, saved: true, applying: true });
    expect(mocks.spawn).toHaveBeenCalledTimes(1);
    expect(mocks.spawn).toHaveBeenCalledWith(
      "/usr/bin/python3",
      ["-c", expect.stringContaining("auth_profile_store")],
      expect.objectContaining({ cwd: "/home/clawbox" }),
    );
    const child = mocks.spawn.mock.results[0].value as ReturnType<typeof createSuccessfulChild>;
    expect(child.stdin.end).toHaveBeenCalledWith(
      expect.stringContaining('"deepseek:default"'),
    );
    expect(child.stdin.end).toHaveBeenCalledWith(
      expect.stringContaining('"deepseek:manual"'),
    );
    expect(mocks.updateConfig).toHaveBeenCalledOnce();
    const update = mocks.updateConfig.mock.calls[0][0] as (config: Record<string, unknown>) => unknown;
    const config: Record<string, any> = {};
    update(config);
    expect(config).toMatchObject({
      auth: { profiles: { "deepseek:default": { provider: "deepseek", mode: "token" } } },
      agents: { defaults: { model: { primary: "deepseek/deepseek-v4-flash" } } },
      gateway: {
        auth: { mode: "none" },
        controlUi: {
          allowInsecureAuth: true,
          dangerouslyDisableDeviceAuth: true,
        },
      },
      models: { mode: "merge" },
    });
    expect(mocks.setMany).toHaveBeenCalledWith(
      expect.objectContaining({
        ai_model_configured: true,
        ai_model_provider: "deepseek",
        ai_model_last_error: undefined,
      }),
    );
    expect(mocks.restartGateway).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(100);
    expect(mocks.restartGateway).toHaveBeenCalledOnce();
  });

  it("records a background reload failure without undoing the saved state", async () => {
    mocks.restartGateway.mockRejectedValue(new Error("reload denied"));

    const response = await post(
      request({ provider: "deepseek", apiKey: "test-api-key", authMode: "token" }),
    );
    expect(response.status).toBe(200);

    await vi.advanceTimersByTimeAsync(100);
    expect(mocks.setMany).toHaveBeenCalledWith({
      ai_model_gateway_reload_error: "reload denied",
    });
    expect(mocks.setMany).not.toHaveBeenCalledWith(
      expect.objectContaining({ ai_model_configured: false }),
    );
  });

  it("stores API-key providers as token auth even if subscription is requested", async () => {
    await post(
      request({ provider: "deepseek", apiKey: "test-api-key", authMode: "subscription" }),
    );

    const written = mocks.writeFile.mock.calls[0][1] as string;
    const profileStore = JSON.parse(written) as {
      profiles: Record<string, { type: string; provider: string; token?: string }>;
    };
    expect(profileStore.profiles["deepseek:default"]).toEqual({
      type: "token",
      provider: "deepseek",
      token: "test-api-key",
    });
    expect(profileStore.profiles["deepseek:manual"]).toEqual({
      type: "token",
      provider: "deepseek",
      token: "test-api-key",
    });
  });

  it("stores subscription credentials as OAuth without overwriting manual token profiles", async () => {
    await post(
      request({
        provider: "openai",
        apiKey: "access-token",
        authMode: "subscription",
        refreshToken: "refresh-token",
        expiresIn: 120,
      }),
    );

    const child = mocks.spawn.mock.results[0].value as ReturnType<typeof createSuccessfulChild>;
    const payload = JSON.parse(child.stdin.end.mock.calls[0][0]) as {
      profiles: Record<string, { type: string; provider: string; access?: string; refresh?: string }>;
    };
    expect(payload.profiles["openai-codex:default"]).toMatchObject({
      type: "oauth",
      provider: "openai-codex",
      access: "access-token",
      refresh: "refresh-token",
    });
    expect(payload.profiles["openai-codex:manual"]).toBeUndefined();
  });

  it("returns an error instead of reporting a saved model when the auth store write fails", async () => {
    const child = createSuccessfulChild();
    child.stdin.end.mockImplementation(() => queueMicrotask(() => child.emit("close", 1)));
    mocks.spawn.mockReturnValue(child);

    const response = await post(
      request({ provider: "deepseek", apiKey: "test-api-key", authMode: "token" }),
    );
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.error).toBe("Unable to save model credentials. Please retry.");
    expect(mocks.updateConfig).not.toHaveBeenCalled();
    expect(mocks.setMany).not.toHaveBeenCalledWith(
      expect.objectContaining({ ai_model_configured: true }),
    );
  });
});
