export const MAK_SCORE_QUESTIONNAIRE_VERSION = "makscore-v1" as const;

export type QuestionnaireSection = "A" | "B" | "C" | "D" | "E";

export interface QuestionnaireItem {
  key: string;
  label: string;
  pts: number;
}

export interface QuestionnairePillar {
  title: string;
  max: number;
  items: QuestionnaireItem[];
}

export interface MakScoreQuestionnaireAnswers {
  version: typeof MAK_SCORE_QUESTIONNAIRE_VERSION;
  bloqueios: Record<string, boolean>;
  pilares: Record<string, boolean>;
  agravantes: Record<string, boolean>;
  mitigadores: Record<string, boolean>;
}

export interface MakScoreQuestionnaireScore {
  version: typeof MAK_SCORE_QUESTIONNAIRE_VERSION;
  pillarTotals: Record<QuestionnaireSection, number>;
  basePilares: number;
  agravantesTotal: number;
  mitigadoresTotal: number;
  total: number;
  hasBloqueio: boolean;
  classification: "bloqueio" | "A" | "B" | "C" | "D" | "E";
  label: string;
  decision: string;
}

export const QUESTIONNAIRE_PILLARS: Record<QuestionnaireSection, QuestionnairePillar> = {
  A: {
    title: "Regularidade cadastral e documental",
    max: 50,
    items: [
      { key: "a_abertura_12m", label: "Data de abertura superior a 12 meses", pts: 5 },
      { key: "a_servico_cnae", label: "Servico compativel com CNAE", pts: 4 },
      { key: "a_endereco_receita", label: "Endereco da Receita confere com comprovante e informado", pts: 4 },
      { key: "a_nome_confere", label: "Nome empresarial/fantasia confere com documentos", pts: 3 },
      { key: "a_porte", label: "Porte coerente com volume da locacao", pts: 3 },
      { key: "a_ie_ativa", label: "IE ativa e regular no Cadesp/Sintegra", pts: 5 },
      { key: "a_ie_endereco", label: "Endereco da IE confere com Receita", pts: 4 },
      { key: "a_ie_cnae", label: "CNAE da IE compativel", pts: 4 },
      { key: "a_situacao_regular", label: "Situacao cadastral sem irregularidade", pts: 5 },
      { key: "a_contrato_jucesp", label: "Contrato social/ATA atualizado na Jucesp", pts: 5 },
      { key: "a_jucesp_endereco", label: "Endereco da Jucesp igual ao informado", pts: 4 },
      { key: "a_qsa_jucesp", label: "Quadro societario da Jucesp confere", pts: 5 },
      { key: "a_alteracao_recente", label: "Ultima alteracao contratual em prazo razoavel", pts: 3 },
      { key: "a_sem_duplicidade", label: "Sem duplicidade/confusao cadastral", pts: 4 },
    ],
  },
  B: {
    title: "Risco juridico e reputacional",
    max: 50,
    items: [
      { key: "b_sem_processos", label: "Empresa sem processos judiciais relevantes", pts: 5 },
      { key: "b_socios_limpos", label: "Socios sem acoes civeis/trabalhistas recorrentes", pts: 4 },
      { key: "b_sem_ambientais", label: "Sem acoes ambientais/fiscais relevantes", pts: 4 },
      { key: "b_sem_protesto", label: "Nenhum protesto ativo", pts: 5 },
      { key: "b_protesto_justificado", label: "Protesto baixo, pontual e justificado", pts: 3 },
      { key: "b_sem_protestos_multi", label: "Sem protestos multiplos em diferentes pracas", pts: 4 },
      { key: "b_sem_cheques_falencia", label: "Sem cheques sem fundos / falencia / recuperacao", pts: 5 },
      { key: "b_reclame_aqui", label: "Reclame Aqui e reputacao publica sem sinais criticos", pts: 2 },
      { key: "b_referencia_segmento", label: "Referencia comercial positiva no segmento", pts: 4 },
      { key: "b_indicacao_makfil", label: "Indicacao de cliente Makfil bom pagador", pts: 4 },
      { key: "b_confirma_terceiros", label: "Confirmacao com terceiros da obra/contrato", pts: 4 },
      { key: "b_nada_consta_extra", label: "Demais validacoes juridicas", pts: 6 },
    ],
  },
  C: {
    title: "Credito e comportamento financeiro",
    max: 70,
    items: [
      { key: "c_acirp_spc", label: "Consulta ACIRP/SPC realizada", pts: 5 },
      { key: "c_score_minimo", label: "Score de credito acima do minimo Makfil", pts: 5 },
      { key: "c_sem_excesso_consulta", label: "Sem consultas excessivas recentes no CNPJ", pts: 4 },
      { key: "c_historico_estavel", label: "Historico financeiro estavel", pts: 4 },
      { key: "c_socio_sem_negativa", label: "Nenhum socio negativado", pts: 5 },
      { key: "c_pagamentos_em_dia", label: "Historico de pagamentos em dia com mercado", pts: 5 },
      { key: "c_makfil_sem_atraso", label: "Historico Makfil sem atrasos", pts: 8 },
      { key: "c_tempo_makfil", label: "Tempo de cadastro Makfil", pts: 4 },
      { key: "c_volume_coerente", label: "Volume pretendido coerente com porte", pts: 6 },
      { key: "c_limite_externo", label: "Limite externo compativel com operacao", pts: 6 },
      { key: "c_endividamento", label: "Endividamento e compromissos controlados", pts: 6 },
      { key: "c_capacidade", label: "Capacidade de pagamento compativel com ticket", pts: 6 },
      { key: "c_contrato_obra", label: "Contrato/prestacao comprovando receita da obra", pts: 6 },
    ],
  },
  D: {
    title: "Evidencia operacional e fisica",
    max: 45,
    items: [
      { key: "d_endereco_maps", label: "Endereco fisico confirmado no Maps/Street View", pts: 5 },
      { key: "d_fachada", label: "Fachada com placa, logotipo ou operacao aparente", pts: 4 },
      { key: "d_nao_residencial", label: "Local nao residencial/coworking generico", pts: 4 },
      { key: "d_obra_real", label: "Endereco da obra real e ativo", pts: 5 },
      { key: "d_obra_segmento", label: "Obra compativel com segmento", pts: 4 },
      { key: "d_vendedor_conhece", label: "Vendedor conhece a instalacao", pts: 5 },
      { key: "d_captacao_obra", label: "Cliente captado em obra e validado", pts: 5 },
      { key: "d_contato_usina", label: "Contato da usina/obra confirmado", pts: 5 },
      { key: "d_nf_entrada", label: "NF de entrada de material ou evidencia equivalente", pts: 4 },
      { key: "d_ligacoes_locais", label: "Ligacoes locais confirmando obra", pts: 4 },
    ],
  },
  E: {
    title: "Presenca digital, identidade e consistencia",
    max: 35,
    items: [
      { key: "e_dominio_proprio", label: "Dominio proprio registrado", pts: 3 },
      { key: "e_dominio_antigo", label: "Dominio com mais de 1 ano", pts: 2 },
      { key: "e_dominio_titular", label: "Titular do dominio = CNPJ ou socio", pts: 3 },
      { key: "e_email_corporativo", label: "E-mail corporativo do mesmo dominio", pts: 3 },
      { key: "e_telefone_validado", label: "Telefone validado / titular coerente", pts: 3 },
      { key: "e_email_validado", label: "E-mail validado e coerente", pts: 2 },
      { key: "e_assertiva_qsa", label: "Assertiva confirma quadro societario/dados", pts: 4 },
      { key: "e_sem_inconsistencias", label: "Sem inconsistencias entre Assertiva, Receita e Jucesp", pts: 5 },
      { key: "e_presenca_digital", label: "Presenca digital minima (site, Google Business, redes)", pts: 2 },
      { key: "e_linkedin", label: "LinkedIn e rastros publicos coerentes", pts: 3 },
      { key: "e_endereco_socios", label: "Comprovante de endereco dos socios coerente", pts: 5 },
    ],
  },
};

