import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeEposi } from "../src/modules/makscore/normalizer";

test("normaliza payload aninhado VerifiQPJResponseEx + ReportPJResponseEx", () => {
  const raw = {
    VerifiQPJResponseEx: {
      Response: {
        Header: { Status: 0 },
        VerifiQPJOutput: [
          {
            CNPJ: "12312312300180",
            Analytics: {
              ScorePJ: {
                Score: "656",
                ReasonCode1: "R4",
                ReasonCode2: "R20",
                ReasonCode3: "R25",
              },
            },
            Restrictive: {
              Negative: {
                Apontamentos: {
                  Apontamento: [
                    { CountApontamento: "0", AmountTotal: "0", Situation: "Nada Consta" },
                  ],
                },
              },
              Protests: { Protest: [{ QuantidadeProtestos: "0", ValorTotalProtestos: "0" }] },
              Inquiry: { InquiryCount12Months: 33 },
            },
          },
        ],
      },
    },
    ReportPJResponseEx: {
      Response: {
        ReportPJOutput: [
          {
            CNPJ: "12312312300180",
            BestInfo: {
              CompanyStatus: "ATIVO",
              CompanyName: "BORGES COMERCIO LTDA",
              TradeName: "O SUCATAO",
              MainActivity: "4511102",
              DateFoundation: { Year: "1980", Month: "4", Day: "10" },
              Address: { Street: "R RONAT", Number: "3120", City: "IBIPORA", State: "PR" },
              Email: { Email: "x@y.com" },
              Phone: { PhoneNumber: "11999999999" },
            },
          },
        ],
      },
    },
  };
  const n = normalizeEposi({ raw, httpStatus: 200, fromMock: false }, "TOTAL_PJ");
  assert.equal(n.score, 656);
  assert.deepEqual(n.reasonCodes, ["R4", "R20", "R25"]);
  assert.equal(n.cadastralStatus, "ativa");
  assert.equal(n.razaoSocial, "BORGES COMERCIO LTDA");
  assert.equal(n.dataAbertura, "1980-04-10");
  assert.equal(n.email, "x@y.com");
  assert.equal(n.telefone, "11999999999");
  assert.equal(n.hasNegativacao, false);
  assert.equal(n.hasProtesto, false);
  assert.equal(n.consultasAnteriores, 33);
});

test("HTTP 200 com ErrorCode dentro de ScorePJ aninhado", () => {
  const raw = {
    VerifiQPJResponseEx: {
      Response: {
        VerifiQPJOutput: [
          {
            Analytics: {
              ScorePJ: { Score: "0", ErrorCode: "1001", ErrorMessage: "CNPJ invalido" },
            },
          },
        ],
      },
    },
  };
  const n = normalizeEposi({ raw, httpStatus: 200, fromMock: false }, "TOTAL_PJ");
  assert.equal(n.errorCode, "1001");
  assert.equal(n.errorMessage, "CNPJ invalido");
  assert.equal(n.score, 0);
});

test("payload achatado legado continua funcionando (compat com mock antigo)", () => {
  const n = normalizeEposi(
    {
      raw: {
        ScorePJ: { Score: 720, ReasonCode1: "R2" },
        Empresa: { RazaoSocial: "X", SituacaoCadastral: "ATIVA" },
        Restritivos: { Negativacao: false, Protestos: false },
      },
      httpStatus: 200,
      fromMock: true,
    },
    "TOTAL_PJ",
  );
  assert.equal(n.score, 720);
  assert.equal(n.cadastralStatus, "ativa");
  assert.equal(n.sourceIsMock, true);
});

