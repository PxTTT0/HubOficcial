/* global React, IconScore, IconHistory, IconAlert, IconLock, IconClock, IconRefresh, IconCheck, IconX, IconInfo, IconSearch */

const { useState: useStateMS } = React;

// MakScore — internal user view, decision-first
function MakScore({ onBack }) {
  const [view, setView] = useStateMS("form"); // form, loading, result, blocked, unavailable
  const [cnpj, setCnpj] = useStateMS("12.345.678/0001-99");
  const [ticket, setTicket] = useStateMS("R$ 38.420,00");
  const [product, setProduct] = useStateMS("TOTAL_PJ");

  const consultar = () => {
    setView("loading");
    setTimeout(() => setView("result"), 1100);
  };

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", background: "var(--c-bg)" }}>
      <ModuleHeader
        title="MakScore"
        subtitle="Análise interna · E-POSI TOTAL_PJ"
        onBack={onBack}
        right={<span className="badge warn"><span className="dot" />HOMOLOG</span>} />
      

      <div style={{ flex: 1, overflowY: "auto" }} className="scroll">
        <div style={{ padding: 14, display: "flex", flexDirection: "column", gap: 12 }}>
          {/* Form section */}
          <div className="surface" style={{ padding: 14, display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div className="label">Consulta</div>
              <span className="badge neutral mono">{product}</span>
            </div>

            <div className="field">
              <label htmlFor="cnpj">CNPJ</label>
              <div className="input-wrap">
                <span className="prefix mono">CNPJ</span>
                <input
                  id="cnpj" className="input mono with-prefix tnum"
                  value={cnpj} onChange={(e) => setCnpj(e.target.value)}
                  inputMode="numeric" />
                
              </div>
              <div className="hint">Validação completa no servidor.</div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <div className="field">
                <label>Produto E-POSI</label>
                <select className="select" value={product} onChange={(e) => setProduct(e.target.value)}>
                  <option value="TOTAL_PJ">TOTAL_PJ (padrão)</option>
                  <option value="COMPLETA_PJ">COMPLETA_PJ</option>
                </select>
              </div>
              <div className="field">
                <label>Ticket pretendido</label>
                <input className="input tnum" value={ticket} onChange={(e) => setTicket(e.target.value)} />
              </div>
            </div>

            <button className="btn btn-brand btn-lg btn-block" onClick={consultar}>
              <IconScore size={16} strokeWidth={1.9} /> Consultar MakScore
            </button>
          </div>

          {/* States below */}
          {view === "loading" && <LoadingState />}
          {view === "result" && <ResultBlock />}

          {/* History */}
          <div>
            <div style={{ padding: "8px 4px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span className="label">Histórico recente</span>
              <a className="link" style={{ fontSize: 12, fontWeight: 600, color: "var(--c-ink-3)", textDecoration: "none" }}>Ver tudo</a>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <HistoryRow doc="04.221.105/0001-44" name="Engerocha Engenharia" decision="Exige análise" tone="warn" score="540" when="hoje, 08:30" />
              <HistoryRow doc="58.901.220/0001-08" name="Construtora Norte Sul" decision="Aprovado" tone="ok" score="720" when="hoje, 07:55" />
              <HistoryRow doc="11.444.777/0001-61" name="Empreendedora Vega" decision="Reprovado" tone="risk" score="—" when="ontem" />
              <HistoryRow doc="22.300.110/0001-92" name="JS Estruturas Metálicas" decision="Indisponível" tone="neutral" score="—" when="ontem" />
            </div>
          </div>
        </div>
      </div>
    </div>);

}

function LoadingState() {
  return (
    <div className="surface" style={{ padding: 18, display: "flex", flexDirection: "column", alignItems: "center", gap: 14 }}>
      <Spinner />
      <div style={{ fontSize: 13, fontWeight: 600 }}>Consultando E-POSI…</div>
      <div style={{ fontSize: 11.5, color: "var(--c-ink-4)", textAlign: "center", maxWidth: 260, lineHeight: 1.45 }}>
        Validando documento, autenticando token e aplicando política Makfil de decisão.
      </div>
      <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: 6 }}>
        <StepLine label="Validação CNPJ" state="done" />
        <StepLine label="Token E-POSI" state="done" />
        <StepLine label="processfilter · TOTAL_PJ" state="active" />
        <StepLine label="Política Makfil" state="pending" />
      </div>
    </div>);

}

function Spinner() {
  return (
    <svg width="38" height="38" viewBox="0 0 38 38" aria-hidden>
      <circle cx="19" cy="19" r="15" stroke="var(--c-line-strong)" strokeWidth="3" fill="none" />
      <circle cx="19" cy="19" r="15" stroke="var(--c-brand)" strokeWidth="3" fill="none"
      strokeDasharray="30 100" strokeLinecap="round">
        <animateTransform attributeName="transform" type="rotate" from="0 19 19" to="360 19 19" dur="0.9s" repeatCount="indefinite" />
      </circle>
    </svg>);

}

function StepLine({ label, state }) {
  const dot = {
    done: { bg: "var(--c-ok)", ring: "var(--c-ok-line)", icon: "✓", color: "#fff" },
    active: { bg: "#fff", ring: "var(--c-brand)", icon: "", color: "" },
    pending: { bg: "#fff", ring: "var(--c-line-strong)", icon: "", color: "" }
  }[state];
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: state === "pending" ? "var(--c-ink-5)" : "var(--c-ink-3)" }}>
      <div style={{
        width: 14, height: 14, borderRadius: 7,
        background: dot.bg, border: `2px solid ${dot.ring}`,
        display: "grid", placeItems: "center",
        color: dot.color, fontSize: 9, fontWeight: 800,
        position: "relative"
      }}>
        {state === "active" && <span style={{ width: 6, height: 6, borderRadius: 3, background: "var(--c-brand)" }} />}
        {dot.icon}
      </div>
      <span style={{ fontWeight: state === "active" ? 700 : 500 }}>{label}</span>
    </div>);

}

