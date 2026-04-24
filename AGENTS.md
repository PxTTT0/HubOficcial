# AGENTS

This workspace uses GSD as the planning and execution workflow.

## Project Context

- Product: HUB de Vendas Makfil
- Core value: calculos confiaveis de frete e locacao sem dependencia do suporte interno
- Current phase: Phase 1 - Foundation and Governance

## Workflow

Use these commands in order:

1. `$gsd-discuss-phase 1`
2. `$gsd-plan-phase 1`
3. `$gsd-execute-phase 1`

## Guardrails

- Preserve modular architecture boundaries between frontend, backend and data layers
- Treat pricing tables and logistics parameters as sensitive administrative data
- Optimize for mobile field use and simple operational flows
- Keep v1 independent from full Sisloc and RD CRM integrations
