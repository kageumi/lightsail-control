import { isMap, isScalar, isSeq, parseDocument } from "yaml";
import { HttpError } from "./types";

export const subscriptionKey = "clash";
export const singBoxKey = "sing-box";
const nonServerTypes = new Set([
  "direct",
  "block",
  "reject",
  "reject-drop",
  "pass",
  "dns",
  "selector",
  "urltest",
  "url-test",
  "fallback",
  "load-balance",
  "relay",
]);
function hasProxyServer(type: unknown, server: unknown): server is string {
  return (
    typeof server === "string" &&
    !!server.trim() &&
    !(typeof type === "string" && nonServerTypes.has(type.toLowerCase()))
  );
}

export async function contentDigest(content: string) {
  const bytes = new TextEncoder().encode(content);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const sha256 = [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return { size: bytes.byteLength, sha256 };
}

export function updateClashServer(content: string, ip: string): string {
  const document = parseDocument(content, { logLevel: "silent" });
  if (document.errors.length)
    throw new HttpError(422, "Clash 配置不是有效的 YAML");
  const proxies = isMap(document.contents)
    ? document.contents.get("proxies", true)
    : document.contents;
  if (isSeq(proxies)) {
    for (const node of proxies.items) {
      if (!isMap(node)) continue;
      const server = node.get("server", true);
      if (
        !isScalar(server) ||
        !server.range ||
        !hasProxyServer(node.get("type"), server.value)
      )
        continue;
      if (server.value === ip) return content;
      const [start, end] = server.range;
      const original = content.slice(start, end);
      const replacement = original.startsWith('"')
        ? JSON.stringify(ip)
        : original.startsWith("'")
          ? `'${ip}'`
          : ip;
      return content.slice(0, start) + replacement + content.slice(end);
    }
  }
  throw new HttpError(422, "Clash 配置中未找到具有 server 地址的代理节点");
}

export function updateSingBoxServer(content: string, ip: string): string {
  let config: unknown;
  try {
    config = JSON.parse(content);
  } catch {
    throw new HttpError(422, "sing-box 配置不是有效的 JSON");
  }
  if (
    !config ||
    typeof config !== "object" ||
    !("outbounds" in config) ||
    !Array.isArray(config.outbounds)
  )
    throw new HttpError(422, "sing-box 配置缺少 outbounds 数组");
  const first = config.outbounds.find(
    (outbound: unknown): outbound is Record<string, unknown> =>
      !!outbound &&
      typeof outbound === "object" &&
      "server" in outbound &&
      hasProxyServer(
        "type" in outbound ? outbound.type : undefined,
        outbound.server,
      ),
  );
  if (!first)
    throw new HttpError(422, "sing-box 配置中未找到具有 server 地址的代理节点");
  if (first.server === ip) return content;
  first.server = ip;
  return JSON.stringify(config, null, 2) + (content.endsWith("\n") ? "\n" : "");
}

export async function syncSubscriptions(
  store: KVNamespace,
  ip: string,
): Promise<void> {
  const targets = [
    { key: subscriptionKey, label: "Clash", update: updateClashServer },
    { key: singBoxKey, label: "sing-box", update: updateSingBoxServer },
  ];
  const results = await Promise.allSettled(
    targets.map(async (target) => {
      const { value, metadata } = await store.getWithMetadata(target.key);
      if (value === null || !value.trim())
        throw new HttpError(404, "订阅配置尚未保存");
      const updated = target.update(value, ip);
      if (updated === value) return;
      const digest = await contentDigest(updated);
      await store.put(target.key, updated, {
        metadata: {
          ...(metadata && typeof metadata === "object" ? metadata : {}),
          size: digest.size,
          sha256: digest.sha256,
          updatedAt: Date.now(),
        },
      });
    }),
  );
  const failures: { status: number; message: string }[] = [];
  results.forEach((result, index) => {
    if (result.status === "rejected") {
      const error: unknown = result.reason;
      failures.push({
        status: error instanceof HttpError ? error.status : 503,
        message: `${targets[index].label}：${error instanceof HttpError ? error.message : "订阅写入失败，请重试"}`,
      });
    }
  });
  if (failures.length)
    throw new HttpError(
      failures[0].status,
      failures.map((failure) => failure.message).join("；"),
    );
}
