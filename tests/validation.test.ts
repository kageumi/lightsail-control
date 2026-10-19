import { describe, expect, it, vi } from "vitest";
import { readJson, validIpv4 } from "../worker/validation";

describe("request validation", () => {
  it.each(["0.0.0.0", "255.255.255.255", "1.2.3.4"])("accepts IPv4 %s", (ip) =>
    expect(validIpv4(ip)).toBe(true),
  );
  it.each(["256.1.1.1", "1.2.3.999", "1.2.3", "::1", null, 123])(
    "rejects invalid IPv4 %s",
    (ip) => expect(validIpv4(ip)).toBe(false),
  );
  it.each(["null", "[]", "42", "{broken", ""])(
    "rejects non-object JSON %s",
    async (body) => {
      await expect(
        readJson(new Request("https://test.example", { method: "POST", body })),
      ).rejects.toMatchObject({ status: 400 });
    },
  );
  it("limits UTF-8 bytes rather than characters", async () => {
    await expect(
      readJson(
        new Request("https://test.example", {
          method: "POST",
          body: JSON.stringify({ value: "汉".repeat(1400) }),
        }),
      ),
    ).rejects.toMatchObject({ status: 413 });
  });
  it("cancels an oversized stream without reading the rest", async () => {
    const cancel = vi.fn();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(4097));
      },
      cancel,
    });
    const request = { body: stream, headers: new Headers() } as Request;
    await expect(readJson(request)).rejects.toMatchObject({ status: 413 });
    expect(cancel).toHaveBeenCalledOnce();
  });
  it("decodes UTF-8 split across chunks", async () => {
    const encoded = new TextEncoder().encode('{"value":"汉字"}');
    const stream = new ReadableStream({
      start(controller) {
        for (const byte of encoded) controller.enqueue(new Uint8Array([byte]));
        controller.close();
      },
    });
    expect(
      await readJson({ body: stream, headers: new Headers() } as Request),
    ).toEqual({ value: "汉字" });
  });
});
