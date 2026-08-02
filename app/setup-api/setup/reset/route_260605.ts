import { NextResponse } from "next/server";
import { resetUpdateState } from "@/lib/updater";
import { DATA_DIR } from "@/lib/config-store";
import { execFile as execFileCb } from "child_process";
import { promisify } from "util";
import fs from "fs/promises";
import path from "path";
import { restartAP } from "@/lib/network";

const execFile = promisify(execFileCb);

export const dynamic = "force-dynamic";
const OPENCLAW_DIR = "/home/clawbox/.openclaw";
const PRESERVE_FILES = new Set(["network.env"]);

async function deleteWifiConnections(): Promise<void> {
  const { stdout } = await execFile("nmcli", ["-t", "-f", "NAME,TYPE", "connection", "show"], {
    timeout: 10_000,
  });
  const wifiNames = stdout
    .trim()
    .split("\n")
    .filter((line) => line.endsWith(":802-11-wireless"))
    .map((line) => line.slice(0, -":802-11-wireless".length));

  for (const name of wifiNames) {
    await execFile("nmcli", ["connection", "delete", name], { timeout: 10_000 }).catch((err) => {
      console.warn(`[Reset] Failed to delete WiFi connection '${name}':`, err instanceof Error ? err.message : err);
    });
  }
  if (wifiNames.length > 0) {
    console.log(`[Reset] Deleted ${wifiNames.length} saved WiFi connection(s)`);
  }
}

async function removeDirectoryContents(dir: string): Promise<string[]> {
  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch (err: unknown) {
    if (err && typeof err === "object" && "code" in err && err.code === "ENOENT") return [];
    throw err;
  }
  const results = await Promise.allSettled(
    entries.map(entry => fs.rm(path.join(dir, entry), { recursive: true, force: true }))
  );
  const failures = results
    .map((r, i) => r.status === "rejected" ? `${entries[i]}: ${r.reason}` : null)
    .filter((f): f is string => f !== null);
  if (failures.length > 0) {
    console.warn(`[Reset] Failed to remove ${failures.length} item(s) in ${dir}:`, failures);
  }
  return failures;
}

export async function POST() {
  try {
    resetUpdateState();

    const dataFailures: string[] = [];
    try {
      const entries = await fs.readdir(DATA_DIR);
      const results = await Promise.allSettled(
        entries
          .filter(entry => !PRESERVE_FILES.has(entry))
          .map(entry => fs.rm(path.join(DATA_DIR, entry), { recursive: true, force: true }))
      );
      for (const r of results) {
        if (r.status === "rejected") dataFailures.push(String(r.reason));
      }
    } catch (err: unknown) {
      if (!(err && typeof err === "object" && "code" in err && err.code === "ENOENT")) throw err;
    }

    const openclawFailures = await removeDirectoryContents(OPENCLAW_DIR);
    const allFailures = [...dataFailures, ...openclawFailures];
    if (allFailures.length > 0) {
      console.warn(`[Reset] ${allFailures.length} file deletion(s) failed — continuing with reboot`);
    }

    await deleteWifiConnections().catch((err) => {
      console.error("[Reset] WiFi cleanup failed:", err instanceof Error ? err.message : err);
    });

    if (allFailures.length > 0) {
      return NextResponse.json(
        { error: `Factory reset incomplete: ${allFailures.length} file deletion(s) failed`, failures: allFailures },
        { status: 500 },
      );
    }

    // 延迟 8 秒后同时启动热点和重启，给用户时间看到"重置成功"
    const DELAY_MS = 4_000;
    console.log(`[Reset] Scheduling AP start and reboot in ${DELAY_MS}ms...`);

    setTimeout(async () => {
      console.log("[Reset] Starting AP...");
      try {
        await restartAP();
        console.log("[Reset] AP started successfully");
      } catch (err) {
        console.error("[Reset] Failed to start AP:", err instanceof Error ? err.message : err);
      }

      console.log("[Reset] Rebooting...");
      try {
        await execFile("systemctl", ["reboot"], { timeout: 10_000 });
      } catch (err) {
        console.error("[Reset] Reboot failed:", err instanceof Error ? err.message : err);
      }
    }, DELAY_MS);



    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Factory reset failed" },
      { status: 500 },
    );
  }
}
