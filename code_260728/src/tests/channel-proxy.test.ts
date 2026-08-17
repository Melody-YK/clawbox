import { describe, expect, it, vi } from "vitest";
import {
  fetchWithChannelProxy,
  normalizeChannelProxy,
  resolveChannelProxyUpdate,
} from "@/lib/channels/proxy";

describe("channel proxy helpers", () => {
  it("accepts HTTP and HTTPS proxy URLs without exposing credentials", async () => {
    const proxy = "http://proxy-user:proxy-password@192.168.1.4:7890";
    const fetcher = vi.fn(async () => new Response("ok", { status: 200 }));

    expect(normalizeChannelProxy(proxy)).toBe(proxy);
    await fetchWithChannelProxy("https://api.telegram.org", { method: "GET" }, proxy, fetcher as typeof fetch);

    expect(fetcher).toHaveBeenCalledWith(
      "https://api.telegram.org",
      expect.objectContaining({ dispatcher: expect.anything() }),
    );
    expect(JSON.stringify(await fetcher.mock.results[0].value)).not.toContain("proxy-password");
  });

  it("rejects unsupported protocols and proxy URLs with request paths", () => {
    for (const proxy of [
      "socks5://192.168.1.4:7891",
      "ftp://192.168.1.4:21",
      "http://192.168.1.4:7890/proxy-path",
      "not-a-url",
    ]) {
      expect(() => normalizeChannelProxy(proxy)).toThrowError(
        "Enter a valid HTTP or HTTPS proxy URL.",
      );
    }
  });

  it("preserves, replaces, and removes a saved proxy explicitly", () => {
    const existing = "http://192.168.1.4:7890";
    expect(resolveChannelProxyUpdate(existing, {})).toBe(existing);
    expect(resolveChannelProxyUpdate(existing, { proxy: "https://proxy.example:8443" })).toBe(
      "https://proxy.example:8443",
    );
    expect(resolveChannelProxyUpdate(existing, { removeProxy: true })).toBeNull();
  });
});