export const QUESTIONNAIRE_AGGRAVATORS: QuestionnaireItem[] = [
  { key: "ag_protesto_alto", label: "Protesto ativo acima de R$ 10 mil", pts: -20 },
  { key: "ag_pendencia_locadora", label: "Pendencia recente em locadora/frota", pts: -15 },
  { key: "ag_divergencia", label: "Divergencia societaria/documental", pts: -25 },
  { key: "ag_email_generico", label: "Gmail/Hotmail sem site, sem referencia e sem presenca fisica", pts: -10 },
  { key: "ag_obra_distante", label: "Obra distante sem contato do contratante/usina", pts: -15 },
  { key: "ag_ticket_alto", label: "Primeiro negocio com ticket alto para empresa pequena", pts: -20 },
];

export const QUESTIONNAIRE_MITIGATORS: QuestionnaireItem[] = [
  { key: "mt_indicacao_ouro", label: "Cliente indicado por Ouro/Prata adimplente", pts: 10 },
  { key: "mt_historico_makfil", label: "Ja possui historico positivo com a Makfil", pts: 15 },
  { key: "mt_vendedor_conhece", label: "Vendedor conhece instalacao e obra", pts: 8 },
  { key: "mt_contrato_os_nf", label: "Contrato/OS/NF comprovando a operacao", pts: 10 },
];

export const QUESTIONNAIRE_BLOCKERS: Omit<QuestionnaireItem, "pts">[] = [
  { key: "bl_cnpj_inapto", label: "CNPJ inapto, baixado, suspenso ou irregular" },
  { key: "bl_menos_12m", label: "Empresa com menos de 12 meses de abertura" },
  { key: "bl_socio_irregular", label: "Socio com CPF irregular" },
  { key: "bl_incompatibilidade", label: "Incompatibilidade grave entre razao social, QSA, endereco e documentos" },
  { key: "bl_recusa_docs", label: "Recusa em enviar documentos minimos / sem responsavel legal" },
  { key: "bl_endereco_inexistente", label: "Endereco inexistente ou empresa de fachada" },
  { key: "bl_protesto_grave", label: "Protestos relevantes sem justificativa plausivel" },
  { key: "bl_restricao_grave", label: "Restricao grave ativa sem comprovacao operacional" },
];

