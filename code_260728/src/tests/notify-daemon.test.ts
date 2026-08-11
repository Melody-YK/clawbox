import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fsMocks = vi.hoisted(() => ({
  mkdir: vi.fn(async (_path: string, _options: object) => undefined),
  writeFile: vi.fn(
    async (_file: string, _data: string, _options: object) => undefined,
  ),
  rename: vi.fn(async (_oldPath: string, _newPath: string) => undefined),
}));

vi.mock("fs/promises", () => ({ default: fsMocks }));

import { LOCALE_TRIGGER_FILE, notifyDaemonLocale } from "@/lib/notify-daemon";

describe("peripheral daemon notifications", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(Date, "now").mockReturnValue(1_786_436_075_341);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("uses a distinct temporary file for concurrent locale writes", async () => {
    await Promise.all([
      notifyDaemonLocale("en"),
      notifyDaemonLocale("zh-CN"),
    ]);

    const temporaryFiles = fsMocks.writeFile.mock.calls.map(([file]) => file);
    expect(temporaryFiles).toHaveLength(2);
    expect(new Set(temporaryFiles).size).toBe(2);
    expect(fsMocks.rename.mock.calls).toEqual([
      [temporaryFiles[0], LOCALE_TRIGGER_FILE],
      [temporaryFiles[1], LOCALE_TRIGGER_FILE],
    ]);
  });
});
