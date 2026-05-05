import { createHmac, randomBytes, timingSafeEqual } from "crypto";

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const BASE32_LOOKUP: Record<string, number> = (() => {
  const map: Record<string, number> = {};
  for (let i = 0; i < BASE32_ALPHABET.length; i++) {
    map[BASE32_ALPHABET[i]] = i;
  }
  return map;
})();

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = "";
  for (let i = 0; i < buf.length; i++) {
    value = (value << 8) | buf[i];
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 0x1f];
      bits -= 5;
    }
  }
  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 0x1f];
  }
  return output;
}

export function base32Decode(input: string): Buffer {
  const cleaned = input.replace(/=+$/g, "").replace(/\s+/g, "").toUpperCase();
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of cleaned) {
    const idx = BASE32_LOOKUP[ch];
    if (idx === undefined) {
      throw new Error("invalid_base32");
    }
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export function generateTotpSecret(byteLength = 20): string {
  return base32Encode(randomBytes(byteLength));
}

function counterBuffer(counter: number): Buffer {
  const buf = Buffer.alloc(8);
  const high = Math.floor(counter / 0x1_0000_0000);
  const low = counter >>> 0;
  buf.writeUInt32BE(high, 0);
  buf.writeUInt32BE(low, 4);
  return buf;
}

export interface TotpParams {
  period?: number;
  digits?: number;
  algorithm?: "SHA1" | "SHA256" | "SHA512";
}

export function generateTotpCode(
  secret: string,
  atSec: number = Math.floor(Date.now() / 1000),
  params: TotpParams = {},
): string {
  const period = params.period ?? 30;
  const digits = params.digits ?? 6;
  const algorithm = params.algorithm ?? "SHA1";
  const counter = Math.floor(atSec / period);
  const key = base32Decode(secret);
  const hmac = createHmac(algorithm.toLowerCase(), key).update(counterBuffer(counter)).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binary =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  const mod = binary % 10 ** digits;
  return mod.toString().padStart(digits, "0");
}

export interface VerifyTotpOptions extends TotpParams {
  secret: string;
  code: string;
  /** ± steps to accept (default 1 = ±period of tolerance) */
  window?: number;
  atSec?: number;
  /** prevents replay: only accept steps strictly greater than this */
  lastUsedStep?: number;
}

export interface VerifyTotpResult {
  ok: boolean;
  step?: number;
}

function safeEqualString(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

export function verifyTotpCode(opts: VerifyTotpOptions): VerifyTotpResult {
  const period = opts.period ?? 30;
  const digits = opts.digits ?? 6;
  const window = opts.window ?? 1;
  const atSec = opts.atSec ?? Math.floor(Date.now() / 1000);
  const currentStep = Math.floor(atSec / period);

  if (typeof opts.code !== "string" || opts.code.length !== digits || !/^\d+$/.test(opts.code)) {
    return { ok: false };
  }

  for (let delta = -window; delta <= window; delta++) {
    const step = currentStep + delta;
    if (step < 0) continue;
    if (opts.lastUsedStep !== undefined && step <= opts.lastUsedStep) continue;
    const expected = generateTotpCode(opts.secret, step * period, {
      period,
      digits,
      algorithm: opts.algorithm,
    });
    if (safeEqualString(expected, opts.code)) {
      return { ok: true, step };
    }
  }
  return { ok: false };
}

export interface OtpAuthUriOptions {
  issuer: string;
  account: string;
  secret: string;
  digits?: number;
  period?: number;
  algorithm?: "SHA1" | "SHA256" | "SHA512";
}

export function buildOtpAuthUri(opts: OtpAuthUriOptions): string {
  const issuer = encodeURIComponent(opts.issuer);
  const label = encodeURIComponent(`${opts.issuer}:${opts.account}`);
  const params = new URLSearchParams();
  params.set("secret", opts.secret);
  params.set("issuer", opts.issuer);
  params.set("algorithm", opts.algorithm ?? "SHA1");
  params.set("digits", String(opts.digits ?? 6));
  params.set("period", String(opts.period ?? 30));
  return `otpauth://totp/${label}?${params.toString()}`;
}
