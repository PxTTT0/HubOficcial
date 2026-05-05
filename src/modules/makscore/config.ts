export type EposiProduct = "TOTAL_PJ" | "COMPLETA_PJ";
export type EposiMode = "mock" | "live";

export interface MakScoreConfig {
  eposiMode: EposiMode;
  eposiAuthUrl: string;
  eposiQueryUrl: string;
  eposiLogin: string;
  eposiPassword: string;
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
    defaultProduct: product(process.env.MAKSCORE_DEFAULT_PRODUCT),
    approveMinScore: num("MAKSCORE_APPROVE_MIN_SCORE", 700),
    reproveMaxScore: num("MAKSCORE_REPROVE_MAX_SCORE", 400),
    validityHours: num("MAKSCORE_VALIDITY_HOURS", 24),
    httpTimeoutMs: num("MAKSCORE_HTTP_TIMEOUT_MS", 8000),
    rateLimitPerMin: num("MAKSCORE_RATE_LIMIT_PER_MIN", 20),
    highTicketAmount: num("MAKSCORE_HIGH_TICKET_AMOUNT", 50_000),
  };
}
