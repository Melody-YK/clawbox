import fs from "fs/promises";
import path from "path";
import { describe, expect, it } from "vitest";
import {
  resolveLocale,
  translate,
  translateRuntime,
} from "@/lib/i18n";
import { i18n } from "@/i18n.config";

describe("setup i18n", () => {
  it("exposes all configured language options", () => {
    expect(i18n.locales).toHaveLength(21);
  });

  it("resolves a saved locale before the browser preference", () => {
    expect(resolveLocale("en", ["zh-CN"])).toBe("en");
    expect(resolveLocale("zh-CN", ["en-US"])).toBe("zh-CN");
  });

  it("resolves supported browser language families", () => {
    expect(resolveLocale(null, ["zh-HK", "en-US"])).toBe("zh-CN");
    expect(resolveLocale(null, ["ja-JP", "en-US"])).toBe("ja");
    expect(resolveLocale(null, ["pt-BR", "en-US"])).toBe("pt-BR");
    expect(resolveLocale("unsupported", ["en-US"])).toBe("en");
  });

  it("translates typed messages and interpolates values", () => {
    expect(
      translate("zh-CN", "Connected to {ssid}. You can continue setup on this network.", {
        ssid: "Office WiFi",
      }),
    ).toBe("已连接到 Office WiFi。现在可以在此网络中继续设置。");
    expect(translate("en", "Retry")).toBe("Retry");
    expect(translate("zh-CN", "How to get a Telegram Bot Token")).toBe(
      "\u5982\u4f55\u83b7\u53d6 Telegram Bot Token",
    );
    expect(translate("zh-CN", "Prepare and show QR code")).toBe(
      "\u51c6\u5907\u5e76\u663e\u793a\u4e8c\u7ef4\u7801",
    );
    expect(translate("ja", "welcome")).toBe("ClawBox へようこそ");
    expect(translate("ru", "wifi_step_title")).toBe("Подключение к WiFi");
    expect(translate("fr", "system_update")).toBe("Mise à jour système");
    expect(
      translate("fr", "wifi_switching_status", { ssid: "Office WiFi" }),
    ).toContain("Office WiFi");
  });

  it("translates the finish setup action in every configured locale", () => {
    for (const { code } of i18n.locales) {
      expect(translate(code, "finish_setup")).not.toBe("finish_setup");
    }
    expect(translate("zh-CN", "finish_setup")).toBe("完成设置");
  });

  it("translates the security, hotspot, and access section in Simplified Chinese", () => {
    const messages = {
      set_password: "设置密码",
      confirm_password: "确认密码",
      min_8_chars: "至少 8 个字符",
      enable_setup_hotspot: "启用设置热点",
      hotspot_name: "热点名称",
      hotspot_password_optional: "热点密码（可选）",
      leave_empty_open: "留空表示无密码",
      access: "访问地址",
      ipv4_fallback: "IPv4 备用地址",
      optional_dns_alias: "DNS 别名（可选）",
      memory: "内存",
      storage: "存储空间",
      temperature: "温度",
      cpu_timeline: "CPU 趋势",
      cores: "核",
      free: "可用",
      loading_system_info: "正在加载系统信息...",
    } as const;

    for (const [key, value] of Object.entries(messages)) {
      expect(translate("zh-CN", key)).toBe(value);
    }
  });

  it("translates the dashboard WiFi section in Simplified Chinese", () => {
    const messages = {
      network_name: "网络名称（SSID）",
      wifi_name: "输入 WiFi 名称",
      wifi_reconnect_note:
        "连接新 WiFi 会暂时中断当前页面。设备接入新网络后，请通过 .local 地址或设备显示的 IP 重新访问。",
      open_wifi_setup: "打开 WiFi 设置页面",
      selected_wifi: "所选 WiFi",
      wifi_skipped_status: "已跳过 WiFi 配置，当前继续使用以太网连接。",
      wifi_connected_status:
        "WiFi 已连接。请在系统浏览器中打开设备的 .local 地址；如果当前设备无法解析 .local，请使用设备屏幕显示的 IP 地址。",
    } as const;

    for (const [key, value] of Object.entries(messages)) {
      expect(translate("zh-CN", key)).toBe(value);
    }
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
    expect(selector).toContain("i18n.locales.map");
    expect(selector).toContain("<select");
    expect(provider).toContain("window.localStorage.setItem");
    expect(provider).toContain("document.documentElement.lang = locale");
    expect(provider).toContain("JSON.stringify({ locale: nextLocale })");
    expect(provider).not.toContain("JSON.stringify({ locale })");
  });
});
