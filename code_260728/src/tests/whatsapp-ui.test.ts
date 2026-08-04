import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("WhatsApp setup UI", () => {
  it("makes QR linking and both account modes unambiguous", async () => {
    const source = await fs.readFile(
      path.join(process.cwd(), "components/DoneStep.tsx"),
      "utf-8",
    );

    expect(source).toContain('t("Confirm settings and generate QR code")');
    expect(source).toContain('t("Both account modes link WhatsApp by scanning a QR code.")');
    expect(source).toContain('whatsappMode === "dedicated"');
    expect(source).toContain('id="whatsapp-dedicated-mode-help"');
    expect(source).toContain("Use a separate WhatsApp number as the assistant account.");
    expect(source).toContain("through separate direct chats; group chats remain disabled");
    expect(source).toContain("an administrator must approve new users through OpenClaw pairing");
    expect(source).toContain("no owner number is required");
    expect(source).toContain('t("Your allowed WhatsApp number (required, international format)")');
    expect(source).not.toContain('t("Why this number is required")');
    expect(source).not.toContain("whatsapp-owner-number-purpose-title");
    expect(source).toContain("The QR code signs in and links WhatsApp.");
    expect(source).toContain("adds this number to the message allowlist and enables self-chat so the owner can message the assistant directly");
    expect(source).toContain("It is not used to sign in or receive a verification code");
    expect(source).not.toContain('t("Owner phone number (optional)")');
    expect(source).toContain('aria-describedby="whatsapp-owner-number-purpose whatsapp-owner-number-help"');
    expect(source).toContain('aria-required="true"');
    expect(source).toContain("const whatsappConfigurationLocked =");
    expect(source).toContain('&& (channelSaving === "whatsapp" || whatsappQrLoading || whatsappQrPolling)');
    expect(source).toContain('disabled={whatsappConfigurationLocked}');
    expect(source).toContain('disabled={!canConfigureWechat || whatsappConfigurationLocked}');

    const purpose = source.indexOf('id="whatsapp-owner-number-purpose"');
    const ownerInput = source.indexOf('id="whatsapp-owner-number"');
    const ownerHelp = source.indexOf('id="whatsapp-owner-number-help"');
    const confirmButton = source.indexOf('t("Confirm settings and generate QR code")');
    const qrImage = source.indexOf('alt={t("WhatsApp linking QR code")}');
    expect(purpose).toBeGreaterThan(-1);
    expect(ownerInput).toBeGreaterThan(purpose);
    expect(ownerHelp).toBeGreaterThan(ownerInput);
    expect(ownerHelp).toBeGreaterThan(-1);
    expect(confirmButton).toBeGreaterThan(ownerHelp);
    expect(qrImage).toBeGreaterThan(confirmButton);
  });

  it("waits for a scan, accepts refreshed QR images, and bounds start requests", async () => {
    const source = await fs.readFile(
      path.join(process.cwd(), "components/DoneStep.tsx"),
      "utf-8",
    );
    const loginStatusCall = source.match(
      /fetchWithTimeout\(\s*"\/setup-api\/channels\/whatsapp\/login-status",[\s\S]*?WHATSAPP_LOGIN_STATUS_REQUEST_TIMEOUT_MS,\s*\);/,
    )?.[0];

    expect(source).toContain('"/setup-api/channels/whatsapp/login-status"');
    expect(source).toContain("currentQrDataUrl: whatsappQrDataUrl");
    expect(source).toContain("isTerminalWhatsAppLoginMessage(message)");
    expect(source).toContain("setWhatsappQrDataUrl(data.qrDataUrl)");
    expect(source).toContain("fetchWithTimeout(");
    expect(source).toContain("WHATSAPP_PREPARE_REQUEST_TIMEOUT_MS");
    expect(source).toContain("WHATSAPP_QR_REQUEST_TIMEOUT_MS");
    expect(source).toContain("WHATSAPP_LOGIN_STATUS_REQUEST_TIMEOUT_MS");
    expect(loginStatusCall).toContain("signal: controller.signal");
    expect(source.match(/errorCode: "request_timeout"/g)).toHaveLength(3);
  });

  it("provides Chinese copy for confirmation and network diagnostics", async () => {
    const messages = await fs.readFile(
      path.join(process.cwd(), "lib/i18n.ts"),
      "utf-8",
    );

    const englishMessages = messages.slice(
      messages.indexOf("const EN_MESSAGES"),
      messages.indexOf("export function isLocale"),
    );
    for (const key of [
      "Confirm settings and generate QR code",
      "Saving settings and generating QR code...",
      "Both account modes link WhatsApp by scanning a QR code.",
      "Use a separate WhatsApp number as the assistant account. This mode is recommended when multiple people use the assistant through separate direct chats; group chats remain disabled. After QR linking, an administrator must approve new users through OpenClaw pairing before they can message the assistant; no owner number is required.",
      "Your allowed WhatsApp number (required, international format)",
      "The QR code signs in and links WhatsApp. In personal mode, OpenClaw adds this number to the message allowlist and enables self-chat so the owner can message the assistant directly.",
      "Use the number of the WhatsApp account you will link, including the country or region code, for example +8613800000000. It is not used to sign in or receive a verification code; an incorrect number may cause your messages to be rejected.",
      "Diagnostic details",
      "OpenClaw Gateway is unavailable. Check the network, DNS, proxy, and TLS settings on the device running Gateway, then retry.",
      "Waiting for the scan. This page will detect the connection and refresh the QR code automatically.",
      "WhatsApp step 1",
      "WhatsApp step 2",
      "WhatsApp step 3",
    ]) {
      expect(messages).toContain(`"${key}":`);
    }
    for (const key of ["WhatsApp step 1", "WhatsApp step 2", "WhatsApp step 3"]) {
      expect(englishMessages).toContain(`"${key}":`);
    }
  });
});
