import type { MakScoreConfig } from "./config";
import { runDecisionEngine } from "./decision/engine";
import type { MakfilDecision, MakScoreContext, NormalizedEposi } from "./types";

/**
 * Wrapper fino do Decision Engine, mantido por compatibilidade com as
 * chamadas e testes existentes. Toda a logica de regras vive em
 * `decision/` (rules.ts + engine.ts). Paridade de outcome/primaryRule
 * preservada.
 */
export function applyMakfilPolicy(
  n: NormalizedEposi,
  cfg: MakScoreConfig,
  ctx?: MakScoreContext,
): MakfilDecision {
  return runDecisionEngine(n, cfg, ctx);
}

export { runDecisionEngine } from "./decision/engine";
export { MAKFIL_RULES } from "./decision/rules";
