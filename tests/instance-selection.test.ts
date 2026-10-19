import { describe, it, expect } from "vitest";
import { selectFirstInstance } from "../src/instance-selection";
const row = { name: "Debian-1", state: { name: "running" } };
describe("first instance across regions", () => {
  it("selects a Singapore instance without filtering by region", () =>
    expect(
      selectFirstInstance({
        regions: [{ region: "ap-southeast-1", instances: [row] }],
      }),
    ).toEqual({ ...row, region: "ap-southeast-1" }));
  it("skips empty regions and preserves the first populated region", () =>
    expect(
      selectFirstInstance({
        regions: [
          { region: "ap-northeast-1", instances: [] },
          { region: "ap-southeast-1", instances: [row] },
          { region: "us-east-1", instances: [{ ...row, name: "second" }] },
        ],
      }),
    ).toEqual({ ...row, region: "ap-southeast-1" }));
  it("selects the first of multiple instances", () =>
    expect(
      selectFirstInstance({
        regions: [
          { region: "us-east-1", instances: [row, { ...row, name: "second" }] },
        ],
      }),
    ).toEqual({ ...row, region: "us-east-1" }));
  it.each([
    { regions: [] },
    { regions: [{ region: "ap-southeast-1", instances: [] }] },
  ])("rejects empty results", ({ regions }) =>
    expect(() => selectFirstInstance({ regions })).toThrow("没有找到实例"),
  );
  it("does not use partial data when a region reports an error", () =>
    expect(() =>
      selectFirstInstance({
        regions: [
          { region: "ap-southeast-1", instances: [row], error: "读取失败" },
        ],
      }),
    ).toThrow("读取失败"));
  it("can select an instance when another region fails", () =>
    expect(
      selectFirstInstance({
        regions: [
          { region: "ap-northeast-1", instances: [], error: "读取失败" },
          { region: "ap-southeast-1", instances: [row] },
        ],
      }),
    ).toEqual({ ...row, region: "ap-southeast-1" }));
});
