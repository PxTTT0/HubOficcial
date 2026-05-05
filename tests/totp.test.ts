import { test } from "node:test";
import assert from "node:assert/strict";
import {
  base32Decode,
  base32Encode,
  buildOtpAuthUri,
  generateTotpCode,
  generateTotpSecret,
  verifyTotpCode,
} from "../src/security";

test("base32 round-trip preserva bytes arbitrarios", () => {
  const original = Buffer.from("makfil-hub-vendas-secret", "utf8");
  const encoded = base32Encode(original);
  assert.match(encoded, /^[A-Z2-7]+$/);
  const decoded = base32Decode(encoded);
  assert.deepEqual(decoded, original);
});

test("RFC 6238 - vetores de teste oficiais SHA-1 batem com a implementacao", () => {
  // Vetores oficiais do RFC 6238 - apendice B, sha-1.
  // Secret ASCII = "12345678901234567890" (20 bytes), base32 = GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ.
  const secret = base32Encode(Buffer.from("12345678901234567890"));
  const cases: Array<{ atSec: number; code: string }> = [
    { atSec: 59, code: "94287082" },
    { atSec: 1111111109, code: "07081804" },
    { atSec: 1111111111, code: "14050471" },
    { atSec: 1234567890, code: "89005924" },
    { atSec: 2000000000, code: "69279037" },
  ];
  for (const { atSec, code } of cases) {
    const got = generateTotpCode(secret, atSec, { digits: 8 });
    assert.equal(got, code, `step at ${atSec}`);
  }
});

test("verifyTotpCode aceita janela e bloqueia replay via lastUsedStep", () => {
  const secret = generateTotpSecret();
  const t = 1_700_000_000;
  const code = generateTotpCode(secret, t);
  const ok = verifyTotpCode({ secret, code, atSec: t });
  assert.equal(ok.ok, true);
  assert.equal(typeof ok.step, "number");

  // Replay: mesmo step (lastUsedStep igual ao step usado) deve falhar.
  const replay = verifyTotpCode({
    secret,
    code,
    atSec: t,
    lastUsedStep: ok.step,
  });
  assert.equal(replay.ok, false);

  // Janela: codigo do step anterior ainda dentro de window=1.
  const previousCode = generateTotpCode(secret, t - 30);
  const inside = verifyTotpCode({ secret, code: previousCode, atSec: t });
  assert.equal(inside.ok, true);

  // Fora da janela.
  const outside = verifyTotpCode({ secret, code: previousCode, atSec: t + 60 });
  assert.equal(outside.ok, false);
});

test("verifyTotpCode rejeita codigos malformados", () => {
  const secret = generateTotpSecret();
  assert.equal(verifyTotpCode({ secret, code: "abc123" }).ok, false);
  assert.equal(verifyTotpCode({ secret, code: "12345" }).ok, false);
  assert.equal(verifyTotpCode({ secret, code: "1234567" }).ok, false);
  assert.equal(verifyTotpCode({ secret, code: "" }).ok, false);
});

test("buildOtpAuthUri produz URI compativel com apps autenticadores", () => {
  const uri = buildOtpAuthUri({
    issuer: "HubVendasMakfil",
    account: "admin@makfil",
    secret: "JBSWY3DPEHPK3PXP",
  });
  assert.match(uri, /^otpauth:\/\/totp\//);
  assert.match(uri, /HubVendasMakfil%3Aadmin%40makfil/);
  assert.match(uri, /secret=JBSWY3DPEHPK3PXP/);
  assert.match(uri, /issuer=HubVendasMakfil/);
  assert.match(uri, /algorithm=SHA1/);
  assert.match(uri, /digits=6/);
  assert.match(uri, /period=30/);
});
