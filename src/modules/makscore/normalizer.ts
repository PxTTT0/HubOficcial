import type { EposiRawResponse } from "./eposiClient";
import type { EposiProduct } from "./config";
import type { CadastralStatus, NormalizedEposi } from "./types";

// E-POSI real (observado em homologacao/producao) envelopa o payload em
// `resposta` e usa `Response.Records.*`:
//
//   raw.resposta.quod.ReportPJResponseEx.Response.Records.ReportPJOutput[]
//   raw.resposta.quodVerifiqPJ.VerifiQPJResponseEx.Response.Records.QdpjVerifiQPJOutput[]
//   raw.resposta.gps.{PROTESTOS, PEND_FINANCEIRAS, CH_SEM_FUNDOS_BACEN}
//   raw.erros[]                       // erros tecnicos do gateway
//
// O manual padrao do bureau (e os testes legados) usa caminhos sem `resposta`
// e sem `Records`. Mantemos compatibilidade com os dois.

function get(obj: any, path: (string | number)[]): any {
  let cur: any = obj;
  for (const k of path) {
    if (cur == null) return undefined;
    cur = cur[k as any];
  }
  return cur;
}

function firstDefined<T>(...vals: (T | undefined | null)[]): T | null {
  for (const v of vals) {
    if (v !== undefined && v !== null && v !== "") return v as T;
  }
  return null;
}

function asString(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s.length === 0 ? null : s;
}

function asNumber(v: unknown): number | null {
  if (v == null || v === "") return null;
  // Aceita "0,00" estilo BR alem de "0.00"
  const s = String(v).replace(/\./g, "").replace(",", ".");
  const n = Number(s);
  if (Number.isFinite(n)) return n;
  const n2 = Number(v);
  return Number.isFinite(n2) ? n2 : null;
}

function asBoolFromCount(v: unknown): boolean {
  const n = asNumber(v);
  if (n != null) return n > 0;
  if (v === true) return true;
  if (typeof v === "string") {
    const s = v.trim().toLowerCase();
    if (s === "" || s === "0" || s.startsWith("nada")) return false;
    if (s === "true" || s === "sim" || s === "consta") return true;
  }
  return false;
}

function mapCadastral(raw: string | null): CadastralStatus {
  if (!raw) return "desconhecida";
  const r = raw.toLowerCase();
  if (r.includes("ativ")) return "ativa";
  if (r.includes("inapt")) return "inapta";
  if (r.includes("baix")) return "baixada";
  if (r.includes("susp")) return "suspensa";
  if (r.includes("nul")) return "nula";
  return "desconhecida";
}

function joinDate(d: any): string | null {
  if (!d) return null;
  if (typeof d === "string") return d;
  const y = d.Year ?? d.year;
  const m = d.Month ?? d.month;
  const day = d.Day ?? d.day;
  if (!y) return null;
  const pad = (x: any) => String(x ?? "01").padStart(2, "0");
  return `${y}-${pad(m)}-${pad(day)}`;
}

function joinAddress(a: any): string | null {
  if (!a) return null;
  if (typeof a === "string") return a;
  const parts = [
    a.Street ?? a.Logradouro,
    a.Number ?? a.Numero,
    a.Neighborhood ?? a.Bairro,
    a.City ?? a.Cidade,
    a.State ?? a.UF ?? a.Estado,
    a.PostalCode ?? a.CEP,
  ]
    .map((x) => (x == null ? "" : String(x).trim()))
    .filter(Boolean);
  return parts.length ? parts.join(", ") : null;
}

// Aceita "Records.ReportPJOutput" (real) ou "ReportPJOutput" (manual/mock).
function recordsOrFlat(response: any, key: string): any[] | null {
  if (!response) return null;
  const arr = get(response, ["Records", key]) ?? response[key];
  if (Array.isArray(arr)) return arr;
  if (arr) return [arr];
  return null;
}

