/* global React, IconSearch, IconFilter, IconHistory, IconLock, IconAlert, IconCheck, IconChevron, IconRefresh, IconClock */

const { useState: useStateRest } = React;

// ----- Tabela de Preços -----
function Tabela({ onBack }) {
  const [q, setQ] = useStateRest("");
  const rows = [
    { sku: "PLT-2X1", name: "Plataforma 2,0 × 1,0 m", cat: "Plataforma", val: 12.00, un: "un/dia", st: "vigente" },
    { sku: "PLT-1X1", name: "Plataforma 1,0 × 1,0 m", cat: "Plataforma", val: 8.00,  un: "un/dia", st: "vigente" },
    { sku: "PLT-15X1",name: "Plataforma 1,5 × 1,0 m", cat: "Plataforma", val: 10.00, un: "un/dia", st: "vigente" },
    { sku: "EST-T18", name: "Escora metálica T-18",   cat: "Estrutura",  val: 3.66,  un: "un/dia", st: "vigente" },
    { sku: "EST-T22", name: "Escora metálica T-22",   cat: "Estrutura",  val: 4.40,  un: "un/dia", st: "vigente" },
    { sku: "PCO-S60", name: "Painel concretagem S-60",cat: "Estrutura",  val: 6.20,  un: "un/dia", st: "vigente" },
    { sku: "ACC-PRA", name: "Pranchão acabamento",    cat: "Acessório",  val: 2.10,  un: "un/dia", st: "vigente" },
    { sku: "ACC-GAR", name: "Garra de fixação",       cat: "Acessório",  val: 0.90,  un: "un/dia", st: "vigente" },
  ];
  const filtered = rows.filter((r) => !q || r.name.toLowerCase().includes(q.toLowerCase()) || r.sku.toLowerCase().includes(q.toLowerCase()));

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", background: "var(--c-bg)" }}>
      <ModuleHeader title="Tabela de Preços" subtitle="Versão vigente · v.2026-04-22" onBack={onBack}/>

      {/* Banner vigência */}
      <div style={{
        padding: "10px 14px",
        background: "var(--c-surface)",
        borderBottom: "1px solid var(--c-line)",
        display: "flex", alignItems: "center", gap: 10,
        flexShrink: 0,
      }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12, color: "var(--c-ink-4)", fontWeight: 600 }}>Vigente desde 22/04/2026</div>
          <div style={{ fontSize: 13, fontWeight: 700, color: "var(--c-ink)", marginTop: 1 }}>v.2026-04-22 · Sisloc/import</div>
        </div>
        <span className="badge ok"><span className="dot"/>VIGENTE</span>
      </div>

      {/* Search */}
      <div style={{ padding: "12px 14px", background: "var(--c-surface)", borderBottom: "1px solid var(--c-line)", flexShrink: 0 }}>
        <div className="input-wrap">
          <span className="prefix"><IconSearch size={14}/></span>
          <input className="input with-prefix" placeholder="Buscar por SKU ou produto" value={q} onChange={(e) => setQ(e.target.value)}/>
        </div>
        <div style={{ display: "flex", gap: 6, marginTop: 10, overflowX: "auto" }} className="scroll">
          {["Todos", "Plataforma", "Estrutura", "Acessório"].map((c, i) => (
            <button key={c} style={{
              padding: "6px 12px", borderRadius: 999,
              border: "1px solid var(--c-line-strong)",
              background: i === 0 ? "var(--c-ink)" : "#fff",
              color: i === 0 ? "#fff" : "var(--c-ink-3)",
              fontSize: 12, fontWeight: 600, whiteSpace: "nowrap", cursor: "pointer",
            }}>{c}</button>
          ))}
        </div>
      </div>

      <div style={{ flex: 1, overflowY: "auto" }} className="scroll">
        <div style={{ padding: "0 14px 14px" }}>
          <div className="surface" style={{ marginTop: 12, overflow: "hidden" }}>
            {filtered.map((r, i) => (
              <div key={r.sku} style={{
                padding: "12px 14px",
                display: "flex", alignItems: "center", gap: 10,
                borderBottom: i < filtered.length - 1 ? "1px solid var(--c-line-soft)" : "none",
              }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span className="mono" style={{ fontSize: 10.5, fontWeight: 700, color: "var(--c-ink-3)", background: "var(--c-neutral-bg)", padding: "1px 5px", borderRadius: 3 }}>{r.sku}</span>
                    <span className="badge neutral" style={{ fontSize: 10, padding: "1px 6px" }}>{r.cat}</span>
                  </div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "var(--c-ink)", marginTop: 4 }}>{r.name}</div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div className="tnum" style={{ fontSize: 14, fontWeight: 700 }}>R$ {r.val.toFixed(2).replace(".", ",")}</div>
                  <div style={{ fontSize: 10.5, color: "var(--c-ink-4)" }}>{r.un}</div>
                </div>
              </div>
            ))}
            {filtered.length === 0 && (
              <div style={{ padding: 28, textAlign: "center", color: "var(--c-ink-4)", fontSize: 13 }}>Nenhum item encontrado.</div>
            )}
          </div>

          <div style={{ marginTop: 12, fontSize: 11, color: "var(--c-ink-5)", textAlign: "center" }}>
            Importação registrada · operação somente leitura
          </div>
        </div>
      </div>
    </div>
  );
}

