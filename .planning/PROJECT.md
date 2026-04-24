# HUB de Vendas Makfil

## What This Is

O HUB de Vendas Makfil e uma aplicacao web mobile-first para apoiar o processo comercial em campo, com foco principal no vendedor externo. O produto permite montar propostas rapidas diretamente da obra, com calculo confiavel de frete e locacao, sem depender do suporte interno para consolidar a oferta comercial.

Tambem atende necessidades operacionais do vendedor interno no modulo independente de calculo de frete. A arquitetura da v1 deve nascer preparada para futuras integracoes com Sisloc e RD CRM, sem depender delas para operar.

## Core Value

O sistema deve produzir calculos confiaveis de frete e locacao, reduzindo a dependencia do suporte interno sem aumentar o risco comercial da proposta.

## Requirements

### Validated

(None yet — ship to validate)

### Active

- [ ] Vendedor externo consegue montar proposta rapida completa em campo
- [ ] Calculo de frete segue logica operacional validada e rastreavel
- [ ] Calculo de locacao usa tabela de precos derivada do Sisloc
- [ ] PDF simples e comercialmente apresentavel pode ser gerado na proposta
- [ ] Mak Score apoia decisao comercial com resultado preliminar automatico
- [ ] Parametros sensiveis ficam protegidos por perfis administrativos
- [ ] Seguranca da v1 e especificada de forma objetiva e aplicada como requisito transversal
- [ ] Cada modulo obrigatorio da v1 possui especificacao funcional clara antes do planejamento de execucao

### Out of Scope

- Integracao completa em tempo real com RD CRM — fora da v1 para manter escopo pragmatico
- Integracao completa em tempo real com Sisloc — fora da v1; arquitetura deve ficar preparada
- Workflow avancado de aprovacao e automacao — nao e necessario para validar a proposta inicial
- Offline completo — v1 sera online, com tolerancia razoavel a conexao ruim

## Context

- O processo atual e lento porque o vendedor externo encontra dificuldade para usar o CRM mobile para montar uma proposta completa.
- A proposta comercial depende da combinacao de calculo de frete, valor de locacao e apresentacao rapida ao cliente.
- O frete hoje usa parametros logisticos da calculadora anterior, incluindo valores por km rodado, regras por CD, tipo de caminhao, combinacao de plataformas e regras por peso para estruturas.
- A locacao deve considerar tabela de precos vinculada ao Sisloc, inicialmente por importacao ou consumo controlado de dados.
- A Calculadora de Frete 2.0 precisa funcionar tambem como modulo independente para vendedor interno.
- O Mak Score entra na v1 como score automatico de apoio a decisao comercial a partir de CPF/CNPJ, combinando fontes externas e regras internas conforme viabilidade tecnica.
- Confiabilidade na v1 significa aderencia minima de 95% aos cenarios homologados, com cobertura obrigatoria de cenarios criticos e rastreabilidade dos resultados.
- Gestores nao sao foco operacional da v1, mas podem existir como perfis administrativos ou de acompanhamento para governanca.
- A base de planejamento da v1 inclui dois complementos obrigatorios antes da Fase 1: um addendum de seguranca e uma especificacao funcional por abas.

## Constraints

- **Architecture**: Separacao clara entre frontend, backend e banco de dados — produto deve nascer organizado para evolucao modular e integracoes futuras.
- **Security**: Seguranca em profundidade — parametros logisticos, tabela de precos e dados sensiveis devem ser protegidos por RBAC, trilha de auditoria e isolamento de responsabilidades.
- **Security Scope**: Autenticacao, sessao, RBAC, permissoes por modulo, logs, segredos, rate limiting, validacoes e falhas externas devem ser tratados explicitamente na v1 — nao podem ficar como decisoes implicitas para fases futuras.
- **Scope**: V1 enxuta e pragmatica — priorizar fluxo principal de proposta rapida e confiabilidade de calculo, evitando excesso de escopo.
- **Connectivity**: Uso online em navegador mobile — experiencia deve considerar campo e conexao instavel, mas sem offline completo.
- **Data Source**: Frete e controlado no proprio sistema; locacao depende de tabela derivada do Sisloc — v1 precisa importar dados minimos necessarios para operar corretamente.
- **Governance**: Apenas perfis administrativos autorizados alteram parametros logisticos e tabela de precos — vendedores operacionais apenas consultam e executam fluxo comercial.

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Priorizar confiabilidade do calculo sobre velocidade e acabamento inicial | Valor real so existe se a proposta estiver correta e segura comercialmente | — Pending |
| Adotar operacao sem integracoes corporativas completas na v1 | Permite validar produto mais cedo sem bloquear arquitetura futura | — Pending |
| Separar calculo de frete como modulo reutilizavel | Vendedor interno tambem precisa usar esse calculo no dia a dia | — Pending |
| Incluir Mak Score na v1 | Score automatico gera utilidade comercial concreta ja na primeira entrega | — Pending |
| Restringir alteracao de parametros e tabela a perfis administrativos | Evita risco operacional e protege consistencia dos calculos | — Pending |
| Formalizar um security addendum da v1 antes da Fase 1 | Seguranca e requisito de produto, nao detalhe de implementacao tardio | — Pending |
| Formalizar uma especificacao funcional por modulo antes da Fase 1 | Evita ambiguidade no planejamento e reduz retrabalho nas fases seguintes | — Pending |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition**:
1. Requirements invalidated? -> Move to Out of Scope with reason
2. Requirements validated? -> Move to Validated with phase reference
3. New requirements emerged? -> Add to Active
4. Decisions to log? -> Add to Key Decisions
5. "What This Is" still accurate? -> Update if drifted

**After each milestone**:
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-04-24 after initialization*
