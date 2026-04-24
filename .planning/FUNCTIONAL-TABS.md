# Functional Tabs Spec: HUB de Vendas Makfil v1

**Defined:** 2026-04-24
**Purpose:** Consolidar especificacao funcional objetiva das abas e modulos obrigatorios da v1 antes da Fase 1.

## 1. Proposta Rapida

### Objetivo

Permitir ao vendedor externo montar uma proposta comercial simples, rapida e apresentavel diretamente da obra, consolidando produtos, frete, locacao e PDF final.

### Quem acessa

- Vendedor Externo
- Vendedor Interno autorizado, quando aplicavel ao fluxo comercial
- Perfis administrativos para consulta ou suporte, sem ser foco principal

### Campos Principais

- dados basicos do cliente
- dados basicos da obra
- lista de produtos selecionados
- quantidade, periodo e parametros comerciais essenciais
- origem/CD quando necessario
- frete calculado
- locacao calculada
- valor final consolidado

### Acoes Permitidas

- iniciar proposta
- preencher cliente e obra
- selecionar produtos
- consultar/calcular frete
- consultar/calcular locacao
- revisar consolidado
- gerar PDF

### Validacoes

- campos obrigatorios de cliente e obra
- selecao minima de produto
- consistencia entre itens da proposta e regras de frete
- integridade do valor consolidado antes da geracao do PDF

### Regras de Negocio

- proposta nao pode consolidar valor final sem frete e locacao validos
- fluxo deve priorizar simplicidade e poucos passos em mobile
- dados nao devem ser perdidos em conexao instavel durante o preenchimento

### Dependencias

- Calculadora de Frete 2.0
- Tabela de Precos
- gerador de PDF
- autenticacao e RBAC

### Erros/Estados Possiveis

- proposta em edicao
- proposta parcialmente preenchida
- frete pendente
- locacao pendente
- erro de consolidacao
- PDF indisponivel temporariamente

### Criterios de Aceite

1. Vendedor consegue sair de dados basicos para proposta consolidada em fluxo curto no celular.
2. PDF final e claro e utilizavel comercialmente.
3. Proposta nao perde consistencia se alguma etapa intermediaria falhar.

## 2. Calculadora de Frete 2.0

### Objetivo

Calcular frete com confiabilidade operacional usando regras validadas da Makfil, inclusive como modulo independente para vendedor interno.

### Quem acessa

- Vendedor Externo
- Vendedor Interno
- Perfis administrativos para manutencao e homologacao

### Campos Principais

- CD de origem
- destino ou referencia logistica
- tipo de produto
- tipo de caminhao
- combinacao de modelos de plataformas
- peso da carga para estruturas
- indicador de frete por conta do cliente

### Acoes Permitidas

- informar parametros de calculo
- executar calculo
- revisar memoria resumida do calculo
- reutilizar resultado no fluxo de proposta

### Validacoes

- combinacoes validas entre produto e caminhao
- peso obrigatorio para cenarios de estruturas
- zeragem correta quando frete e por conta do cliente
- presenca de parametros logisticos vigentes

### Regras de Negocio

- calculo deve refletir logica operacional homologada
- plataformas usam tabela de combinacao por modelo e caminhao compativel
- estruturas usam peso e regra logistica correspondente
- resultado precisa ser rastreavel e auditavel quando necessario

### Dependencias

- Configuracoes Logisticas
- autenticacao e RBAC
- base de parametros vigentes

### Erros/Estados Possiveis

- parametros incompletos
- combinacao invalida
- regra nao encontrada
- calculo concluido
- calculo exige revisao

### Criterios de Aceite

1. Cobre cenarios criticos homologados pela operacao.
2. Bate com a referencia atual em pelo menos 95% dos cenarios homologados.
3. Pode ser usado isoladamente pelo vendedor interno sem depender da proposta completa.

## 3. Configuracoes Logisticas

### Objetivo

Permitir a governanca e manutencao segura dos parametros que alimentam o calculo de frete.

### Quem acessa

- Logistica/Admin
- Administrador do Sistema

### Campos Principais

