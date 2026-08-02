import { probeWhatsAppChannel } from "@/lib/channels/whatsapp";
import {
  noStoreJson,
  whatsappErrorCode,
  whatsappErrorMessage,
  whatsappErrorStatus,
} from "../response";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return noStoreJson(await probeWhatsAppChannel());
  } catch (error) {
    const code = whatsappErrorCode(error);
    return noStoreJson(
      {
        state: "error",
        linked: false,
        connected: false,
        running: false,
        pluginAvailable: code === "plugin_unavailable" ? false : null,
        lastError: whatsappErrorMessage(
          error,
          "Failed to check WhatsApp status.",
        ),
        errorCode: code,
      },
      { status: whatsappErrorStatus(error) },
    );
  }
}
