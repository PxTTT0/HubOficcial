import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

/**
 * Cifragem do secret TOTP em repouso. AES-256-GCM.
 *
 * Chave: AUTH_MFA_SECRET_ENCRYPTION_KEY em base64 que decodifica para
 * EXATAMENTE 32 bytes. Sem derivacao implicita de texto - chave fraca
 * deve falhar (validado tambem no bootstrap de producao).
 *
 * CONTRATO: nunca logar a chave, o secret em claro nem o ciphertext.
 */
const KEY_BYTES = 32;
const IV_BYTES = 12;

export interface EncryptedSecret {
  ct: Buffer;
  iv: Buffer;
  tag: Buffer;
}

export interface ParsedKey {
  ok: boolean;
  key?: Buffer;
  reason?: string;
}

export function parseEncryptionKey(raw: string | undefined): ParsedKey {
  if (!raw || raw.trim().length === 0) {
    return { ok: false, reason: "ausente" };
  }
  let decoded: Buffer;
  try {
    decoded = Buffer.from(raw.trim(), "base64");
  } catch {
    return { ok: false, reason: "base64 invalido" };
  }
  // Buffer.from base64 e tolerante; reencodar e comparar pega lixo.
  if (decoded.length !== KEY_BYTES) {
    return {
      ok: false,
      reason: `base64 deve decodificar para ${KEY_BYTES} bytes (recebido ${decoded.length})`,
    };
  }
  return { ok: true, key: decoded };
}

export function requireEncryptionKey(raw: string | undefined): Buffer {
  const p = parseEncryptionKey(raw);
  if (!p.ok || !p.key) {
    // mensagem sem valor da chave
    throw new Error(`AUTH_MFA_SECRET_ENCRYPTION_KEY invalida: ${p.reason}`);
  }
  return p.key;
}

export function encryptSecret(plaintext: string, key: Buffer): EncryptedSecret {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return { ct, iv, tag };
}

export function decryptSecret(enc: EncryptedSecret, key: Buffer): string {
  const decipher = createDecipheriv("aes-256-gcm", key, enc.iv);
  decipher.setAuthTag(enc.tag);
  const pt = Buffer.concat([decipher.update(enc.ct), decipher.final()]);
  return pt.toString("utf8");
}
