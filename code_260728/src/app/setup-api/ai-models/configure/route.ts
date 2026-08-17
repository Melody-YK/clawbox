export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { spawn } from "child_process";
import fs from "fs/promises";
import path from "path";
import { setMany } from "@/lib/config-store";
import { restartGateway, updateConfig } from "@/lib/openclaw-config";

const AUTH_PROFILES_PATH =
  "/home/clawbox/.openclaw/agents/main/agent/auth-profiles.json";
const AUTH_STORE_PATH =
  "/home/clawbox/.openclaw/agents/main/agent/openclaw-agent.sqlite";
const CLAWBOX_UID = process.getuid?.() ?? 1000;
const CLAWBOX_GID = process.getgid?.() ?? 1000;

interface ProviderConfig {
  defaultModel: string;
  profileKey: string;
  hasSubscription: boolean;
  subscriptionOverride?: { defaultModel: string; profileKey: string };
}

const PROVIDERS: Record<string, ProviderConfig> = {
  anthropic: {
    defaultModel: "anthropic/claude-sonnet-4-6",
    profileKey: "anthropic:default",
    hasSubscription: true,
  },
  openai: {
    defaultModel: "openai/gpt-4o",
    profileKey: "openai:default",
    hasSubscription: true,
    subscriptionOverride: {
      defaultModel: "openai-codex/gpt-5.3-codex",
      profileKey: "openai-codex:default",
    },
  },
  google: {
    defaultModel: "google/gemini-2.0-flash",
    profileKey: "google:default",
    hasSubscription: true,
    subscriptionOverride: {
      defaultModel: "google-gemini-cli/gemini-2.5-flash",
      profileKey: "google-gemini-cli:default",
    },
  },
  openrouter: {
    defaultModel: "openrouter/anthropic/claude-sonnet-4.5",
    profileKey: "openrouter:default",
    hasSubscription: false,
  },
  deepseek: {
    defaultModel: "deepseek/deepseek-v4-flash",
    profileKey: "deepseek:default",
    hasSubscription: false,
  },
};

const PROFILE_KEY_RE = /^[a-zA-Z0-9._-]+(?::[a-zA-Z0-9._-]+)*$/;
const SQLITE_WRITE_TIMEOUT_MS = 5_000;
const GATEWAY_RELOAD_DELAY_MS = 100;
let gatewayReloadTimer: ReturnType<typeof setTimeout> | null = null;

type AuthProfile =
  | { type: "token"; provider: string; token: string }
  | {
      type: "oauth";
      provider: string;
      access: string;
      refresh: string;
      expires: number;
      projectId?: string;
    };

type AuthProfileUpdates = Record<string, AuthProfile>;

type MutableOpenClawConfig = {
  auth?: { profiles?: Record<string, unknown> };
  agents?: { defaults?: { model?: Record<string, unknown> } };
  gateway?: {
    auth?: Record<string, unknown>;
    controlUi?: Record<string, unknown>;
  };
  models?: Record<string, unknown>;
};

function normalizeAiAuthMode(
  provider: ProviderConfig,
  requestedMode: string,
): "token" | "subscription" {
  return requestedMode === "subscription" && provider.hasSubscription
    ? "subscription"
    : "token";
}

function runCommand(
  cmd: string,
  args: string[],
  input: string,
  timeoutMs = SQLITE_WRITE_TIMEOUT_MS,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const child = spawn(cmd, args, {
      stdio: ["pipe", "pipe", "pipe"],
      cwd: "/home/clawbox",
      uid: CLAWBOX_UID,
      gid: CLAWBOX_GID,
      env: { ...process.env, HOME: "/home/clawbox" },
    });
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        child.kill("SIGKILL");
        reject(new Error(`${cmd} timed out after ${timeoutMs}ms`));
      }
    }, timeoutMs);

    child.on("error", (err) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        reject(err);
      }
    });
    child.on("close", (code) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        if (code === 0) resolve();
        else reject(new Error(stderr.trim() || `${cmd} exited with code ${code}`));
      }
    });
    child.stdin.end(input);
  });
}

