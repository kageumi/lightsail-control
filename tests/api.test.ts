import { describe, it, expect, vi, beforeEach } from "vitest";
import worker from "../worker/index";
import {
  issueSession,
  validSession,
  equalPassword,
  clearFailures,
} from "../worker/auth";
import type { Env } from "../worker/types";
vi.mock("../worker/aws", () => ({
  getInstance: vi.fn(),
  listInstances: vi.fn(),
  aws: vi.fn(),
  regions: vi.fn(),
}));
import { getInstance, listInstances, aws, regions } from "../worker/aws";
type StoredValue = { value: string; metadata: Record<string, unknown> | null };
const kv = new Map<string, StoredValue>();
const store = (
  key: string,
  value: string,
  metadata: Record<string, unknown> | null = null,
) => kv.set(key, { value, metadata });
const env = {
  ADMIN_PASSWORD: "Test123!",
  AWS_REGIONS: "ap-northeast-1",
  ASSETS: { fetch: vi.fn() },
  SUB: {
    get: vi.fn((key: string) => Promise.resolve(kv.get(key)?.value ?? null)),
    getWithMetadata: vi.fn((key: string) =>
      Promise.resolve(kv.get(key) ?? { value: null, metadata: null }),
    ),
    put: vi.fn(
      (
        key: string,
        value: string,
        options?: { metadata?: Record<string, unknown> },
      ) => {
        kv.set(key, { value, metadata: options?.metadata ?? null });
        return Promise.resolve();
      },
    ),
  },
} as unknown as Env;
async function request(
  path: string,
  body?: unknown,
  authenticated = true,
  origin = "https://test.example",
) {
  const token = authenticated ? await issueSession(env.ADMIN_PASSWORD) : "";
  return worker.fetch(
    new Request("https://test.example/api/" + path, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        Origin: origin,
        Cookie: "lightsail_session=" + token,
        "Content-Type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    env,
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(regions).mockResolvedValue(["ap-northeast-1"]);
  kv.clear();
  store(
    "sing-box",
    JSON.stringify({
      outbounds: [{ type: "vless", tag: "Singapore", server: "1.1.1.1" }],
    }),
  );
  clearFailures("local");
});
describe("session and API boundaries", () => {
  it("returns only the first instance across regions", async () => {
    vi.mocked(regions).mockResolvedValue([
      "ap-northeast-1",
      "ap-southeast-1",
      "us-east-1",
    ]);
    vi.mocked(listInstances).mockImplementation(async (_env, region) =>
      region === "ap-northeast-1"
        ? []
        : [{ name: region, state: { name: "running" } }],
    );
    const response = await request("instances");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      regions: [
        {
          region: "ap-southeast-1",
          instances: [{ name: "ap-southeast-1", state: { name: "running" } }],
        },
      ],
    });
    expect(listInstances).toHaveBeenCalledWith(env, "ap-southeast-1", 1);
  });
  it("reads a Singapore instance using its actual region", async () => {
    vi.mocked(regions).mockResolvedValue(["ap-southeast-1"]);
    vi.mocked(getInstance).mockResolvedValue({
      name: "Singapore-1",
      state: { name: "running" },
    });
    const response = await request(
      "instance?region=ap-southeast-1&name=Singapore-1",
    );
    expect(response.status).toBe(200);
    expect(getInstance).toHaveBeenCalledWith(
      env,
      "ap-southeast-1",
      "Singapore-1",
    );
  });

  it("validates signatures, tampering and expiration", async () => {
    const now = Date.now(),
      token = await issueSession(env.ADMIN_PASSWORD, now);
    expect(await validSession(token, env.ADMIN_PASSWORD, now)).toBe(true);
    expect(await validSession(token + "x", env.ADMIN_PASSWORD, now)).toBe(
      false,
    );
    expect(await validSession(token, env.ADMIN_PASSWORD, now + 43200001)).toBe(
      false,
    );
    expect(await validSession(token, "different-password-value", now)).toBe(
      false,
    );
  });
  it("compares passwords", async () => {
    expect(await equalPassword("a", "a")).toBe(true);
    expect(await equalPassword("a", "b")).toBe(false);
  });
  it("rejects anonymous reads", async () => {
    expect((await request("instances", undefined, false)).status).toBe(401);
  });
  it("rejects cross-origin writes", async () => {
    expect(
      (
        await request(
          "login",
          { password: "bad" },
          false,
          "https://evil.example",
        )
      ).status,
    ).toBe(403);
  });
  it("sets a protected session cookie and clears it on logout", async () => {
    const response = await request(
      "login",
      { password: env.ADMIN_PASSWORD },
      false,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toContain(
      "HttpOnly; Secure; SameSite=Strict",
    );
    expect((await request("logout", {})).headers.get("set-cookie")).toContain(
      "Max-Age=0",
    );
  });
  it("rejects unconfigured regions and unknown actions", async () => {
    expect(
      (
        await request("action?region=us-east-1&name=test", {
          action: "start",
          rotate: false,
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await request("action?region=ap-northeast-1&name=test", {
          action: "delete",
          rotate: false,
        })
      ).status,
    ).toBe(400);
  });
  it("rejects static IP rotations", async () => {
    vi.mocked(getInstance).mockResolvedValue({
      name: "test",
      state: { name: "running" },
      isStaticIp: true,
    });
    expect(
      (
        await request("action?region=ap-northeast-1&name=test", {
          action: "stop",
          rotate: true,
        })
      ).status,
    ).toBe(409);
    expect(aws).not.toHaveBeenCalled();
  });
  it("reconciles repeated stop requests", async () => {
    vi.mocked(getInstance).mockResolvedValue({
      name: "test",
      state: { name: "stopping" },
    });
    expect(
      (
        await request("action?region=ap-northeast-1&name=test", {
          action: "stop",
          rotate: false,
        })
      ).status,
    ).toBe(200);
    expect(aws).not.toHaveBeenCalled();
  });
  it("reports regional failures without failing the entire list", async () => {
    vi.mocked(listInstances).mockRejectedValue(Error("secret details"));
    const response = await request("instances");
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).toContain("无法读取");
    expect(text).not.toContain("secret details");
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
  it("updates the Singapore server and preserves subscription metadata", async () => {
    store(
      "clash",
      "proxies:\n  - name: Singapore\n    type: vless\n    server: 13.158.134.19\n    port: 443\n",
      {
        name: "Clash 配置",
        contentType: "text/yaml; charset=utf-8",
        allowedDomains: "sub.unicom.top",
        allowedCountries: "CN",
        size: 1,
        sha256: "old",
        createdAt: 111,
        updatedAt: 222,
      },
    );
    const response = await request("sub", { ip: "5.6.7.8" });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    const stored = kv.get("clash");
    expect(stored?.value).toBe(
      "proxies:\n  - name: Singapore\n    type: vless\n    server: 5.6.7.8\n    port: 443\n",
    );
    expect(stored?.metadata).toMatchObject({
      name: "Clash 配置",
      contentType: "text/yaml; charset=utf-8",
      allowedDomains: "sub.unicom.top",
      allowedCountries: "CN",
      createdAt: 111,
    });
    const bytes = new TextEncoder().encode(stored?.value);
    expect(stored?.metadata?.size).toBe(bytes.byteLength);
    expect(stored?.metadata?.updatedAt).toBeGreaterThan(222);
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    const sha256 = [...new Uint8Array(digest)]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
    expect(stored?.metadata?.sha256).toBe(sha256);
  });
  it("updates sing-box and keeps node settings and KV metadata", async () => {
    store("clash", "- name: Singapore\n  server: 1.1.1.1");
    const config = {
      dns: { servers: [{ server: "223.5.5.5" }] },
      outbounds: [
        { type: "selector", tag: "Select", outbounds: ["Singapore"] },
        {
          type: "vless",
          tag: "Singapore",
          server: "1.1.1.1",
          server_port: 443,
          uuid: "test-uuid",
          tls: { enabled: true, server_name: "itunes.apple.com" },
        },
        { type: "vless", tag: "Other", server: "1.1.1.1" },
      ],
    };
    store("sing-box", JSON.stringify(config), {
      name: "sing-box",
      allowedCountries: "CN",
      createdAt: 123,
    });
    expect((await request("sub", { ip: "5.6.7.8" })).status).toBe(200);
    config.outbounds[1].server = "5.6.7.8";
    const stored = kv.get("sing-box");
    expect(JSON.parse(stored!.value)).toEqual(config);
    expect(stored?.metadata).toMatchObject({
      name: "sing-box",
      allowedCountries: "CN",
      createdAt: 123,
    });
    expect(stored?.metadata?.size).toBe(
      new TextEncoder().encode(stored?.value).byteLength,
    );
    expect(stored?.metadata?.sha256).toMatch(/^[0-9a-f]{64}$/);
  });
  it("still syncs sing-box when Clash fails", async () => {
    store("clash", "- name: DIRECT\n  type: direct");
    const response = await request("sub", { ip: "5.6.7.8" });
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({
      error: expect.stringContaining("Clash"),
    });
    expect(JSON.parse(kv.get("sing-box")!.value).outbounds[0].server).toBe(
      "5.6.7.8",
    );
  });
  it("still syncs Clash when sing-box fails without overwriting invalid JSON", async () => {
    store("clash", "- name: Singapore\n  server: 1.1.1.1");
    store("sing-box", "invalid-json", { name: "original" });
    const response = await request("sub", { ip: "5.6.7.8" });
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({
      error: expect.stringContaining("sing-box"),
    });
    expect(kv.get("clash")?.value).toContain("server: 5.6.7.8");
    expect(kv.get("sing-box")).toEqual({
      value: "invalid-json",
      metadata: { name: "original" },
    });
  });
  it("requires login and a valid IP to update the subscription", async () => {
    store("clash", "proxies:\n  - name: Singapore\n    server: 13.158.134.19");
    expect((await request("sub", { ip: "1.2.3.4" }, false)).status).toBe(401);
    expect((await request("sub", { ip: "not-an-ip" })).status).toBe(400);
    expect((await request("sub", { ip: "1.2.3.4" })).status).toBe(200);
  });
  it("reports a missing subscription config or proxy node", async () => {
    expect((await request("sub", { ip: "1.2.3.4" })).status).toBe(404);
    store("clash", "proxies:\n  - name: DIRECT\n    type: direct");
    const response = await request("sub", { ip: "1.2.3.4" });
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({
      error: expect.stringContaining("代理节点"),
    });
  });
  it("throttles repeated failed logins within an isolate", async () => {
    for (let i = 0; i < 5; i++)
      expect((await request("login", { password: "bad" }, false)).status).toBe(
        401,
      );
    expect((await request("login", { password: "bad" }, false)).status).toBe(
      429,
    );
  });
  it("clears failed-attempt count after a successful login", async () => {
    for (let i = 0; i < 3; i++)
      await request("login", { password: "bad" }, false);
    expect(
      (await request("login", { password: env.ADMIN_PASSWORD }, false)).status,
    ).toBe(200);
    for (let i = 0; i < 5; i++)
      expect((await request("login", { password: "bad" }, false)).status).toBe(
        401,
      );
  });
});
it("returns the allowed method for known endpoints", async () => {
  const response = await request("action?region=ap-northeast-1&name=test");
  expect(response.status).toBe(405);
  expect(response.headers.get("Allow")).toBe("POST");
  expect(aws).not.toHaveBeenCalled();
});
it("does not rewrite subscriptions or metadata when both addresses already match", async () => {
  store("clash", "- name: Singapore\n  server: 1.1.1.1\n", { updatedAt: 123 });
  store("sing-box", '{"outbounds":[{"type":"vless","server":"1.1.1.1"}]}', {
    updatedAt: 456,
  });
  const response = await request("sub", { ip: "1.1.1.1" });
  expect(response.status).toBe(200);
  expect(env.SUB.put).not.toHaveBeenCalled();
  expect(kv.get("clash")?.metadata?.updatedAt).toBe(123);
  expect(kv.get("sing-box")?.metadata?.updatedAt).toBe(456);
});
