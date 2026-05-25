"use strict";
const state = {
  user: null,
  csrfToken: null,
  challengeToken: null,
  currentResult: null,
  currentView: "query",
};

const $ = (id) => document.getElementById(id);
const canReview = () => state.user && ["analista", "admin"].includes(state.user.role);
const canSeeTech = canReview;
const QUESTIONNAIRE_VERSION = "makscore-v1";

// Escapa qualquer dado dinamico antes de injetar via innerHTML.
// Defesa contra XSS (nomes de empresa da E-POSI, notas de analista, etc.).
function esc(v) {
  return String(v ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

const Q_PILLARS = {
  A: { title: "Regularidade cadastral e documental", max: 50, items: [
    ["a_abertura_12m", "Data de abertura superior a 12 meses", 5], ["a_servico_cnae", "Servico compativel com CNAE", 4],
    ["a_endereco_receita", "Endereco da Receita confere com comprovante e informado", 4], ["a_nome_confere", "Nome empresarial/fantasia confere com documentos", 3],
    ["a_porte", "Porte coerente com volume da locacao", 3], ["a_ie_ativa", "IE ativa e regular no Cadesp/Sintegra", 5],
    ["a_ie_endereco", "Endereco da IE confere com Receita", 4], ["a_ie_cnae", "CNAE da IE compativel", 4],
    ["a_situacao_regular", "Situacao cadastral sem irregularidade", 5], ["a_contrato_jucesp", "Contrato social/ATA atualizado na Jucesp", 5],
    ["a_jucesp_endereco", "Endereco da Jucesp igual ao informado", 4], ["a_qsa_jucesp", "Quadro societario da Jucesp confere", 5],
    ["a_alteracao_recente", "Ultima alteracao contratual em prazo razoavel", 3], ["a_sem_duplicidade", "Sem duplicidade/confusao cadastral", 4],
  ]},
  B: { title: "Risco juridico e reputacional", max: 50, items: [
    ["b_sem_processos", "Empresa sem processos judiciais relevantes", 5], ["b_socios_limpos", "Socios sem acoes civeis/trabalhistas recorrentes", 4],
    ["b_sem_ambientais", "Sem acoes ambientais/fiscais relevantes", 4], ["b_sem_protesto", "Nenhum protesto ativo", 5],
    ["b_protesto_justificado", "Protesto baixo, pontual e justificado", 3], ["b_sem_protestos_multi", "Sem protestos multiplos em diferentes pracas", 4],
    ["b_sem_cheques_falencia", "Sem cheques sem fundos / falencia / recuperacao", 5], ["b_reclame_aqui", "Reclame Aqui e reputacao publica sem sinais criticos", 2],
    ["b_referencia_segmento", "Referencia comercial positiva no segmento", 4], ["b_indicacao_makfil", "Indicacao de cliente Makfil bom pagador", 4],
    ["b_confirma_terceiros", "Confirmacao com terceiros da obra/contrato", 4], ["b_nada_consta_extra", "Demais validacoes juridicas", 6],
  ]},
  C: { title: "Credito e comportamento financeiro", max: 70, items: [
    ["c_acirp_spc", "Consulta ACIRP/SPC realizada", 5], ["c_score_minimo", "Score de credito acima do minimo Makfil", 5],
    ["c_sem_excesso_consulta", "Sem consultas excessivas recentes no CNPJ", 4], ["c_historico_estavel", "Historico financeiro estavel", 4],
    ["c_socio_sem_negativa", "Nenhum socio negativado", 5], ["c_pagamentos_em_dia", "Historico de pagamentos em dia com mercado", 5],
    ["c_makfil_sem_atraso", "Historico Makfil sem atrasos", 8], ["c_tempo_makfil", "Tempo de cadastro Makfil", 4],
    ["c_volume_coerente", "Volume pretendido coerente com porte", 6], ["c_limite_externo", "Limite externo compativel com operacao", 6],
    ["c_endividamento", "Endividamento e compromissos controlados", 6], ["c_capacidade", "Capacidade de pagamento compativel com ticket", 6],
    ["c_contrato_obra", "Contrato/prestacao comprovando receita da obra", 6],
  ]},
  D: { title: "Evidencia operacional e fisica", max: 45, items: [
    ["d_endereco_maps", "Endereco fisico confirmado no Maps/Street View", 5], ["d_fachada", "Fachada com placa, logotipo ou operacao aparente", 4],
    ["d_nao_residencial", "Local nao residencial/coworking generico", 4], ["d_obra_real", "Endereco da obra real e ativo", 5],
    ["d_obra_segmento", "Obra compativel com segmento", 4], ["d_vendedor_conhece", "Vendedor conhece a instalacao", 5],
    ["d_captacao_obra", "Cliente captado em obra e validado", 5], ["d_contato_usina", "Contato da usina/obra confirmado", 5],
    ["d_nf_entrada", "NF de entrada de material ou evidencia equivalente", 4], ["d_ligacoes_locais", "Ligacoes locais confirmando obra", 4],
  ]},
  E: { title: "Presenca digital, identidade e consistencia", max: 35, items: [
    ["e_dominio_proprio", "Dominio proprio registrado", 3], ["e_dominio_antigo", "Dominio com mais de 1 ano", 2],
    ["e_dominio_titular", "Titular do dominio = CNPJ ou socio", 3], ["e_email_corporativo", "E-mail corporativo do mesmo dominio", 3],
    ["e_telefone_validado", "Telefone validado / titular coerente", 3], ["e_email_validado", "E-mail validado e coerente", 2],
    ["e_assertiva_qsa", "Assertiva confirma quadro societario/dados", 4], ["e_sem_inconsistencias", "Sem inconsistencias entre Assertiva, Receita e Jucesp", 5],
    ["e_presenca_digital", "Presenca digital minima (site, Google Business, redes)", 2], ["e_linkedin", "LinkedIn e rastros publicos coerentes", 3],
    ["e_endereco_socios", "Comprovante de endereco dos socios coerente", 5],
  ]},
};
const Q_AGGRAVATORS = [
  ["ag_protesto_alto", "Protesto ativo acima de R$ 10 mil", -20], ["ag_pendencia_locadora", "Pendencia recente em locadora/frota", -15],
  ["ag_divergencia", "Divergencia societaria/documental", -25], ["ag_email_generico", "Gmail/Hotmail sem site, sem referencia e sem presenca fisica", -10],
  ["ag_obra_distante", "Obra distante sem contato do contratante/usina", -15], ["ag_ticket_alto", "Primeiro negocio com ticket alto para empresa pequena", -20],
];
const Q_MITIGATORS = [
  ["mt_indicacao_ouro", "Cliente indicado por Ouro/Prata adimplente", 10], ["mt_historico_makfil", "Ja possui historico positivo com a Makfil", 15],
  ["mt_vendedor_conhece", "Vendedor conhece instalacao e obra", 8], ["mt_contrato_os_nf", "Contrato/OS/NF comprovando a operacao", 10],
];
const Q_BLOCKERS = [
  ["bl_cnpj_inapto", "CNPJ inapto, baixado, suspenso ou irregular"], ["bl_menos_12m", "Empresa com menos de 12 meses de abertura"],
  ["bl_socio_irregular", "Socio com CPF irregular"], ["bl_incompatibilidade", "Incompatibilidade grave entre razao social, QSA, endereco e documentos"],
  ["bl_recusa_docs", "Recusa em enviar documentos minimos / sem responsavel legal"], ["bl_endereco_inexistente", "Endereco inexistente ou empresa de fachada"],
  ["bl_protesto_grave", "Protestos relevantes sem justificativa plausivel"], ["bl_restricao_grave", "Restricao grave ativa sem comprovacao operacional"],
];

function show(el, visible) { el.classList.toggle("hide", !visible); }
function msg(el, text, kind = "error") {
  el.textContent = text;
  el.className = kind === "error" ? "error" : "notice";
  show(el, Boolean(text));
}
function fmtDate(v) { return v ? new Date(v).toLocaleString("pt-BR") : "-"; }
function fmtMoneyInput(v) {
  const n = String(v || "").replace(/\D/g, "");
  if (!n) return "";
  return (Number(n) / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
function parseMoney(v) {
  const s = String(v || "").replace(/\./g, "").replace(",", ".").replace(/[^\d.]/g, "");
  const n = Number(s);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}
function maskCnpjInput(v) {
  return String(v || "").replace(/\D/g, "").slice(0, 14)
    .replace(/^(\d{2})(\d)/, "$1.$2")
    .replace(/^(\d{2})\.(\d{3})(\d)/, "$1.$2.$3")
    .replace(/\.(\d{3})(\d)/, ".$1/$2")
    .replace(/(\d{4})(\d)/, "$1-$2");
}
function qCheckHtml(group, item) {
  const [key, label, pts] = item;
  const ptsLabel = typeof pts === "number" ? (pts > 0 ? `+${pts}` : String(pts)) : "bloqueio";
  return `<label class="check"><input type="checkbox" data-q-group="${esc(group)}" data-q-key="${esc(key)}" /> <span>${esc(label)}</span><span class="pts">${esc(ptsLabel)}</span></label>`;
}
function renderQuestionnaire() {
  const box = $("questionnaireBox");
  box.innerHTML = `
    <details class="question-group" open>
      <summary>Bloqueios automáticos <span class="pts">reprova</span></summary>
      <div class="checks">${Q_BLOCKERS.map((i) => qCheckHtml("bloqueios", i)).join("")}</div>
    </details>
    ${Object.entries(Q_PILLARS).map(([id, p]) => `
      <details class="question-group">
        <summary>${esc(id)}. ${esc(p.title)} <span class="pts">max ${esc(p.max)}</span></summary>
        <div class="checks">${p.items.map((i) => qCheckHtml("pilares", i)).join("")}</div>
      </details>
    `).join("")}
    <details class="question-group">
      <summary>Agravantes <span class="pts">reduzem</span></summary>
      <div class="checks">${Q_AGGRAVATORS.map((i) => qCheckHtml("agravantes", i)).join("")}</div>
    </details>
    <details class="question-group">
      <summary>Mitigadores <span class="pts">bonus</span></summary>
      <div class="checks">${Q_MITIGATORS.map((i) => qCheckHtml("mitigadores", i)).join("")}</div>
    </details>
  `;
  box.querySelectorAll("input[type=checkbox]").forEach((i) => i.addEventListener("change", updateQuestionnaireScore));
  updateQuestionnaireScore();
}
function collectQuestionnaire() {
  const answers = { version: QUESTIONNAIRE_VERSION, bloqueios: {}, pilares: {}, agravantes: {}, mitigadores: {} };
  document.querySelectorAll("[data-q-group]").forEach((input) => {
    answers[input.dataset.qGroup][input.dataset.qKey] = input.checked;
  });
  return answers;
}
function scoreQuestionnaireLocal(answers) {
  let total = 0;
  for (const p of Object.values(Q_PILLARS)) {
    for (const [key, , pts] of p.items) if (answers.pilares[key]) total += pts;
  }
  for (const [key, , pts] of Q_AGGRAVATORS) if (answers.agravantes[key]) total += pts;
  for (const [key, , pts] of Q_MITIGATORS) if (answers.mitigadores[key]) total += pts;
  total = Math.min(250, Math.max(0, total));
  const hasBlock = Q_BLOCKERS.some(([key]) => answers.bloqueios[key]);
  const label = hasBlock ? "Bloqueio" : total >= 220 ? "Makfil A" : total >= 180 ? "Makfil B" : total >= 140 ? "Makfil C" : total >= 100 ? "Makfil D" : "Makfil E";
  return { total, label, hasBlock };
}
function updateQuestionnaireScore() {
  const s = scoreQuestionnaireLocal(collectQuestionnaire());
  $("questionnaireScore").textContent = `${s.label} · ${s.total} / 250`;
  $("questionnaireScore").className = "pill " + (s.hasBlock || s.label === "Makfil E" ? "reprovado" : s.label === "Makfil C" || s.label === "Makfil D" ? "exige_analise" : "aprovado");
}

async function api(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  const method = (options.method || "GET").toUpperCase();
  if (options.body && !headers["content-type"]) headers["content-type"] = "application/json";
  if (!["GET", "HEAD", "OPTIONS"].includes(method) && state.csrfToken) {
    headers["x-csrf-token"] = state.csrfToken;
  }
  const res = await fetch(path, { ...options, method, headers, credentials: "same-origin" });
  let body = null;
  const text = await res.text();
  if (text) {
    try { body = JSON.parse(text); } catch { body = { raw: text }; }
  }
  if (body && body.csrfToken) state.csrfToken = body.csrfToken;
  if (res.status === 401) {
    state.user = null;
    showAuthenticated(false);
    throw new Error("Sessão expirada. Faça login novamente.");
  }
  if (!res.ok) {
    const error = body?.error || `HTTP ${res.status}`;
    throw new Error(error);
  }
  return body;
}

// Desabilita o botao de submit durante a requisicao (anti duplo-submit).
async function withBusy(button, fn) {
  if (button) button.disabled = true;
  try { return await fn(); }
  finally { if (button) button.disabled = false; }
}

async function bootstrap() {
  try {
    const me = await api("/api/auth/me");
    state.user = me.user;
    state.csrfToken = me.csrfToken;
    if (me.mfa?.enrollmentPending) {
      showEnrollment();
      return;
    }
    showAuthenticated(true);
    await loadHistory();
  } catch {
    showAuthenticated(false);
  }
}

function showAuthenticated(ok) {
  show($("authScreen"), !ok);
  show($("app"), ok);
  if (!ok) return;
  $("sessionUser").textContent = state.user?.id || "-";
  $("sessionRole").textContent = state.user?.role || "-";
  showView(state.currentView || "query");
}

function showLogin() {
  show($("loginForm"), true);
  show($("mfaForm"), false);
  show($("enrollBox"), false);
  msg($("loginMsg"), "");
}

function showMfa(challengeToken) {
  state.challengeToken = challengeToken;
  show($("loginForm"), false);
  show($("mfaForm"), true);
  show($("enrollBox"), false);
  $("mfaCode").focus();
}

function showEnrollment() {
  show($("loginForm"), false);
  show($("mfaForm"), false);
  show($("enrollBox"), true);
}

async function login(e) {
  e.preventDefault();
  msg($("loginMsg"), "");
  await withBusy(e.submitter, async () => {
    try {
      const body = await api("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({
          username: $("username").value.trim(),
          password: $("password").value,
        }),
      });
      if (body.mfaRequired) {
        showMfa(body.challengeToken);
        return;
      }
      state.user = body.user;
      state.csrfToken = body.csrfToken;
      if (body.mfaEnrollmentPending) {
        showEnrollment();
        return;
      }
      showAuthenticated(true);
      await loadHistory();
    } catch (err) {
      msg($("loginMsg"), "Não foi possível entrar. Verifique usuário e senha.");
    }
  });
}

async function submitMfa(e) {
  e.preventDefault();
  msg($("mfaMsg"), "");
  await withBusy(e.submitter, async () => {
    try {
      const body = await api("/api/auth/login/mfa", {
        method: "POST",
        body: JSON.stringify({
          challengeToken: state.challengeToken,
          code: $("mfaCode").value.trim(),
          recovery: $("mfaRecovery").checked,
        }),
      });
      state.user = body.user;
      state.csrfToken = body.csrfToken;
      state.challengeToken = null;
      showAuthenticated(true);
      await loadHistory();
    } catch {
      msg($("mfaMsg"), "Código inválido ou expirado.");
    }
  });
}

async function startEnrollment() {
  msg($("enrollMsg"), "");
  await withBusy($("startEnroll"), async () => {
    try {
      const body = await api("/api/auth/mfa/enroll", { method: "POST", body: "{}" });
      $("totpSecret").value = body.secret || "";
      $("otpauthUri").value = body.otpauthUri || "";
      show($("enrollData"), true);
    } catch {
      msg($("enrollMsg"), "Não foi possível iniciar MFA.");
    }
  });
}

async function verifyEnrollment() {
  msg($("enrollMsg"), "");
  await withBusy($("verifyEnroll"), async () => {
    try {
      const body = await api("/api/auth/mfa/verify-enrollment", {
        method: "POST",
        body: JSON.stringify({ code: $("enrollCode").value.trim() }),
      });
      if (Array.isArray(body.recoveryCodes)) {
        $("recoveryCodes").innerHTML = "<strong>Guarde estes códigos agora:</strong><br><span class='mono'>"
          + body.recoveryCodes.map(esc).join("<br>") + "</span>";
        show($("recoveryCodes"), true);
      }
      state.user = body.user;
      state.csrfToken = body.csrfToken;
      showAuthenticated(true);
      await loadHistory();
    } catch {
      msg($("enrollMsg"), "Código inválido.");
    }
  });
}

async function logout() {
  try { await api("/api/auth/logout", { method: "POST", body: "{}" }); } catch {}
  state.user = null;
  state.csrfToken = null;
  state.currentResult = null;
  showLogin();
  showAuthenticated(false);
}

function showView(name) {
  state.currentView = name;
  document.querySelectorAll(".nav button").forEach((b) => {
    const active = b.dataset.view === name;
    b.classList.toggle("active", active);
    if (active) b.setAttribute("aria-current", "page");
    else b.removeAttribute("aria-current");
  });
  ["query", "history", "detail"].forEach((v) => show($("view-" + v), v === name));
  const titles = {
    query: ["Consulta MakScore", "Gere decisão automática com histórico e rastreabilidade."],
    history: ["Histórico", "Acompanhe consultas conforme seu perfil de acesso."],
    detail: ["Detalhe e análise", "Veja a decisão completa e registre análise manual quando permitido."],
  };
  $("pageTitle").textContent = titles[name][0];
  $("pageSub").textContent = titles[name][1];
}

async function queryMakScore(e) {
  e.preventDefault();
  msg($("globalMsg"), "", "info");
  const payload = {
    cnpj: $("cnpj").value.replace(/\D/g, ""),
    product: $("product").value,
    proposalId: $("proposal").value.trim() || undefined,
    ticketPretendido: parseMoney($("ticket").value),
    durationMonths: $("duration").value ? Number($("duration").value) : undefined,
    questionnaire: collectQuestionnaire(),
    forceRefresh: $("forceRefresh").checked || undefined,
  };
  await withBusy(e.submitter, async () => {
    try {
      const result = await api("/api/makscore/query", { method: "POST", body: JSON.stringify(payload) });
      renderResult(result);
      state.currentResult = result;
      show($("resultCard"), true);
      await loadHistory();
    } catch (err) {
      msg($("globalMsg"), "Consulta não concluída: " + err.message);
    }
  });
}

async function loadHistory() {
  if (!state.user) return;
  try {
    const body = await api("/api/makscore/history?limit=30");
    const list = $("historyList");
    list.innerHTML = "";
    const items = body.items || [];
    if (!items.length) {
      list.innerHTML = "<div class='muted'>Nenhuma consulta encontrada.</div>";
      return;
    }
    items.forEach((item) => {
      const div = document.createElement("div");
      div.className = "item";
      div.innerHTML = `
        <div class="actions between">
          <strong>${esc(item.cnpj || "-")}</strong>
          <span class="pill ${esc(item.outcome)}">${esc(String(item.outcome || "-").replaceAll("_", " "))}</span>
        </div>
        <div class="small muted">${esc(fmtDate(item.consultedAt))} · Score ${esc(item.score ?? "-")} · Risco ${esc(item.riskLevel ?? "-")}</div>
        <div class="small">${esc(item.recommendedAction || "")}</div>
      `;
      div.addEventListener("click", () => openResult(item.correlationId));
      list.appendChild(div);
    });
  } catch (err) {
    $("historyList").innerHTML = "<div class='error'>Histórico indisponível.</div>";
  }
}

async function openResult(correlationId) {
  try {
    const result = await api("/api/makscore/results/" + encodeURIComponent(correlationId));
    state.currentResult = result;
    renderDetail(result);
    showView("detail");
    if (canReview()) await loadReviewEvents(correlationId);
  } catch (err) {
    msg($("globalMsg"), "Resultado indisponível: " + err.message);
  }
}

function renderResult(d) {
  $("resultOutcome").textContent = String(d.outcome || "-").replaceAll("_", " ");
  $("resultOutcome").className = "pill " + esc(d.outcome);
  $("resultScore").textContent = d.score ?? "-";
  $("resultRisk").textContent = d.riskLevel || "-";
  $("resultValid").textContent = fmtDate(d.validUntil);
  $("resultAction").textContent = d.recommendedAction || "";
  $("resultFacts").innerHTML = factsHtml(d);
  renderReasons($("resultReasons"), d.reasons);
  renderTech($("techBox"), d);
}

function renderDetail(d) {
  $("detailOutcome").textContent = String(d.outcome || "-").replaceAll("_", " ");
  $("detailOutcome").className = "pill " + esc(d.outcome);
  $("detailBody").innerHTML = `
    <div class="row three">
      <div class="metric"><span>Score</span><strong>${esc(d.score ?? "-")}</strong></div>
      <div class="metric"><span>Risco</span><strong>${esc(d.riskLevel || "-")}</strong></div>
      <div class="metric"><span>Review</span><strong>${esc(d.reviewStatus || "none")}</strong></div>
    </div>
    <p>${esc(d.recommendedAction || "")}</p>
    ${factsHtml(d)}
    <div><h3>Motivos</h3><ul class="reasons">${(d.reasons || []).map((r) => `<li>${esc(r.label)}${r.critical ? " (crítico)" : ""}</li>`).join("") || "<li class='muted'>Sem motivos relevantes</li>"}</ul></div>
    <div id="detailTech"></div>
  `;
  renderTech($("detailTech"), d);
  show($("reviewPanel"), canReview());
}

function factsHtml(d) {
  const q = d.questionnaire?.score;
  return `
    <div class="card flat">
      <div class="kv"><span>CNPJ</span><strong>${esc(d.cnpj || "-")}</strong></div>
      <div class="kv"><span>Produto</span><strong>${esc(d.product || "-")}</strong></div>
      ${q ? `<div class="kv"><span>Questionário Makfil</span><strong>${esc(q.label)} · ${esc(q.total)}/250</strong></div>` : ""}
      <div class="kv"><span>Razão Social</span><strong>${esc(d.cadastral?.razaoSocial || "-")}</strong></div>
      <div class="kv"><span>CNAE</span><strong>${esc(d.cadastral?.cnaePrincipal || "-")}</strong></div>
      <div class="kv"><span>Situação</span><strong>${esc(d.cadastral?.status || "-")}</strong></div>
      <div class="kv"><span>Correlation</span><strong class="mono">${esc(d.correlationId || "-")}</strong></div>
    </div>
  `;
}

function renderReasons(ul, reasons) {
  ul.innerHTML = "";
  (reasons || []).forEach((r) => {
    const li = document.createElement("li");
    li.textContent = r.label + (r.critical ? " (crítico)" : "");
    ul.appendChild(li);
  });
  if (!ul.childElementCount) ul.innerHTML = "<li class='muted'>Sem motivos relevantes</li>";
}

function renderTech(box, d) {
  const q = d.questionnaire?.score;
  const showTech = canSeeTech() && ("primaryRule" in d || "ruleHits" in d || "errorCode" in d || q);
  show(box, showTech);
  if (!showTech) return;
  box.innerHTML = `
    <h3>Detalhes técnicos</h3>
    ${q ? `<div class="kv"><span>Questionário</span><strong>${esc(q.classification)} · ${esc(q.total)}/250 · ${esc(q.decision)}</strong></div>` : ""}
    <div class="kv"><span>Regra principal</span><strong>${esc(d.primaryRule || "-")}</strong></div>
    <div class="kv"><span>ErrorCode</span><strong>${esc(d.errorCode || "-")}</strong></div>
    <div class="kv"><span>ErrorMessage</span><strong>${esc(d.errorMessage || "-")}</strong></div>
    <div class="kv"><span>Rule hits</span><strong>${esc((d.ruleHits || []).length)}</strong></div>
  `;
}

async function submitReview(e) {
  e.preventDefault();
  if (!state.currentResult) return;
  await withBusy(e.submitter, async () => {
    try {
      const updated = await api(`/api/makscore/results/${encodeURIComponent(state.currentResult.correlationId)}/review`, {
        method: "POST",
        body: JSON.stringify({
          status: $("reviewStatus").value,
          note: $("reviewNote").value.trim() || undefined,
        }),
      });
      state.currentResult = updated;
      renderDetail(updated);
      await loadReviewEvents(updated.correlationId);
      msg($("globalMsg"), "Análise registrada.", "info");
    } catch (err) {
      msg($("globalMsg"), "Não foi possível registrar análise: " + err.message);
    }
  });
}

async function loadReviewEvents(correlationId) {
  const box = $("reviewEvents");
  box.innerHTML = "";
  try {
    const body = await api(`/api/makscore/results/${encodeURIComponent(correlationId)}/review-events`);
    const events = body.events || [];
    if (!events.length) {
      box.innerHTML = "<div class='muted'>Sem eventos de análise.</div>";
      return;
    }
    events.forEach((ev) => {
      const div = document.createElement("div");
      div.className = "item";
      div.innerHTML = `<strong>${esc(ev.fromStatus)} → ${esc(ev.toStatus)}</strong>`
        + `<div class="small muted">${esc(ev.reviewerId)} · ${esc(fmtDate(ev.createdAtMs))}</div>`
        + `<div>${esc(ev.note || "")}</div>`;
      box.appendChild(div);
    });
  } catch {
    box.innerHTML = "<div class='error'>Trilha indisponível.</div>";
  }
}

$("loginForm").addEventListener("submit", login);
$("mfaForm").addEventListener("submit", submitMfa);
$("backToLogin").addEventListener("click", showLogin);
$("startEnroll").addEventListener("click", startEnrollment);
$("verifyEnroll").addEventListener("click", verifyEnrollment);
$("logoutBtn").addEventListener("click", logout);
$("queryForm").addEventListener("submit", queryMakScore);
$("refreshHistory").addEventListener("click", loadHistory);
$("reviewForm").addEventListener("submit", submitReview);
$("cnpj").addEventListener("input", (e) => { e.target.value = maskCnpjInput(e.target.value); });
$("ticket").addEventListener("blur", (e) => { e.target.value = fmtMoneyInput(e.target.value); });
document.querySelectorAll(".nav button").forEach((b) => b.addEventListener("click", () => showView(b.dataset.view)));

renderQuestionnaire();
bootstrap();