async function writeAuthProfilesToSqlite(profiles: AuthProfileUpdates): Promise<void> {
  const script = [
    "import json, sqlite3, sys, time",
    `DB = ${JSON.stringify(AUTH_STORE_PATH)}`,
    "payload = json.load(sys.stdin)",
    "db = sqlite3.connect(DB, timeout=2)",
    "db.execute('PRAGMA busy_timeout=2000')",
    "db.execute('CREATE TABLE IF NOT EXISTS auth_profile_store (store_key TEXT PRIMARY KEY, store_json TEXT, updated_at INTEGER)')",
    "row = db.execute(\"SELECT store_json FROM auth_profile_store WHERE store_key='primary'\").fetchone()",
    "store = json.loads(row[0]) if row else {}",
    "if not isinstance(store, dict): store = {}",
    "store.setdefault('version', 1)",
    "stored_profiles = store.setdefault('profiles', {})",
    "stored_profiles.update(payload['profiles'])",
    "db.execute(",
    "  'INSERT INTO auth_profile_store (store_key, store_json, updated_at) VALUES (?,?,?) '",
    "  'ON CONFLICT(store_key) DO UPDATE SET store_json=excluded.store_json, updated_at=excluded.updated_at',",
    "  ('primary', json.dumps(store), int(time.time() * 1000)),",
    ")",
    "db.commit()",
    "db.close()",
  ].join("\n");

  await runCommand("/usr/bin/python3", ["-c", script], JSON.stringify({ profiles }));
}

async function writeLegacyAuthProfiles(profiles: AuthProfileUpdates): Promise<void> {
  let authProfiles: { version: number; profiles: Record<string, AuthProfile> };
  try {
    const raw = await fs.readFile(AUTH_PROFILES_PATH, "utf-8");
    authProfiles = JSON.parse(raw) as {
      version: number;
      profiles: Record<string, AuthProfile>;
    };
  } catch {
    authProfiles = { version: 1, profiles: {} };
  }

  authProfiles.version ||= 1;
  authProfiles.profiles ||= {};
  Object.assign(authProfiles.profiles, profiles);

  await fs.mkdir(path.dirname(AUTH_PROFILES_PATH), { recursive: true });
  const tmpPath = AUTH_PROFILES_PATH + `.tmp.${Date.now()}.${process.pid}`;
  await fs.writeFile(tmpPath, JSON.stringify(authProfiles, null, 2), { mode: 0o600 });
  await fs.rename(tmpPath, AUTH_PROFILES_PATH);
  await fs.chown(AUTH_PROFILES_PATH, CLAWBOX_UID, CLAWBOX_GID);
}

function scheduleGatewayReload(provider: string): void {
  if (gatewayReloadTimer) clearTimeout(gatewayReloadTimer);
  gatewayReloadTimer = setTimeout(() => {
    gatewayReloadTimer = null;
    void restartGateway()
      .then(() =>
        setMany({
          ai_model_gateway_reloaded_at: new Date().toISOString(),
          ai_model_gateway_reload_error: undefined,
        }),
      )
      .catch(async (error) => {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`[configure] Background gateway reload failed for ${provider}:`, message);
        await setMany({ ai_model_gateway_reload_error: message }).catch(() => undefined);
      });
  }, GATEWAY_RELOAD_DELAY_MS);
}

