"use strict";
const state = {
  user: null,
  csrfToken: null,
  challengeToken: null,
  currentResult: null,
  currentView: "query",
  // Schema do questionario (fonte unica vinda do backend).
  questionnaire: null,
  // Secao ativa do stepper do questionario.
  qStep: null,
  // Paginacao/filtros do historico.
  history: { offset: 0, limit: 20, total: 0, filters: {} },
};

const $ = (id) => document.getElementById(id);
const canReview = () => state.user && ["analista", "admin"].includes(state.user.role);
const canSeeTech = canReview;

// Escapa qualquer dado dinamico antes de injetar via innerHTML.
// Defesa contra XSS (nomes de empresa da E-POSI, notas de analista, etc.).
function esc(v) {
  return String(v ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

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
function qCheckHtml(group, key, label, pts) {
  const ptsLabel = typeof pts === "number" ? (pts > 0 ? `+${pts}` : String(pts)) : "bloqueio";
  return `<label class="check"><input type="checkbox" data-q-group="${esc(group)}" data-q-key="${esc(key)}" /> <span>${esc(label)}</span><span class="pts">${esc(ptsLabel)}</span></label>`;
}
// ── Gauges (medidores visuais). Valor dinamico via CSSOM setProperty
//    (compativel com CSP estrita; nunca style="" inline). ──────────────
function gaugeBand(ratio) {
  return ratio >= 0.7 ? "high" : ratio >= 0.4 ? "medium" : "low";
}
function renderGaugeInto(container, label, value, max, valueText) {
  container.innerHTML = "";
  const ratio = typeof value === "number" && max > 0 ? Math.min(1, Math.max(0, value / max)) : 0;
  const wrap = document.createElement("div");
  wrap.className = "gauge";
  wrap.dataset.band = gaugeBand(ratio);
  const head = document.createElement("div");
  head.className = "gv";
  const lab = document.createElement("span");
  lab.className = "muted small";
  lab.textContent = label;
  const val = document.createElement("strong");
  val.textContent = valueText != null ? valueText : (value ?? "-");
  head.append(lab, val);
  const track = document.createElement("div");
  track.className = "track";
  const fill = document.createElement("div");
  fill.className = "fill";
  fill.style.setProperty("--v", String(ratio));
  track.appendChild(fill);
  wrap.append(head, track);
  container.appendChild(wrap);
}

// Secoes do stepper do questionario (a partir do schema).
function qSections() {
  const s = state.questionnaire;
  const out = [{ id: "bloqueios", title: "Bloqueios", group: "bloqueios", items: s.blockers, kind: "count" }];
  for (const [id, p] of Object.entries(s.pillars)) {
    out.push({ id, title: `${id}. ${p.title}`, group: "pilares", items: p.items, max: p.max, kind: "points" });
  }
  out.push({ id: "agravantes", title: "Agravantes", group: "agravantes", items: s.aggravators, kind: "count" });
  out.push({ id: "mitigadores", title: "Mitigadores", group: "mitigadores", items: s.mitigators, kind: "count" });
  return out;
}

function renderQuestionnaire() {
  const box = $("questionnaireBox");
  const schema = state.questionnaire;
  if (!schema) {
    box.innerHTML = "<div class='muted small'>Carregando questionário…</div>";
    return;
  }
  const sections = qSections();
  if (!state.qStep || !sections.some((s) => s.id === state.qStep)) state.qStep = sections[0].id;

  const nav = sections.map((s) =>
    `<button type="button" class="q-step" data-step="${esc(s.id)}"><span>${esc(s.title)}</span><span class="pts" data-step-progress="${esc(s.id)}"></span></button>`
  ).join("");

  const content = sections.map((s) =>
    `<div class="q-section${s.id === state.qStep ? "" : " hide"}" data-section="${esc(s.id)}">
       <div class="checks">${s.items.map((i) => qCheckHtml(s.group, i.key, i.label, i.pts)).join("")}</div>
     </div>`
  ).join("");

  box.innerHTML = `
    <div class="q-steps">${nav}</div>
    ${content}
    <div class="actions between q-footer">
      <div class="actions">
        <button type="button" class="ghost" data-q-nav="prev">‹ Anterior</button>
        <button type="button" class="ghost" data-q-nav="next">Próximo ›</button>
      </div>
      <div class="actions">
        <button type="button" class="ghost" data-q-bulk="mark">Marcar seção</button>
        <button type="button" class="ghost" data-q-bulk="clear">Limpar seção</button>
      </div>
    </div>
  `;

  box.querySelectorAll(".q-step").forEach((b) => b.addEventListener("click", () => setQStep(b.dataset.step)));
  box.querySelectorAll("[data-q-nav]").forEach((b) => b.addEventListener("click", () => stepBy(b.dataset.qNav === "next" ? 1 : -1)));
  box.querySelectorAll("[data-q-bulk]").forEach((b) => b.addEventListener("click", () => bulkSection(b.dataset.qBulk === "mark")));
  box.querySelectorAll("input[type=checkbox]").forEach((i) => i.addEventListener("change", updateQuestionnaireScore));
  setQStep(state.qStep);
  updateQuestionnaireScore();
}

function setQStep(id) {
  state.qStep = id;
  document.querySelectorAll(".q-section").forEach((el) => show(el, el.dataset.section === id));
  document.querySelectorAll(".q-step").forEach((b) => {
    const active = b.dataset.step === id;
    b.classList.toggle("active", active);
    if (active) b.setAttribute("aria-current", "step"); else b.removeAttribute("aria-current");
  });
}
function stepBy(delta) {
  const ids = qSections().map((s) => s.id);
  const i = Math.max(0, Math.min(ids.length - 1, ids.indexOf(state.qStep) + delta));
  setQStep(ids[i]);
}
function bulkSection(checked) {
  const sec = document.querySelector(`.q-section[data-section="${state.qStep}"]`);
  if (!sec) return;
  sec.querySelectorAll("input[type=checkbox]").forEach((i) => { i.checked = checked; });
  updateQuestionnaireScore();
}
function collectQuestionnaire() {
  const answers = {
    version: state.questionnaire?.version || "makscore-v1",
    bloqueios: {}, pilares: {}, agravantes: {}, mitigadores: {},
  };
  document.querySelectorAll("[data-q-group]").forEach((input) => {
    answers[input.dataset.qGroup][input.dataset.qKey] = input.checked;
  });
  return answers;
}
// Preview local (o backend recalcula o score autoritativo). Usa o mesmo
// schema do servidor -> sem duplicacao/drift.
function scoreQuestionnaireLocal(answers) {
  const schema = state.questionnaire;
  if (!schema) return { total: 0, label: "-", classification: "-", hasBlock: false };
  let total = 0;
  for (const p of Object.values(schema.pillars)) {
    for (const it of p.items) if (answers.pilares[it.key]) total += it.pts;
  }
  for (const it of schema.aggravators) if (answers.agravantes[it.key]) total += it.pts;
  for (const it of schema.mitigators) if (answers.mitigadores[it.key]) total += it.pts;
  total = Math.min(schema.maxTotal, Math.max(0, total));
  const hasBlock = schema.blockers.some((b) => answers.bloqueios[b.key]);
  const tier = hasBlock
    ? { classification: "bloqueio", label: "Bloqueio" }
    : (schema.tiers.find((t) => total >= t.min) || schema.tiers[schema.tiers.length - 1]);
  return { total, label: tier.label, classification: tier.classification, hasBlock };
}
function updateQuestionnaireScore() {
  const schema = state.questionnaire;
  const max = schema?.maxTotal ?? 250;
  const answers = collectQuestionnaire();
  const s = scoreQuestionnaireLocal(answers);
  $("questionnaireScore").textContent = `${s.label} · ${s.total} / ${max}`;
  const cls = s.hasBlock || s.classification === "E"
    ? "reprovado"
    : (s.classification === "C" || s.classification === "D") ? "exige_analise" : "aprovado";
  $("questionnaireScore").className = "pill " + cls;
  const g = $("questionnaireGauge");
  if (g) renderGaugeInto(g, "Pontuação Makfil", s.total, max, `${s.total} / ${max}`);
  if (!schema) return;
  // Progresso por secao no stepper.
  for (const sec of qSections()) {
    const badge = document.querySelector(`[data-step-progress="${sec.id}"]`);
    if (!badge) continue;
    const ans = answers[sec.group] || {};
    if (sec.kind === "points") {
      const pts = sec.items.reduce((sum, it) => sum + (ans[it.key] ? it.pts : 0), 0);
      badge.textContent = `${pts}/${sec.max}`;
    } else {
      const n = sec.items.filter((it) => ans[it.key]).length;
      badge.textContent = n ? String(n) : "";
    }
  }
}
async function loadQuestionnaireSchema() {
  if (!state.questionnaire) {
    try { state.questionnaire = await api("/api/makscore/questionnaire"); }
    catch { state.questionnaire = null; }
  }
  renderQuestionnaire();
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
  // Schema do questionario (fonte unica) carregado apos autenticar.
  loadQuestionnaireSchema();
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
    } catch {
      msg($("enrollMsg"), "Código inválido.");
    }
  });
}

