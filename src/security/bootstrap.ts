import type { SecurityAuditConfig } from "./audit";
import type { SecurityConfig } from "./config";

const DEV_SESSION_SECRET = "dev-insecure-session-secret-change-me";
const MIN_SESSION_SECRET_BYTES = 32;

// Valores obviamente nao-reais que nao podem subir como credencial E-POSI
// em producao. Comparados em lowercase, com trim. Match exato (nao substring)
// para nao rejeitar uma senha forte legitima que contenha "test" no meio.
const EPOSI_CREDENTIAL_PLACEHOLDERS = new Set([
  "changeme",
  "change-me",
  "trocar",
  "senha",
  "password",
  "admin",
  "test",
  "teste",
]);

function isEposiPlaceholder(value: string): boolean {
  return EPOSI_CREDENTIAL_PLACEHOLDERS.has(value.trim().toLowerCase());
}

export class ProductionSecurityError extends Error {
  constructor(public readonly issues: string[]) {
    super(
      "Producao recusou subir por configuracao de seguranca insuficiente:\n  - " +
        issues.join("\n  - "),
    );
    this.name = "ProductionSecurityError";
  }
}

export interface ProductionEnvironment {
  envName: string;
  security: SecurityConfig;
  audit: SecurityAuditConfig & { configured?: boolean };
  makscore: {
    cnpjPepper: string;
    eposiMode: string;
    eposiLogin: string;
    eposiPassword: string;
    eposiLoginSecondary: string;
    eposiPasswordSecondary: string;
  };
  redis: {
    url: string | null;
    allowInMemoryState: boolean;
  };
  db: {
    url: string | null;
    allowInMemoryState: boolean;
    /** Resultado da validacao da chave de cifragem do secret MFA. */
    encryptionKeyOk: boolean;
    encryptionKeyReason?: string;
  };
}

/**
 * Em NODE_ENV=production, exige que toda a configuracao critica de
 * seguranca esteja presente e nao apresente valores-default ou inseguros.
 *
 * Estrategia: agregar TODOS os problemas em uma unica excecao para o
 * operador conseguir corrigir tudo de uma vez, em vez de empilhar deploys
 * com falha + correcao + falha + correcao.
 *
 * Em ambientes != production, retorna sem validar nada (dev/test ficam
 * livres para usar defaults inseguros, intencional).
 */
