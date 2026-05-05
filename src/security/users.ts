import type { Role } from "../modules/makscore/auth";

export interface StoredUser {
  id: string;
  username: string;
  role: Role;
  passwordHash: string;
  disabled?: boolean;
}

export interface UserRepository {
  findByUsername(username: string): StoredUser | null;
  findById(id: string): StoredUser | null;
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
      }];
    });
  } catch {
    return [];
  }
}

function loadBootstrapUsers(): StoredUser[] {
  const configured = parseUsersJson(process.env.AUTH_USERS_JSON);
  const adminUsername = process.env.AUTH_BOOTSTRAP_ADMIN_USERNAME;
  const adminPasswordHash = process.env.AUTH_BOOTSTRAP_ADMIN_PASSWORD_HASH;
  if (adminUsername && adminPasswordHash) {
    configured.push({
      id: process.env.AUTH_BOOTSTRAP_ADMIN_ID ?? "bootstrap-admin",
      username: normalizeUsername(adminUsername),
      role: "admin",
      passwordHash: adminPasswordHash,
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
      const stored = { ...user, username: normalized };
      this.byId.set(stored.id, stored);
      this.byUsername.set(stored.username, stored);
    }
  }

  findByUsername(username: string): StoredUser | null {
    return this.byUsername.get(normalizeUsername(username)) ?? null;
  }

  findById(id: string): StoredUser | null {
    return this.byId.get(id) ?? null;
  }
}
