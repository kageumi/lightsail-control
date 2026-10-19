import { AwsClient } from "aws4fetch";
import { Env, Instance, HttpError } from "./types";
import { publicInstance } from "./instance";
const clients = new Map<string, AwsClient>();
const regionCache = new Map<
  string,
  { expires: number; result: Promise<string[]> }
>();
const maxCachedClients = 32;
const regionCacheMs = 5 * 60 * 1000;
const credentialsKey = (env: Env) =>
  [
    env.AWS_ACCESS_KEY_ID,
    env.AWS_SECRET_ACCESS_KEY,
    env.AWS_SESSION_TOKEN ?? "",
  ].join("\n");
function clientFor(env: Env, region: string) {
  const key = credentialsKey(env) + "\n" + region;
  let client = clients.get(key);
  if (!client) {
    client = new AwsClient({
      accessKeyId: env.AWS_ACCESS_KEY_ID,
      secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
      sessionToken: env.AWS_SESSION_TOKEN,
      service: "lightsail",
      region,
      retries: 0,
    });
    if (clients.size >= maxCachedClients)
      clients.delete(clients.keys().next().value!);
    clients.set(key, client);
  }
  return client;
}
export async function aws<T>(
  env: Env,
  region: string,
  operation: string,
  input: unknown,
): Promise<T> {
  if (!env.AWS_ACCESS_KEY_ID || !env.AWS_SECRET_ACCESS_KEY)
    throw new HttpError(503, "AWS 凭证尚未配置");
  const timeout = AbortSignal.timeout(15000);
  let response: Response;
  try {
    response = await clientFor(env, region).fetch(
      "https://lightsail." + region + ".amazonaws.com/",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-amz-json-1.1",
          "X-Amz-Target": "Lightsail_20161128." + operation,
        },
        body: JSON.stringify(input),
        signal: timeout,
      },
    );
  } catch {
    throw new HttpError(503, "AWS 连接失败或超时，请重试");
  }
  if (!response.ok) {
    const error: unknown = await response.json().catch(() => null);
    if (timeout.aborted) throw new HttpError(503, "AWS 连接失败或超时，请重试");
    const kind =
      error &&
      typeof error === "object" &&
      "__type" in error &&
      typeof error.__type === "string"
        ? error.__type.split("#").at(-1)
        : undefined;
    const status =
      response.status === 401 ||
      response.status === 403 ||
      kind === "AccessDeniedException" ||
      kind === "UnauthenticatedException"
        ? 403
        : response.status === 404 || kind === "NotFoundException"
          ? 404
          : kind === "InvalidInputException"
            ? 400
            : response.status === 429 || response.status >= 500
              ? 503
              : 502;
    throw new HttpError(
      status,
      "AWS 请求失败（HTTP " +
        response.status +
        "），请检查权限、实例状态及服务可用性",
    );
  }
  try {
    const data: unknown = await response.json();
    if (!data || typeof data !== "object" || Array.isArray(data))
      throw new Error("Invalid response");
    return data as T;
  } catch {
    throw new HttpError(
      timeout.aborted ? 503 : 502,
      timeout.aborted
        ? "AWS 连接失败或超时，请重试"
        : "AWS 响应格式不正确，请重试",
    );
  }
}
export async function getInstance(env: Env, region: string, name: string) {
  return publicInstance(
    (
      await aws<{ instance: Instance }>(env, region, "GetInstance", {
        instanceName: name,
      })
    ).instance,
  );
}
export async function regions(env: Env) {
  const configured = (env.AWS_REGIONS ?? "")
    .split(",")
    .map((region) => region.trim())
    .filter(Boolean);
  if (configured.length) {
    if (configured.some((region) => !/^[a-z]{2}(?:-[a-z]+)+-\d+$/.test(region)))
      throw new HttpError(503, "AWS 区域配置不合法");
    return [...new Set(configured)];
  }
  const key = credentialsKey(env);
  const cached = regionCache.get(key);
  if (cached && cached.expires > Date.now()) return cached.result;
  const result = aws<{ regions: { name: string }[] }>(
    env,
    "ap-southeast-1",
    "GetRegions",
    {},
  ).then((response) => {
    if (
      !Array.isArray(response.regions) ||
      response.regions.some(
        (region) =>
          typeof region.name !== "string" ||
          !/^[a-z]{2}(?:-[a-z]+)+-\d+$/.test(region.name),
      )
    )
      throw new HttpError(502, "AWS 区域响应格式不正确");
    return [...new Set(response.regions.map((region) => region.name))];
  });
  const entry = { expires: Date.now() + regionCacheMs, result };
  if (regionCache.size >= 4)
    regionCache.delete(regionCache.keys().next().value!);
  regionCache.set(key, entry);
  try {
    return await result;
  } catch (error) {
    if (regionCache.get(key) === entry) regionCache.delete(key);
    throw error;
  }
}
export async function listInstances(
  env: Env,
  region: string,
  limit = Infinity,
) {
  const result: Instance[] = [];
  let pageToken: string | undefined;
  const visited = new Set<string>();
  do {
    const page = await aws<{ instances: Instance[]; nextPageToken?: string }>(
      env,
      region,
      "GetInstances",
      { pageToken },
    );
    if (!Array.isArray(page.instances))
      throw new HttpError(502, "AWS 实例响应格式不正确");
    result.push(
      ...page.instances.slice(0, limit - result.length).map(publicInstance),
    );
    if (result.length >= limit) return result.slice(0, limit);
    pageToken = page.nextPageToken;
    if (pageToken) {
      if (visited.has(pageToken))
        throw new HttpError(502, "AWS 分页响应重复，请重试");
      visited.add(pageToken);
    }
  } while (pageToken);
  return result;
}