// Decision panel
function ResultBlock() {
  return (
    <>
      <DecisionPanel
        decision="approved"
        score={720}
        company="Construtora Norte Sul Ltda"
        cnpj="12.345.678/0001-99" />
      

      <div className="surface" style={{ padding: 14, display: "flex", flexDirection: "column", gap: 12 }}>
        <div className="label" style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span>Motivos</span>
          <span style={{ fontSize: 10, color: "var(--c-ink-5)" }}>traduzidos da E-POSI</span>
        </div>
        <ReasonItem tone="ok" text="CNPJ ativo na Receita Federal" code="—" />
        <ReasonItem tone="ok" text="Sem negativações ou protestos relevantes" code="—" />
        <ReasonItem tone="info" text="Empresa com mais de 5 anos de constituição" code="RC-12" />
        <ReasonItem tone="warn" text="Volume de contratações recentes acima da média" code="RC-31" />
      </div>

      <div className="surface" style={{ padding: 14, display: "flex", flexDirection: "column", gap: 8 }}>
        <div className="label">Cadastrais (resumo)</div>
        <KV k="Razão social" v="Construtora Norte Sul Ltda" />
        <KV k="Situação" v={<span className="badge ok"><span className="dot" />ATIVA</span>} />
        <KV k="Abertura" v="14/03/2018" />
        <KV k="CNAE principal" v="42.11-1-01 — Construção rodovias" />
        <KV k="Porte" v="Médio porte" />
      </div>

      <div className="surface" style={{ padding: 14 }}>
        <div className="label" style={{ marginBottom: 10 }}>Validade & rastreabilidade</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <Stat label="Validade do score" value="48h" sub="expira 06/05 08:42" />
          <Stat label="Origem" value="E-POSI" sub="processfilter · 200 OK" />
          <Stat label="Correlation" value="MK-9F2A1B" sub="auditoria registrada" />
          <Stat label="Custo" value="HOMOL" sub="não fatura" />
        </div>

        <details style={{ marginTop: 12, borderTop: "1px solid var(--c-line)", paddingTop: 10 }}>
          <summary style={{ cursor: "pointer", fontSize: 12, fontWeight: 700, color: "var(--c-ink-3)", display: "flex", alignItems: "center", gap: 6 }}>
            <IconLock size={13} /> Detalhe técnico (analista/admin)
          </summary>
          <div className="mono" style={{
            marginTop: 8, padding: 10, background: "#0E1116", color: "#9AE0B8",
            borderRadius: 6, fontSize: 11, lineHeight: 1.5,
            whiteSpace: "pre", overflowX: "auto"
          }}>
{`ScorePJ.Score      720
ReasonCode1        RC-12
ReasonCode2        RC-31
ReasonCode3        —
ErrorCode          0
Product            TOTAL_PJ
HTTP               200
Latency            842 ms`}
          </div>
        </details>
      </div>

      <div style={{ display: "flex", gap: 8 }}>
        <button className="btn btn-secondary" style={{ flex: 1 }}><IconRefresh size={14} /> Reconsultar</button>
        <button className="btn btn-brand" style={{ flex: 1.4 }}>Vincular à proposta</button>
      </div>
    </>);

}

