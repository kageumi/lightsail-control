import { HttpError } from "./types";

export function validIpv4(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^(?:\d{1,3}\.){3}\d{1,3}$/.test(value) &&
    value.split(".").every((part) => Number(part) <= 255)
  );
}

export async function readJson(
  request: Request,
  maxBytes = 4096,
): Promise<Record<string, unknown>> {
  if (Number(request.headers.get("Content-Length")) > maxBytes)
    throw new HttpError(413, "请求过大");
  const reader = request.body?.getReader();
  if (!reader) throw new HttpError(400, "请求格式不正确");
  const decoder = new TextDecoder();
  let text = "",
    size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw new HttpError(413, "请求过大");
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
  } finally {
    reader.releaseLock();
  }
  try {
    const data: unknown = JSON.parse(text);
    if (!data || typeof data !== "object" || Array.isArray(data))
      throw new Error("Expected an object");
    return data as Record<string, unknown>;
  } catch {
    throw new HttpError(400, "请求格式不正确");
  }
}
