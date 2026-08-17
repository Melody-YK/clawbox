import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.doUnmock("child_process");
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("restartGateway", () => {
  it("signals the systemd MainPID instead of matching a process name", async () => {
    const execFile = vi.fn(
      (
        _file: string,
        _args: string[],
        _options: object,
        callback: (error: null, result: { stdout: string; stderr: string }) => void,
      ) => callback(null, { stdout: "609\n", stderr: "" }),
    );
    vi.doMock("child_process", () => ({ execFile }));
    const kill = vi.spyOn(process, "kill").mockReturnValue(true);

    const { restartGateway } = await import("@/lib/openclaw-config");
    await restartGateway();

    expect(execFile).toHaveBeenCalledWith(
      "systemctl",
      ["show", "clawbox-gateway.service", "--property=MainPID", "--value"],
      { timeout: 3_000 },
      expect.any(Function),
    );
    expect(kill).toHaveBeenCalledWith(609, "SIGUSR1");
  });

  it("does not signal an invalid or stopped service PID", async () => {
    const execFile = vi.fn(
      (
        _file: string,
        _args: string[],
        _options: object,
        callback: (error: null, result: { stdout: string; stderr: string }) => void,
      ) => callback(null, { stdout: "0\n", stderr: "" }),
    );
    vi.doMock("child_process", () => ({ execFile }));
    const kill = vi.spyOn(process, "kill").mockReturnValue(true);

    const { restartGateway } = await import("@/lib/openclaw-config");

    await expect(restartGateway()).rejects.toThrow("clawbox-gateway is not running");
    expect(kill).not.toHaveBeenCalled();
  });
});
