import type { Role } from "../modules/makscore/auth";

export interface MfaState {
  enabled: boolean;
  secret: string | null;
  /** Argon2id-hashed recovery codes; consumed on use. */
  recoveryHashes: string[];
  /** Last accepted TOTP step (replay protection). */
  lastUsedStep: number;
  enrolledAtMs: number | null;
}

export interface StoredUser {
  id: string;
  username: string;
  role: Role;
  passwordHash: string;
  disabled?: boolean;
  mfa: MfaState;
}

export interface UserMfaUpdate {
  enabled?: boolean;
  secret?: string | null;
  recoveryHashes?: string[];
  lastUsedStep?: number;
  enrolledAtMs?: number | null;
}

export interface UserRepository {
  findByUsername(username: string): Promise<StoredUser | null>;
  findById(id: string): Promise<StoredUser | null>;
  updateMfa(id: string, update: UserMfaUpdate): Promise<StoredUser | null>;
  /** Consumo single-use atomico do recovery hash. */
  consumeRecoveryHash(id: string, hash: string): Promise<StoredUser | null>;
  /**
   * Avanca lastUsedStep de forma ATOMICA (compare-and-set): so aplica se
   * newStep > atual. Retorna true se aplicou (codigo valido e nao-replay),
   * false caso contrario. Protege contra replay TOTP entre replicas.
   */
  bumpLastUsedStep(id: string, newStep: number): Promise<boolean>;
}

export function emptyMfaState(): MfaState {
  return {
    enabled: false,
    secret: null,
    recoveryHashes: [],
    lastUsedStep: -1,
    enrolledAtMs: null,
  };
}

function normalizeUsername(username: string): string {
  return username.trim().toLowerCase();
}

function parseUsersJson(raw: string | undefined): StoredUser[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((item) => {
      if (
        !item ||
        typeof item.id !== "string" ||
        typeof item.username !== "string" ||
        typeof item.role !== "string" ||
        typeof item.passwordHash !== "string"
      ) {
        return [];
      }
      return [{
        id: item.id,
        username: normalizeUsername(item.username),
        role: item.role as Role,
        passwordHash: item.passwordHash,
        disabled: Boolean(item.disabled),
        mfa: emptyMfaState(),
      }];
    });
  } catch {
    return [];
  }
}

export function loadBootstrapUsers(): StoredUser[] {
  const configured = parseUsersJson(process.env.AUTH_USERS_JSON);
  const adminUsername = process.env.AUTH_BOOTSTRAP_ADMIN_USERNAME;
  const adminPasswordHash = process.env.AUTH_BOOTSTRAP_ADMIN_PASSWORD_HASH;
  if (adminUsername && adminPasswordHash) {
    configured.push({
      id: process.env.AUTH_BOOTSTRAP_ADMIN_ID ?? "bootstrap-admin",
      username: normalizeUsername(adminUsername),
      role: "admin",
      passwordHash: adminPasswordHash,
      mfa: emptyMfaState(),
    });
  }
  return configured;
}

export class InMemoryUserRepository implements UserRepository {
  private byId = new Map<string, StoredUser>();
  private byUsername = new Map<string, StoredUser>();

  constructor(users: StoredUser[] = loadBootstrapUsers()) {
    for (const user of users) {
      const normalized = normalizeUsername(user.username);
      const stored: StoredUser = {
        ...user,
        username: normalized,
        mfa: user.mfa ?? emptyMfaState(),
      };
      this.byId.set(stored.id, stored);
      this.byUsername.set(stored.username, stored);
    }
  }

  async findByUsername(username: string): Promise<StoredUser | null> {
    return this.byUsername.get(normalizeUsername(username)) ?? null;
  }

  async findById(id: string): Promise<StoredUser | null> {
    return this.byId.get(id) ?? null;
  }

  async updateMfa(id: string, update: UserMfaUpdate): Promise<StoredUser | null> {
    const user = this.byId.get(id);
    if (!user) return null;
    const next: MfaState = {
      enabled: update.enabled ?? user.mfa.enabled,
      secret: update.secret !== undefined ? update.secret : user.mfa.secret,
      recoveryHashes: update.recoveryHashes ?? user.mfa.recoveryHashes,
      lastUsedStep: update.lastUsedStep ?? user.mfa.lastUsedStep,
      enrolledAtMs:
        update.enrolledAtMs !== undefined ? update.enrolledAtMs : user.mfa.enrolledAtMs,
    };
    user.mfa = next;
    return user;
  }

  async consumeRecoveryHash(id: string, hash: string): Promise<StoredUser | null> {
    const user = this.byId.get(id);
    if (!user) return null;
    const before = user.mfa.recoveryHashes.length;
    user.mfa.recoveryHashes = user.mfa.recoveryHashes.filter((h) => h !== hash);
    if (user.mfa.recoveryHashes.length === before) return null;
    return user;
  }

  async bumpLastUsedStep(id: string, newStep: number): Promise<boolean> {
    const user = this.byId.get(id);
    if (!user) return false;
    // CAS: single-process => trivialmente atomico.
    if (newStep > user.mfa.lastUsedStep) {
      user.mfa.lastUsedStep = newStep;
      return true;
    }
    return false;
  }
}