test("payload real E-POSI: envelope `resposta` + Records + QdpjVerifiQPJOutput", () => {
  // Shape exato observado em producao (campos sanitizados).
  const raw = {
    protocolo: "001000000",
    usuario: "Tester",
    documento: "00000000000000",
    erros: [],
    opcoesPai: ["E-POSI TOTAL PJ"],
    opcoes: null,
    resposta: {
      creditoScore: {},
      gps: {
        PEND_FINANCEIRAS: { QUANTIDADE_OCORRENCIA: "0", VALOR_TOTAL: "" },
        PROTESTOS: { QUANTIDADE_OCORRENCIA: "0", VALOR_TOTAL: "0,00" },
        CH_SEM_FUNDOS_BACEN: { QUANTIDADE_OCORRENCIA: "0" },
      },
      quod: {
        ReportPJResponseEx: {
          Response: {
            Header: { Status: 0 },
            Records: {
              ReportPJOutput: [
                {
                  CNPJ: "00000000000000",
                  CPStatus: "1",
                  BestInfo: {
                    CompanyStatus: "ATIVO",
                    CompanyName: "EMPRESA TESTE LTDA",
                    LegalType: "2062",
                    MainActivity: "7732201",
                    MainActivityDescription: "ALUGUEL DE MAQUINAS",
                    DateFoundation: { Year: "1994", Month: "3", Day: "11" },
                    Address: {
                      Street: "RUA TESTE",
                      Number: "200",
                      City: "SAO JOSE DO RIO PRETO",
                      State: "SP",
                      PostalCode: "15000-000",
                    },
                    Email: { Email: "x@y.com" },
                    PhoneNumber: "1733330000",
                  },
                },
              ],
            },
          },
        },
      },
      quodVerifiqPJ: {
        VerifiQPJResponseEx: {
          Response: {
            Header: { Status: 0 },
            Records: {
              QdpjVerifiQPJOutput: [
                {
                  CNPJ: "00000000000000",
                  Analytics: {
                    ScorePJ: {
                      Score: "514",
                      ReasonCode1: "R16",
                      ReasonCode2: "R12",
                      ReasonCode3: "R4",
                      ReasonCode4: "R19",
                    },
                  },
                  Restrictive: {
                    Negative: {
                      Apontamentos: {
                        Apontamento: [
                          { CountApontamento: "0", AmountTotal: "0", Situation: "Nada Consta" },
                        ],
                      },
                      LawSuitLevelsApontamentos: {
                        LawSuitLevelsApontamento: [{ CountLawsuits: "0", AmountLawsuitTotal: "0" }],
                      },
                      LawSuitBankruptApontamentos: {
                        LawSuitBankruptApontamento: [{ CountLawsuits: "0", AmountLawsuitTotal: "0" }],
                      },
                      CCFApontamentos: { CCFApontamento: [{ CountBounceTotal: "0" }] },
                    },
                    Inquiries: { InquiryCount12Months: 29 },
                  },
                },
              ],
            },
          },
        },
      },
    },
  };
  const n = normalizeEposi({ raw, httpStatus: 200, fromMock: false }, "TOTAL_PJ");
  assert.equal(n.score, 514);
  assert.deepEqual(n.reasonCodes, ["R16", "R12", "R4", "R19"]);
  assert.equal(n.errorCode, null);
  assert.equal(n.cadastralStatus, "ativa");
  assert.equal(n.razaoSocial, "EMPRESA TESTE LTDA");
  assert.equal(n.cnaePrincipal, "7732201");
  assert.equal(n.dataAbertura, "1994-03-11");
  assert.equal(n.email, "x@y.com");
  assert.equal(n.telefone, "1733330000");
  assert.equal(n.hasNegativacao, false);
  assert.equal(n.hasProtesto, false);
  assert.equal(n.consultasAnteriores, 29);
});

test("payload real com gps.PROTESTOS > 0 acende flag mesmo se Quod nao tiver", () => {
  const raw = {
    resposta: {
      gps: {
        PROTESTOS: { QUANTIDADE_OCORRENCIA: "3", VALOR_TOTAL: "1500,00" },
        PEND_FINANCEIRAS: { QUANTIDADE_OCORRENCIA: "0" },
      },
      quodVerifiqPJ: {
        VerifiQPJResponseEx: {
          Response: {
            Records: {
              QdpjVerifiQPJOutput: [
                { Analytics: { ScorePJ: { Score: "650" } } },
              ],
            },
          },
        },
      },
    },
  };
  const n = normalizeEposi({ raw, httpStatus: 200, fromMock: false }, "TOTAL_PJ");
  assert.equal(n.hasProtesto, true);
  assert.equal(n.score, 650);
});

test("apontamento e protesto presentes acendem flags", () => {
  const raw = {
    VerifiQPJResponseEx: {
      Response: {
        VerifiQPJOutput: [
          {
            Analytics: { ScorePJ: { Score: "500" } },
            Restrictive: {
              Negative: {
                Apontamentos: {
                  Apontamento: [{ CountApontamento: "3", AmountTotal: "1500" }],
                },
              },
              Protests: { Protest: [{ QuantidadeProtestos: "1", ValorTotalProtestos: "200" }] },
            },
          },
        ],
      },
    },
  };
  const n = normalizeEposi({ raw, httpStatus: 200, fromMock: false }, "TOTAL_PJ");
  assert.equal(n.hasNegativacao, true);
  assert.equal(n.hasProtesto, true);
});
