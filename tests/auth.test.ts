import { expect, it } from "vitest";
import { clearFailures, limited, loginFailure } from "../worker/auth";

it("retains an existing IP's failure count when the throttle cache is full", () => {
  const ips = Array.from({ length: 1000 }, (_, i) => `capacity-${i}`);
  try {
    for (const ip of ips) loginFailure(ip, 0);
    for (let i = 0; i < 4; i++) loginFailure(ips[0], 0);
    expect(limited(ips[0], 1)).toBe(true);
    expect(limited(ips[0], 900_001)).toBe(false);
  } finally {
    for (const ip of ips) clearFailures(ip);
  }
});
