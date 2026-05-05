import type { MakScoreConfig, EposiProduct } from "./config";

export interface EposiRawResponse {
  raw: unknown;
  httpStatus: number;
  // Indica que esta resposta foi gerada por mock controlado.
  // Sempre setado para true em modo "mock" para impedir confusao com producao.
  fromMock: boolean;
}

export interface EposiClient {
  query(cnpj: string, product: EposiProduct): Promise<EposiRawResponse>;
}

interface TokenCache {
  token: string;
  expiresAt: number;
}

class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit & { timeoutMs: number },
): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), init.timeoutMs);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

export class LiveEposiClient implements EposiClient {
  private tokenCache: TokenCache | null = null;

  constructor(private cfg: MakScoreConfig) {}

  private async authenticate(): Promise<string> {
    const now = Date.now();
    if (this.tokenCache && this.tokenCache.expiresAt > now + 5_000) {
      return this.tokenCache.token;
    }
    if (!this.cfg.eposiLogin || !this.cfg.eposiPassword) {
      throw new HttpError(500, "MAKSCORE_EPOSI_LOGIN/PASSWORD ausentes");
    }
    const res = await fetchWithTimeout(this.cfg.eposiAuthUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        login: this.cfg.eposiLogin,
        password: this.cfg.eposiPassword,
      }),
      timeoutMs: this.cfg.httpTimeoutMs,
    });
    if (!res.ok) {
      throw new HttpError(res.status, `Falha autenticacao E-POSI (${res.status})`);
    }
    const data = (await res.json()) as { token?: string; access_token?: string };
    const token = data.token ?? data.access_token;
    if (!token) throw new HttpError(502, "Token E-POSI ausente na resposta");
    // token vale 5 minutos; renovar antes para seguranca
    this.tokenCache = { token, expiresAt: now + 4 * 60_000 };
    return token;
  }

  async query(cnpj: string, product: EposiProduct): Promise<EposiRawResponse> {
    const token = await this.authenticate();
    const res = await fetchWithTimeout(this.cfg.eposiQueryUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      // Manual E-POSI usa { documento, consultas: [PRODUTO] }.
      body: JSON.stringify({ documento: cnpj, consultas: [product] }),
      timeoutMs: this.cfg.httpTimeoutMs,
    });
    const httpStatus = res.status;
    let raw: unknown = null;
    try {
      raw = await res.json();
    } catch {
      raw = null;
    }
    if (httpStatus === 401 || httpStatus === 403) {
      // invalida token para forcar reautenticacao no proximo
      this.tokenCache = null;
    }
    return { raw, httpStatus, fromMock: false };
  }
}

// Mock controlado para homologacao. Nao deve ser usado em producao.
// Reproduz o formato real do manual E-POSI:
//   - VerifiQPJResponseEx.Response.VerifiQPJOutput[].Analytics.ScorePJ
//   - ReportPJResponseEx.Response.ReportPJOutput[].BestInfo
//   - Restrictive.{Negative.Apontamentos, Protests.Protest, Inquiry}
// Cenarios deterministicos pelo sufixo do CNPJ.
export class MockEposiClient implements EposiClient {
  async query(cnpj: string, product: EposiProduct): Promise<EposiRawResponse> {
    const tail = cnpj.slice(-2);
    const last = Number(cnpj.slice(-1));

    let companyStatus = "ATIVO";
    let score: number | string = 0;
    let reasons: string[] = [];
    let errorCode = "";
    let errorMessage = "";
    let countApontamento = "0";
    let amountTotal = "0";
    let qtdProtestos = "0";
    let valorProtestos = "0";

    if (tail === "01") {
      errorCode = "1001";
      errorMessage = "CNPJ invalido";
    } else if (tail === "02") {
      errorCode = "1005";
      errorMessage = "Inapta";
      companyStatus = "INAPTA";
    } else if (tail === "03") {
      errorCode = "1003";
      errorMessage = "Bloqueio judicial";
    } else if (tail === "04") {
      errorCode = "1021";
      errorMessage = "Indisponivel";
    } else if (tail === "05") {
      errorCode = "1006";
      errorMessage = "Opt-Out";
    } else if (tail === "06") {
      score = "350";
      reasons = ["R3", "R5"];
      countApontamento = "2";
      amountTotal = "1500";
    } else if (tail === "07") {
      score = "550";
      reasons = ["R2"];
    } else {
      score = String(720 + last * 5);
      reasons = last % 2 === 0 ? ["R2"] : [];
    }

    const scorePJ: any = { Score: score };
    if (reasons[0]) scorePJ.ReasonCode1 = reasons[0];
    if (reasons[1]) scorePJ.ReasonCode2 = reasons[1];
    if (reasons[2]) scorePJ.ReasonCode3 = reasons[2];
    if (reasons[3]) scorePJ.ReasonCode4 = reasons[3];
    if (errorCode) scorePJ.ErrorCode = errorCode;
    if (errorMessage) scorePJ.ErrorMessage = errorMessage;

    const verifiq: any = {
      VerifiQPJResponseEx: {
        Response: {
          Header: { Status: 0, QueryId: "mock" },
          VerifiQPJOutput: [
            {
              CNPJ: cnpj,
              DateReference: "20260504",
              Analytics: { ScorePJ: scorePJ },
              Restrictive: {
                Negative: {
                  Apontamentos: {
                    Apontamento: [
                      {
                        CpfCnpj: cnpj,
                        CountApontamento: countApontamento,
                        AmountTotal: amountTotal,
                        Situation: countApontamento === "0" ? "Nada Consta" : "Consta",
                      },
                    ],
                  },
                },
                Protests: {
                  Protest: [
                    {
                      CpfCnpj: cnpj,
                      QuantidadeProtestos: qtdProtestos,
                      ValorTotalProtestos: valorProtestos,
                      Situacao: qtdProtestos === "0" ? "Nada Consta" : "Consta",
                    },
                  ],
                },
                Inquiry: { InquiryCount12Months: 1 },
              },
            },
          ],
        },
      },
    };

    const report: any = {
      ReportPJResponseEx: {
        Response: {
          Header: { Status: 0, QueryId: "mock" },
          ReportPJOutput: [
            {
              CNPJ: cnpj,
              CPStatus: "1",
              BestInfo: {
                CompanyStatus: companyStatus,
                CompanyName: "EMPRESA MOCK LTDA",
                TradeName: "MOCK",
                LegalType: "2062",
                MainActivity: "4744001",
                MainActivityDescription: "COMERCIO MOCK",
                DateFoundation: { Year: "2010", Month: "1", Day: "15" },
                Address: {
                  Street: "RUA TESTE",
                  Number: "100",
                  City: "SAO PAULO",
                  State: "SP",
                  PostalCode: "01000-000",
                },
                Email: { Email: "contato@mock.test" },
                Phone: { PhoneNumber: "1140000000" },
              },
            },
          ],
        },
      },
    };

    // Em TOTAL_PJ os documentos mostram VerifiQ + Report no mesmo retorno.
    // Em COMPLETA_PJ, prevalece o bloco cadastral. Mantemos os dois para
    // exercitar o normalizer com tolerancia a paths reais.
    const raw: any = {
      ...verifiq,
      ...report,
      _mock: true,
      _product: product,
    };

    return { raw, httpStatus: 200, fromMock: true };
  }
}

export function buildEposiClient(cfg: MakScoreConfig): EposiClient {
  return cfg.eposiMode === "live" ? new LiveEposiClient(cfg) : new MockEposiClient();
}
