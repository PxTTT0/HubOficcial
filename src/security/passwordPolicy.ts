const COMMON_PASSWORDS = new Set([
  "12345678",
  "123456789",
  "password",
  "password1",
  "senha123",
  "senha1234",
  "admin123",
  "admin1234",
  "makfil123",
  "hubvendas123",
  "qwerty123",
  "letmein123",
]);

export interface PasswordPolicy {
  minLength: number;
  requireLowercase: boolean;
  requireUppercase: boolean;
  requireNumber: boolean;
  requireSymbol: boolean;
}

export interface PasswordPolicyResult {
  ok: boolean;
  errors: string[];
}

function bool(raw: string | undefined, fallback: boolean): boolean {
  if (!raw) return fallback;
  return raw === "1" || raw.toLowerCase() === "true";
}

function num(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function loadPasswordPolicy(): PasswordPolicy {
  return {
    minLength: num(process.env.AUTH_PASSWORD_MIN_LENGTH, 12),
    requireLowercase: bool(process.env.AUTH_PASSWORD_REQUIRE_LOWERCASE, true),
    requireUppercase: bool(process.env.AUTH_PASSWORD_REQUIRE_UPPERCASE, true),
    requireNumber: bool(process.env.AUTH_PASSWORD_REQUIRE_NUMBER, true),
    requireSymbol: bool(process.env.AUTH_PASSWORD_REQUIRE_SYMBOL, true),
  };
}

export function validatePasswordPolicy(
  password: string,
  policy: PasswordPolicy = loadPasswordPolicy(),
): PasswordPolicyResult {
  const errors: string[] = [];
  const normalized = password.trim().toLowerCase();

  if (password.length < policy.minLength) {
    errors.push(`senha deve ter pelo menos ${policy.minLength} caracteres`);
  }
  if (policy.requireLowercase && !/[a-z]/.test(password)) {
    errors.push("senha deve conter letra minuscula");
  }
  if (policy.requireUppercase && !/[A-Z]/.test(password)) {
    errors.push("senha deve conter letra maiuscula");
  }
  if (policy.requireNumber && !/\d/.test(password)) {
    errors.push("senha deve conter numero");
  }
  if (policy.requireSymbol && !/[^A-Za-z0-9]/.test(password)) {
    errors.push("senha deve conter simbolo");
  }
  if (COMMON_PASSWORDS.has(normalized)) {
    errors.push("senha consta na denylist local de senhas comuns");
  }
  if (/^(.)\1{7,}$/.test(password)) {
    errors.push("senha nao pode repetir o mesmo caractere");
  }

  return { ok: errors.length === 0, errors };
}
