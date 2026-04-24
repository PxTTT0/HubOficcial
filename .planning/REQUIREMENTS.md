# Requirements: HUB de Vendas Makfil

**Defined:** 2026-04-24
**Core Value:** O sistema deve produzir calculos confiaveis de frete e locacao, reduzindo a dependencia do suporte interno sem aumentar o risco comercial da proposta.

## v1 Requirements

### Access and Roles

- [ ] **AUTH-01**: Usuario pode autenticar com perfil operacional ou administrativo
- [ ] **AUTH-02**: Sistema aplica permissoes por perfil para separar uso operacional de administracao
- [ ] **AUTH-03**: Sistema registra trilha minima de auditoria para alteracoes em parametros logisticos e tabela de precos
- [ ] **AUTH-04**: Sistema encerra ou renova sessao de forma segura, com controles adequados para ambiente mobile web
- [ ] **AUTH-05**: Sistema aplica principio do menor privilegio por perfil e por modulo

### Proposta Rapida

- [ ] **PROP-01**: Vendedor externo pode criar proposta rapida com dados basicos do cliente e da obra
- [ ] **PROP-02**: Vendedor externo pode selecionar produtos para compor a proposta
- [ ] **PROP-03**: Sistema consolida frete, locacao e total final em uma unica proposta
- [ ] **PROP-04**: Sistema gera PDF simples, claro e comercialmente apresentavel para o cliente
- [ ] **PROP-05**: Sistema preserva o progresso da proposta durante instabilidade de conexao sem perder dados ja informados

### Frete 2.0

- [ ] **FRET-01**: Sistema calcula frete com base em parametros logisticos controlados internamente
- [ ] **FRET-02**: Sistema considera CD de origem no calculo de frete
- [ ] **FRET-03**: Sistema considera tipo de caminhao no calculo de frete
- [ ] **FRET-04**: Sistema calcula corretamente combinacao de modelos de plataformas e caminhao compativel
- [ ] **FRET-05**: Sistema calcula corretamente frete de estruturas com base em peso da carga e regras logisticos
- [ ] **FRET-06**: Sistema permite frete por conta do cliente com zeragem correta do valor
- [ ] **FRET-07**: Sistema exibe memoria basica do calculo ou rastreabilidade do resultado para validacao operacional
- [ ] **FRET-08**: Vendedor interno pode usar a Calculadora de Frete 2.0 como modulo independente

### Locacao e Precos

- [ ] **PRIC-01**: Sistema importa ou atualiza tabela de precos derivada do Sisloc por processo controlado
- [ ] **PRIC-02**: Sistema utiliza tabela de precos vigente para calcular valor de locacao
- [ ] **PRIC-03**: Usuario operacional pode consultar tabela de precos sem alterar dados estruturais

### Parametros Logisticos

- [ ] **CONF-01**: Perfil administrativo autorizado pode cadastrar e editar parametros logisticos
- [ ] **CONF-02**: Perfil administrativo autorizado pode definir ou manter regras por CD, km rodado e tipos logisticos necessarios ao calculo
- [ ] **CONF-03**: Sistema valida consistencia minima dos parametros antes de disponibilizar calculos para uso operacional

### Mak Score

- [ ] **MKSC-01**: Usuario informa CPF ou CNPJ para consultar Mak Score no fluxo comercial
- [ ] **MKSC-02**: Sistema calcula ou consolida resultado preliminar de score para apoiar decisao comercial
- [ ] **MKSC-03**: Sistema apresenta resultado em formato operacional claro, como aprovado, reprovado ou exige analise
- [ ] **MKSC-04**: Arquitetura do Mak Score suporta evolucao de regras internas e conectores externos sem acoplamento ao fluxo de proposta
- [ ] **MKSC-05**: Sistema registra auditoria minima para consultas sensiveis e decisoes relevantes do Mak Score

### Security and Resilience

- [ ] **SECU-01**: Sistema protege CPF, CNPJ, telefone e e-mail em repouso, em transito e na exibicao operacional conforme necessidade de acesso
- [ ] **SECU-02**: Sistema mascara ou sanitiza logs para evitar exposicao de dados sensiveis e credenciais
- [ ] **SECU-03**: Sistema trata segredos e credenciais fora do codigo e com rotacao controlada por ambiente
- [ ] **SECU-04**: Sistema aplica rate limit e protecao contra abuso nos modulos sensiveis e nas APIs expostas
- [ ] **SECU-05**: Sistema valida entradas no client-side para UX e no server-side como garantia de integridade
- [ ] **SECU-06**: Sistema falha de forma segura quando APIs externas do Mak Score ou outras dependencias nao responderem
- [ ] **SECU-07**: Sistema aplica defesa em profundidade entre frontend, backend, banco e integracoes
- [ ] **SECU-08**: Sistema aplica permissoes por modulo de forma explicita e auditavel

