import { loadConfig } from "./config";
import type { EposiCredentialId } from "./config";
import { buildEposiClient } from "./eposiClient";
import type { EposiAuthAuditor } from "./eposiCredentials";
import { InMemoryMakScoreRepository } from "./repository";
import { buildMakScoreRouter } from "./routes";
import { MakScoreService } from "./service";
import { InMemoryAuditSink } from "./audit";
import type { SecurityContext } from "../../security";
import type { SecurityAuditSink } from "../../security";
import type { InfraStores } from "../../infra";

/**
 * Adapter: traduz eventos de auth E-POSI para o audit PERSISTENTE de
 * seguranca, sem o cliente conhecer o modulo de seguranca.
 *
 * CONTRATO: `details` carrega apenas credentialId, reason sanitizado e
 * httpStatus. Nunca login, senha, token, payload ou resposta bruta.
 */
function eposiSecurityAuditor(sink: SecurityAuditSink): EposiAuthAuditor {
  const emit = (
    type: string,
    severity: "info" | "warn" | "high",
    outcome: "success" | "failure" | undefined,
    reason: string | undefined,
    details: Record<string, unknown>,
  ): void => {
    sink.write({
      ts: new Date().toISOString(),
      scope: "makscore",
      type,
      severity,
      ...(outcome ? { outcome } : {}),
      ...(reason ? { reason } : {}),
      details,
    });
  };
  return {
    authSuccess(credentialId: EposiCredentialId, httpStatus: number) {
      emit("eposi.auth.success", "info", "success", undefined, {
        credentialId,
        httpStatus,
      });
    },
    authFailure(
      credentialId: EposiCredentialId,
      reason: string,
      httpStatus?: number,
    ) {
      emit("eposi.auth.failure", "warn", "failure", reason, {
        credentialId,
        ...(httpStatus !== undefined ? { httpStatus } : {}),
      });
    },
    authFallback(
      from: EposiCredentialId,
      to: EposiCredentialId,
      reason: string,
    ) {
      emit("eposi.auth.fallback", "warn", undefined, reason, { from, to });
    },
    authExhausted(reason: string) {
      emit("eposi.auth.exhausted", "high", "failure", reason, {});
    },
  };
}

export function createMakScoreModule(
  security: SecurityContext,
  infra: InfraStores,
) {
  const cfg = loadConfig();
  const client = buildEposiClient(
    cfg,
    eposiSecurityAuditor(security.audit),
    infra.eposiTokenStore,
  );
  const repo = new InMemoryMakScoreRepository();
  const audit = new InMemoryAuditSink();
  const service = new MakScoreService(cfg, client, repo, audit);
  const router = buildMakScoreRouter(service, cfg, security, infra);
  return { cfg, service, router };
}

export * from "./types";
export { applyMakfilPolicy } from "./policy";
export { normalizeEposi } from "./normalizer";
export { isValidCnpj, maskCnpjForLog, maskCnpjForDisplay } from "./cnpj";
