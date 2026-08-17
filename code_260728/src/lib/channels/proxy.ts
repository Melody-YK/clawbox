import { ProxyAgent, type Dispatcher } from "undici";

const MAX_PROXY_URL_LENGTH = 2_048;
const proxyAgents = new Map<string, Dispatcher>();

export class ChannelProxyError extends Error {
  readonly code = "invalid_proxy" as const;

  constructor(message: string) {
    super(message);
    this.name = "ChannelProxyError";
  }
}

export function normalizeChannelProxy(value: string): string {
  const proxy = value.trim();
  if (!proxy || proxy.length > MAX_PROXY_URL_LENGTH || /[\r\n]/.test(proxy)) {
    throw new ChannelProxyError("Enter a valid HTTP or HTTPS proxy URL.");
  }

  let parsed: URL;
  try {
    parsed = new URL(proxy);
  } catch {
    throw new ChannelProxyError("Enter a valid HTTP or HTTPS proxy URL.");
  }

  if (
    (parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
    !parsed.hostname ||
    (parsed.pathname && parsed.pathname !== "/") ||
    parsed.search ||
    parsed.hash
  ) {
    throw new ChannelProxyError("Enter a valid HTTP or HTTPS proxy URL.");
  }

  return proxy;
}

export function resolveChannelProxyUpdate(
  existingProxy: string | null,
  input: { proxy?: string; removeProxy?: boolean },
): string | null {
  if (input.removeProxy === true) return null;
  if (input.proxy === undefined) return existingProxy;
  return normalizeChannelProxy(input.proxy);
}

function getProxyDispatcher(proxy: string): Dispatcher {
  const normalized = normalizeChannelProxy(proxy);
  const existing = proxyAgents.get(normalized);
  if (existing) return existing;

  const dispatcher = new ProxyAgent(normalized);
  proxyAgents.set(normalized, dispatcher);
  return dispatcher;
}

export function fetchWithChannelProxy(
  input: string | URL,
  init: RequestInit,
  proxy: string | null | undefined,
  fetcher: typeof fetch = fetch,
): Promise<Response> {
  if (!proxy) return fetcher(input, init);

  const requestInit = {
    ...init,
    dispatcher: getProxyDispatcher(proxy),
  } as RequestInit;
  return fetcher(input, requestInit);
}