### Functional Specification

- [ ] **SPEC-01**: Cada modulo obrigatorio da v1 possui objetivo, publico, campos, acoes, validacoes e regras de negocio documentados
- [ ] **SPEC-02**: Cada modulo obrigatorio da v1 possui dependencias, erros provaveis e estados operacionais documentados
- [ ] **SPEC-03**: Cada modulo obrigatorio da v1 possui criterios de aceite claros antes do planejamento detalhado

### Qualidade e Confiabilidade

- [ ] **QUAL-01**: Calculos de frete e locacao atingem aderencia minima de 95% nos cenarios homologados
- [ ] **QUAL-02**: Todos os cenarios criticos definidos pela area sao cobertos por homologacao da v1
- [ ] **QUAL-03**: Sistema produz valor final consolidado da proposta de forma consistente com a regra operacional validada

## v2 Requirements

### Integracoes

- **INTG-01**: Sistema integra em tempo real com Sisloc para sincronizacao de tabelas e dados comerciais
- **INTG-02**: Sistema integra em tempo real com RD CRM para sincronizacao de leads, obras e propostas

### Workflow e Governanca Avancada

- **FLOW-01**: Sistema suporta workflow formal de aprovacao comercial
- **FLOW-02**: Sistema suporta automacoes avancadas de notificacao e acompanhamento

### Experiencia Avancada

- **MOBL-01**: Sistema suporta modo offline mais robusto para uso prolongado em campo

## Out of Scope

| Feature | Reason |
|---------|--------|
| Integracao completa em tempo real com RD CRM | Fora da v1 para manter validacao inicial independente |
| Integracao completa em tempo real com Sisloc | Fora da v1; somente preparacao arquitetural e importacao controlada |
| Workflow avancado de aprovacao | Nao e essencial para validar o fluxo principal |
| Automacoes comerciais avancadas | Escopo adicional sem impacto no core value imediato |
| Offline completo | V1 sera online com tolerancia a conexao ruim |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| AUTH-01 | Phase 1 | Pending |
| AUTH-02 | Phase 1 | Pending |
| AUTH-03 | Phase 1 | Pending |
| AUTH-04 | Phase 1 | Pending |
| AUTH-05 | Phase 1 | Pending |
| PROP-01 | Phase 2 | Pending |
| PROP-02 | Phase 2 | Pending |
| PROP-03 | Phase 4 | Pending |
| PROP-04 | Phase 4 | Pending |
| PROP-05 | Phase 2 | Pending |
| FRET-01 | Phase 2 | Pending |
| FRET-02 | Phase 2 | Pending |
| FRET-03 | Phase 2 | Pending |
| FRET-04 | Phase 2 | Pending |
| FRET-05 | Phase 2 | Pending |
| FRET-06 | Phase 2 | Pending |
| FRET-07 | Phase 2 | Pending |
| FRET-08 | Phase 2 | Pending |
| PRIC-01 | Phase 3 | Pending |
| PRIC-02 | Phase 3 | Pending |
| PRIC-03 | Phase 3 | Pending |
| CONF-01 | Phase 1 | Pending |
| CONF-02 | Phase 1 | Pending |
| CONF-03 | Phase 1 | Pending |
| MKSC-01 | Phase 5 | Pending |
| MKSC-02 | Phase 5 | Pending |
| MKSC-03 | Phase 5 | Pending |
| MKSC-04 | Phase 5 | Pending |
| MKSC-05 | Phase 5 | Pending |
| SECU-01 | Phase 1 | Pending |
| SECU-02 | Phase 1 | Pending |
| SECU-03 | Phase 1 | Pending |
| SECU-04 | Phase 1 | Pending |
| SECU-05 | Phase 1 | Pending |
| SECU-06 | Phase 5 | Pending |
| SECU-07 | Phase 1 | Pending |
| SECU-08 | Phase 1 | Pending |
| SPEC-01 | Phase 1 | Pending |
| SPEC-02 | Phase 1 | Pending |
| SPEC-03 | Phase 1 | Pending |
| QUAL-01 | Phase 4 | Pending |
| QUAL-02 | Phase 4 | Pending |
| QUAL-03 | Phase 4 | Pending |

**Coverage:**
- v1 requirements: 43 total
- Mapped to phases: 43
- Unmapped: 0

---
*Requirements defined: 2026-04-24*
*Last updated: 2026-04-24 after initial definition*