function DecisionPanel({ decision, score, company, cnpj }) {
  const cfg = {
    approved: {
      label: "APROVADO", sub: "Score acima do limite Makfil",
      bg: "#0F6E3A", ring: "#0B5A30", chip: "ok", barFrom: "#22A55F", barTo: "#0F6E3A"
    },
    review: {
      label: "EXIGE ANÁLISE", sub: "Pontos de atenção identificados",
      bg: "#A65A00", ring: "#8D4D00", chip: "warn", barFrom: "#E2A24A", barTo: "#A65A00"
    },
    reproved: {
      label: "REPROVADO", sub: "Bloqueio operacional automático",
      bg: "#9A0E16", ring: "#7B0810", chip: "risk", barFrom: "#D6262F", barTo: "#9A0E16"
    },
    unavailable: {
      label: "INDISPONÍVEL", sub: "Provedor temporariamente indisponível",
      bg: "#3D434F", ring: "#2A2F38", chip: "neutral", barFrom: "#5B6271", barTo: "#3D434F"
    }
  }[decision];

  return (
    <div style={{
      borderRadius: 12,
      background: cfg.bg, color: "#fff",
      padding: 16,
      boxShadow: `0 1px 0 ${cfg.ring} inset, 0 8px 22px rgba(14,17,22,0.12)`,
      display: "flex", flexDirection: "column", gap: 14
    }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: 0.18, opacity: 0.78 }}>RESULTADO</div>
          <div style={{ fontSize: 22, fontWeight: 800, letterSpacing: -0.4, marginTop: 2 }}>{cfg.label}</div>
          <div style={{ fontSize: 12, opacity: 0.85, marginTop: 2 }}>{cfg.sub}</div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: 0.18, opacity: 0.78 }}>SCORE PJ</div>
          <div className="tnum" style={{ fontSize: 32, fontWeight: 800, letterSpacing: -1, lineHeight: 1, marginTop: 2 }}>{score}</div>
          <div style={{ fontSize: 10, opacity: 0.7, marginTop: 2 }}>faixa 300–1000</div>
        </div>
      </div>

      {/* Score bar */}
      <div>
        <div style={{
          height: 6, borderRadius: 3, position: "relative",
          background: "rgba(255,255,255,0.18)",
          overflow: "hidden"
        }}>
          <div style={{
            position: "absolute", left: 0, top: 0, bottom: 0,
            width: `${(score - 300) / 700 * 100}%`,
            background: `linear-gradient(90deg, ${cfg.barFrom}, ${cfg.barTo})`,
            borderRadius: 3
          }} />
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, opacity: 0.7, marginTop: 4 }}>
          <span>300</span><span>500</span><span>700</span><span>1000</span>
        </div>
      </div>

      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        paddingTop: 10, borderTop: "1px solid rgba(255,255,255,0.16)"
      }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{company}</div>
          <div className="mono" style={{ fontSize: 11, opacity: 0.78 }}>{cnpj}</div>
        </div>
        <span style={{
          fontSize: 10, fontWeight: 700, letterSpacing: 0.1,
          background: "rgba(255,255,255,0.16)", padding: "3px 8px", borderRadius: 999
        }}>VÁLIDO 48h</span>
      </div>
    </div>);

}

function ReasonItem({ tone, text, code }) {
  const tones = {
    ok: { c: "var(--c-ok)", icon: <IconCheck size={12} /> },
    info: { c: "var(--c-info)", icon: <IconInfo size={12} /> },
    warn: { c: "var(--c-warn)", icon: <IconAlert size={12} /> },
    risk: { c: "var(--c-risk)", icon: <IconX size={12} /> }
  }[tone];
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <div style={{
        width: 22, height: 22, borderRadius: 6,
        background: "var(--c-neutral-bg)", color: tones.c,
        display: "grid", placeItems: "center", flexShrink: 0
      }}>{tones.icon}</div>
      <div style={{ flex: 1, fontSize: 12.5, color: "var(--c-ink)" }}>{text}</div>
      <span className="mono" style={{ fontSize: 10.5, color: "var(--c-ink-5)" }}>{code}</span>
    </div>);

}

function KV({ k, v }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, padding: "4px 0" }}>
      <div style={{ fontSize: 12, color: "var(--c-ink-4)" }}>{k}</div>
      <div style={{ fontSize: 12.5, fontWeight: 600, color: "var(--c-ink)", textAlign: "right" }}>{v}</div>
    </div>);

}

function Stat({ label, value, sub }) {
  return (
    <div style={{
      background: "var(--c-surface-2)",
      border: "1px solid var(--c-line)",
      borderRadius: 8, padding: "10px 12px"
    }}>
      <div className="label" style={{ fontSize: 9.5 }}>{label}</div>
      <div className="tnum" style={{ fontSize: 16, fontWeight: 700, color: "var(--c-ink)", letterSpacing: -0.2, marginTop: 2 }}>{value}</div>
      <div style={{ fontSize: 10.5, color: "var(--c-ink-4)", marginTop: 2 }}>{sub}</div>
    </div>);

}

function HistoryRow({ doc, name, decision, tone, score, when }) {
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 10,
      padding: "10px 12px",
      background: "var(--c-surface)",
      border: "1px solid var(--c-line)",
      borderRadius: 8
    }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12.5, fontWeight: 600, color: "var(--c-ink)" }}>{name}</div>
        <div className="mono" style={{ fontSize: 11, color: "var(--c-ink-4)", marginTop: 1 }}>{doc} · {when}</div>
      </div>
      <div style={{ textAlign: "right" }}>
        <span className={`badge ${tone}`}><span className="dot" />{decision}</span>
        <div className="tnum" style={{ fontSize: 11, color: "var(--c-ink-4)", marginTop: 4 }}>score {score}</div>
      </div>
    </div>);

}

Object.assign(window, { MakScore });