import fs from "fs/promises";
import path from "path";
import { describe, expect, it } from "vitest";
import { isLocalChannelPreview, resolveSetupFlowState } from "@/lib/setup-flow";

describe("setup flow UI behavior", () => {
  it("only enables the channel preview bypass on local hosts", () => {
    expect(
      isLocalChannelPreview({ hostname: "localhost", search: "?preview=channels" }),
    ).toBe(true);
    expect(
      isLocalChannelPreview({ hostname: "127.0.0.1", search: "?preview=channels" }),
    ).toBe(true);
    expect(
      isLocalChannelPreview({ hostname: "clawbox-123.local", search: "?preview=channels" }),
    ).toBe(false);
    expect(
      isLocalChannelPreview({ hostname: "localhost", search: "?preview=wifi" }),
    ).toBe(false);
  });

  it("keeps the wizard on the WiFi step while the hotspot is active", () => {
    expect(
      resolveSetupFlowState({
        setup_complete: true,
        wifi_configured: true,
        wifi_mode: "ap",
        hotspot_active: true,
      }),
    ).toEqual({
      currentStep: 1,
      setupComplete: false,
    });
  });

  it("advances to the done step only after leaving hotspot mode", () => {
    expect(
      resolveSetupFlowState({
        wifi_configured: true,
        wifi_mode: "client",
        hotspot_active: false,
      }),
    ).toEqual({
      currentStep: 2,
      setupComplete: false,
    });
  });

  it("does not keep the old auto-advance timeout in WifiStep", async () => {
    const source = await fs.readFile(
      path.join(process.cwd(), "components/WifiStep.tsx"),
      "utf-8",
    );

    expect(source).not.toMatch(/setTimeout\s*\(\s*\(\)\s*=>\s*onNext/);
  });

  it("keeps the setup shell and dashboard controls shrinkable on mobile", async () => {
    const [wizard, doneStep, languageSelector] = await Promise.all([
      fs.readFile(path.join(process.cwd(), "components/SetupWizard.tsx"), "utf-8"),
      fs.readFile(path.join(process.cwd(), "components/DoneStep.tsx"), "utf-8"),
      fs.readFile(path.join(process.cwd(), "components/LanguageSelector.tsx"), "utf-8"),
    ]);

    expect(wizard).toContain("w-full min-w-0");
    expect(doneStep).toContain("grid-cols-1 gap-3 sm:grid-cols-2");
    expect(doneStep).toContain("grid-cols-1 gap-3 sm:grid-cols-3");
    expect(doneStep).toContain('data.wifi_skipped');
    expect(doneStep).toContain('? "wifi_skipped_status"');
    expect(doneStep).toContain(': "wifi_connected_status"');
    expect(doneStep).toContain('placeholder={t("wifi_password_placeholder")}');
    expect(doneStep).toContain('message={wifiStatus.message} values={wifiStatus.values}');
    expect(languageSelector).toContain("w-28 shrink-0 sm:w-36");
  });

  it("keeps asynchronous channel notices translatable after a locale change", async () => {
    const source = await fs.readFile(
      path.join(process.cwd(), "components/DoneStep.tsx"),
      "utf-8",
    );
    const statusLogic = source.slice(
      source.indexOf("const saveChatChannel"),
      source.indexOf("if (providerDone && !wechatDone)"),
    );

    expect(statusLogic).not.toMatch(/message:\s*t\(/);
    expect(statusLogic).toContain(
      'message: "QR setup completed and the channel is connected."',
    );
    expect(source).toContain(
      "message={channelStatuses[channelId].message} values={channelStatuses[channelId].values} suffix={channelStatuses[channelId].suffix}",
    );
  });

  it("shows and approves pending Telegram users from the channel page", async () => {
    const [doneStep, telegramChannel] = await Promise.all([
      fs.readFile(path.join(process.cwd(), "components/DoneStep.tsx"), "utf-8"),
      fs.readFile(path.join(process.cwd(), "lib/channels/telegram.ts"), "utf-8"),
    ]);

    expect(doneStep).toContain("<TelegramPairingPanel");
    expect(doneStep).toContain('fetch("/setup-api/channels/telegram/pairing"');
    expect(doneStep).toContain('method: "POST"');
    expect(doneStep).toContain('message: "Telegram user approved. Return to Telegram and send a new message."');
    expect(doneStep).toContain('t("Telegram step 4")');
    expect(telegramChannel).toContain("const OPENCLAW_PAIRING_TIMEOUT_MS = 30_000;");
    expect(telegramChannel.match(/OPENCLAW_PAIRING_TIMEOUT_MS/g)).toHaveLength(3);
  });
});
