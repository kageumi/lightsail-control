import { afterEach, expect, it, vi } from "vitest";
import { api } from "../src/api";
afterEach(() => vi.unstubAllGlobals());
it("reports unauthorized responses even if the response is not JSON", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("unavailable", { status: 401 })),
  );
  const unauthorized = vi.fn();
  await expect(api("instance", undefined, unauthorized)).rejects.toMatchObject({
    status: 401,
  });
  expect(unauthorized).toHaveBeenCalledOnce();
});
it("does not treat malformed successful responses as data", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("<html>Bad gateway</html>")),
  );
  await expect(api("instance", undefined, vi.fn())).rejects.toThrow("响应格式");
});
it("provides a readable network failure", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    }),
  );
  await expect(api("instance", undefined, vi.fn())).rejects.toThrow(
    "网络连接失败",
  );
});
it("reports timeouts as temporary failures", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      throw new DOMException("timeout", "TimeoutError");
    }),
  );
  await expect(api("instance", undefined, vi.fn())).rejects.toMatchObject({
    status: 504,
    message: "请求超时，请重试",
  });
});
it("aborts a request when its session ends", async () => {
  const controller = new AbortController();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url, options) => {
      expect(options.signal).toBeInstanceOf(AbortSignal);
      controller.abort(new Error("session ended"));
      throw new Error("aborted");
    }),
  );
  await expect(
    api("instance", undefined, vi.fn(), controller.signal),
  ).rejects.toThrow("session ended");
});
