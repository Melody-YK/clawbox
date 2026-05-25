import { NextResponse } from "next/server";
import { spawn } from "child_process";
import { getAll, setMany } from "@/lib/config-store";

export const dynamic = "force-dynamic";

const OPENCLAW_BIN = "/home/clawbox/.npm-global/bin/openclaw";
const OPENCLAW_HOME = "/home/clawbox";
const QR_URL_RE = /https:\/\/liteapp\.weixin\.qq\.com\/\S+/g;

function extractQrUrl(text: string): string | null {
  const all = text.match(QR_URL_RE);
  if (!all || all.length === 0) return null;
  return all[all.length - 1] ?? null;
}

async function requestWechatQrCode(): Promise<{ qrUrl: string }> {
  return await new Promise((resolve, reject) => {
    const child = spawn(
      OPENCLAW_BIN,
      ["channels", "login", "--channel", "openclaw-weixin"],
      {
        cwd: OPENCLAW_HOME,
        env: {
          ...process.env,
          HOME: OPENCLAW_HOME,
          PATH: `/home/clawbox/.npm-global/bin:${process.env.PATH ?? ""}`,
        },
      },
    );

    let output = "";
    let settled = false;

    const finish = (err?: Error, url?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (!child.killed) {
        child.kill("SIGTERM");
      }
      if (err) {
        reject(err);
        return;
      }
      if (!url) {
        reject(new Error("QR code link not found in login output"));
        return;
      }
      resolve({ qrUrl: url });
    };

    const onChunk = (buf: Buffer) => {
      const text = buf.toString("utf8");
      output += text;
      const qrUrl = extractQrUrl(output);
      if (qrUrl) {
        finish(undefined, qrUrl);
      }
    };

    child.stdout.on("data", onChunk);
    child.stderr.on("data", onChunk);
    child.on("error", (err) => finish(err));

    child.on("close", (code) => {
      if (settled) return;
      const qrUrl = extractQrUrl(output);
      if (qrUrl) {
        finish(undefined, qrUrl);
        return;
      }
      finish(new Error(`openclaw login exited with code ${code ?? "unknown"}`));
    });

    const timer = setTimeout(() => {
      const qrUrl = extractQrUrl(output);
      if (qrUrl) {
        finish(undefined, qrUrl);
        return;
      }
      finish(new Error("Timed out while generating WeChat QR code"));
    }, 35_000);
  });
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
    const { qrUrl } = await requestWechatQrCode();
    await setMany({ wechat_last_error: undefined }).catch(() => {});
    return NextResponse.json({
      success: true,
      qrUrl,
      message: "QR code generated. If it expires, click refresh.",
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to generate QR code";
    await setMany({ wechat_last_error: message }).catch(() => {});
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
