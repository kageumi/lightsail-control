// Isolated local fixtures: no AWS imports or credentials; never deploy this entry.
import type { Instance } from "../worker/types";
type MockState = { state: string; ip: string; next?: string; due?: number };
const states = new Map<string, MockState>();
const refreshFailures = new Set<string>();
let subscription =
  "proxies:\n  - name: 🇯🇵 JP\n    type: vless\n    server: 203.0.113.24\n    port: 443";
export default {
  async fetch(request: Request, env: { ASSETS: Fetcher }) {
    const url = new URL(request.url);
    const ref = new URL(request.headers.get("Referer") ?? "http://localhost");
    const savedScenario = request.headers
      .get("Cookie")
      ?.match(/(?:^|; )preview_scenario=([^;]+)/)?.[1];
    const scenario =
      ref.searchParams.get("scenario") ??
      (savedScenario ? decodeURIComponent(savedScenario) : "running");
    const signedIn = request.headers.get("Cookie")?.includes("preview_login=1");
    if (url.pathname === "/api/session")
      return Response.json({ authenticated: scenario !== "login" || signedIn });
    if (url.pathname === "/api/login")
      return Response.json(
        { ok: true },
        {
          headers: {
            "Set-Cookie": "preview_login=1; Path=/; HttpOnly; SameSite=Strict",
          },
        },
      );
    if (url.pathname === "/api/logout")
      return Response.json(
        { ok: true },
        { headers: { "Set-Cookie": "preview_login=; Path=/; Max-Age=0" } },
      );
    if (url.pathname === "/api/sub") {
      const data = (await request.json()) as { ip?: unknown };
      if (typeof data.ip !== "string")
        return Response.json({ error: "IP 地址不合法" }, { status: 400 });
      subscription = subscription.replace(/server: \S+/, `server: ${data.ip}`);
      return Response.json({ ok: true });
    }
    let state = states.get(scenario);
    if (!state) {
      state = {
        state: ["stopped", "stopping", "pending"].includes(scenario)
          ? scenario
          : "running",
        ip: "203.0.113.24",
      };
      states.set(scenario, state);
    }
    if (state.next && Date.now() > state.due!) {
      state.state = state.next;
      delete state.next;
      if (state.state === "running") state.ip = "203.0.113.85";
    }
    const instance: Instance = {
      name:
        scenario === "long-name"
          ? "Debian-1-production-tokyo-personal-server"
          : "Debian-1",
      state: { name: state.state },
      publicIpAddress: state.state === "running" ? state.ip : undefined,
      isStaticIp: scenario === "static",
      ...(scenario === "minimal"
        ? {}
        : {
            blueprintName: "Debian 12",
            bundleId: "nano_3_0",
            hardware: {
              cpuCount: 2,
              ramSizeInGb: 0.5,
              disks: [{ sizeInGb: 20, isSystemDisk: true }],
            },
            location: {
              regionName: "ap-southeast-1",
              availabilityZone: "ap-southeast-1a",
            },
            privateIpAddress: "172.26.0.10",
            ipv6Addresses: ["2001:db8:1234:5678:abcd:1234:5678:90ab"],
            username: "admin",
          }),
    };
    if (url.pathname === "/api/instances") {
      return Response.json({
        regions: [
          {
            region: "ap-southeast-1",
            instances:
              scenario === "empty"
                ? []
                : scenario === "multiple"
                  ? [instance, { ...instance, name: "Debian-2" }]
                  : [instance],
            ...(scenario === "error"
              ? { error: "无法读取实例，请检查连接后重试。" }
              : {}),
          },
        ],
      });
    }
    if (url.pathname === "/api/instance") {
      if (scenario === "refresh-error" && !refreshFailures.has(scenario)) {
        refreshFailures.add(scenario);
        return Response.json({ error: "暂时无法连接 AWS" }, { status: 503 });
      }
      return Response.json(instance);
    }
    if (url.pathname === "/api/action") {
      if (scenario === "action-error")
        return Response.json({ error: "模拟操作失败" }, { status: 409 });
      const data = (await request.json()) as { action: string };
      state.state = data.action === "stop" ? "stopping" : "pending";
      state.next = data.action === "stop" ? "stopped" : "running";
      state.due = Date.now() + 500;
      return Response.json({ accepted: true });
    }
    if (url.pathname.startsWith("/api/"))
      return Response.json({ error: "测试接口不存在" }, { status: 404 });
    // The isolated preview stores its fixture in a cookie because static asset
    // security headers can suppress Referer. Production never imports this entry.
    const asset = await env.ASSETS.fetch(request);
    const response = new Response(asset.body, asset);
    response.headers.set("Referrer-Policy", "same-origin");
    if (url.pathname === "/")
      response.headers.append(
        "Set-Cookie",
        `preview_scenario=${encodeURIComponent(url.searchParams.get("scenario") ?? "running")}; Path=/; HttpOnly; SameSite=Strict`,
      );
    return response;
  },
};