// ----- Configurações Logísticas (admin) -----
function Admin({ onBack }) {
  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", background: "var(--c-bg)" }}>
      <ModuleHeader
        title="Configurações Logísticas"
        subtitle="Área administrativa · sensível"
        onBack={onBack}
        right={<span className="badge brand"><IconLock size={11}/>ADMIN</span>}
      />

      {/* Sensitive area banner */}
      <div style={{
        background: "var(--c-brand-50)",
        borderBottom: "1px solid var(--c-brand-100)",
        color: "var(--c-brand-700)",
        padding: "10px 14px",
        fontSize: 12, fontWeight: 600,
        display: "flex", alignItems: "flex-start", gap: 8,
        flexShrink: 0,
      }}>
        <IconAlert size={14} style={{ marginTop: 1 }}/>
        <div>
          Alterações afetam cálculo de frete em produção. Ações são auditadas e exigem motivo.
        </div>
      </div>

      <div style={{ flex: 1, overflowY: "auto" }} className="scroll">
        <div style={{ padding: 14, display: "flex", flexDirection: "column", gap: 14 }}>
          {/* Versão */}
          <div className="surface" style={{ padding: 14 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
              <div>
                <div className="label">Versão atual</div>
                <div style={{ fontSize: 18, fontWeight: 700, marginTop: 4, letterSpacing: -0.2 }}>v.2026-03-18</div>
              </div>
              <span className="badge ok"><span className="dot"/>VIGENTE</span>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <Stat2 k="Rascunho aberto" v="v.2026-05-04" tone="warn"/>
              <Stat2 k="Conflito" v="Nenhum" tone="ok"/>
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
              <button className="btn btn-secondary" style={{ flex: 1 }}>Editar rascunho</button>
              <button className="btn btn-brand" style={{ flex: 1 }}>Publicar</button>
            </div>
          </div>

          {/* Parâmetros por CD */}
          <div>
            <div className="label" style={{ padding: "0 4px 8px" }}>Parâmetros por CD</div>
            <div className="surface" style={{ overflow: "hidden" }}>
              {[
                { cd: "CD Itupeva — SP",   km: "8,40",  trucks: "3/4 · Toco · Truck · Carreta", st: "ok" },
                { cd: "CD Betim — MG",     km: "9,20",  trucks: "Toco · Truck · Carreta",        st: "ok" },
                { cd: "CD Curitiba — PR",  km: "8,80",  trucks: "Toco · Truck",                   st: "warn" },
              ].map((c, i) => (
                <div key={c.cd} style={{
                  padding: "12px 14px",
                  display: "flex", alignItems: "center", gap: 10,
                  borderBottom: i < 2 ? "1px solid var(--c-line-soft)" : "none",
                }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: "var(--c-ink)" }}>{c.cd}</div>
                    <div style={{ fontSize: 11.5, color: "var(--c-ink-4)", marginTop: 2 }}>{c.trucks}</div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div className="tnum" style={{ fontSize: 14, fontWeight: 700 }}>R$ {c.km}</div>
                    <div style={{ fontSize: 10.5, color: "var(--c-ink-4)" }}>por km</div>
                  </div>
                  <span className={`badge ${c.st}`} style={{ marginLeft: 4 }}><span className="dot"/>{c.st === "ok" ? "OK" : "Revisar"}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Regras */}
          <div>
            <div className="label" style={{ padding: "0 4px 8px" }}>Regras</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <RuleCard title="Combinação plataformas" count="14" tone="neutral"/>
              <RuleCard title="Faixas de peso · estrutura" count="6" tone="neutral"/>
              <RuleCard title="Frete por conta cliente" count="ativo" tone="ok"/>
              <RuleCard title="Promoção sazonal" count="inativa" tone="neutral"/>
            </div>
          </div>

          {/* Auditoria */}
          <div>
            <div className="label" style={{ padding: "0 4px 8px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span>Histórico & auditoria</span>
              <a style={{ fontSize: 11, color: "var(--c-ink-3)", fontWeight: 600 }}>Ver tudo</a>
            </div>
            <div className="surface" style={{ overflow: "hidden" }}>
              <Audit when="hoje · 09:12" who="A. Souza" act="Editou rascunho v.2026-05-04" tone="info"/>
              <Audit when="22/04 · 14:08" who="L. Reis" act="Publicou v.2026-04-22" tone="ok"/>
              <Audit when="18/03 · 11:30" who="L. Reis" act="Rollback de v.2026-03-22 → v.2026-03-18" tone="warn"/>
              <Audit when="14/03 · 16:42" who="A. Souza" act="Criou v.2026-03-22 (rascunho)" tone="neutral" last/>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Stat2({ k, v, tone }) {
  const c = tone === "ok" ? "var(--c-ok)" : tone === "warn" ? "var(--c-warn)" : "var(--c-ink-3)";
  return (
    <div style={{ background: "var(--c-surface-2)", border: "1px solid var(--c-line)", borderRadius: 8, padding: 10 }}>
      <div className="label" style={{ fontSize: 9.5 }}>{k}</div>
      <div style={{ fontSize: 13, fontWeight: 700, color: c, marginTop: 2 }}>{v}</div>
    </div>
  );
}

function RuleCard({ title, count, tone }) {
  const c = tone === "ok" ? "var(--c-ok)" : "var(--c-ink-3)";
  return (
    <div style={{
      background: "var(--c-surface)",
      border: "1px solid var(--c-line)",
      borderRadius: 8, padding: 12,
    }}>
      <div style={{ fontSize: 12, color: "var(--c-ink-4)", fontWeight: 600 }}>{title}</div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 6 }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: c }}>{count}</div>
        <IconChevron size={14} style={{ color: "var(--c-ink-5)" }}/>
      </div>
    </div>
  );
}

function Audit({ when, who, act, tone, last }) {
  const c = { ok: "var(--c-ok)", warn: "var(--c-warn)", info: "var(--c-info)", neutral: "var(--c-ink-3)" }[tone];
  return (
    <div style={{
      padding: "10px 14px",
      borderBottom: last ? "none" : "1px solid var(--c-line-soft)",
      display: "flex", alignItems: "flex-start", gap: 10,
    }}>
      <div style={{ width: 8, height: 8, borderRadius: 4, background: c, marginTop: 6, flexShrink: 0 }}/>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12.5, fontWeight: 600, color: "var(--c-ink)" }}>{act}</div>
        <div style={{ fontSize: 11, color: "var(--c-ink-4)", marginTop: 2 }}>{who} · {when}</div>
      </div>
    </div>
  );
}

Object.assign(window, { Tabela, Admin });
