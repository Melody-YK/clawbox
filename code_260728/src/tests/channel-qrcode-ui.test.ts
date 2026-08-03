import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("channel QR setup UI", () => {
  it("uses QR setup as the primary Feishu and QQ flow", async () => {
    const source = await fs.readFile(
      path.join(process.cwd(), "components/DoneStep.tsx"),
      "utf-8",
    );

    expect(source).toContain('const AUTO_QR_CHANNELS: readonly AutoQrChannelId[] = ["feishu", "qqbot"]');
    expect(source).toContain("<ChannelQrSetupPanel");
    expect(source).toContain("<QRCodeSVG");
    expect(source).toContain("session.qrUrl");
    expect(source).toContain("`/setup-api/channels/${channel}/qrcode`");
    expect(source).toContain('method: "POST"');
    expect(source).toContain('method: "DELETE"');
    expect(source).toContain("window.setInterval(poll, 1_500)");
    expect(source).toContain('t("I already have an app")');
    expect(source).toContain('"x-clawbox-qr-owner"');
    expect(source).toContain('"x-clawbox-qr-session"');
    expect(source).toContain("QR_OPAQUE_OWNER_PATTERN.test(value)");
    expect(source).toContain("channelQrRequestVersionsRef.current[channel]");
    expect(source).toContain("channelQrRefreshesRef.current[channel]");
    expect(source).toContain("channelQrActionsRef.current[channel]");
    expect(source).toContain("refreshStoredChannelConfig(channel");
    expect(source).toContain('void requestChannelQr("feishu")');
  });

  it("keeps the existing manual credentials and unrelated channel flows", async () => {
    const source = await fs.readFile(
      path.join(process.cwd(), "components/DoneStep.tsx"),
      "utf-8",
    );

    expect(source).toContain('placeholder: "cli_xxxxxxxxxxxxxxxx"');
    expect(source).toContain('placeholder: "QQ Bot Client Secret"');
    expect(source).toContain("<ChannelCredentialGuide channel={channelId} />");
    expect(source).toContain("prepareWhatsApp");
    expect(source).toContain('https://t.me/BotFather');
    expect(source).toContain('channelId === "line"');
    expect(source).toContain("disabled={!canConfigureWechat || qrBusy}");
    expect(source).toContain('t("Cancel or finish QR setup before using manual configuration.")');
  });

  it("provides Chinese copy for every primary QR action", async () => {
    const messages = await fs.readFile(
      path.join(process.cwd(), "lib/i18n.ts"),
      "utf-8",
    );

    for (const key of [
      "Scan to connect",
      "Generate QR code",
      "Connect another bot",
      "QR setup cancelled.",
      "I already have an app",
      "Another browser tab is configuring this channel. Finish or cancel it there first.",
      "QR authorization could not be completed.",
      "Credentials were saved, but the channel did not come online.",
    ]) {
      expect(messages).toContain(`"${key}":`);
    }
  });
});
