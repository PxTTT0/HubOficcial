import type { EposiCredentialId, MakScoreConfig } from "./config";

export type { EposiCredentialId } from "./config";

export interface EposiCredential {
  id: EposiCredentialId;
  login: string;
  password: string;
}

/**
 * Fonte ordenada de credenciais E-POSI para tentativa com fallback.
 *
 * `candidates()` retorna a lista NA ORDEM DE TENTATIVA. O cliente tenta a
 * primeira; se a autenticacao falhar, cai para a proxima. Lista vazia
 * significa "nenhuma credencial configurada".
 */
export interface EposiCredentialProvider {
  candidates(): EposiCredential[];
}

/**
 * Provider baseado em ambiente (env vars). Regras:
 *
 * - Uma credencial so e considerada presente se login E senha existirem.
 * - Apenas primaria configurada => 1 candidato (compat total).
 * - Ambas configuradas => fallback habilitado.
 * - `eposiActiveCredential` inverte a ORDEM (cutover controlado), mas
 *   NUNCA remove a outra credencial da lista: o fallback continua ativo.
 */
export class EnvEposiCredentialProvider implements EposiCredentialProvider {
  constructor(private readonly cfg: MakScoreConfig) {}

  candidates(): EposiCredential[] {
    const primary: EposiCredential | null =
      this.cfg.eposiLogin && this.cfg.eposiPassword
        ? { id: "primary", login: this.cfg.eposiLogin, password: this.cfg.eposiPassword }
        : null;

    const secondary: EposiCredential | null =
      this.cfg.eposiLoginSecondary && this.cfg.eposiPasswordSecondary
        ? {
            id: "secondary",
            login: this.cfg.eposiLoginSecondary,
            password: this.cfg.eposiPasswordSecondary,
          }
        : null;

    const ordered =
      this.cfg.eposiActiveCredential === "secondary"
        ? [secondary, primary]
        : [primary, secondary];

    return ordered.filter((c): c is EposiCredential => c !== null);
  }
}

/**
 * Interface MINIMA de auditoria injetada no LiveEposiClient.
 *
 * Proposito: registrar eventos de autenticacao E-POSI no audit
 * persistente de seguranca SEM acoplar o cliente ao modulo de seguranca
 * inteiro. O cliente so conhece este contrato.
 *
 * CONTRATO DE SEGURANCA: nenhuma implementacao pode receber/registrar
 * login, senha, token, payload bruto ou resposta bruta da E-POSI. Apenas
 * `credentialId`, um `reason` sanitizado (vocabulario fixo) e httpStatus.
 */
export interface EposiAuthAuditor {
  authSuccess(credentialId: EposiCredentialId, httpStatus: number): void;
  authFailure(
    credentialId: EposiCredentialId,
    reason: string,
    httpStatus?: number,
  ): void;
  authFallback(
    from: EposiCredentialId,
    to: EposiCredentialId,
    reason: string,
  ): void;
  /** Todas as credenciais falharam OU nenhuma configurada. */
  authExhausted(reason: string): void;
}

/** Auditor nulo - usado por mock/testes sem audit persistente. */
export const NOOP_EPOSI_AUDITOR: EposiAuthAuditor = {
  authSuccess() {},
  authFailure() {},
  authFallback() {},
  authExhausted() {},
};
