import { loadConfig } from "./config";
import { buildEposiClient } from "./eposiClient";
import { InMemoryMakScoreRepository } from "./repository";
import { buildMakScoreRouter } from "./routes";
import { MakScoreService } from "./service";
import { InMemoryAuditSink } from "./audit";
import type { SecurityContext } from "../../security";

export function createMakScoreModule(security: SecurityContext) {
  const cfg = loadConfig();
  const client = buildEposiClient(cfg);
  const repo = new InMemoryMakScoreRepository();
  const audit = new InMemoryAuditSink();
  const service = new MakScoreService(cfg, client, repo, audit);
  const router = buildMakScoreRouter(service, cfg, security);
  return { cfg, service, router };
}

export * from "./types";
export { applyMakfilPolicy } from "./policy";
export { normalizeEposi } from "./normalizer";
export { isValidCnpj, maskCnpjForLog, maskCnpjForDisplay } from "./cnpj";
