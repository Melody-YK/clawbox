import { NextResponse } from "next/server";
import { getAll, setMany } from "@/lib/config-store";
import { readConfig, writeConfig, restartGateway, saveWeixinAccount } from "@/lib/openclaw-config";
import fs from "fs/promises";
import path from "path";

export const dynamic = "force-dynamic";

const ILINK_BASE_URL = "https://ilinkai.weixin.qq.com";
const QR_POLL_INTERVAL_MS = 2_000;
const QR_MAX_POLL_MS = 120_000;

interface QrSession {
  qrcodeKey: string;
  qrUrl: string;
  startedAt: number;
  status: "pending" | "scaned" | "confirmed" | "expired" | "error";
  botToken?: string;
  accountId?: string;
  userId?: string;
  message?: string;
}

let activeSession: QrSession | null = null;
let pollTimer: NodeJS.Timeout | null = null;

/**
 * Start a new QR login session by calling the iLink API directly.
 */
async function startQrSession(): Promise<QrSession> {
  const resp = await fetch(`${ILINK_BASE_URL}/ilink/bot/get_bot_qrcode?bot_type=3`, {
    method: "GET",
    headers: {
      "iLink-App-ClientVersion": "1",
    },
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`iLink QR API failed: ${resp.status} ${resp.statusText}. ${text}`);
  }

  const data = await resp.json() as {
    ret: number;
    qrcode: string;
    qrcode_img_content: string;
    errmsg?: string;
  };

  if (data.ret !== 0) {
    throw new Error(`iLink QR API returned ret=${data.ret}: ${data.errmsg || "unknown error"}`);
  }

  return {
    qrcodeKey: data.qrcode,
    qrUrl: data.qrcode_img_content,
    startedAt: Date.now(),
    status: "pending",
  };
}

/**
 * Poll the QR scan status from iLink API.
 */
async function pollQrStatus(session: QrSession): Promise<QrSession> {
  const resp = await fetch(
    `${ILINK_BASE_URL}/ilink/bot/get_qrcode_status?qrcode=${encodeURIComponent(session.qrcodeKey)}`,
    {
      method: "GET",
      headers: {
        "iLink-App-ClientVersion": "1",
      },
    },
  );

  if (!resp.ok) {
    session.status = "error";
    session.message = `Status poll failed: ${resp.status}`;
    return session;
  }

  const data = await resp.json() as {
    ret: number;
    status: string;
    bot_token?: string;
    ilink_bot_id?: string;
    ilink_user_id?: string;
    errmsg?: string;
  };

  if (data.ret !== 0) {
    session.status = "error";
    session.message = `Status poll error: ret=${data.ret} ${data.errmsg || ""}`;
    return session;
  }

  switch (data.status) {
    case "scaned":
      session.status = "scaned";
      session.message = "QR code scanned. Please confirm on your phone.";
      break;
    case "confirmed":
      session.status = "confirmed";
      session.botToken = data.bot_token;
      session.accountId = data.ilink_bot_id;
      session.userId = data.ilink_user_id;
      session.message = "Login confirmed! Saving credentials...";
      break;
    case "expired":
      session.status = "expired";
      session.message = "QR code expired. Please refresh.";
      break;
    default:
      // still pending
      break;
  }

  return session;
}

/**
 * Save WeChat credentials to OpenClaw config and restart gateway.
 * 关键修复：同一 userId 的旧账号会被清理，防止多账号冲突导致 Gateway 崩溃。
 */