export function validateProductionEnvironment(env: ProductionEnvironment): void {
  if (env.envName !== "production") return;

  const issues: string[] = [];

  // AUTH_SESSION_SECRET tem que ser longo e nao pode ser o default de dev.
  if (!env.security.sessionSecret) {
    issues.push("AUTH_SESSION_SECRET nao definido");
  } else if (env.security.sessionSecret === DEV_SESSION_SECRET) {
    issues.push(
      "AUTH_SESSION_SECRET ainda esta usando o default de dev - gerar um segredo aleatorio com pelo menos 32 bytes",
    );
  } else if (env.security.sessionSecret.length < MIN_SESSION_SECRET_BYTES) {
    issues.push(
      `AUTH_SESSION_SECRET tem apenas ${env.security.sessionSecret.length} caracteres - exigido minimo de ${MIN_SESSION_SECRET_BYTES}`,
    );
  } else if (/^dev[-_]/i.test(env.security.sessionSecret)) {
    issues.push("AUTH_SESSION_SECRET parece ser um placeholder de dev (prefixo 'dev-')");
  }

  // Cookies em producao precisam de Secure (TLS obrigatorio entre cliente e proxy).
  if (!env.security.secureCookies) {
    issues.push("AUTH_SECURE_COOKIES tem que ser true em producao");
  }

  // CORS allowlist tem que existir em producao para o middleware CSRF/origin
  // bloquear requisicoes mutaveis de origens nao confiaveis.
  if (env.security.trustedOrigins.length === 0) {
    issues.push(
      "AUTH_TRUSTED_ORIGINS esta vazio - listar todos os dominios do front, ex: https://hub.makfil.com.br",
    );
  }

  // Dev header auth nunca deve subir em producao - tratado tambem em config.ts
  // que forca para false; checagem extra protege contra bypass via outras rotas.
  if (env.security.allowDevHeaderAuth) {
    issues.push(
      "AUTH_ALLOW_DEV_HEADER_AUTH esta habilitado em producao - bypass de autenticacao via header",
    );
  }

  // Auditoria persistente eh requisito operacional em producao.
  if (env.audit.configured === false || !env.audit.filePath) {
    issues.push(
      "AUDIT_LOG_PATH nao configurado - eventos de seguranca nao seriam persistidos",
    );
  }

  // Pepper do hash de CNPJ tem que existir, senao o repo guarda chaves
  // dependentes apenas do CNPJ + secret default.
  if (!env.makscore.cnpjPepper || env.makscore.cnpjPepper.trim().length === 0) {
    issues.push(
      "MAKSCORE_CNPJ_PEPPER nao configurado - hashes de CNPJ ficariam previsiveis",
    );
  }

  // Integracao real E-POSI exige credenciais. Em mock nao validamos:
  // homologacao/dev sobem sem login/senha de proposito. As mensagens
  // NUNCA incluem o valor de login/senha (so o nome da variavel).
  if (env.makscore.eposiMode === "live") {
    const login = env.makscore.eposiLogin?.trim() ?? "";
    const password = env.makscore.eposiPassword?.trim() ?? "";

    if (login.length === 0) {
      issues.push(
        "MAKSCORE_EPOSI_LOGIN nao definido mas MAKSCORE_EPOSI_MODE=live - integracao real exige credencial",
      );
    } else if (isEposiPlaceholder(login)) {
      issues.push(
        "MAKSCORE_EPOSI_LOGIN parece ser um placeholder - definir o login real da API E-POSI",
      );
    }

    if (password.length === 0) {
      issues.push(
        "MAKSCORE_EPOSI_PASSWORD nao definido mas MAKSCORE_EPOSI_MODE=live - integracao real exige credencial",
      );
    } else if (isEposiPlaceholder(password)) {
      issues.push(
        "MAKSCORE_EPOSI_PASSWORD parece ser um placeholder - definir a senha real da API E-POSI",
      );
    }

    // Credencial secundaria e OPCIONAL, mas se uma metade for definida a
    // outra tambem tem que ser - secundaria pela metade nao autentica e
    // mascara um erro de config como "fallback indisponivel" em runtime.
    const secLogin = env.makscore.eposiLoginSecondary?.trim() ?? "";
    const secPassword = env.makscore.eposiPasswordSecondary?.trim() ?? "";
    const secLoginSet = secLogin.length > 0;
    const secPasswordSet = secPassword.length > 0;

    if (secLoginSet !== secPasswordSet) {
      issues.push(
        "Credencial E-POSI secundaria parcial - definir AMBOS MAKSCORE_EPOSI_LOGIN_SECONDARY e MAKSCORE_EPOSI_PASSWORD_SECONDARY, ou nenhum",
      );
    } else if (secLoginSet && secPasswordSet) {
      if (isEposiPlaceholder(secLogin)) {
        issues.push(
          "MAKSCORE_EPOSI_LOGIN_SECONDARY parece ser um placeholder - definir o login real ou remover a secundaria",
        );
      }
      if (isEposiPlaceholder(secPassword)) {
        issues.push(
          "MAKSCORE_EPOSI_PASSWORD_SECONDARY parece ser um placeholder - definir a senha real ou remover a secundaria",
        );
      }
    }
  }

  // Estado efemero (sessoes/rate limit/MFA challenge/token E-POSI) em
  // memoria nao sobrevive a restart nem e compartilhado entre replicas.
  // Producao exige Redis, salvo opt-out explicito de emergencia.
  if (!env.redis.url && !env.redis.allowInMemoryState) {
    issues.push(
      "REDIS_URL nao definido em producao - estado de sessao/rate-limit/MFA ficaria em memoria (perde no restart, nao compartilha entre replicas). Definir REDIS_URL ou, em emergencia, ALLOW_IN_MEMORY_STATE=true",
    );
  }

  // DB e fonte de verdade de usuarios/MFA/recovery/auditoria funcional.
  // Producao exige DATABASE_URL, salvo o mesmo opt-out de emergencia.
  if (!env.db.url && !env.db.allowInMemoryState) {
    issues.push(
      "DATABASE_URL nao definido em producao - usuarios/MFA/recovery/auditoria funcional ficariam em memoria (perde no restart). Definir DATABASE_URL ou, em emergencia, ALLOW_IN_MEMORY_STATE=true",
    );
  }
  // Com DB ativo, o secret TOTP e cifrado em repouso: a chave e
  // obrigatoria e precisa ser forte (base64 de 32 bytes).
  if (env.db.url && !env.db.encryptionKeyOk) {
    issues.push(
      `AUTH_MFA_SECRET_ENCRYPTION_KEY invalida com DATABASE_URL ativo (${env.db.encryptionKeyReason ?? "ausente"}) - exigir base64 que decodifique para 32 bytes`,
    );
  }

  if (issues.length > 0) {
    throw new ProductionSecurityError(issues);
  }
}
