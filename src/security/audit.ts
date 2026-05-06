import fs from "node:fs";
import path from "node:path";
import type { Request } from "express";
import type { Role } from "../modules/makscore/auth";
import { getClientIp } from "./http";

export type SecurityAuditScope =
  | "auth"
  | "auth.mfa"
  | "auth.session"
  | "auth.csrf";

export type SecurityAuditSeverity = "info" | "warn" | "high";

export interface SecurityAuditEvent {
  ts: string;
  scope: SecurityAuditScope;
  type: string;
  severity: SecurityAuditSeverity;
  outcome?: "success" | "failure";
  reason?: string;
  actor?: { userId?: string; username?: string; role?: Role };
  ip?: string;
  userAgent?: string;
  details?: Record<string, unknown>;
}

export interface SecurityAuditConfig {
  filePath: string | null;
  memoryRetain: number;
}

function num(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function loadSecurityAuditConfig(): SecurityAuditConfig {
  const raw = process.env.AUDIT_LOG_PATH;
  return {
    // Vazio explicito ("") desativa file sink. undefined cai no default.
    filePath:
      raw === undefined
        ? path.resolve(process.cwd(), "logs", "security-audit.jsonl")
        : raw === ""
          ? null
          : raw,
    memoryRetain: num(process.env.AUDIT_MEMORY_RETAIN, 1000),
  };
}

export interface SecurityAuditSink {
  write(event: SecurityAuditEvent): void;
  recent(limit?: number): SecurityAuditEvent[];
}

/**
 * Sink append-only em JSON Lines.
 *
 * - Cada evento e uma linha JSON separada por \n. Append e atomico em
 *   POSIX para writes < PIPE_BUF e funciona bem em Windows para os
 *   tamanhos tipicos de evento (~512 bytes), o que protege contra
 *   intercalacao parcial sob concorrencia.
 * - Falha de IO nao deve quebrar a request: erros sao silenciados em
 *   memoria com throttle de 60s para nao floodar log.
 * - Mantem buffer em memoria para `recent()` (endpoint admin).
 * - Rotacao e compressao sao responsabilidade do operador (logrotate).
 */
export class JsonlSecurityAuditSink implements SecurityAuditSink {
  private buffer: SecurityAuditEvent[] = [];
  private lastWriteErrorAtMs = 0;

  constructor(private readonly cfg: SecurityAuditConfig) {
    if (cfg.filePath) {
      try {
        fs.mkdirSync(path.dirname(cfg.filePath), { recursive: true });
      } catch {
        // best effort - falha sera reportada na primeira tentativa de write
      }
    }
  }

  write(event: SecurityAuditEvent): void {
    this.buffer.push(event);
    const overflow = this.buffer.length - this.cfg.memoryRetain;
    if (overflow > 0) this.buffer.splice(0, overflow);

    const line = JSON.stringify(event) + "\n";

    if (this.cfg.filePath) {
      try {
        fs.appendFileSync(this.cfg.filePath, line, { encoding: "utf8" });
      } catch (err) {
        const now = Date.now();
        if (now - this.lastWriteErrorAtMs > 60_000) {
          this.lastWriteErrorAtMs = now;
          // eslint-disable-next-line no-console
          console.error(
            JSON.stringify({
              ts: new Date().toISOString(),
              scope: "audit",
              severity: "high",
              type: "audit.write_failed",
              error: err instanceof Error ? err.message : String(err),
            }),
          );
        }
      }
    }
  }

  recent(limit = 50): SecurityAuditEvent[] {
    return this.buffer.slice(-limit).reverse();
  }
}

export function buildAuditContext(
  req: Request,
  actor?: { userId?: string; username?: string; role?: Role },
): Pick<SecurityAuditEvent, "ip" | "userAgent" | "actor"> {
  return {
    ip: getClientIp(req),
    userAgent: req.header("user-agent"),
    ...(actor ? { actor } : {}),
  };
}