export async function POST(request: Request) {
  try {
    let body: {
      provider?: string;
      apiKey?: string;
      authMode?: string;
      refreshToken?: string;
      expiresIn?: number;
      projectId?: string;
    };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }

    const { provider, apiKey, authMode = "token", refreshToken, expiresIn, projectId } = body;
    if (typeof provider !== "string" || typeof apiKey !== "string" || !apiKey.trim()) {
      return NextResponse.json(
        { error: "Provider and API key are required (cloud providers only)" },
        { status: 400 },
      );
    }

    const baseConfig = PROVIDERS[provider];
    if (!baseConfig) {
      return NextResponse.json({ error: `Unknown provider: ${provider}` }, { status: 400 });
    }

    const normalizedAuthMode = normalizeAiAuthMode(baseConfig, authMode);
    const config =
      normalizedAuthMode === "subscription" && baseConfig.subscriptionOverride
        ? { ...baseConfig.subscriptionOverride }
        : { ...baseConfig };
    const ocProvider = config.profileKey.split(":")[0];

    if (!PROFILE_KEY_RE.test(config.profileKey)) {
      return NextResponse.json({ error: "Invalid profile key format" }, { status: 400 });
    }

    const authProfile: AuthProfile =
      normalizedAuthMode === "subscription"
        ? {
          type: "oauth",
          provider: ocProvider,
          access: apiKey,
          refresh: typeof refreshToken === "string" ? refreshToken : "",
          expires:
            typeof expiresIn === "number" && Number.isFinite(expiresIn) && expiresIn > 0
              ? Date.now() + expiresIn * 1000
              : Date.now() + 8 * 60 * 60 * 1000,
          ...(typeof projectId === "string" && projectId ? { projectId } : {}),
        }
        : {
          type: "token",
          provider: ocProvider,
          token: apiKey,
        };

    const authProfileUpdates: AuthProfileUpdates = {
      [config.profileKey]: authProfile,
    };
    if (normalizedAuthMode === "token") {
      authProfileUpdates[`${ocProvider}:default`] = authProfile;
      authProfileUpdates[`${ocProvider}:manual`] = authProfile;
    }

    // OpenClaw 运行时从 SQLite 读取凭据；失败时不能让页面误报保存成功。
    try {
      await writeAuthProfilesToSqlite(authProfileUpdates);
    } catch (error) {
      console.error(
        `[configure] Unable to save ${ocProvider} credentials to the OpenClaw auth store:`,
        error instanceof Error ? error.message : String(error),
      );
      return NextResponse.json(
        { error: "Unable to save model credentials. Please retry." },
        { status: 500 },
      );
    }
    await writeLegacyAuthProfiles(authProfileUpdates);

    // 原子更新配置，避免启动 OpenClaw CLI 加载插件造成十几秒的保存等待。
    await updateConfig((cfg) => {
      const c = cfg as MutableOpenClawConfig;
      c.auth ??= {};
      c.auth.profiles ??= {};
      c.auth.profiles[config.profileKey] = {
        provider: ocProvider,
        mode: normalizedAuthMode === "subscription" ? "oauth" : "token",
      };
      c.agents ??= {};
      c.agents.defaults ??= {};
      c.agents.defaults.model = {
        ...(c.agents.defaults.model ?? {}),
        primary: config.defaultModel,
      };
      c.gateway ??= {};
      c.gateway.auth = { ...(c.gateway.auth ?? {}), mode: "none" };
      c.gateway.controlUi = {
        ...(c.gateway.controlUi ?? {}),
        allowInsecureAuth: true,
        dangerouslyDisableDeviceAuth: true,
      };
      c.models = { ...(c.models ?? {}), mode: "merge" };
      return cfg;
    });

    await Promise.all(
      ["openclaw.json", "openclaw.json.bak", "openclaw.json.bak.1", "openclaw.json.bak.2"].map((name) =>
        fs.chown(path.join("/home/clawbox/.openclaw", name), CLAWBOX_UID, CLAWBOX_GID).catch(() => {}),
      ),
    );

    await setMany({
      ai_model_configured: true,
      ai_model_provider: provider,
      ai_model_configured_at: new Date().toISOString(),
      ai_model_last_error: undefined,
      ai_model_gateway_reload_error: undefined,
    });

    scheduleGatewayReload(provider);
    return NextResponse.json({ success: true, saved: true, applying: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to configure AI model" },
      { status: 500 },
    );
  }
}
