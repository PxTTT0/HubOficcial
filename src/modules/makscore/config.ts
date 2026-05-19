export type EposiProduct = "TOTAL_PJ" | "COMPLETA_PJ";
export type EposiMode = "mock" | "live";
export type EposiCredentialId = "primary" | "secondary";

export interface MakScoreConfig {
  eposiMode: EposiMode;
  eposiAuthUrl: string;
  eposiQueryUrl: string;
  eposiLogin: string;
  eposiPassword: string;
  // Credencial secundaria OPCIONAL para rotacao sem downtime.
  // Vazia => apenas a primaria existe (compat total com deploy antigo).
  eposiLoginSecondary: string;
  eposiPasswordSecondary: string;
  // Pin manual de ordem para cutover controlado. NUNCA desativa o
  // fallback - apenas inverte qual credencial e tentada primeiro.
  eposiActiveCredential: EposiCredentialId;
  defaultProduct: EposiProduct;
  approveMinScore: number;
  reproveMaxScore: number;
  validityHours: number;
  httpTimeoutMs: number;
  rateLimitPerMin: number;
  // Politica de ticket: valor (BRL) acima do qual operacao e considerada
  // "alto" e empurra cenarios intermediarios para exige_analise.
  // Default conservador - precisa validacao comercial Makfil.
  highTicketAmount: number;
}

function num(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

function product(raw: string | undefined): EposiProduct {
  return raw === "COMPLETA_PJ" ? "COMPLETA_PJ" : "TOTAL_PJ";
}

function mode(raw: string | undefined): EposiMode {
  return raw === "live" ? "live" : "mock";
}

export function loadConfig(): MakScoreConfig {
  return {
    eposiMode: mode(process.env.MAKSCORE_EPOSI_MODE),
    eposiAuthUrl:
      process.env.MAKSCORE_EPOSI_AUTH_URL ??
      "https://eposi.toolsdata.com.br/api/gatewaybiro/authentication",
    eposiQueryUrl:
      process.env.MAKSCORE_EPOSI_QUERY_URL ??
      "https://eposi.toolsdata.com.br/api/gatewaybiro/processfilter",
    eposiLogin: process.env.MAKSCORE_EPOSI_LOGIN ?? "",
    eposiPassword: process.env.MAKSCORE_EPOSI_PASSWORD ?? "",
    eposiLoginSecondary: process.env.MAKSCORE_EPOSI_LOGIN_SECONDARY ?? "",
    eposiPasswordSecondary: process.env.MAKSCORE_EPOSI_PASSWORD_SECONDARY ?? "",
    eposiActiveCredential:
      process.env.MAKSCORE_EPOSI_ACTIVE_CREDENTIAL === "secondary"
        ? "secondary"
        : "primary",
    defaultProduct: product(process.env.MAKSCORE_DEFAULT_PRODUCT),
    approveMinScore: num("MAKSCORE_APPROVE_MIN_SCORE", 700),
    reproveMaxScore: num("MAKSCORE_REPROVE_MAX_SCORE", 400),
    validityHours: num("MAKSCORE_VALIDITY_HOURS", 24),
    httpTimeoutMs: num("MAKSCORE_HTTP_TIMEOUT_MS", 8000),
    rateLimitPerMin: num("MAKSCORE_RATE_LIMIT_PER_MIN", 20),
    highTicketAmount: num("MAKSCORE_HIGH_TICKET_AMOUNT", 50_000),
  };
}