- parametros por CD
- valor de km rodado
- tipos de caminhao
- regras de combinacao de plataformas
- faixas ou regras de peso para estruturas
- vigencia ou status do parametro

### Acoes Permitidas

- cadastrar parametro
- editar parametro
- ativar/desativar parametro
- consultar historico

### Validacoes

- coerencia minima entre tipos e faixas
- unicidade logica para regra vigente
- obrigatoriedade de campos criticos

### Regras de Negocio

- vendedor operacional nao altera parametros
- alteracao relevante deve gerar trilha de auditoria
- parametro inconsistente nao deve ser publicado para uso operacional

### Dependencias

- RBAC
- auditoria
- Calculadora de Frete 2.0

### Erros/Estados Possiveis

- cadastro em edicao
- conflito de vigencia
- parametro invalido
- alteracao bloqueada por permissao
- publicacao concluida

### Criterios de Aceite

1. Apenas perfis autorizados alteram parametros.
2. Toda alteracao sensivel fica auditada.
3. Parametros publicados sao consumidos pelo calculo de frete sem ambiguidade.

## 4. Tabela de Precos

### Objetivo

Disponibilizar consulta operacional e manutencao controlada da tabela de precos usada no calculo de locacao.

### Quem acessa

- Vendedor Externo para consulta
- Vendedor Interno para consulta
- Administrativo/Comercial ou Admin para importacao e atualizacao

### Campos Principais

- produto
- categoria
- valor de locacao
- vigencia
- origem da importacao
- status da tabela

### Acoes Permitidas

- consultar tabela
- importar tabela
- atualizar tabela
- conferir vigencia e consistencia

### Validacoes

- formato valido da importacao
- consistencia minima de produtos e valores
- bloqueio de publicacao em caso de erro critico

### Regras de Negocio

- tabela operacional da v1 deriva do Sisloc por processo controlado
- consulta operacional nao implica permissao de alteracao
- locacao deve usar tabela vigente e aprovada

### Dependencias

- processo de importacao controlada
- RBAC
- modulo de locacao
- auditoria

### Erros/Estados Possiveis

- tabela vigente disponivel
- importacao em processamento
- importacao rejeitada
- tabela inconsistente
- tabela sem vigencia ativa

### Criterios de Aceite

1. Usuario operacional consulta precos sem editar dados.
2. Admin atualiza tabela de forma controlada e auditavel.
3. Calculo de locacao usa sempre a tabela vigente correta.

## 5. Mak Score

### Objetivo

Gerar score automatico de apoio a decisao comercial a partir de CPF/CNPJ, com retorno operacional simples e util para a v1.

### Quem acessa

- Vendedor Externo
- Vendedor Interno autorizado
- Perfis administrativos para governanca, regras e auditoria

### Campos Principais

- CPF/CNPJ
- identificador do lead ou cliente, quando houver
- resultado do score
- status da consulta
- justificativa resumida ou classificacao, quando permitido

### Acoes Permitidas

- consultar score
- visualizar resultado
- registrar resultado no contexto da proposta ou atendimento

### Validacoes

- CPF/CNPJ valido
- permissao de consulta
- disponibilidade e consistencia minima de resposta externa/interna

### Regras de Negocio

- score deve ter utilidade real na decisao comercial da v1
- falha externa nao aprova automaticamente
- resposta segura em falha deve priorizar `exige analise` ou equivalente definido
- consultas e decisoes relevantes devem ser auditadas

### Dependencias

- fontes externas e regras internas conforme viabilidade tecnica
- RBAC
- trilha de auditoria
- politica de dados sensiveis

### Erros/Estados Possiveis

- aguardando consulta
- score retornado
- exige analise
- indisponivel temporariamente
- consulta bloqueada por permissao ou rate limit

### Criterios de Aceite

1. Usuario recebe retorno operacional claro a partir de CPF/CNPJ valido.
2. Falha externa nao gera comportamento inseguro.
3. Consultas relevantes ficam auditadas e protegidas.

---
*Last updated: 2026-04-24 after functional specification reinforcement*