async function logout() {
  // Confirma antes p/ evitar saida acidental (clique no botao da sidebar
  // perto do menu de navegacao). window.confirm e CSP-safe e acessivel.
  if (!window.confirm("Encerrar a sessão MakScore?")) return;
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
  // Indicador visivel + acessivel enquanto a consulta roda.
  msg($("globalMsg"), "Consultando MakScore…", "info");
  await withBusy(e.submitter, async () => {
    try {
      const result = await api("/api/makscore/query", { method: "POST", body: JSON.stringify(payload) });
      renderResult(result);
      state.currentResult = result;
      show($("resultCard"), true);
      msg($("globalMsg"), "", "info");
    } catch (err) {
      msg($("globalMsg"), "Consulta não concluída: " + err.message);
    }
  });
}

// Le os filtros do formulario. Datas (yyyy-mm-dd) viram ISO; "to" cobre
// o dia inteiro (fim do dia) para o filtro <= toMs.
function collectHistoryFilters() {
  const f = {};
  const outcome = $("filterOutcome").value;
  const from = $("filterFrom").value;
  const to = $("filterTo").value;
  const q = $("filterQ").value.trim();
  const userId = canReview() ? $("filterUserId").value.trim() : "";
  if (outcome) f.outcome = outcome;
  if (from) f.from = new Date(from + "T00:00:00").toISOString();
  if (to) f.to = new Date(to + "T23:59:59.999").toISOString();
  if (q) f.q = q;
  if (userId) f.userId = userId;
  return f;
}

