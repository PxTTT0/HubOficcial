# Roadmap: HUB de Vendas Makfil

**Created:** 2026-04-24
**Phases:** 5
**v1 Requirements Mapped:** 43 / 43

## Summary

| # | Phase | Goal | Requirements |
|---|-------|------|--------------|
| 1 | Foundation and Governance | Estabelecer base segura, perfis, administracao de parametros e especificacao funcional bloqueada | AUTH-01, AUTH-02, AUTH-03, AUTH-04, AUTH-05, CONF-01, CONF-02, CONF-03, SECU-01, SECU-02, SECU-03, SECU-04, SECU-05, SECU-07, SECU-08, SPEC-01, SPEC-02, SPEC-03 |
| 2 | Freight Engine and Field Flow Base | Entregar calculo de frete confiavel e fluxo operacional basico de proposta | PROP-01, PROP-02, PROP-05, FRET-01, FRET-02, FRET-03, FRET-04, FRET-05, FRET-06, FRET-07, FRET-08 |
| 3 | Pricing and Controlled Data Imports | Integrar tabela de precos controlada e calculo de locacao | PRIC-01, PRIC-02, PRIC-03 |
| 4 | Proposal Consolidation and Validation | Consolidar proposta final, PDF comercial e homologacao dos calculos | PROP-03, PROP-04, QUAL-01, QUAL-02, QUAL-03 |
| 5 | Mak Score and Future-Ready Integrations | Entregar Mak Score util e preparar conectores futuros sem acoplamento forte | MKSC-01, MKSC-02, MKSC-03, MKSC-04, MKSC-05, SECU-06 |

## Phase Details

### Phase 1: Foundation and Governance

**Goal:** Criar a fundacao tecnica e de seguranca do produto, incluindo autenticacao, papeis, governanca, administracao segura de dados sensiveis e especificacao funcional fechada para os modulos da v1.

**Requirements:** AUTH-01, AUTH-02, AUTH-03, AUTH-04, AUTH-05, CONF-01, CONF-02, CONF-03, SECU-01, SECU-02, SECU-03, SECU-04, SECU-05, SECU-07, SECU-08, SPEC-01, SPEC-02, SPEC-03

**Success Criteria:**
1. Usuarios autenticam com perfis coerentes com seu papel operacional ou administrativo.
2. Parametros logisticos e tabela de precos ficam protegidos contra alteracoes por perfis operacionais.
3. Alteracoes em dados sensiveis ficam auditaveis.
4. Security addendum da v1 fica definido, versionado e referenciado no planejamento.
5. Functional tabs spec da v1 fica definido para todos os modulos obrigatorios.
6. Base modular suporta evolucao separada de frontend, backend e integracoes.

**UI hint:** yes

### Phase 2: Freight Engine and Field Flow Base

**Goal:** Disponibilizar a Calculadora de Frete 2.0 com confiabilidade operacional e fluxo inicial de proposta rapida para uso em campo.

**Requirements:** PROP-01, PROP-02, PROP-05, FRET-01, FRET-02, FRET-03, FRET-04, FRET-05, FRET-06, FRET-07, FRET-08

**Success Criteria:**
1. Vendedor externo inicia proposta e seleciona produtos em fluxo simples no celular.
2. Calculo de frete cobre CD, tipo de caminhao, plataformas, estruturas e frete por conta do cliente.
3. Resultado do frete e rastreavel para conferencia comercial.
4. Vendedor interno consegue usar o modulo de frete de forma independente.

**UI hint:** yes

### Phase 3: Pricing and Controlled Data Imports

**Goal:** Garantir calculo de locacao a partir de tabela controlada e governada, sem dependencia de integracao em tempo real.

**Requirements:** PRIC-01, PRIC-02, PRIC-03

**Success Criteria:**
1. Administracao consegue importar ou atualizar tabela derivada do Sisloc de forma controlada.
2. Sistema usa tabela vigente para calcular locacao sem intervencao manual do vendedor operacional.
3. Consulta de precos fica disponivel ao usuario operacional sem abrir permissao de edicao.

**UI hint:** yes

### Phase 4: Proposal Consolidation and Validation

**Goal:** Consolidar frete, locacao e valor final em proposta utilizavel, com PDF comercial e evidencias de confiabilidade da v1.

**Requirements:** PROP-03, PROP-04, QUAL-01, QUAL-02, QUAL-03

**Success Criteria:**
1. Sistema consolida valor final da proposta com frete e locacao corretos.
2. PDF gerado e claro, simples e apresentavel ao cliente.
3. Homologacao cobre cenarios criticos definidos pela operacao.
4. Aderencia minima de 95% e demonstrada nos cenarios homologados.

**UI hint:** yes

### Phase 5: Mak Score and Future-Ready Integrations

**Goal:** Disponibilizar Mak Score como apoio real a decisao comercial e preparar a arquitetura para conectores futuros.

**Requirements:** MKSC-01, MKSC-02, MKSC-03, MKSC-04, MKSC-05, SECU-06

**Success Criteria:**
1. Usuario informa CPF/CNPJ e recebe retorno preliminar util para decisao comercial.
2. Resultado do score e apresentado em formato operacional simples.
3. Regras internas e conectores externos do score ficam desacoplados do fluxo central de proposta.
4. Falhas de API externa nao quebram o fluxo principal nem expoem comportamento inseguro.
5. Arquitetura deixa pontos claros de integracao futura com Sisloc e RD CRM.

**UI hint:** yes

---
*Last updated: 2026-04-24 after initial roadmap creation*
