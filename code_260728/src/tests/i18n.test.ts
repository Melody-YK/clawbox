import fs from "fs/promises";
import path from "path";
import { describe, expect, it } from "vitest";
import {
  resolveLocale,
  translate,
  translateRuntime,
} from "@/lib/i18n";

describe("setup i18n", () => {
  it("resolves a saved locale before the browser preference", () => {
    expect(resolveLocale("en", ["zh-CN"])).toBe("en");
    expect(resolveLocale("zh-CN", ["en-US"])).toBe("zh-CN");
  });

  it("uses simplified Chinese for Chinese browser locales", () => {
    expect(resolveLocale(null, ["zh-HK", "en-US"])).toBe("zh-CN");
    expect(resolveLocale("unsupported", ["en-US"])).toBe("en");
  });

  it("translates typed messages and interpolates values", () => {
    expect(
      translate("zh-CN", "Connected to {ssid}. You can continue setup on this network.", {
        ssid: "Office WiFi",
      }),
    ).toBe("已连接到 Office WiFi。现在可以在此网络中继续设置。");
    expect(translate("en", "Retry")).toBe("Retry");
  });

  it("retranslates dynamic channel status messages", () => {
    expect(translateRuntime("zh-CN", "Telegram is online as @clawbox_bot.")).toBe(
      "Telegram 已在线，机器人为 @clawbox_bot。",
    );
    expect(translateRuntime("zh-CN", "2 Feishu pairing requests waiting for approval.")).toBe(
      "2 个飞书配对请求等待批准。",
    );
    expect(translateRuntime("zh-CN", "WhatsApp is linked but currently offline.")).toBe(
      "WhatsApp 已关联，但当前离线。",
    );
    expect(
      translateRuntime(
        "zh-CN",
        "LINE received a verified inbound webhook; the channel is active.",
      ),
    ).toBe("LINE 已收到经过验证的入站 Webhook，通道已激活。");
  });

  it("switches language without reloading the page", async () => {
    const selector = await fs.readFile(
      path.join(process.cwd(), "components/LanguageSelector.tsx"),
      "utf-8",
    );
    const provider = await fs.readFile(
      path.join(process.cwd(), "components/I18nProvider.tsx"),
      "utf-8",
    );

    expect(selector).not.toContain("window.location.reload");
    expect(provider).toContain("window.localStorage.setItem");
    expect(provider).toContain("document.documentElement.lang = locale");
  });
});
