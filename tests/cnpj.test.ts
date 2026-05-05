import { test } from "node:test";
import assert from "node:assert/strict";
import { isValidCnpj, maskCnpjForLog, maskCnpjForDisplay } from "../src/modules/makscore/cnpj";

test("isValidCnpj rejects junk and equal-digit cnpjs", () => {
  assert.equal(isValidCnpj(""), false);
  assert.equal(isValidCnpj("123"), false);
  assert.equal(isValidCnpj("11111111111111"), false);
  assert.equal(isValidCnpj("00000000000000"), false);
});

test("isValidCnpj accepts known-valid cnpj", () => {
  // CNPJ valido conhecido (formato real, mas fictício)
  assert.equal(isValidCnpj("11.222.333/0001-81"), true);
  assert.equal(isValidCnpj("11222333000181"), true);
});

test("isValidCnpj rejects bad check digits", () => {
  assert.equal(isValidCnpj("11.222.333/0001-82"), false);
});

test("masking helpers", () => {
  assert.equal(maskCnpjForLog("11222333000181"), "11.***.***/****-81");
  assert.equal(maskCnpjForDisplay("11222333000181"), "11.222.333/0001-81");
});
