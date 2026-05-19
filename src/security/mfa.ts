import { createHmac, randomBytes, timingSafeEqual } from "crypto";
import type { SecurityConfig } from "./config";
import {
  buildOtpAuthUri,
  generateTotpSecret,
  verifyTotpCode,
} from "./totp";
import type { UserRepository } from "./users";
import type { ChallengeRecord, MfaChallengeStore } from "../infra/mfaChallengeStore";

export interface MfaEnrollmentStart {
  secret: string;
  otpauthUri: string;
}

export interface MfaEnrollmentConfirmation {
  recoveryCodes: string[];
}

export interface MfaChallenge {
  token: string;
  expiresAtMs: number;
}

const RECOVERY_CODE_GROUP_LENGTH = 4;
const RECOVERY_CODE_GROUPS = 3;

function encodePart(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

function decodePart(value: string): string {
  return Buffer.from(value, "base64url").toString("utf8");
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

function signChallenge(cfg: SecurityConfig, cid: string, exp: number): string {
  return createHmac("sha256", cfg.sessionSecret).update(`mfa.${cid}.${exp}`).digest("base64url");
}

function generateRecoveryCode(): string {
  const groups: string[] = [];
  for (let g = 0; g < RECOVERY_CODE_GROUPS; g++) {
    const buf = randomBytes(RECOVERY_CODE_GROUP_LENGTH);
    let chunk = "";
    for (let i = 0; i < buf.length; i++) {
      chunk += (buf[i] % 36).toString(36);
    }
    groups.push(chunk.toUpperCase());
  }
  return groups.join("-");
}

export function hashRecoveryCode(cfg: SecurityConfig, code: string): string {
  const normalized = code.replace(/[\s-]/g, "").toUpperCase();
  return createHmac("sha256", cfg.sessionSecret).update(`recovery.${normalized}`).digest("base64url");
}

export class MfaService {
  constructor(
    private readonly cfg: SecurityConfig,
    private readonly users: UserRepository,
    private readonly challengeStore: MfaChallengeStore,
  ) {}

  isRequiredForRole(role: string | undefined): boolean {
    if (!role) return false;
    return this.cfg.mfaRequiredRoles.includes(role as any);
  }

  beginEnrollment(userId: string, username: string): MfaEnrollmentStart {
    const user = this.users.findById(userId);
    if (!user) throw new Error("user_not_found");
    if (user.mfa.enabled) throw new Error("mfa_already_enabled");

    const secret = generateTotpSecret();
    this.users.updateMfa(userId, {
      enabled: false,
      secret,
      lastUsedStep: -1,
      enrolledAtMs: null,
      recoveryHashes: [],
    });
    const otpauthUri = buildOtpAuthUri({
      issuer: this.cfg.mfaIssuer,
      account: username,
      secret,
    });
    return { secret, otpauthUri };
  }

  confirmEnrollment(userId: string, code: string): MfaEnrollmentConfirmation {
    const user = this.users.findById(userId);
    if (!user) throw new Error("user_not_found");
    if (user.mfa.enabled) throw new Error("mfa_already_enabled");
    if (!user.mfa.secret) throw new Error("mfa_not_started");

    const result = verifyTotpCode({
      secret: user.mfa.secret,
      code,
      lastUsedStep: user.mfa.lastUsedStep,
    });
    if (!result.ok) throw new Error("invalid_code");

    const codes: string[] = [];
    const hashes: string[] = [];
    for (let i = 0; i < this.cfg.mfaRecoveryCodes; i++) {
      const code = generateRecoveryCode();
      codes.push(code);
      hashes.push(hashRecoveryCode(this.cfg, code));
    }

    // Mantemos lastUsedStep em -1 deliberadamente: o usuario pode
    // precisar usar o mesmo codigo no primeiro login real logo apos
    // enrollment. O secret acabou de nascer; um atacante que capture
    // este codigo provavelmente capturou o secret junto, entao replay
    // protection desse step nao agrega.
    this.users.updateMfa(userId, {
      enabled: true,
      enrolledAtMs: Date.now(),
      recoveryHashes: hashes,
    });

    return { recoveryCodes: codes };
  }

  disable(userId: string): void {
    const user = this.users.findById(userId);
    if (!user) throw new Error("user_not_found");
    this.users.updateMfa(userId, {
      enabled: false,
      secret: null,
      lastUsedStep: -1,
      enrolledAtMs: null,
      recoveryHashes: [],
    });
  }

  async issueChallenge(userId: string): Promise<MfaChallenge> {
    const cid = randomBytes(18).toString("base64url");
    const expiresAtMs = Date.now() + this.cfg.mfaChallengeTtlMs;
    const record: ChallengeRecord = { userId, expiresAtMs };
    await this.challengeStore.put(cid, record, this.cfg.mfaChallengeTtlMs);
    const sig = signChallenge(this.cfg, cid, expiresAtMs);
    const token = `${encodePart(cid)}.${encodePart(String(expiresAtMs))}.${sig}`;
    return { token, expiresAtMs };
  }

  /**
   * Verifica APENAS o token (assinatura, formato, expiry). Nao acessa o
   * store - e usado por quem ainda vai consumir o challenge.
   */
  private verifyChallengeToken(token: string): { cid: string; exp: number } | null {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    let cid: string;
    let expRaw: string;
    try {
      cid = decodePart(parts[0]);
      expRaw = decodePart(parts[1]);
    } catch {
      return null;
    }
    const exp = Number(expRaw);
    if (!Number.isFinite(exp)) return null;
    const expectedSig = signChallenge(this.cfg, cid, exp);
    if (!safeEqual(expectedSig, parts[2])) return null;
    if (Date.now() >= exp) return null;
    return { cid, exp };
  }

  /** Valida token + presenca no store. NAO consome. */
  async resolveChallenge(
    token: string,
  ): Promise<{ cid: string; userId: string } | null> {
    const v = this.verifyChallengeToken(token);
    if (!v) return null;
    const record = await this.challengeStore.get(v.cid);
    if (!record || record.expiresAtMs !== v.exp) return null;
    return { cid: v.cid, userId: record.userId };
  }

  async consumeChallenge(token: string): Promise<{ userId: string } | null> {
    const v = this.verifyChallengeToken(token);
    if (!v) return null;
    // GET+DEL atomico: garante consumo unico mesmo com instancias
    // concorrentes (anti double-spend).
    const record = await this.challengeStore.consume(v.cid);
    if (!record || record.expiresAtMs !== v.exp) return null;
    return { userId: record.userId };
  }

  verifyTotp(userId: string, code: string): boolean {
    const user = this.users.findById(userId);
    if (!user || !user.mfa.enabled || !user.mfa.secret) return false;
    const result = verifyTotpCode({
      secret: user.mfa.secret,
      code,
      lastUsedStep: user.mfa.lastUsedStep,
    });
    if (!result.ok) return false;
    this.users.updateMfa(userId, {
      lastUsedStep: result.step ?? user.mfa.lastUsedStep,
    });
    return true;
  }

  verifyRecoveryCode(userId: string, code: string): boolean {
    const user = this.users.findById(userId);
    if (!user || !user.mfa.enabled) return false;
    const expected = hashRecoveryCode(this.cfg, code);
    return Boolean(this.users.consumeRecoveryHash(userId, expected));
  }

}
