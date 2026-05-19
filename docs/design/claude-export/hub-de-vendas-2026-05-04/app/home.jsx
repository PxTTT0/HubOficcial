/* global React, IconProposal, IconTruck, IconScore, IconTable, IconAdmin, IconChevron, IconHistory, IconClock, IconAlert, IconLock, IconPlus, IconSearch, IconRefresh, BrandMark */

function Home({ onNav, isAdmin }) {
  return (
    <div style={{ flex: 1, overflowY: "auto", background: "var(--c-bg)" }} className="scroll">

      {/* Top bar */}
      <div style={{
        background: "var(--c-surface)",
        borderBottom: "1px solid var(--c-line)",
        padding: "14px 20px",
      }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", maxWidth: 1100, margin: "0 auto" }}>
          <BrandMark/>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span className="badge accent"><span className="dot"/>HOMOLOG</span>
            <button aria-label="perfil" style={{
              width: 34, height: 34, borderRadius: 17,
              background: "var(--c-brand)", color: "var(--c-brand-ink)",
              fontWeight: 800, fontSize: 12, cursor: "pointer",
              border: "none",
            }}>AS</button>
          </div>
        </div>
      </div>

      <div style={{ maxWidth: 1100, margin: "0 auto", padding: "20px 16px 24px" }}>

        {/* Hero CTA + ações rápidas */}
        <div style={{ marginBottom: 20 }}>
          <div style={{
            background: "linear-gradient(135deg, var(--c-brand) 0%, #FFD544 100%)",
            border: "1px solid var(--c-brand-600)",
            borderRadius: 14,
            padding: "18px 18px",
            display: "flex", alignItems: "center", gap: 14,
            boxShadow: "0 1px 0 rgba(0,0,0,0.04), 0 8px 22px rgba(252,192,10,0.18)",
          }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{
                fontSize: 10.5, fontWeight: 800, letterSpacing: 0.16,
                color: "var(--c-brand-700)", textTransform: "uppercase",
              }}>Ação principal</div>
              <div style={{
                fontSize: 19, fontWeight: 800, letterSpacing: -0.4,
                color: "var(--c-brand-ink)", marginTop: 3,
              }}>Nova proposta</div>
              <div style={{ fontSize: 12.5, color: "var(--c-brand-700)", marginTop: 2, fontWeight: 600 }}>
                Cliente · Obra · Itens · Frete · Resumo
              </div>
            </div>
            <button onClick={() => onNav("proposta")} style={{
              background: "var(--c-ink)", color: "#fff",
              border: "none", cursor: "pointer",
              padding: "12px 18px", borderRadius: 10,
              fontSize: 14, fontWeight: 700,
              display: "flex", alignItems: "center", gap: 8,
              minHeight: 48, flexShrink: 0,
            }}>
              <IconPlus size={16} strokeWidth={2.2}/> Iniciar
            </button>
          </div>

          {/* Ações rápidas */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8, marginTop: 8 }}>
            <QuickAction label="Calcular frete"     Icon={IconTruck}  onClick={() => onNav("frete")}/>
            <QuickAction label="Consultar MakScore" Icon={IconScore}  onClick={() => onNav("score")}/>
            <QuickAction label="Consultar preço"    Icon={IconSearch} onClick={() => onNav("tabela")}/>
          </div>
        </div>

        {/* Módulos */}
        <SectionHeader title="Módulos"/>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 8 }}>
          <ModuleRow
            title="Proposta Rápida"
            Icon={IconProposal}
            status={{ label: "2 rascunhos", tone: "neutral" }}
            onClick={() => onNav("proposta")}
          />
          <ModuleRow
            title="Calculadora de Frete 2.0"
            Icon={IconTruck}
            status={{ label: "Operacional", tone: "ok" }}
            onClick={() => onNav("frete")}
          />
          <ModuleRow
            title="MakScore"
            Icon={IconScore}
            internal
            status={{ label: "Uso interno", tone: "info" }}
            onClick={() => onNav("score")}
          />
          <ModuleRow
            title="Tabela de Preços"
            Icon={IconTable}
            status={{ label: "v.2026-04-22", tone: "ok" }}
            onClick={() => onNav("tabela")}
          />
        </div>

        {isAdmin && (
          <>
            <SectionHeader title="Administração"/>
            <ModuleRow
              title="Configurações Logísticas"
              Icon={IconAdmin}
              admin
              status={{ label: "1 rascunho aberto", tone: "warn" }}
              onClick={() => onNav("admin")}
            />
          </>
        )}

        {/* Atividade recente — leve */}
        <SectionHeader title="Atividade recente" right={<a className="link" style={linkStyle}>Ver tudo</a>}/>
        <div style={{
          background: "var(--c-surface)",
          border: "1px solid var(--c-line)",
          borderRadius: 10,
          overflow: "hidden",
        }}>
          <ActivityItem  Icon={IconScore}    title="MakScore — Construtora Norte Sul" meta="Aprovado · 720" tone="ok"      time="08:42"/>
          <ActivityItem  Icon={IconTruck}    title="Frete avulso — Itupeva → SP"      meta="R$ 1.842,00"   tone="info"    time="08:31"/>
          <ActivityItem  Icon={IconProposal} title="Proposta P-2842 atualizada"       meta="Construtora Norte Sul" tone="neutral" time="08:18"/>
          <ActivityItem  Icon={IconScore}    title="MakScore — Engerocha"             meta="Exige análise · 540" tone="warn" time="ontem"/>
          <ActivityItem  Icon={IconHistory}  title="Proposta P-2839 enviada"          meta="PDF · R$ 38.420,00" tone="neutral" time="ontem" last/>
        </div>

        <div style={{ textAlign: "center", padding: "20px 0 8px", fontSize: 11, color: "var(--c-ink-5)", letterSpacing: 0.04 }}>
          Hub de Vendas Makfil · v1.0.0
        </div>
      </div>
    </div>
  );
}

