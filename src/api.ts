export const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : "请求失败，请稍后重试";

export async function api<T>(
  path: string,
  body: unknown,
  onUnauthorized: () => void,
  signal?: AbortSignal,
): Promise<T> {
  const timeout = AbortSignal.timeout(25_000);
  let response: Response;
  let data: unknown;
  try {
    response = await fetch(`/api/${path}`, {
      method: body === undefined ? "GET" : "POST",
      credentials: "same-origin",
      headers:
        body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: signal ? AbortSignal.any([timeout, signal]) : timeout,
    });
    data = await response.json().catch(() => null);
  } catch (error) {
    if (signal?.aborted) throw signal.reason;
    if (
      timeout.aborted ||
      (error instanceof Error && error.name === "TimeoutError")
    )
      throw Object.assign(new Error("请求超时，请重试"), { status: 504 });
    throw new Error("网络连接失败，请重试", { cause: error });
  }
  if (signal?.aborted) throw signal.reason;
  if (timeout.aborted)
    throw Object.assign(new Error("请求超时，请重试"), { status: 504 });
  if (!response.ok) {
    if (response.status === 401) onUnauthorized();
    const message =
      data && typeof data === "object" && "error" in data
        ? data.error
        : undefined;
    throw Object.assign(
      new Error(typeof message === "string" ? message : "请求失败，请稍后重试"),
      { status: response.status },
    );
  }
  if (!data || typeof data !== "object" || Array.isArray(data))
    throw new Error("服务器响应格式不正确，请重试");
  return data as T;
}
