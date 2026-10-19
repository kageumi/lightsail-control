import { it, expect, vi, afterEach } from "vitest";
import { getInstance, listInstances, aws, regions } from "../worker/aws";
import type { Env } from "../worker/types";
const env = {
  AWS_ACCESS_KEY_ID: "TEST_ACCESS",
  AWS_SECRET_ACCESS_KEY: "TEST_SECRET",
} as Env;
afterEach(() => vi.unstubAllGlobals());
it("signs Lightsail calls and fetches every list page", async () => {
  const requests: Request[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: Request) => {
      requests.push(input);
      return new Response(
        JSON.stringify(
          requests.length === 1
            ? {
                instances: [{ name: "one", state: { name: "running" } }],
                nextPageToken: "page2",
              }
            : { instances: [{ name: "two", state: { name: "stopped" } }] },
        ),
      );
    }),
  );
  expect(
    (await listInstances(env, "ap-northeast-1")).map((i) => i.name),
  ).toEqual(["one", "two"]);
  expect(requests[0].headers.get("Authorization")).toContain(
    "AWS4-HMAC-SHA256",
  );
  expect(requests[0].headers.get("X-Amz-Target")).toBe(
    "Lightsail_20161128.GetInstances",
  );
  expect(JSON.parse(await requests[1].text())).toEqual({ pageToken: "page2" });
});
it("does not expose raw AWS error bodies", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("PRIVATE AWS DETAILS", { status: 403 })),
  );
  await expect(aws(env, "ap-northeast-1", "GetInstances", {})).rejects.toThrow(
    "HTTP 403",
  );
});

it("discovers all Lightsail regions when no region is configured", async () => {
  const fetch = vi.fn(async (input: Request) => {
    expect(new URL(input.url).hostname).toBe(
      "lightsail.ap-southeast-1.amazonaws.com",
    );
    return Response.json({
      regions: [{ name: "ap-southeast-1" }, { name: "us-east-1" }],
    });
  });
  vi.stubGlobal("fetch", fetch);
  expect(await regions(env)).toEqual(["ap-southeast-1", "us-east-1"]);
  expect(fetch.mock.calls[0][0].headers.get("X-Amz-Target")).toBe(
    "Lightsail_20161128.GetRegions",
  );
});
it("does not fetch later pages after finding the first instance", async () => {
  const fetch = vi.fn(async () =>
    Response.json({
      instances: [
        { name: "one", state: { name: "running" } },
        { name: "two", state: { name: "stopped" } },
      ],
      nextPageToken: "page2",
    }),
  );
  vi.stubGlobal("fetch", fetch);
  expect(await listInstances(env, "ap-southeast-1", 1)).toMatchObject([
    { name: "one", state: { name: "running" } },
  ]);
  expect(fetch).toHaveBeenCalledTimes(1);
});

it("shares concurrent region discovery and refreshes after expiry", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  try {
    const cachedEnv = { ...env, AWS_ACCESS_KEY_ID: "CACHE_TEST" };
    const fetch = vi.fn(async () =>
      Response.json({ regions: [{ name: "ap-southeast-1" }] }),
    );
    vi.stubGlobal("fetch", fetch);
    await Promise.all([regions(cachedEnv), regions(cachedEnv)]);
    expect(fetch).toHaveBeenCalledTimes(1);
    await regions(cachedEnv);
    expect(fetch).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(5 * 60 * 1000);
    await regions(cachedEnv);
    expect(fetch).toHaveBeenCalledTimes(2);
    await regions({ ...cachedEnv, AWS_SECRET_ACCESS_KEY: "ROTATED" });
    expect(fetch).toHaveBeenCalledTimes(3);
  } finally {
    vi.useRealTimers();
  }
});
it("does not cache failed discovery", async () => {
  const cachedEnv = { ...env, AWS_ACCESS_KEY_ID: "FAILED_CACHE_TEST" };
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(new Response("denied", { status: 403 }))
    .mockResolvedValueOnce(
      Response.json({ regions: [{ name: "ap-southeast-1" }] }),
    );
  vi.stubGlobal("fetch", fetch);
  await expect(regions(cachedEnv)).rejects.toThrow("HTTP 403");
  expect(await regions(cachedEnv)).toEqual(["ap-southeast-1"]);
  expect(fetch).toHaveBeenCalledTimes(2);
});

it.each([
  ["AccessDeniedException", 403],
  ["UnauthenticatedException", 403],
  ["NotFoundException", 404],
  ["InvalidInputException", 400],
])(
  "maps permanent AWS %s errors without leaking details",
  async (kind, status) => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json(
          { __type: `aws#${kind}`, message: "PRIVATE DETAILS" },
          { status: 400 },
        ),
      ),
    );
    await expect(
      aws(env, "ap-southeast-1", "GetInstance", {}),
    ).rejects.toMatchObject({ status });
  },
);
it("classifies failed AWS connections as temporary without exposing errors", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      throw new Error("SECRET CONNECTION INFO");
    }),
  );
  await expect(
    aws(env, "ap-southeast-1", "GetInstance", {}),
  ).rejects.toMatchObject({
    status: 503,
    message: "AWS 连接失败或超时，请重试",
  });
});
it("stops repeated pagination tokens instead of looping forever", async () => {
  const fetch = vi.fn(async () =>
    Response.json({ instances: [], nextPageToken: "repeated" }),
  );
  vi.stubGlobal("fetch", fetch);
  await expect(listInstances(env, "ap-southeast-1")).rejects.toMatchObject({
    status: 502,
  });
  expect(fetch).toHaveBeenCalledTimes(2);
});
it("returns only the fields needed by the console", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Response.json({
        instance: {
          name: "one",
          arn: "PRIVATE ARN",
          state: { name: "running", code: 16 },
          publicIpAddress: "203.0.113.24",
          username: "admin",
          tags: [{ key: "internal", value: "private" }],
          hardware: {
            cpuCount: 2,
            ramSizeInGb: 0.5,
            disks: [{ sizeInGb: 20, isSystemDisk: true, arn: "PRIVATE DISK" }],
          },
        },
      }),
    ),
  );
  const result = await getInstance(env, "ap-southeast-1", "one");
  expect(JSON.parse(JSON.stringify(result))).toEqual({
    name: "one",
    state: { name: "running" },
    publicIpAddress: "203.0.113.24",
    username: "admin",
    hardware: {
      cpuCount: 2,
      ramSizeInGb: 0.5,
      disks: [{ sizeInGb: 20, isSystemDisk: true }],
    },
  });
});
it("rejects missing AWS credentials and malformed region configuration before fetching", async () => {
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  await expect(
    aws(
      { ...env, AWS_SECRET_ACCESS_KEY: "" },
      "ap-southeast-1",
      "GetInstance",
      {},
    ),
  ).rejects.toMatchObject({ status: 503 });
  await expect(
    regions({ ...env, AWS_REGIONS: "ap-southeast-1/path" }),
  ).rejects.toMatchObject({ status: 503 });
  expect(fetch).not.toHaveBeenCalled();
});
it("rejects malformed successful AWS responses", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json({ instance: { name: "incomplete" } })),
  );
  await expect(getInstance(env, "ap-southeast-1", "one")).rejects.toMatchObject(
    { status: 502 },
  );
});