const linkStyle = { fontSize: 12, fontWeight: 600, color: "var(--c-ink-3)", cursor: "pointer", textDecoration: "none" };

function QuickAction({ label, Icon, onClick }) {
  return (
    <button onClick={onClick} style={{
      cursor: "pointer", textAlign: "left",
      padding: "14px 14px",
      background: "var(--c-surface)",
      color: "var(--c-ink)",
      border: "1px solid var(--c-line)",
      borderRadius: 10,
      display: "flex", alignItems: "center", gap: 10,
      minHeight: 60,
    }}>
      <div style={{
        width: 34, height: 34, borderRadius: 8,
        background: "var(--c-neutral-bg)",
        color: "var(--c-ink-2)",
        display: "grid", placeItems: "center", flexShrink: 0,
      }}>
        <Icon size={17} strokeWidth={1.9}/>
      </div>
      <span style={{ fontSize: 13.5, fontWeight: 700, letterSpacing: -0.1, lineHeight: 1.2 }}>{label}</span>
    </button>
  );
}

function SectionHeader({ title, right }) {
  return (
    <div style={{
      padding: "20px 2px 8px",
      display: "flex", alignItems: "center", justifyContent: "space-between",
    }}>
      <div className="label">{title}</div>
      {right}
    </div>
  );
}

function ModuleRow({ title, Icon, admin, internal, status, onClick }) {
  return (
    <button
      onClick={onClick}
      style={{
        textAlign: "left", cursor: "pointer",
        background: "var(--c-surface)",
        border: admin ? "1px solid #1A1C22" : "1px solid var(--c-line)",
        borderRadius: 10,
        padding: "14px 14px",
        display: "flex", alignItems: "center", gap: 12,
        position: "relative",
      }}>
      <div style={{
        width: 42, height: 42, borderRadius: 9,
        background: admin ? "#1A1C22" : "var(--c-neutral-bg)",
        color: admin ? "var(--c-brand)" : "var(--c-ink-2)",
        display: "grid", placeItems: "center",
        flexShrink: 0,
      }}>
        <Icon size={20} strokeWidth={1.7}/>
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          <span style={{ fontSize: 14, fontWeight: 700, color: "var(--c-ink)", letterSpacing: -0.1 }}>{title}</span>
          {admin && <span style={{
            fontSize: 9.5, fontWeight: 800, letterSpacing: 0.1,
            color: "var(--c-brand)", padding: "1px 6px",
            background: "rgba(252,192,10,0.18)", borderRadius: 999,
            display: "inline-flex", alignItems: "center", gap: 4,
          }}><IconLock size={10}/> ADMIN</span>}
          {internal && <span className="badge accent" style={{ padding: "1px 6px", fontSize: 9.5 }}>INTERNO</span>}
        </div>
        {status && (
          <div style={{ marginTop: 4 }}>
            <span className={`badge ${status.tone}`} style={{ fontSize: 10, padding: "1px 6px" }}>
              <span className="dot"/>{status.label}
            </span>
          </div>
        )}
      </div>
      <IconChevron size={16} style={{ color: admin ? "var(--c-ink-5)" : "var(--c-ink-5)" }}/>
    </button>
  );
}

function ActivityItem({ Icon, title, meta, tone = "neutral", time, last }) {
  const tones = {
    ok: "var(--c-ok)", warn: "var(--c-warn)", risk: "var(--c-risk)",
    info: "var(--c-info)", neutral: "var(--c-ink-3)",
  };
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 10,
      padding: "11px 14px",
      borderBottom: last ? "none" : "1px solid var(--c-line-soft)",
    }}>
      <div style={{
        width: 28, height: 28, borderRadius: 7,
        background: "var(--c-neutral-bg)", color: tones[tone],
        display: "grid", placeItems: "center", flexShrink: 0,
      }}><Icon size={15}/></div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12.5, color: "var(--c-ink)", fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{title}</div>
        <div style={{ fontSize: 11, color: tones[tone], fontWeight: 600, marginTop: 1 }}>{meta}</div>
      </div>
      <div style={{ fontSize: 11, color: "var(--c-ink-5)" }}>{time}</div>
    </div>
  );
}

Object.assign(window, { Home });