// reset=true zera offset e substitui a lista (filtro novo/atualizar).
// reset=false acrescenta a proxima pagina (Carregar mais).
async function loadHistory(reset = true) {
  if (!state.user) return;
  const h = state.history;
  if (reset) {
    h.offset = 0;
    h.filters = collectHistoryFilters();
  }
  const params = new URLSearchParams({ limit: String(h.limit), offset: String(h.offset) });
  for (const [k, v] of Object.entries(h.filters)) params.set(k, v);
  const list = $("historyList");
  const more = $("loadMoreHistory");
  // Loading state visivel: aria-busy p/ leitor de tela + placeholder
  // textual no reset. Em "carregar mais", desabilita o proprio botao
  // e troca o rotulo enquanto a request roda.
  list.setAttribute("aria-busy", "true");
  if (reset) list.innerHTML = "<div class='muted small'>Carregando histórico…</div>";
  let moreLabel;
  if (!reset && more) {
    moreLabel = more.textContent;
    more.disabled = true;
    more.textContent = "Carregando…";
  }
  try {
    const body = await api("/api/makscore/history?" + params.toString());
    const items = body.items || [];
    h.total = body.total ?? items.length;
    if (reset) list.innerHTML = "";
    if (reset && !items.length) {
      list.innerHTML = "<div class='muted'>Nenhuma consulta encontrada.</div>";
    }
    items.forEach((item) => {
      // <button> em vez de <div>: focavel por teclado nativamente,
      // anuncia como interativo p/ leitor de tela e responde a
      // Enter/Espaco sem JS extra. role="listitem" liga ao role="list"
      // do container para navegacao consistente.
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "item";
      btn.setAttribute("role", "listitem");
      btn.setAttribute("aria-label",
        `Consulta ${item.cnpj || "-"}, ${String(item.outcome || "-").replaceAll("_", " ")}, em ${fmtDate(item.consultedAt)}`);
      btn.innerHTML = `
        <div class="actions between">
          <strong>${esc(item.cnpj || "-")}</strong>
          <span class="pill ${esc(item.outcome)}">${esc(String(item.outcome || "-").replaceAll("_", " "))}</span>
        </div>
        <div class="small muted">${esc(fmtDate(item.consultedAt))} · Score ${esc(item.score ?? "-")} · Risco ${esc(item.riskLevel ?? "-")}</div>
        <div class="small">${esc(item.recommendedAction || "")}</div>
      `;
      btn.addEventListener("click", () => openResult(item.correlationId));
      list.appendChild(btn);
    });
    h.offset += items.length;
    const shown = reset ? items.length : h.offset;
    $("historyCount").textContent = h.total
      ? `Mostrando ${shown} de ${h.total}`
      : "";
    show($("loadMoreHistory"), Boolean(body.hasMore));
  } catch (err) {
    if (reset) list.innerHTML = "<div class='error'>Histórico indisponível.</div>";
  } finally {
    list.setAttribute("aria-busy", "false");
    if (more && moreLabel !== undefined) {
      more.disabled = false;
      more.textContent = moreLabel;
    }
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
  renderEffective($("resultEffective"), d);
  renderScoreGauges(d, "resultGauges");
  $("resultFacts").innerHTML = factsHtml(d);
  renderReasons($("resultReasons"), d.reasons);
  renderTech($("techBox"), d);
}

// Gauges de score E-POSI (0-1000) e questionario (0-250).
function renderScoreGauges(d, containerId) {
  const c = $(containerId);
  if (!c) return;
  c.innerHTML = "";
  const scoreWrap = document.createElement("div");
  c.appendChild(scoreWrap);
  renderGaugeInto(scoreWrap, "Score E-POSI", typeof d.score === "number" ? d.score : null, 1000, d.score ?? "-");
  const q = d.questionnaire?.score;
  if (q) {
    const qWrap = document.createElement("div");
    c.appendChild(qWrap);
    renderGaugeInto(qWrap, "Questionário Makfil", q.total, 250, `${q.label} · ${q.total}/250`);
  }
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
    <div id="detailEffective" class="mt-14"></div>
    <p>${esc(d.recommendedAction || "")}</p>
    ${factsHtml(d)}
    <div><h3>Motivos</h3><ul class="reasons">${(d.reasons || []).map((r) => `<li>${esc(r.label)}${r.critical ? " (crítico)" : ""}</li>`).join("") || "<li class='muted'>Sem motivos relevantes</li>"}</ul></div>
    <div id="detailGauges" class="gauges mt-14"></div>
    <div id="detailTech"></div>
  `;
  renderEffective($("detailEffective"), d);
  renderScoreGauges(d, "detailGauges");
  renderTech($("detailTech"), d);
  show($("reviewPanel"), canReview());
}

// Decisao efetiva (automatica + analise manual). Destaque para o usuario.
function renderEffective(container, d) {
  if (!container) return;
  const e = d.effectiveDecision;
  if (!e) { container.innerHTML = ""; return; }
  container.innerHTML =
    `<div class="effective">`
    + `<span class="muted small">Decisão efetiva</span>`
    + `<span class="pill ${esc(e.status)}">${esc(e.label)}</span>`
    + (e.source === "manual" ? `<span class="pts">análise manual</span>` : "")
    + `</div>`;
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
  const hits = d.ruleHits || [];
  box.innerHTML = `
    <h3>Detalhes técnicos</h3>
    ${q ? `<div class="kv"><span>Questionário</span><strong>${esc(q.classification)} · ${esc(q.total)}/250 · ${esc(q.decision)}</strong></div>` : ""}
    <div class="kv"><span>Regra principal</span><strong>${esc(d.primaryRule || "-")}</strong></div>
    <div class="kv"><span>ErrorCode</span><strong>${esc(d.errorCode || "-")}</strong></div>
    <div class="kv"><span>ErrorMessage</span><strong>${esc(d.errorMessage || "-")}</strong></div>
    <h3 class="mt-14">Regras disparadas (${esc(hits.length)})</h3>
    ${hits.length
      ? `<div class="rulehits">${hits.map((h) => `
          <div class="rulehit" data-sev="${esc(h.severity)}">
            <div class="actions between"><strong>${esc(h.code)}</strong><span class="pill ${esc(sevClass(h.severity))}">${esc(h.severity)}</span></div>
            <div class="small">${esc(h.explanation || "")}</div>
            <div class="small muted">${esc(h.impact || "")}</div>
          </div>`).join("")}</div>`
      : "<div class='muted small'>Nenhuma regra disparada.</div>"}
  `;
}
// Mapeia severidade da regra para a paleta de pills.
function sevClass(sev) {
  return sev === "block" ? "reprovado" : sev === "review" ? "exige_analise" : sev === "approve" ? "aprovado" : "indeterminado";
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
// Modo emergencial: a UI de historico fica desativada (nav + view ocultos).
// O backend continua intacto -- voltar a expor requer apenas religar o nav.
// loadHistory() permanece definido para reuso futuro.
$("reviewForm").addEventListener("submit", submitReview);
// Botoes de impressao: imprimem APENAS o card alvo (resultCard ou
// detail card). O CSS @media print esconde a sidebar e os controles
// ("no-print"); o browser oferece "Salvar como PDF" no dialog padrao.
$("printResult")?.addEventListener("click", () => window.print());
$("printDetail")?.addEventListener("click", () => window.print());
$("cnpj").addEventListener("input", (e) => { e.target.value = maskCnpjInput(e.target.value); });
$("ticket").addEventListener("blur", (e) => { e.target.value = fmtMoneyInput(e.target.value); });
document.querySelectorAll(".nav button").forEach((b) => b.addEventListener("click", () => showView(b.dataset.view)));

bootstrap();