async function saveWechatCredentials(
  botToken: string,
  accountId: string,
  userId: string,
): Promise<void> {
  const config = await readConfig();

  if (!config.channels) {
    config.channels = {};
  }

  // 获取现有的 openclaw-weixin 配置（保留其他字段如 dmPolicy, allowFrom, enabled）
  const existingChannel = (config.channels["openclaw-weixin"] || {}) as Record<string, any>;

  // 【关键修复】单账号场景：直接替换整个 accounts，不保留任何历史账号
  const newAccounts = {
    [accountId]: {
      token: botToken,
      userId: userId,
      baseUrl: ILINK_BASE_URL,
    },
  };

  // const existingAccounts = (existingChannel.accounts || {}) as Record<string, any>;
  // const cleanedAccounts: Record<string, any> = {};

  // // 清理同一 userId 的所有旧账号（关键修复！）

  // for (const [id, acc] of Object.entries(existingAccounts)) {
  //   if (acc.userId !== userId) {
  //     cleanedAccounts[id] = acc; // 保留其他 userId 的账号
  //   } else {
  //     // 删除旧的 account 文件
  //     const oldAccountPath = path.join(
  //       process.env.OPENCLAW_HOME || "/home/clawbox/.openclaw",
  //       "openclaw-weixin", "accounts", `${id}.json`
  //     );
  //     try {
  //       await fs.unlink(oldAccountPath);
  //       console.log(`[WeChat QR] Removed old account file for ${id}`);
  //     } catch {
  //       // 文件可能不存在，忽略
  //     }
      
  //     // 【关键】从 accounts.json 索引中移除旧账号
  //     const stateDir = path.join(
  //       process.env.OPENCLAW_HOME || "/home/clawbox/.openclaw",
  //       "openclaw-weixin"
  //     );
  //     const indexPath = path.join(stateDir, "accounts.json");
  //     try {
  //       const raw = await fs.readFile(indexPath, "utf-8");
  //       const index = JSON.parse(raw);
  //       if (Array.isArray(index)) {
  //         const updated = index.filter((accId: string) => accId !== id);
  //         await fs.writeFile(indexPath, JSON.stringify(updated, null, 2), "utf-8");
  //         console.log(`[WeChat QR] Removed ${id} from accounts.json index`);
  //       }
  //     } catch {
  //       // 索引文件可能不存在，忽略
  //     }

  //   }
  // }

  // 构建新的 channel 配置，使用 cleanedAccounts（旧账号已移除）
  config.channels["openclaw-weixin"] = {
    ...existingChannel,           // 保留 dmPolicy, allowFrom, enabled 等
    enabled: true,
    dmPolicy: "open",
    allowFrom: ["*"],
    accounts: newAccounts
    // {
    //   ...cleanedAccounts,           // ← 关键：只保留其他 userId 的旧账号
    //   [accountId]: {
    //     token: botToken,
    //     userId: userId,
    //     baseUrl: ILINK_BASE_URL,
    //   },
    // },
  };

  // 清理旧格式的 wechat 配置
  if (config.channels["wechat"]) {
    delete config.channels["wechat"];
  }

  await writeConfig(config);
    // saveWeixinAccount 现在权限正常，会以 openclaw.json 为权威重建 accounts.json 和 accounts/ 目录
  await saveWeixinAccount(accountId, botToken, userId);
  await restartGateway();
}

/**
 * Start a background polling task that checks iLink QR status until
 * confirmed, expired, or error. This is used when nowait=1 so the
 * HTTP response returns immediately but the server keeps polling.
 */
function startBackgroundPoll(session: QrSession): void {
  // Clear any existing timer
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }

  const deadline = Date.now() + QR_MAX_POLL_MS;

  pollTimer = setInterval(async () => {
    // Session was replaced or cleared — stop polling
    if (!activeSession || activeSession.qrcodeKey !== session.qrcodeKey) {
      if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
      return;
    }

    // Deadline reached
    if (Date.now() > deadline) {
      activeSession.status = "expired";
      activeSession.message = "QR code expired.";
      if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
      return;
    }

    // Poll iLink status
    try {
      activeSession = await pollQrStatus(activeSession);
    } catch (err) {
      console.error("[WeChat QR] Background poll error:", err);
      activeSession.status = "error";
      activeSession.message = err instanceof Error ? err.message : "Poll failed";
      if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
      return;
    }

    // Confirmed — save credentials
    if (activeSession.status === "confirmed" && activeSession.botToken) {
      try {
        await saveWechatCredentials(
          activeSession.botToken,
          activeSession.accountId!,
          activeSession.userId!,
        );
        await setMany({ wechat_last_error: undefined }).catch(() => {});
        console.log("[WeChat QR] Background poll: credentials saved successfully");
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error("[WeChat QR] Background poll: failed to save credentials:", message);
        await setMany({ wechat_last_error: message }).catch(() => {});
        activeSession.status = "error";
        activeSession.message = `Save failed: ${message}`;
      }
      if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
      return;
    }

    // Expired or error — stop polling
    if (activeSession.status === "expired" || activeSession.status === "error") {
      if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
      return;
    }
  }, QR_POLL_INTERVAL_MS);
}