function pickVerifiQOutput(raw: any): any | null {
  const responses = [
    get(raw, ["resposta", "quodVerifiqPJ", "VerifiQPJResponseEx", "Response"]),
    get(raw, ["resposta", "quodVerifiQPJ", "VerifiQPJResponseEx", "Response"]),
    get(raw, ["VerifiQPJResponseEx", "Response"]),
  ];
  for (const resp of responses) {
    if (!resp) continue;
    // Real: QdpjVerifiQPJOutput. Manual/mock: VerifiQPJOutput.
    const arr =
      recordsOrFlat(resp, "QdpjVerifiQPJOutput") ??
      recordsOrFlat(resp, "VerifiQPJOutput");
    if (arr && arr.length > 0) return arr[0];
  }
  // Fallback bem chato: alguns mocks legados colocam VerifiQPJOutput direto.
  const flat = get(raw, ["VerifiQPJOutput"]);
  if (Array.isArray(flat) && flat.length > 0) return flat[0];
  return null;
}

function pickReportOutput(raw: any): any | null {
  const responses = [
    get(raw, ["resposta", "quod", "ReportPJResponseEx", "Response"]),
    get(raw, ["ReportPJResponseEx", "Response"]),
  ];
  for (const resp of responses) {
    if (!resp) continue;
    const arr = recordsOrFlat(resp, "ReportPJOutput");
    if (arr && arr.length > 0) return arr[0];
  }
  const flat = get(raw, ["ReportPJOutput"]);
  if (Array.isArray(flat) && flat.length > 0) return flat[0];
  return null;
}

function gpsHasOcorrencia(gpsBlock: any): boolean {
  if (!gpsBlock) return false;
  return asBoolFromCount(gpsBlock.QUANTIDADE_OCORRENCIA);
}

