import { maskCnpjForLog } from "./cnpj";
import type { EposiProduct } from "./config";
import type { MakfilOutcome } from "./types";

export interface AuditEvent {
  type:
    | "query.start"
    | "query.cache_hit"
    | "query.external_ok"
    | "query.external_fail"
    | "query.decision"
    | "query.rate_limited"
    | "query.invalid_input"
    | "prefill.start"
    | "prefill.ok"
    | "prefill.fail"
    | "prefill.invalid_input";
  correlationId: string;
  cnpjMasked: string;
  product?: EposiProduct;
  outcome?: MakfilOutcome;
  primaryRule?: string;
  errorCode?: string | null;
  httpStatus?: number;
  userId?: string;
  durationMs?: number;
  sourceIsMock?: boolean;
  message?: string;
}

// DB e assincrono => o contrato reflete isso. O servico chama
// best-effort (void sink.write(e).catch(...)) p/ nao bloquear a resposta.
export interface AuditSink {
  write(event: AuditEvent): Promise<void>;
  recent(limit?: number): Promise<AuditEvent[]>;
}

export class InMemoryAuditSink implements AuditSink {
  private events: AuditEvent[] = [];

  async write(event: AuditEvent): Promise<void> {
    this.events.push({ ...event });
    if (this.events.length > 1000) this.events.shift();
    // Log estruturado, sempre com CNPJ mascarado.
    // Nunca logar token ou payload bruto E-POSI.
    // eslint-disable-next-line no-console
    console.log(
      JSON.stringify({
        ts: new Date().toISOString(),
        scope: "makscore.audit",
        ...event,
      }),
    );
  }

  async recent(limit = 50): Promise<AuditEvent[]> {
    return this.events.slice(-limit).reverse();
  }
}

export function makeAuditEvent(
  partial: Omit<AuditEvent, "cnpjMasked"> & { cnpj: string },
): AuditEvent {
  const { cnpj, ...rest } = partial;
  return { ...rest, cnpjMasked: maskCnpjForLog(cnpj) };
}
