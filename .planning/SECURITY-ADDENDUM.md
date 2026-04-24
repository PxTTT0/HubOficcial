# Security Addendum: HUB de Vendas Makfil v1

**Defined:** 2026-04-24
**Purpose:** Formalizar os controles minimos de seguranca da v1 antes do planejamento tecnico detalhado.

## Security Goals

- Proteger dados sensiveis de clientes, leads e regras comerciais.
- Reduzir risco operacional em modulos que impactam proposta, preco, frete e score.
- Garantir que falhas externas nao comprometam integridade, confidencialidade ou continuidade operacional.
- Aplicar seguranca como requisito transversal em toda a v1.

## 1. Autenticacao e Sessao

### Objetivo

Garantir que apenas usuarios autorizados acessem o produto e que a sessao mobile web opere com seguranca adequada ao uso em campo.

### Requisitos

- Autenticacao obrigatoria para qualquer modulo da v1.
- Sessao deve expirar ou ser renovada de forma controlada.
- Logout deve invalidar sessao do cliente de forma confiavel.
- Sessao nao deve depender de dados sensiveis expostos em URL ou armazenamento inseguro.
- Deve existir tratamento seguro para troca de senha, redefinicao e bloqueio de conta, se aplicavel na v1.

### Criterios Minimos

- Tokens, cookies ou mecanismos equivalentes devem ser protegidos conforme o modelo escolhido.
- Sessao deve suportar uso mobile sem sacrificar seguranca basica.
- Inatividade prolongada em modulo sensivel deve exigir revalidacao conforme risco.

## 2. Autorizacao por Perfil (RBAC)

### Perfis Minimos

- **Vendedor Externo**: opera proposta rapida, consulta frete, locacao, tabela e Mak Score.
- **Vendedor Interno**: usa calculadora de frete e consultas operacionais permitidas.
- **Administrativo/Comercial**: importa ou atualiza tabela de precos quando autorizado.
- **Logistica/Admin**: administra parametros logisticos quando autorizado.
- **Administrador do Sistema**: governanca ampliada, sem virar perfil operacional padrao.

### Regras

- RBAC obrigatorio por perfil e por acao.
- Permissoes nao devem ser inferidas apenas pelo frontend.
- Cada acao sensivel deve ser validada no backend.
- Menor privilegio por padrao: usuario novo recebe somente o necessario.

## 3. Permissoes por Modulo

| Modulo | Consultar | Criar/Executar | Editar Estrutural | Aprovar/Admin |
|--------|-----------|----------------|-------------------|---------------|
| Proposta Rapida | Vendedor Externo, Vendedor Interno autorizado | Vendedor Externo | Nao aplicavel estruturalmente | Admin quando houver governanca futura |
| Calculadora de Frete 2.0 | Vendedor Externo, Vendedor Interno, Admin | Vendedor Externo, Vendedor Interno | Somente Logistica/Admin | Admin |
| Configuracoes Logisticas | Admin autorizado | Admin autorizado | Admin autorizado | Admin autorizado |
| Tabela de Precos | Usuarios operacionais para consulta, Admin para manutencao | Consulta por operacional; importacao por Admin | Somente Admin autorizado | Admin autorizado |
| Mak Score | Usuarios operacionais autorizados | Consulta operacional autorizada | Regras internas por Admin autorizado | Admin autorizado |

## 4. Trilha de Auditoria

### Eventos Obrigatorios

- Alteracao de parametros logisticos
- Importacao, atualizacao ou exclusao logica de tabela de precos
- Consultas e decisoes relevantes do Mak Score
- Mudancas de permissao ou papel de usuario
- Falhas repetidas de autenticacao e tentativas de abuso

### Campos Minimos de Auditoria

- usuario
- perfil
- data/hora
- modulo
- acao
- entidade afetada
- valor anterior e novo valor, quando aplicavel
- origem resumida da requisicao
- resultado da operacao

### Regras

- Auditoria deve ser imutavel para uso operacional comum.
- Logs de auditoria devem evitar payloads completos com dados sensiveis desnecessarios.
- Consulta de auditoria deve ser restrita a perfis autorizados.

## 5. Protecao de Dados Sensiveis

