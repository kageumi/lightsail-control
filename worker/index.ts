import { Env, HttpError, json } from "./types";
import { listInstances, getInstance, aws, regions } from "./aws";
import {
  equalPassword,
  issueSession,
  validSession,
  limited,
  loginFailure,
  clearFailures,
} from "./auth";
import { syncSubscriptions } from "./subscription";
import { readJson, validIpv4 } from "./validation";
const methods: Record<string, string> = {
  "/api/login": "POST",
  "/api/logout": "POST",
  "/api/session": "GET",
  "/api/sub": "POST",
  "/api/instances": "GET",
  "/api/instance": "GET",
  "/api/action": "POST",
};
const cookieName = "lightsail_session";
const cookie = (value: string, age: number) =>
  cookieName +
  "=" +
  value +
  "; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=" +
  age;
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(request);
    try {
      if (
        request.method !== "GET" &&
        request.headers.get("Origin") !== url.origin
      )
        throw new HttpError(403, "请求来源不被允许");
      const allowed = methods[url.pathname];
      if (!allowed) return json({ error: "接口不存在" }, 404);
      if (request.method !== allowed)
        return json({ error: "请求方法不被允许" }, 405, { Allow: allowed });
      const body = () => readJson(request);
      const token =
        request.headers
          .get("Cookie")
          ?.split(";")
          .map((s) => s.trim())
          .find((s) => s.startsWith(cookieName + "="))
          ?.slice(cookieName.length + 1) ?? "";
      if (url.pathname === "/api/login" && request.method === "POST") {
        if (!env.ADMIN_PASSWORD || env.ADMIN_PASSWORD.length < 8)
          throw new HttpError(503, "请配置至少 8 位的管理密码");
        const ip = request.headers.get("CF-Connecting-IP") ?? "local";
        if (limited(ip))
          throw new HttpError(429, "尝试次数过多，请 15 分钟后重试");
        const data = await body();
        if (typeof data?.password !== "string" || data.password.length > 1024)
          throw new HttpError(400, "密码格式不正确");
        if (!(await equalPassword(data.password, env.ADMIN_PASSWORD))) {
          loginFailure(ip);
          throw new HttpError(401, "密码不正确");
        }
        clearFailures(ip);
        return json({ ok: true }, 200, {
          "Set-Cookie": cookie(await issueSession(env.ADMIN_PASSWORD), 43200),
        });
      }
      if (url.pathname === "/api/logout" && request.method === "POST")
        return json({ ok: true }, 200, { "Set-Cookie": cookie("", 0) });
      const authenticated = await validSession(token, env.ADMIN_PASSWORD);
      if (url.pathname === "/api/session" && request.method === "GET")
        return json({ authenticated });
      if (!authenticated) throw new HttpError(401, "请先登录");
      if (url.pathname === "/api/sub" && request.method === "POST") {
        const data = await body();
        if (!validIpv4(data.ip)) throw new HttpError(400, "IP 地址不合法");
        await syncSubscriptions(env.SUB, data.ip);
        return json({ ok: true });
      }
      if (url.pathname === "/api/instances" && request.method === "GET") {
        const results = await Promise.all(
          (await regions(env)).map(async (region) => {
            try {
              return { region, instances: await listInstances(env, region, 1) };
            } catch {
              return {
                region,
                instances: [],
                error: "无法读取此区域，请检查 AWS 权限及服务可用性",
              };
            }
          }),
        );
        const first = results.find((result) => result.instances.length);
        return json({ regions: first ? [first] : results });
      }
      if (["/api/instance", "/api/action"].includes(url.pathname)) {
        const region = url.searchParams.get("region") ?? "",
          name = url.searchParams.get("name") ?? "";
        if (
          !/^[-\w.]{1,255}$/.test(name) ||
          !(await regions(env)).includes(region)
        )
          throw new HttpError(400, "区域或实例名称不合法");
        if (url.pathname === "/api/instance" && request.method === "GET")
          return json(await getInstance(env, region, name));
        if (url.pathname === "/api/action" && request.method === "POST") {
          const data = await body();
          if (
            typeof data.action !== "string" ||
            !["start", "stop"].includes(data.action) ||
            typeof data.rotate !== "boolean"
          )
            throw new HttpError(400, "操作参数不合法");
          const instance = await getInstance(env, region, name);
          if (data.rotate && instance.isStaticIp)
            throw new HttpError(409, "静态 IP 实例无法更换 IP");
          const state = instance.state.name;
          if (
            data.action === "start" &&
            (state === "running" || state === "pending")
          )
            return json({ accepted: true, state });
          if (
            data.action === "stop" &&
            (state === "stopped" || state === "stopping")
          )
            return json({ accepted: true, state });
          if (state !== (data.action === "start" ? "stopped" : "running"))
            throw new HttpError(409, "当前实例状态不允许此操作");
          await aws(
            env,
            region,
            data.action === "start" ? "StartInstance" : "StopInstance",
            {
              instanceName: name,
              ...(data.action === "stop" ? { force: false } : {}),
            },
          );
          return json({ accepted: true }, 202);
        }
      }
      return json({ error: "接口不存在" }, 404);
    } catch (e) {
      return json(
        {
          error:
            e instanceof HttpError ? e.message : "请求处理失败，请稍后重试",
        },
        e instanceof HttpError ? e.status : 500,
      );
    }
  },
};
