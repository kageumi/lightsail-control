import { describe, it, expect } from "vitest";
import {
  subscriptionKey,
  singBoxKey,
  updateSingBoxServer,
  updateClashServer,
  contentDigest,
} from "../worker/subscription";

describe("Clash subscription updates", () => {
  it("computes size and sha256 for stored content", async () => {
    expect(await contentDigest("abc")).toEqual({
      size: 3,
      sha256:
        "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    });
  });
  it("replaces the server of the 🇯🇵 JP proxy and keeps siblings", () => {
    const content =
      "proxies:\n" +
      "  - name: 🇯🇵 JP\n    type: vless\n    server: 13.158.134.19\n    port: 443\n" +
      "  - name: Other\n    server: 1.1.1.1\n";
    expect(updateClashServer(content, "5.6.7.8")).toBe(
      "proxies:\n" +
        "  - name: 🇯🇵 JP\n    type: vless\n    server: 5.6.7.8\n    port: 443\n" +
        "  - name: Other\n    server: 1.1.1.1\n",
    );
    expect(subscriptionKey).toBe("clash");
  });
  it("supports inline proxy objects and trailing comments", () => {
    expect(
      updateClashServer(
        "- {name: 🇯🇵 JP, server: 13.158.134.19, port: 443}",
        "5.6.7.8",
      ),
    ).toBe("- {name: 🇯🇵 JP, server: 5.6.7.8, port: 443}");
    expect(
      updateClashServer(
        "- name: 🇯🇵 JP\n  server: 13.158.134.19 # 旧 IP",
        "5.6.7.8",
      ),
    ).toBe("- name: 🇯🇵 JP\n  server: 5.6.7.8 # 旧 IP");
  });
  it("fails when the node or its server is missing", () => {
    expect(() =>
      updateClashServer("proxies:\n  - name: Other", "5.6.7.8"),
    ).toThrow("代理节点");
    expect(() =>
      updateClashServer(
        "proxies:\n  - name: DIRECT\n    type: direct\n    server: 1.1.1.1",
        "5.6.7.8",
      ),
    ).toThrow("代理节点");
  });
});

describe("sing-box subscription updates", () => {
  it("changes only the server of the first server outbound", () => {
    const config = {
      dns: { servers: [{ tag: "bootstrap", server: "223.5.5.5" }] },
      outbounds: [
        { type: "selector", tag: "Select", outbounds: ["🇯🇵 JP"] },
        {
          type: "vless",
          tag: "Singapore",
          server: "3.112.226.94",
          server_port: 443,
          uuid: "test-uuid",
          flow: "xtls-rprx-vision",
          tls: {
            server_name: "itunes.apple.com",
            reality: {
              public_key: "test-public-key",
              short_id: "test-short-id",
            },
          },
        },
        { type: "vless", tag: "🇯🇵 JP Backup", server: "3.112.226.94" },
      ],
      route: { final: "Fallback" },
    };
    const result = JSON.parse(
      updateSingBoxServer(JSON.stringify(config) + "\n", "5.6.7.8"),
    );
    expect(result.outbounds[1].server).toBe("5.6.7.8");
    result.outbounds[1].server = config.outbounds[1].server;
    expect(result).toEqual(config);
    expect(singBoxKey).toBe("sing-box");
  });
  it.each([
    "not-json",
    "null",
    "{}",
    '{"outbounds":{}}',
    '{"outbounds":[{"type":"direct","server":"1.1.1.1"}]}',
    '{"outbounds":[{"tag":"🇯🇵 JP"}]}',
    '{"outbounds":[{"type":"selector","server":"1.1.1.1"}]}',
  ])(
    "rejects invalid configuration without selecting another node: %s",
    (content) => {
      expect(() => updateSingBoxServer(content, "5.6.7.8")).toThrow();
    },
  );
});

describe("first proxy server selection", () => {
  it("skips Clash DIRECT/REJECT and edits the first server regardless of its name or field order", () => {
    const content = [
      "dns:",
      "  server: 223.5.5.5",
      "proxies:",
      '  - {name: DIRECT, type: direct, server: "9.9.9.9"}',
      "  - name: REJECT",
      "    type: reject",
      "  - server: '1.2.3.4' # keep",
      "    name: Singapore",
      "    type: vless",
      "    port: 443",
      "  - name: Japan",
      "    type: vless",
      "    server: 5.5.5.5",
      "proxy-groups:",
      "  - name: select",
      "    type: select",
      "    proxies: [DIRECT, Singapore]",
      "",
    ].join("\n");
    expect(updateClashServer(content, "6.7.8.9")).toBe(
      content.replace("server: '1.2.3.4'", "server: '6.7.8.9'"),
    );
  });
  it("supports compact Clash flow collections and double quoted addresses", () => {
    const content =
      'proxies: [{name: DIRECT, type: direct}, {name: Any, type: vless, server: "1.2.3.4"}, {name: Second, type: vless, server: "5.5.5.5"}]';
    expect(updateClashServer(content, "6.7.8.9")).toBe(
      content.replace('server: "1.2.3.4"', 'server: "6.7.8.9"'),
    );
  });
  it("never treats Clash DNS or proxy groups as a proxy server", () => {
    expect(() =>
      updateClashServer(
        "dns: {server: 1.1.1.1}\nproxy-groups: [{server: 2.2.2.2}]\nproxies: [{name: DIRECT, type: direct}]",
        "6.7.8.9",
      ),
    ).toThrow("代理节点");
  });
  it("skips sing-box direct/block/dns/selectors even if they contain a server", () => {
    const config = {
      dns: { servers: [{ server: "223.5.5.5" }] },
      outbounds: [
        { type: "direct", tag: "DIRECT", server: "9.9.9.9" },
        { type: "block", tag: "REJECT", server: "9.9.9.9" },
        { type: "selector", tag: "Select", server: "9.9.9.9" },
        { type: "dns", tag: "DNS", server: "9.9.9.9" },
        {
          type: "vless",
          tag: "Singapore",
          server: "1.2.3.4",
          server_port: 443,
        },
        { type: "vless", tag: "JP", server: "5.5.5.5" },
      ],
    };
    const updated = JSON.parse(
      updateSingBoxServer(JSON.stringify(config), "6.7.8.9"),
    );
    config.outbounds[4].server = "6.7.8.9";
    expect(updated).toEqual(config);
  });
  it("allows duplicate sing-box tags and still only changes the first server", () => {
    const config = {
      outbounds: [
        { type: "vless", tag: "same", server: "1.2.3.4" },
        { type: "vless", tag: "same", server: "5.5.5.5" },
      ],
    };
    expect(
      JSON.parse(
        updateSingBoxServer(JSON.stringify(config), "6.7.8.9"),
      ).outbounds.map((outbound: { server: string }) => outbound.server),
    ).toEqual(["6.7.8.9", "5.5.5.5"]);
  });
});
