import fs from "fs/promises";
import path from "path";
import { describe, expect, it } from "vitest";
import { resolveSetupFlowState } from "@/lib/setup-flow";

describe("setup flow UI behavior", () => {
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
      path.join(process.cwd(), "src/components/WifiStep.tsx"),
      "utf-8",
    );

    expect(source).not.toMatch(/setTimeout\s*\(\s*\(\)\s*=>\s*onNext/);
  });
});