### Dados Alvo

- CPF/CNPJ
- telefone
- e-mail
- dados pessoais de leads e clientes
- dados de score comercial

### Regras

- Dados sensiveis devem trafegar apenas por canais seguros.
- Exibicao deve respeitar necessidade de acesso e mascaramento parcial quando possivel.
- Persistencia deve minimizar exposicao desnecessaria.
- Coleta deve ser limitada ao minimo necessario para operar cada modulo.

## 6. Mascaramento e Sanitizacao de Logs

- CPF/CNPJ, telefone, e-mail, credenciais, tokens e segredos nao devem aparecer em logs em texto puro.
- Logs tecnicos e de erro devem ser sanitizados antes de persistencia.
- Erros exibidos ao usuario nao devem revelar detalhes internos de infraestrutura ou credenciais.
- Mascaramento deve valer para logs de aplicacao, auditoria e integracao.

## 7. Segredos e Credenciais

- Nenhum segredo deve ficar hardcoded em codigo, script ou arquivo versionado.
- Credenciais de APIs, banco e integracoes devem ser segregadas por ambiente.
- Rotacao e revogacao devem ser possiveis sem refatoracao estrutural.
- Acesso a segredos deve seguir menor privilegio.

## 8. Rate Limit e Protecao Contra Abuso

### Alvos Minimos

- autenticacao
- consultas de Mak Score
- endpoints de importacao de tabela
- endpoints administrativos de parametros logisticos
- geracao repetitiva de proposta ou PDF quando houver risco operacional

### Regras

- Aplicar rate limit por usuario, sessao, IP ou combinacao equivalente conforme contexto.
- Detectar padroes anormais de uso em modulos sensiveis.
- Em caso de abuso, degradar ou bloquear com resposta segura e auditavel.

## 9. Validacao Client-Side e Server-Side

- Validacao client-side existe para melhorar UX e reduzir erro operacional.
- Validacao server-side e obrigatoria para toda entrada relevante.
- Campos criticos como CPF/CNPJ, dados de obra, parametros de frete e importacoes devem ser validados novamente no backend.
- Nenhuma regra de negocio critica pode depender apenas de validacao no cliente.

## 10. Falha Segura em APIs Externas

### Escopo

Principalmente Mak Score e futuras integracoes derivadas.

### Regras

- Falha externa nao pode aprovar automaticamente um lead.
- Falha externa nao pode corromper proposta, tabela ou parametro interno.
- Sistema deve retornar estado seguro, por exemplo `exige analise` ou `indisponivel temporariamente`, conforme regra definida.
- Timeout, indisponibilidade, resposta invalida e dados inconsistentes devem ter tratamento explicito.

## 11. Defesa em Profundidade

- Controles de seguranca devem existir em mais de uma camada.
- Frontend restringe UX e visibilidade, mas backend continua soberano na autorizacao.
- Banco e armazenamento devem restringir acesso direto indevido.
- Integracoes externas devem ficar encapsuladas e nao expor segredos ao cliente.
- Logs, auditoria, RBAC, validacao e observabilidade devem trabalhar em conjunto.

## 12. Principio do Menor Privilegio

- Cada perfil acessa apenas o necessario para cumprir sua funcao.
- Acoes administrativas devem ser explicitamente concedidas.
- Permissoes sensiveis nao devem ser herdadas por conveniencia operacional.
- Integracoes e contas tecnicas tambem devem seguir privilegio minimo.

## 13. Criterios de Aceite de Seguranca da v1

1. Todos os modulos da v1 possuem matriz minima de acesso por perfil.
2. Parametros logisticos e tabela de precos nao podem ser alterados por vendedores operacionais.
3. Mak Score possui auditoria de consultas relevantes e tratamento seguro de falha externa.
4. Dados sensiveis nao aparecem em logs em formato aberto.
5. Validacoes server-side cobrem todos os fluxos criticos.
6. Segredos ficam fora do codigo versionado.
7. Modulos sensiveis possuem controle basico de abuso e rate limit.
8. A arquitetura da v1 demonstra defesa em profundidade e menor privilegio como principios concretos.

---
*Last updated: 2026-04-24 after security planning reinforcement*
