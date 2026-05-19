import argon2 from "argon2";

const DEFAULT_MEMORY_COST = 19_456;
const DEFAULT_TIME_COST = 3;
const DEFAULT_PARALLELISM = 1;

function num(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export interface PasswordHashingConfig {
  memoryCost: number;
  timeCost: number;
  parallelism: number;
}

export function loadPasswordHashingConfig(): PasswordHashingConfig {
  return {
    memoryCost: num(process.env.AUTH_ARGON2_MEMORY_COST, DEFAULT_MEMORY_COST),
    timeCost: num(process.env.AUTH_ARGON2_TIME_COST, DEFAULT_TIME_COST),
    parallelism: num(process.env.AUTH_ARGON2_PARALLELISM, DEFAULT_PARALLELISM),
  };
}

export async function hashPassword(
  password: string,
  cfg: PasswordHashingConfig = loadPasswordHashingConfig(),
): Promise<string> {
  return argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: cfg.memoryCost,
    timeCost: cfg.timeCost,
    parallelism: cfg.parallelism,
  });
}

export async function verifyPassword(
  passwordHash: string,
  password: string,
): Promise<boolean> {
  try {
    return await argon2.verify(passwordHash, password);
  } catch {
    return false;
  }
}
