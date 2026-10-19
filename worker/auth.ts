const encoder = new TextEncoder();
const hex = (bytes: ArrayBuffer) =>
  Array.from(new Uint8Array(bytes))
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");
export async function equalPassword(a: string, b: string) {
  const hash = async (s: string) =>
    new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(s)));
  const [x, y] = await Promise.all([hash(a), hash(b)]);
  let d = 0;
  for (let i = 0; i < x.length; i++) d |= x[i] ^ y[i];
  return d === 0;
}
let signingKey: { password: string; key: Promise<CryptoKey> } | undefined;
async function sign(value: string, password: string) {
  if (signingKey?.password !== password)
    signingKey = {
      password,
      key: crypto.subtle.importKey(
        "raw",
        encoder.encode("lightsail-session-v1:" + password),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"],
      ),
    };
  const key = await signingKey.key;
  return hex(await crypto.subtle.sign("HMAC", key, encoder.encode(value)));
}
export async function issueSession(password: string, now = Date.now()) {
  const payload = String(now + 12 * 3600000) + "." + crypto.randomUUID();
  return payload + "." + (await sign(payload, password));
}
export async function validSession(
  token: string,
  password: string,
  now = Date.now(),
) {
  if (!password || password.length < 8 || token.length > 256) return false;
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  const expires = Number(parts[0]);
  if (
    !Number.isFinite(expires) ||
    expires <= now ||
    expires > now + 12 * 3600000
  )
    return false;
  return equalPassword(
    parts[2],
    await sign(parts[0] + "." + parts[1], password),
  );
}
// Best effort per-isolate throttling, deliberately no persistent storage.
const failures = new Map<string, { count: number; expires: number }>();
export function limited(ip: string, now = Date.now()) {
  const entry = failures.get(ip);
  return !!entry && entry.expires > now && entry.count >= 5;
}
export function loginFailure(ip: string, now = Date.now()) {
  for (const [key, value] of failures)
    if (value.expires <= now) failures.delete(key);
  const previous = failures.get(ip);
  if (!previous && failures.size >= 1000)
    failures.delete(failures.keys().next().value!);
  failures.set(ip, {
    count: (previous?.count ?? 0) + 1,
    expires: previous?.expires ?? now + 900000,
  });
}
export function clearFailures(ip: string) {
  failures.delete(ip);
}