export function normalizeEposi(
  resp: EposiRawResponse,
  product: EposiProduct,
): NormalizedEposi {
  const raw: any = resp.raw ?? {};
  const verifiq = pickVerifiQOutput(raw);
  const report = pickReportOutput(raw);

  // ScorePJ pode aparecer em Analytics.ScorePJ (real/manual), em raw.ScorePJ
  // (mock antigo) ou solto.
  const scorePJ =
    get(verifiq, ["Analytics", "ScorePJ"]) ??
    get(raw, ["ScorePJ"]) ??
    {};

  const score = firstDefined<unknown>(scorePJ.Score, get(raw, ["Score"]));

  const errorCode = firstDefined<unknown>(
    scorePJ.ErrorCode,
    get(raw, ["ErrorCode"]),
  );
  const errorMessage = firstDefined<unknown>(
    scorePJ.ErrorMessage,
    get(raw, ["ErrorMessage"]),
  );

  const reasonCodes = [
    scorePJ.ReasonCode1,
    scorePJ.ReasonCode2,
    scorePJ.ReasonCode3,
    scorePJ.ReasonCode4,
  ]
    .map((c) => asString(c))
    .filter((c): c is string => !!c);

  // BestInfo (ReportPJ) tem dados cadastrais. `Empresa` e fallback antigo.
  const bestInfo = report?.BestInfo ?? {};
  const empresa = raw.Empresa ?? raw.empresa ?? {};

  const cadastralRaw = asString(
    firstDefined(bestInfo.CompanyStatus, empresa.SituacaoCadastral),
  );
  const razaoSocial = asString(
    firstDefined(bestInfo.CompanyName, empresa.RazaoSocial),
  );
  const nomeFantasia = asString(
    firstDefined(bestInfo.TradeName, empresa.NomeFantasia),
  );
  const naturezaJuridica = asString(
    firstDefined(bestInfo.LegalType, empresa.NaturezaJuridica),
  );
  // Preferimos o codigo MainActivity; caimos para descricao se faltar.
  const cnaePrincipal = asString(
    firstDefined(
      bestInfo.MainActivity,
      bestInfo.MainActivityDescription,
      empresa.CnaePrincipal,
    ),
  );
  const dataAbertura = asString(
    firstDefined(joinDate(bestInfo.DateFoundation), empresa.DataAbertura),
  );
  const endereco = asString(
    firstDefined(joinAddress(bestInfo.Address), empresa.Endereco),
  );
  const email = asString(
    firstDefined(
      bestInfo.Email?.Email,
      typeof bestInfo.Email === "string" ? bestInfo.Email : null,
      empresa.Email,
    ),
  );
  // Real: BestInfo.PhoneNumber direto. Manual: BestInfo.Phone.PhoneNumber.
  const telefone = asString(
    firstDefined(
      typeof bestInfo.PhoneNumber === "string" ? bestInfo.PhoneNumber : null,
      bestInfo.Phone?.PhoneNumber,
      empresa.Telefone,
    ),
  );

  // Restrictive em VerifiQPJOutput. Inclui varios tipos de apontamento:
  // Negative.Apontamentos, LawSuitLevelsApontamentos,
  // LawSuitBankruptApontamentos, CCFApontamentos. Qualquer um com
  // QUANTIDADE > 0 acende a flag de negativacao.
  const restrictive =
    verifiq?.Restrictive ?? raw.Restrictive ?? raw.Restritivos ?? {};
  const negative = restrictive.Negative ?? {};
  const negativeBuckets: any[][] = [
    [].concat(get(negative, ["Apontamentos", "Apontamento"]) ?? []),
    [].concat(
      get(negative, ["LawSuitLevelsApontamentos", "LawSuitLevelsApontamento"]) ??
        [],
    ),
    [].concat(
      get(negative, ["LawSuitBankruptApontamentos", "LawSuitBankruptApontamento"]) ??
        [],
    ),
    [].concat(get(negative, ["CCFApontamentos", "CCFApontamento"]) ?? []),
  ];
  const hasNegativacaoFromBureau = negativeBuckets.some((bucket) =>
    bucket.some((a: any) =>
      asBoolFromCount(
        a.CountApontamento ??
          a.CountLawsuits ??
          a.CountBounceTotal ??
          a.AmountTotal ??
          a.AmountLawsuitTotal,
      ),
    ),
  );

  // Bureau alternativo `gps` (camada Boa Vista no envelope E-POSI).
  const gps = get(raw, ["resposta", "gps"]) ?? {};
  const hasNegativacaoFromGps =
    gpsHasOcorrencia(gps.PEND_FINANCEIRAS) ||
    gpsHasOcorrencia(gps.CH_SEM_FUNDOS_BACEN);

  const hasNegativacao =
    hasNegativacaoFromBureau ||
    hasNegativacaoFromGps ||
    asBoolFromCount(restrictive.Negativacao);

  const protestArr = []
    .concat(get(restrictive, ["Protests", "Protest"]) ?? [])
    .filter(Boolean);
  const hasProtestoFromBureau = protestArr.some((p: any) =>
    asBoolFromCount(p.QuantidadeProtestos ?? p.ValorTotalProtestos),
  );
  const hasProtestoFromGps = gpsHasOcorrencia(gps.PROTESTOS);
  const hasProtesto =
    hasProtestoFromBureau ||
    hasProtestoFromGps ||
    asBoolFromCount(restrictive.Protestos);

  // Inquiry: real usa "Inquiries" (plural), manual usa "Inquiry".
  const consultasAnteriores = asNumber(
    firstDefined(
      get(restrictive, ["Inquiries", "InquiryCount12Months"]),
      get(restrictive, ["Inquiry", "InquiryCount12Months"]),
      get(restrictive, ["InquiryCount12Months"]),
      raw.ConsultasAnteriores,
    ),
  );

  return {
    product,
    score: asNumber(score),
    reasonCodes,
    errorCode: asString(errorCode),
    errorMessage: asString(errorMessage),
    cadastralStatus: mapCadastral(cadastralRaw),
    razaoSocial,
    nomeFantasia,
    naturezaJuridica,
    cnaePrincipal,
    dataAbertura,
    endereco,
    email,
    telefone,
    hasNegativacao,
    hasProtesto,
    consultasAnteriores,
    sourceIsMock: resp.fromMock,
  };
}
