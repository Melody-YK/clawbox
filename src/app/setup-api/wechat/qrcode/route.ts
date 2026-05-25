import { NextResponse } from "next/server";
import { spawn, type ChildProcessWithoutNullStreams } from "child_process";
import { getAll, setMany } from "@/lib/config-store";

export const dynamic = "force-dynamic";

const OPENCLAW_BIN = "/home/clawbox/.npm-global/bin/openclaw";
const OPENCLAW_HOME = "/home/clawbox";
const QR_URL_RE = /https:\/\/liteapp\.weixin\.qq\.com\/\S+/g;
const QR_WAIT_TIMEOUT_MS = 140_000;
const PROCESS_MAX_LIFETIME_MS = 240_000;

function stripAnsi(input: string): string {
  return input.replace(/\u001B\[[0-9;]*[A-Za-z]/g, "");
}

function extractQrUrl(text: string): string | null {
  const clean = stripAnsi(text);
  const all = clean.match(QR_URL_RE);
  if (!all || all.length === 0) return null;
  return all[all.length - 1] ?? null;
}

type LoginProcState = {
  child: ChildProcessWithoutNullStreams;
  startedAt: number;
  output: string;
  qrUrl?: string;
  done: boolean;
  connected: boolean;
  accountId?: string;
  message?: string;
};

let loginProc: LoginProcState | null = null;

function parseConnected(state: LoginProcState) {
  const clean = stripAnsi(state.output);
  if (/已将此\s*OpenClaw\s*连接到微信/.test(clean) || /Login confirmed!/i.test(clean)) {
    state.connected = true;
    state.done = true;
  }
  const m = clean.match(/ilink_bot_id=([A-Za-z0-9_-]+)/);
  if (m?.[1]) state.accountId = m[1];
}

function startLoginProcess(): LoginProcState {
  const child = spawn(
    OPENCLAW_BIN,
    ["channels", "login", "--channel", "openclaw-weixin", "--verbose"],
    {
      cwd: OPENCLAW_HOME,
      env: {
        ...process.env,
        HOME: OPENCLAW_HOME,
        PATH: `/home/clawbox/.npm-global/bin:${process.env.PATH ?? ""}`,
      },
    },
  );

  const state: LoginProcState = {
    child,
    startedAt: Date.now(),
    output: "",
    done: false,
    connected: false,
  };

  const onChunk = (buf: Buffer) => {
    const text = buf.toString("utf8");
    state.output += text;
    if (!state.qrUrl) {
      const qr = extractQrUrl(state.output);
      if (qr) state.qrUrl = qr;
    }
    parseConnected(state);
  };

  child.stdout.on("data", onChunk);
  child.stderr.on("data", onChunk);
  child.on("error", (err) => {
    state.done = true;
    state.message = err.message;
  });
  child.on("close", () => {
    state.done = true;
    parseConnected(state);
  });

  // hard-stop stale process
  setTimeout(() => {
    if (!state.done && !child.killed) {
      child.kill("SIGTERM");
    }
  }, PROCESS_MAX_LIFETIME_MS).unref();

  return state;
}

async function ensureQrUrl(): Promise<
  | { qrUrl: string; connected: boolean; accountId?: string }
  | { pending: true; message: string }
> {
  // reuse existing in-flight process if possible
  if (!loginProc || loginProc.done) {
    loginProc = startLoginProcess();
  }

  if (loginProc.qrUrl) {
    return {
      qrUrl: loginProc.qrUrl,
      connected: loginProc.connected,
      accountId: loginProc.accountId,
    };
  }

  const started = Date.now();
  while (Date.now() - started < QR_WAIT_TIMEOUT_MS) {
    if (loginProc.qrUrl) {
      return {
        qrUrl: loginProc.qrUrl,
        connected: loginProc.connected,
        accountId: loginProc.accountId,
      };
    }
    if (loginProc.done) {
      break;
    }
    await new Promise((r) => setTimeout(r, 500));
  }

  if (!loginProc.done) {
    return {
      pending: true,
      message: "Login is still starting. Retry in a few seconds.",
    };
  }

  const tail = stripAnsi(loginProc.output).slice(-1200);
  throw new Error(`Timed out while generating WeChat QR code. output_tail=${tail}`);
}

export async function POST() {
  const config = await getAll();
  if (!config.ai_model_configured) {
    return NextResponse.json(
      { error: "Configure your AI provider before setting up WeChat." },
      { status: 409 },
    );
  }

  try {
    const result = await ensureQrUrl();
    if ("pending" in result) {
      return NextResponse.json(
        { pending: true, message: result.message },
        { status: 202 },
      );
    }

    await setMany({ wechat_last_error: undefined }).catch(() => {});
    return NextResponse.json({
      success: true,
      qrUrl: result.qrUrl,
      connected: result.connected,
      accountId: result.accountId,
      message: "QR code generated. Scan in WeChat and keep this page open until status turns connected.",
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to generate QR code";
    await setMany({ wechat_last_error: message }).catch(() => {});
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
