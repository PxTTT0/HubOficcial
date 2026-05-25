import type { SqlExecutor } from "./pool";
import type { AuditEvent, AuditSink } from "../../modules/makscore/audit";

interface AuditRow {
  ts: Date | string;
  correlation_id: string | null;
  type: string;
  cnpj_masked: string | null;
  product: string | null;
  outcome: string | null;
  primary_rule: string | null;
  error_code: string | null;
  http_status: number | null;
  user_id: string | null;
  duration_ms: number | null;
  source_is_mock: boolean | null;
  message: string | null;
}

/**
 * Auditoria funcional MakScore em tabela Postgres (consultavel,
 * filtravel, sobrevive a restart).
 *
 * `write` e best-effort: falha de DB e engolida com throttle de log
 * (sem dado sensivel) p/ nunca afetar o fluxo de consulta. Nenhum
 * campo aqui contem secret/token/payload bruto - apenas CNPJ ja
 * mascarado e metadados de decisao.
 */
export class PgMakScoreAuditSink implements AuditSink {
  private lastErrorLogAtMs = 0;

  constructor(private readonly exec: SqlExecutor) {}

  async write(event: AuditEvent): Promise<void> {
    try {
      await this.exec.query(
        `INSERT INTO makscore_audit
           (correlation_id, type, cnpj_masked, product, outcome,
            primary_rule, error_code, http_status, user_id,
            duration_ms, source_is_mock, message)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [
          event.correlationId ?? null,
          event.type,
          event.cnpjMasked ?? null,
          event.product ?? null,
          event.outcome ?? null,
          event.primaryRule ?? null,
          event.errorCode ?? null,
          event.httpStatus ?? null,
          event.userId ?? null,
          event.durationMs ?? null,
          event.sourceIsMock ?? null,
          event.message ?? null,
        ],
      );
    } catch (err) {
      const now = Date.now();
      if (now - this.lastErrorLogAtMs > 60_000) {
        this.lastErrorLogAtMs = now;
        // eslint-disable-next-line no-console
        console.error(
          JSON.stringify({
            ts: new Date().toISOString(),
            scope: "makscore.audit",
            level: "error",
            message: "makscore_audit write failed",
            error: err instanceof Error ? err.message : String(err),
          }),
        );
      }
    }
  }

  async recent(limit = 50): Promise<AuditEvent[]> {
    const safe = Math.min(Math.max(limit, 1), 500);
    const r = await this.exec.query<AuditRow>(
      `SELECT ts, correlation_id, type, cnpj_masked, product, outcome,
              primary_rule, error_code, http_status, user_id,
              duration_ms, source_is_mock, message
         FROM makscore_audit
        ORDER BY ts DESC, id DESC
        LIMIT $1`,
      [safe],
    );
    return r.rows.map((row) => ({
      type: row.type as AuditEvent["type"],
      correlationId: row.correlation_id ?? "",
      cnpjMasked: row.cnpj_masked ?? "",
      ...(row.product ? { product: row.product as AuditEvent["product"] } : {}),
      ...(row.outcome
        ? { outcome: row.outcome as AuditEvent["outcome"] }
        : {}),
      ...(row.primary_rule ? { primaryRule: row.primary_rule } : {}),
      ...(row.error_code !== null ? { errorCode: row.error_code } : {}),
      ...(row.http_status !== null ? { httpStatus: row.http_status } : {}),
      ...(row.user_id ? { userId: row.user_id } : {}),
      ...(row.duration_ms !== null ? { durationMs: row.duration_ms } : {}),
      ...(row.source_is_mock !== null
        ? { sourceIsMock: row.source_is_mock }
        : {}),
      ...(row.message ? { message: row.message } : {}),
    }));
  }
}
