import assert from "node:assert/strict";

// Run against npm run dev. Anonymous logout exercises CSRF without AWS calls.
const port = process.env.DEV_PORT || "8787";
for (const host of ["localhost", "127.0.0.1"]) {
  const origin = `http://${host}:${port}`;
  const checks = [
    [origin, 200],
    ["https://untrusted.example", 403],
    [undefined, 403],
  ];
  for (const [requestOrigin, expected] of checks) {
    const response = await fetch(origin + "/api/logout", {
      method: "POST",
      headers: requestOrigin ? { Origin: requestOrigin } : {},
      signal: AbortSignal.timeout(5000),
    });
    assert.equal(
      response.status,
      expected,
      `${host}: Origin ${requestOrigin ?? "(missing)"}`,
    );
  }
  console.log(
    `PASS ${host}: same-origin accepted, foreign/missing origins rejected`,
  );
}