export const QUESTIONNAIRE_MAX_TOTAL = 250;

export interface QuestionnaireTier {
  min: number;
  classification: "A" | "B" | "C" | "D" | "E";
  label: string;
  decision: string;
}

// Faixas de classificacao (ordem decrescente por `min`). Fonte unica:
// usada por scoreQuestionnaire e exposta no schema para o frontend.
export const QUESTIONNAIRE_TIERS: QuestionnaireTier[] = [
  { min: 220, classification: "A", label: "Makfil A - Confiavel", decision: "Liberado - condicao padrao. Revisao em 6 meses." },
  { min: 180, classification: "B", label: "Makfil B - Liberado com atencao", decision: "Liberado com atencao. Limite controlado, contrato reforcado. Revisao em 3 meses." },
  { min: 140, classification: "C", label: "Makfil C - Medio risco", decision: "Liberar somente com mitigacao (entrada antecipada, caucao, garantia). Revisao em 30-60 dias." },
  { min: 100, classification: "D", label: "Makfil D - Alto risco", decision: "Aprovar apenas com garantia real ou comprovacao forte de obra/contrato." },
  { min: 0, classification: "E", label: "Makfil E - Reprovar", decision: "Reprovar cadastro ou bloquear locacao a prazo." },
];

export interface QuestionnaireSchema {
  version: typeof MAK_SCORE_QUESTIONNAIRE_VERSION;
  maxTotal: number;
  pillars: Record<QuestionnaireSection, QuestionnairePillar>;
  aggravators: QuestionnaireItem[];
  mitigators: QuestionnaireItem[];
  blockers: Omit<QuestionnaireItem, "pts">[];
  tiers: QuestionnaireTier[];
}

/**
 * Schema completo do questionario, para o frontend renderizar e prever o
 * score sem duplicar definicoes. FONTE UNICA DE VERDADE - o backend
 * recalcula o score autoritativo em scoreQuestionnaire.
 */
export function getQuestionnaireSchema(): QuestionnaireSchema {
  return {
    version: MAK_SCORE_QUESTIONNAIRE_VERSION,
    maxTotal: QUESTIONNAIRE_MAX_TOTAL,
    pillars: QUESTIONNAIRE_PILLARS,
    aggravators: QUESTIONNAIRE_AGGRAVATORS,
    mitigators: QUESTIONNAIRE_MITIGATORS,
    blockers: QUESTIONNAIRE_BLOCKERS,
    tiers: QUESTIONNAIRE_TIERS,
  };
}

export function scoreQuestionnaire(
  answers: MakScoreQuestionnaireAnswers,
): MakScoreQuestionnaireScore {
  const pillarTotals = {} as Record<QuestionnaireSection, number>;
  let basePilares = 0;

  for (const [section, pillar] of Object.entries(QUESTIONNAIRE_PILLARS) as Array<
    [QuestionnaireSection, QuestionnairePillar]
  >) {
    const total = pillar.items.reduce(
      (sum, item) => sum + (answers.pilares[item.key] ? item.pts : 0),
      0,
    );
    pillarTotals[section] = total;
    basePilares += total;
  }

  const agravantesTotal = QUESTIONNAIRE_AGGRAVATORS.reduce(
    (sum, item) => sum + (answers.agravantes[item.key] ? item.pts : 0),
    0,
  );
  const mitigadoresTotal = QUESTIONNAIRE_MITIGATORS.reduce(
    (sum, item) => sum + (answers.mitigadores[item.key] ? item.pts : 0),
    0,
  );
  const total = Math.min(250, Math.max(0, basePilares + agravantesTotal + mitigadoresTotal));
  const hasBloqueio = QUESTIONNAIRE_BLOCKERS.some((item) => answers.bloqueios[item.key]);

  if (hasBloqueio) {
    return {
      version: answers.version,
      pillarTotals,
      basePilares,
      agravantesTotal,
      mitigadoresTotal,
      total,
      hasBloqueio,
      classification: "bloqueio",
      label: "Reprovado - Bloqueio automatico",
      decision: "Reprovar cadastro",
    };
  }

  // Faixa por pontuacao (tiers em ordem decrescente; o ultimo tem min=0).
  const tier =
    QUESTIONNAIRE_TIERS.find((t) => total >= t.min) ??
    QUESTIONNAIRE_TIERS[QUESTIONNAIRE_TIERS.length - 1];

  return {
    version: answers.version,
    pillarTotals,
    basePilares,
    agravantesTotal,
    mitigadoresTotal,
    total,
    hasBloqueio,
    classification: tier.classification,
    label: tier.label,
    decision: tier.decision,
  };
}