export async function POST(request: Request) {
  const url = new URL(request.url);
  const forceRefresh = url.searchParams.get("force") === "1";
  const nowait = url.searchParams.get("nowait") === "1";

  const config = await getAll();
  if (!config.ai_model_configured) {
    return NextResponse.json(
      { error: "Configure your AI provider before setting up WeChat." },
      { status: 409 },
    );
  }

  try {
    // Force refresh: invalidate current session
    if (forceRefresh) {
      activeSession = null;
      if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
    }

    // Start a new session if none exists or current one expired/error/confirmed
    if (!activeSession || ["expired", "error", "confirmed"].includes(activeSession.status)) {
      activeSession = await startQrSession();
    }

    // If already confirmed, return the saved credentials
    if (activeSession.status === "confirmed" && activeSession.botToken) {
      await saveWechatCredentials(
        activeSession.botToken,
        activeSession.accountId!,
        activeSession.userId!,
      );
      await setMany({ wechat_last_error: undefined }).catch(() => {});
      return NextResponse.json({
        success: true,
        qrUrl: activeSession.qrUrl,
        connected: true,
        accountId: activeSession.accountId,
        issuedAt: activeSession.startedAt,
        message: "WeChat connected successfully!",
      });
    }

    // If scaned, just return current state (user needs to confirm on phone)
    if (activeSession.status === "scaned") {
      return NextResponse.json({
        pending: true,
        qrUrl: activeSession.qrUrl,
        message: activeSession.message,
        status: activeSession.status,
      }, { status: 202 });
    }

    // Poll for status if not in nowait mode (blocking)
    if (!nowait) {
      const deadline = Date.now() + QR_MAX_POLL_MS;
      while (Date.now() < deadline && activeSession.status === "pending") {
        await new Promise((r) => setTimeout(r, QR_POLL_INTERVAL_MS));
        activeSession = await pollQrStatus(activeSession);

        if (activeSession.status === "confirmed" && activeSession.botToken) {
          await saveWechatCredentials(
            activeSession.botToken,
            activeSession.accountId!,
            activeSession.userId!,
          );
          await setMany({ wechat_last_error: undefined }).catch(() => {});
          return NextResponse.json({
            success: true,
            qrUrl: activeSession.qrUrl,
            connected: true,
            accountId: activeSession.accountId,
            issuedAt: activeSession.startedAt,
            message: "WeChat connected successfully!",
          });
        }

        if (activeSession.status === "expired" || activeSession.status === "error") {
          break;
        }
      }
    } else {
      // nowait=1: start background polling and return QR immediately
      startBackgroundPoll(activeSession);
    }

    // Return current state (pending, scaned, expired, or error)
    if (activeSession.status === "expired") {
      return NextResponse.json({
        error: activeSession.message || "QR code expired.",
        qrUrl: activeSession.qrUrl,
        expired: true,
      }, { status: 410 });
    }

    if (activeSession.status === "error") {
      return NextResponse.json({
        error: activeSession.message || "QR login failed.",
      }, { status: 502 });
    }

    // Still pending or scaned (or just started background poll)
    return NextResponse.json({
      pending: true,
      qrUrl: activeSession.qrUrl,
      message: activeSession.message || "Waiting for QR scan...",
      status: activeSession.status,
    }, { status: 202 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to start WeChat QR login";
    await setMany({ wechat_last_error: message }).catch(() => {});
    return NextResponse.json({ error: message }, { status: 502 });
  }
}