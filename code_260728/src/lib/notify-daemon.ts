/**
 * 平台二维码触发文件 —— ClawBox 部署补丁维护
 *
 * 网页端生成微信/飞书/QQ/WhatsApp 等渠道二维码后写入此文件,
 * 外设守护进程检测 mtime 变化 → 即时刷新墨水屏页面2。
 * 内容: { platform, qr_type, qr_url, updated_at }
 *
 * qr_type 说明:
 *   - "url"  (默认): qr_url 为可编码字符串 → 墨水屏用 qrcode 库生成二维码 (微信/飞书/QQ)
 *   - "image": qr_url 为 data:image/png;base64 图片 → 墨水屏图片直显 (WhatsApp)
 */
import fs from "fs/promises";
import { randomUUID } from "node:crypto";
import path from "path";

export const CHAT_QR_TRIGGER_FILE = "/home/clawbox/clawbox/data/chat-qr.json";

export async function notifyDaemonChatQr(
  platform: string,
  qrUrl: string,
  qrType: "url" | "image" = "url",
): Promise<boolean> {
  try {
    await fs.mkdir(path.dirname(CHAT_QR_TRIGGER_FILE), {
      recursive: true,
      mode: 0o770,
    });
    const tmpFile = `${CHAT_QR_TRIGGER_FILE}.${process.pid}.${Date.now()}.${randomUUID()}.tmp`;
    await fs.writeFile(
      tmpFile,
      JSON.stringify({
        platform,
        qr_type: qrType,
        qr_url: qrUrl,
        updated_at: Date.now(),
      }),
      { encoding: "utf-8", mode: 0o640 },
    );
    await fs.rename(tmpFile, CHAT_QR_TRIGGER_FILE);
    return true;
  } catch (err) {
    console.error(
      `[Chat QR] Failed to notify peripheral daemon (${platform}):`,
      err,
    );
    return false;
  }
}

/**
 * 语言触发文件 —— ClawBox 部署补丁维护
 *
 * 网页端语言变化后经 POST /setup-api/locale 写入此文件,
 * 外设守护进程检测 mtime 变化 → 切换墨水屏文案语言并重绘当前页。
 * 内容: { locale, updated_at }
 *
 * locale 为浏览器原样透传的语言代码 (en/zh-CN/ko/ru/...),
 * 不做白名单限制 —— 识别与翻译全部由守护进程负责。
 */
export const LOCALE_TRIGGER_FILE = "/home/clawbox/clawbox/data/locale.json";

export async function notifyDaemonLocale(locale: string): Promise<boolean> {
  try {
    await fs.mkdir(path.dirname(LOCALE_TRIGGER_FILE), {
      recursive: true,
      mode: 0o770,
    });
    const tmpFile = `${LOCALE_TRIGGER_FILE}.${process.pid}.${Date.now()}.${randomUUID()}.tmp`;
    await fs.writeFile(
      tmpFile,
      JSON.stringify({
        locale,
        updated_at: Date.now(),
      }),
      { encoding: "utf-8", mode: 0o640 },
    );
    await fs.rename(tmpFile, LOCALE_TRIGGER_FILE);
    return true;
  } catch (err) {
    console.error(
      "[Locale] Failed to notify peripheral daemon:",
      err,
    );
    return false;
  }
}
