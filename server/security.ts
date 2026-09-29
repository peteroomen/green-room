import { createHmac, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
export function hosted() {
  return Boolean(process.env.VERCEL) || process.env.NODE_ENV === "production";
}
function signature(s: string) {
  return createHmac(
    "sha256",
    process.env.APP_PASSWORD || "local-development-only",
  )
    .update(s)
    .digest("hex");
}
export function token() {
  const expires = String(Date.now() + 7 * 86400000);
  return expires + "." + signature(expires);
}
export function validToken(value: string) {
  const [expires, sig] = value.split(".");
  if (!expires || !sig || Number(expires) < Date.now()) return false;
  const expected = signature(expires);
  return (
    sig.length === expected.length &&
    timingSafeEqual(Buffer.from(sig), Buffer.from(expected))
  );
}
export function unlocked(req: IncomingMessage) {
  if (!process.env.APP_PASSWORD) return !hosted();
  const value = req.headers.cookie?.match(/(?:^|;\s*)greenroom=([^;]+)/)?.[1];
  return Boolean(value && validToken(value));
}
export function sameOrigin(req: IncomingMessage) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}
const buckets = new Map<string, { start: number; count: number }>();
export function limit(req: IncomingMessage, kind: string, max: number) {
  const ip = String(
    req.headers["x-forwarded-for"] || req.socket.remoteAddress,
  ).split(",")[0];
  const key = kind + ip;
  const now = Date.now();
  let b = buckets.get(key);
  if (!b || now - b.start > 60000) {
    b = { start: now, count: 0 };
    buckets.set(key, b);
  }
  if (buckets.size > 5000)
    for (const [k, v] of buckets) if (now - v.start > 60000) buckets.delete(k);
  if (++b.count > max) throw Error("Too many requests. Please wait a minute.");
}
export function setSession(res: ServerResponse) {
  res.setHeader(
    "Set-Cookie",
    `greenroom=${token()}; HttpOnly; Path=/; SameSite=Strict; Max-Age=604800${hosted() ? "; Secure" : ""}`,
  );
}
export function passwordMatches(s: string) {
  const a = Buffer.from(s),
    b = Buffer.from(process.env.APP_PASSWORD || "");
  return a.length === b.length && b.length > 0 && timingSafeEqual(a, b);
}
