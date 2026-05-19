/* global React, IconUser, IconBuilding, IconTruck, IconScale, IconCheck, IconChevron, IconPlus, IconAlert, IconExport, IconRefresh, IconScore */

const { useState: useStateProp } = React;

function Proposta({ onBack }) {
  const steps = [
    { id: "cliente", label: "Cliente", Icon: IconUser },
    { id: "obra",    label: "Obra",    Icon: IconBuilding },
    { id: "itens",   label: "Itens",   Icon: IconScale },
    { id: "frete",   label: "Frete",   Icon: IconTruck },
    { id: "resumo",  label: "Resumo",  Icon: IconCheck },
  ];
  const [active, setActive] = useStateProp("itens");

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", background: "var(--c-bg)" }}>
      <ModuleHeader
        title="Proposta P-2842"
        subtitle="Construtora Norte Sul — Marginal Tietê L4"
        onBack={onBack}
        right={<span className="badge brand"><span className="dot"/>RASCUNHO</span>}
      />

      {/* Stepper */}
      <div style={{ background: "var(--c-surface)", borderBottom: "1px solid var(--c-line)", padding: "10px 8px 12px", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 0, padding: "0 6px" }}>
          {steps.map((s, i) => {
            const idx = steps.findIndex((x) => x.id === active);
            const state = i < idx ? "done" : i === idx ? "active" : "pending";
            return (
              <React.Fragment key={s.id}>
                <button
                  onClick={() => setActive(s.id)}
                  style={{
                    flex: 1, background: "transparent", border: "none", cursor: "pointer",
                    display: "flex", flexDirection: "column", alignItems: "center", gap: 4, padding: 0,
                  }}>
                  <div style={{
                    width: 30, height: 30, borderRadius: 15,
                    background: state === "done" ? "var(--c-ink)" : state === "active" ? "var(--c-brand)" : "#fff",
                    color: state === "done" ? "#fff" : state === "active" ? "var(--c-brand-ink)" : "var(--c-ink-4)",
                    border: state === "pending" ? "1.5px solid var(--c-line-strong)" : state === "active" ? "none" : "none",
                    boxShadow: state === "active" ? "0 0 0 4px rgba(252,192,10,0.22)" : "none",
                    display: "grid", placeItems: "center",
                    fontSize: 12, fontWeight: 800,
                  }}>
                    {state === "done" ? <IconCheck size={14} strokeWidth={2.6}/> : i + 1}
                  </div>
                  <div style={{
                    fontSize: 10.5, fontWeight: state === "active" ? 700 : 600,
                    color: state === "active" ? "var(--c-ink)" : state === "done" ? "var(--c-ink-2)" : "var(--c-ink-4)",
                  }}>{s.label}</div>
                </button>
                {i < steps.length - 1 && (
                  <div style={{
                    height: 2, flex: 0.5,
                    background: i < idx ? "var(--c-ink)" : "var(--c-line)",
                    marginTop: -16,
                  }}/>
                )}
              </React.Fragment>
            );
          })}
        </div>
      </div>

      {/* Content per step */}
      <div style={{ flex: 1, overflowY: "auto" }} className="scroll">
        {active === "cliente" && <ClienteStep/>}
        {active === "obra"    && <ObraStep/>}
        {active === "itens"   && <ItensStep/>}
        {active === "frete"   && <FretePropStep/>}
        {active === "resumo"  && <ResumoStep/>}
      </div>

      {/* Sticky footer with totals + advance */}
      <StickyFooter active={active} onPrev={() => {
        const i = steps.findIndex((x) => x.id === active);
        if (i > 0) setActive(steps[i - 1].id);
      }} onNext={() => {
        const i = steps.findIndex((x) => x.id === active);
        if (i < steps.length - 1) setActive(steps[i + 1].id);
      }}/>
    </div>
  );
}

function ClienteStep() {
  return (
    <div style={{ padding: 14, display: "flex", flexDirection: "column", gap: 12 }}>
      <SectionTitle title="Dados do cliente" hint="Obrigatórios para PDF final"/>
      <div className="surface" style={{ padding: 14, display: "flex", flexDirection: "column", gap: 10 }}>
        <div className="field">
          <label>Razão social</label>
          <input className="input" defaultValue="Construtora Norte Sul Ltda"/>
        </div>
        <div className="field">
          <label>CNPJ</label>
          <input className="input mono tnum" defaultValue="12.345.678/0001-99"/>
          <div className="hint" style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <IconScore size={11}/> MakScore: <strong style={{ color: "var(--c-ok)" }}>aprovado · 720</strong>
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <div className="field">
            <label>Solicitante</label>
            <input className="input" defaultValue="Marcelo Tavares"/>
          </div>
          <div className="field">
            <label>Telefone</label>
            <input className="input tnum" defaultValue="(11) 9 8431-2207"/>
          </div>
        </div>
        <div className="field">
          <label>E-mail</label>
          <input className="input" defaultValue="marcelo.tavares@nortesul.com.br"/>
        </div>
      </div>
    </div>
  );
}

function ObraStep() {
  return (
    <div style={{ padding: 14, display: "flex", flexDirection: "column", gap: 12 }}>
      <SectionTitle title="Obra"/>
      <div className="surface" style={{ padding: 14, display: "flex", flexDirection: "column", gap: 10 }}>
        <div className="field">
          <label>Identificação</label>
          <input className="input" defaultValue="Marginal Tietê — Lote 4"/>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <div className="field">
            <label>CEP</label>
            <input className="input tnum" defaultValue="03318-000"/>
          </div>
          <div className="field">
            <label>UF</label>
            <select className="select" defaultValue="SP"><option>SP</option><option>MG</option><option>PR</option></select>
          </div>
        </div>
        <div className="field">
          <label>Cidade</label>
          <input className="input" defaultValue="São Paulo"/>
        </div>
        <div className="field">
          <label>Endereço/referência</label>
          <input className="input" defaultValue="Marginal Tietê, próx. Ponte do Limão"/>
        </div>
        <div className="field">
          <label>CD de origem</label>
          <select className="select" defaultValue="ITUPEVA">
            <option value="ITUPEVA">CD Itupeva — SP</option>
            <option value="BETIM">CD Betim — MG</option>
            <option value="CURITIBA">CD Curitiba — PR</option>
          </select>
        </div>
      </div>
    </div>
  );
}

function ItensStep() {
  const items = [
    { sku: "PLT-2X1", name: "Plataforma 2,0 × 1,0 m", cat: "Plataforma", qty: 12, dias: 30, val: 4320 },
    { sku: "PLT-1X1", name: "Plataforma 1,0 × 1,0 m", cat: "Plataforma", qty: 8, dias: 30, val: 1920 },
    { sku: "EST-T18", name: "Escora metálica T-18", cat: "Estrutura", qty: 24, dias: 30, val: 2640 },
  ];
  return (
    <div style={{ padding: 14, display: "flex", flexDirection: "column", gap: 12 }}>
      <SectionTitle title="Itens da proposta" right={
        <button className="btn btn-secondary btn-sm"><IconPlus size={13}/> Adicionar</button>
      }/>
      <div className="surface" style={{ overflow: "hidden" }}>
        {items.map((it, i) => (
          <div key={it.sku} style={{
            padding: "12px 14px",
            borderBottom: i < items.length - 1 ? "1px solid var(--c-line-soft)" : "none",
            display: "flex", alignItems: "center", gap: 10,
          }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span className="mono" style={{ fontSize: 10.5, fontWeight: 700, color: "var(--c-ink-3)", background: "var(--c-neutral-bg)", padding: "1px 5px", borderRadius: 3 }}>{it.sku}</span>
                <span className="badge neutral" style={{ fontSize: 10, padding: "1px 6px" }}>{it.cat}</span>
              </div>
              <div style={{ fontSize: 13, fontWeight: 600, color: "var(--c-ink)", marginTop: 4 }}>{it.name}</div>
              <div style={{ fontSize: 11.5, color: "var(--c-ink-4)", marginTop: 2 }}>
                <span className="tnum">{it.qty} un</span> · <span className="tnum">{it.dias} dias</span>
              </div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div className="tnum" style={{ fontSize: 14, fontWeight: 700 }}>R$ {it.val.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}</div>
              <div style={{ fontSize: 10.5, color: "var(--c-ink-4)", marginTop: 2 }}>locação</div>
            </div>
          </div>
        ))}
      </div>

      <div style={{
        background: "var(--c-info-bg)", border: "1px solid var(--c-info-line)",
        color: "var(--c-info)", borderRadius: 8, padding: "10px 12px",
        display: "flex", gap: 8, alignItems: "flex-start",
        fontSize: 12, fontWeight: 500,
      }}>
        <IconAlert size={14} style={{ marginTop: 1 }}/>
        <div>
          Tabela de preços vigente <strong>v.2026-04-22</strong> aplicada · Sisloc.
        </div>
      </div>
    </div>
  );
}

function FretePropStep() {
  return (
    <div style={{ padding: 14, display: "flex", flexDirection: "column", gap: 12 }}>
      <SectionTitle title="Frete" hint="Plataforma · CD Itupeva → São Paulo/SP"/>
      <FreteCalcInner compact/>
    </div>
  );
}

function ResumoStep() {
  return (
    <div style={{ padding: 14, display: "flex", flexDirection: "column", gap: 12 }}>
      <SectionTitle title="Resumo final"/>
      <div className="surface" style={{ padding: 14, display: "flex", flexDirection: "column", gap: 10 }}>
        <KVRow k="Subtotal locação" v="R$ 8.880,00"/>
        <KVRow k="Frete" v="R$ 1.842,00" sub="3 plataformas · CD Itupeva"/>
        <div style={{ height: 1, background: "var(--c-line)" }}/>
        <KVRow k="Total final" v="R$ 10.722,00" big/>
        <div style={{ display: "flex", gap: 6, fontSize: 11.5, color: "var(--c-ink-4)" }}>
          <IconCheck size={13} style={{ color: "var(--c-ok)" }}/> Componentes recalculados pelo backend.
        </div>
      </div>

      <div className="surface" style={{ padding: 14, display: "flex", flexDirection: "column", gap: 10 }}>
        <div className="label">Validações</div>
        <CheckRow ok text="Cliente e obra completos"/>
        <CheckRow ok text="3 itens válidos"/>
        <CheckRow ok text="Frete válido (regra plataforma)"/>
        <CheckRow ok text="Tabela vigente disponível"/>
        <CheckRow info text="MakScore aprovado · 720 (válido 48h)"/>
      </div>

      <button className="btn btn-brand btn-lg btn-block">
        <IconExport size={16}/> Gerar PDF da proposta
      </button>
      <div style={{ fontSize: 11, color: "var(--c-ink-4)", textAlign: "center" }}>
        PDF gerado pelo backend · trilha de auditoria registrada.
      </div>
    </div>
  );
}

function CheckRow({ ok, info, text }) {
  const c = ok ? "var(--c-ok)" : info ? "var(--c-info)" : "var(--c-ink-3)";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, color: "var(--c-ink)" }}>
      <div style={{ width: 18, height: 18, borderRadius: 4, background: "var(--c-neutral-bg)", color: c, display: "grid", placeItems: "center" }}>
        <IconCheck size={12}/>
      </div>
      {text}
    </div>
  );
}

function KVRow({ k, v, sub, big }) {
  return (
    <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
      <div>
        <div style={{ fontSize: big ? 13 : 12.5, color: "var(--c-ink-3)", fontWeight: big ? 700 : 500 }}>{k}</div>
        {sub && <div style={{ fontSize: 11, color: "var(--c-ink-4)", marginTop: 1 }}>{sub}</div>}
      </div>
      <div className="tnum" style={{
        fontSize: big ? 22 : 14, fontWeight: 700,
        color: "var(--c-ink)", letterSpacing: big ? -0.6 : 0,
      }}>{v}</div>
    </div>
  );
}

function SectionTitle({ title, hint, right }) {
  return (
    <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", padding: "0 2px" }}>
      <div>
        <div className="label">{title}</div>
        {hint && <div style={{ fontSize: 11, color: "var(--c-ink-4)", marginTop: 2 }}>{hint}</div>}
      </div>
      {right}
    </div>
  );
}

function StickyFooter({ active, onPrev, onNext }) {
  return (
    <div style={{
      flexShrink: 0,
      borderTop: "1px solid var(--c-line)",
      background: "var(--c-surface)",
      padding: "10px 12px 12px",
      display: "flex", flexDirection: "column", gap: 8,
    }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 4px" }}>
        <div>
          <div style={{ fontSize: 10.5, fontWeight: 700, color: "var(--c-ink-4)", letterSpacing: 0.06, textTransform: "uppercase" }}>Total parcial</div>
          <div className="tnum" style={{ fontSize: 19, fontWeight: 800, letterSpacing: -0.4, color: "var(--c-ink)" }}>
            R$ 10.722,00
          </div>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          {active !== "cliente" && <button onClick={onPrev} className="btn btn-secondary">Voltar</button>}
          <button onClick={onNext} className="btn btn-brand" style={{ minWidth: 130 }}>
            {active === "resumo" ? "Concluir" : "Avançar"} <IconChevron size={14}/>
          </button>
        </div>
      </div>
    </div>
  );
}

// ----- Frete (standalone module) -----
function Frete({ onBack }) {
  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", background: "var(--c-bg)" }}>
      <ModuleHeader title="Calculadora de Frete 2.0" subtitle="Cálculo avulso · independente da proposta" onBack={onBack}
        right={<button className="btn btn-ghost btn-sm"><IconRefresh size={13}/> Limpar</button>}
      />
      <div style={{ flex: 1, overflowY: "auto" }} className="scroll">
        <div style={{ padding: 14, display: "flex", flexDirection: "column", gap: 14 }}>
          <FreteCalcInner/>
          <div>
            <div className="label" style={{ padding: "4px 2px 8px" }}>Cálculos recentes</div>
            <div className="surface" style={{ overflow: "hidden" }}>
              {[
                { rota: "Itupeva → São Paulo/SP", tipo: "3 plataformas", val: "R$ 1.842,00", when: "hoje, 08:31" },
                { rota: "Betim → Contagem/MG", tipo: "Estrutura · 2.450 kg", val: "R$ 1.120,00", when: "ontem" },
                { rota: "Itupeva → Campinas/SP", tipo: "2 plataformas", val: "R$ 980,00", when: "ontem" },
              ].map((h, i, arr) => (
                <div key={i} style={{ padding: "10px 12px", display: "flex", alignItems: "center", gap: 10, borderBottom: i < arr.length - 1 ? "1px solid var(--c-line-soft)" : "none" }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12.5, fontWeight: 600 }}>{h.rota}</div>
                    <div style={{ fontSize: 11, color: "var(--c-ink-4)", marginTop: 2 }}>{h.tipo} · {h.when}</div>
                  </div>
                  <div className="tnum" style={{ fontSize: 13, fontWeight: 700 }}>{h.val}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function FreteCalcInner({ compact }) {
  const [tipo, setTipo] = useStateProp("plataforma");
  const [cliente, setCliente] = useStateProp(false);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* ===== ENTRADA ===== */}
      <FreteSection step="1" title="Entrada" hint="Informe rota, carga e caminhão">
        <div>
          <div className="label" style={{ marginBottom: 6 }}>Tipo de carga</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            <Segmented active={tipo === "plataforma"} onClick={() => setTipo("plataforma")} icon={<IconScale size={14}/>} label="Plataforma" sub="combinação · caminhão"/>
            <Segmented active={tipo === "estrutura"}  onClick={() => setTipo("estrutura")}  icon={<IconScale size={14}/>} label="Estrutura" sub="peso da carga"/>
          </div>
        </div>

        <div className="surface" style={{ padding: 14, display: "flex", flexDirection: "column", gap: 10 }}>
          <div className="field">
            <label>CD de origem</label>
            <select className="select" defaultValue="ITUPEVA">
              <option value="ITUPEVA">CD Itupeva — SP</option>
              <option value="BETIM">CD Betim — MG</option>
              <option value="CURITIBA">CD Curitiba — PR</option>
            </select>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <div className="field">
              <label>CEP destino</label>
              <input className="input tnum" defaultValue="03318-000"/>
            </div>
            <div className="field">
              <label>Cidade/UF</label>
              <input className="input" defaultValue="São Paulo / SP"/>
            </div>
          </div>
        </div>

        <div className="surface" style={{ padding: 14, display: "flex", flexDirection: "column", gap: 10 }}>
          <div className="field">
            <label>Tipo de caminhão</label>
            <select className="select" defaultValue="TOCO">
              <option>3/4</option>
              <option value="TOCO">Toco</option>
              <option>Truck</option>
              <option>Carreta</option>
            </select>
          </div>

          {tipo === "plataforma" ? (
            <div className="field">
              <label>Combinação de plataformas</label>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <ComboLine sku="PLT-2X1" label="Plataforma 2,0 × 1,0 m" qty={2}/>
                <ComboLine sku="PLT-1X1" label="Plataforma 1,0 × 1,0 m" qty={1}/>
                <button className="btn btn-secondary btn-sm" style={{ alignSelf: "flex-start" }}><IconPlus size={12}/> Adicionar modelo</button>
              </div>
            </div>
          ) : (
            <div className="field">
              <label>Peso da carga</label>
              <div className="input-wrap">
                <input className="input tnum" defaultValue="2.450" style={{ paddingRight: 40 }}/>
                <span style={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)", fontSize: 12, color: "var(--c-ink-4)", fontWeight: 600 }}>kg</span>
              </div>
            </div>
          )}

          <label style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 0", cursor: "pointer" }}>
            <input type="checkbox" checked={cliente} onChange={(e) => setCliente(e.target.checked)} style={{ width: 16, height: 16, accentColor: "var(--c-brand)" }}/>
            <span style={{ fontSize: 13, fontWeight: 500 }}>Frete por conta do cliente</span>
          </label>
        </div>
      </FreteSection>

      {/* ===== RESULTADO ===== */}
      <FreteSection step="2" title="Resultado" hint="Valor calculado pelo backend">
        <div style={{
          borderRadius: 12,
          background: "var(--c-ink)", color: "#fff",
          padding: 18, display: "flex", flexDirection: "column", gap: 12,
        }}>
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
            <div>
              <div style={{ fontSize: 10.5, opacity: 0.65, fontWeight: 700, letterSpacing: 0.18 }}>VALOR DO FRETE</div>
              <div className="tnum" style={{ fontSize: 34, fontWeight: 800, letterSpacing: -0.8, marginTop: 2, color: cliente ? "#fff" : "var(--c-brand)" }}>
                {cliente ? "R$ 0,00" : "R$ 1.842,00"}
              </div>
              <div style={{ fontSize: 11.5, opacity: 0.65, marginTop: 2 }}>
                {cliente ? "por conta do cliente · sem cobrança" : "regra plataforma · v.2026-03-18"}
              </div>
            </div>
            <span style={{
              fontSize: 10, fontWeight: 800, letterSpacing: 0.1,
              padding: "4px 9px", borderRadius: 999,
              background: cliente ? "rgba(255,255,255,0.16)" : "rgba(252,192,10,0.18)",
              color: cliente ? "#9AA0AB" : "var(--c-brand)",
              border: cliente ? "1px solid rgba(255,255,255,0.18)" : "1px solid rgba(252,192,10,0.36)",
            }}>{cliente ? "ZERADO" : "VÁLIDO"}</span>
          </div>
        </div>

        {!compact && (
          <button className="btn btn-brand btn-lg btn-block">Reaproveitar na proposta</button>
        )}
      </FreteSection>

      {/* ===== MEMÓRIA (colapsável) ===== */}
      <FreteMemoria items={[
        ["origem", "CD Itupeva (SP)"],
        ["destino", "03318-000 · São Paulo/SP"],
        ["distância", "38,4 km"],
        ["caminhão", "Toco"],
        ["combinação", "2× PLT-2X1 + 1× PLT-1X1"],
        ["km · valor", "R$ 8,40 / km"],
        ["adicional", "R$ 1.520,64"],
      ]}/>
    </div>
  );
}

function FreteSection({ step, title, hint, children }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "0 2px" }}>
        <span style={{
          width: 22, height: 22, borderRadius: 11,
          background: "var(--c-brand)", color: "var(--c-brand-ink)",
          display: "grid", placeItems: "center",
          fontSize: 11, fontWeight: 800,
        }}>{step}</span>
        <div style={{ display: "flex", flexDirection: "column", lineHeight: 1.2 }}>
          <span style={{ fontSize: 13.5, fontWeight: 700, color: "var(--c-ink)", letterSpacing: -0.1 }}>{title}</span>
          {hint && <span style={{ fontSize: 11, color: "var(--c-ink-4)", marginTop: 2 }}>{hint}</span>}
        </div>
      </div>
      {children}
    </div>
  );
}

function FreteMemoria({ items }) {
  return (
    <details className="surface" style={{ padding: 0, overflow: "hidden" }}>
      <summary style={{
        cursor: "pointer", listStyle: "none",
        padding: "12px 14px",
        display: "flex", alignItems: "center", gap: 10,
        fontSize: 12.5, fontWeight: 700, color: "var(--c-ink-2)",
      }}>
        <span style={{
          width: 22, height: 22, borderRadius: 11,
          background: "var(--c-neutral-bg)", color: "var(--c-ink-2)",
          display: "grid", placeItems: "center",
          fontSize: 11, fontWeight: 800,
        }}>3</span>
        <span style={{ flex: 1 }}>Memória do cálculo</span>
        <span style={{ fontSize: 11, color: "var(--c-ink-5)", fontWeight: 600 }}>tocar para abrir</span>
      </summary>
      <div style={{ padding: "4px 14px 14px", borderTop: "1px solid var(--c-line-soft)" }}>
        <div className="mono" style={{ fontSize: 11.5, lineHeight: 1.7, color: "var(--c-ink-2)", paddingTop: 8 }}>
          {items.map(([k, v], i) => (
            <div key={i} style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "2px 0" }}>
              <span style={{ color: "var(--c-ink-4)" }}>{k}</span>
              <span style={{ textAlign: "right", color: "var(--c-ink)" }}>{v}</span>
            </div>
          ))}
        </div>
      </div>
    </details>
  );
}

function Segmented({ active, onClick, icon, label, sub }) {
  return (
    <button onClick={onClick} style={{
      cursor: "pointer", textAlign: "left",
      padding: "10px 12px",
      background: active ? "var(--c-ink)" : "var(--c-surface)",
      color: active ? "#fff" : "var(--c-ink)",
      border: `1px solid ${active ? "var(--c-ink)" : "var(--c-line-strong)"}`,
      borderRadius: 8,
      display: "flex", flexDirection: "column", gap: 2,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, fontWeight: 700, fontSize: 13 }}>{icon}{label}</div>
      <span style={{ fontSize: 11, opacity: active ? 0.75 : 1, color: active ? "rgba(255,255,255,0.78)" : "var(--c-ink-4)" }}>{sub}</span>
    </button>
  );
}

function ComboLine({ sku, label, qty }) {
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 8,
      padding: "8px 10px",
      background: "var(--c-surface-2)",
      border: "1px solid var(--c-line)",
      borderRadius: 6,
    }}>
      <span className="mono" style={{ fontSize: 10.5, fontWeight: 700, color: "var(--c-ink-3)" }}>{sku}</span>
      <span style={{ fontSize: 12.5, flex: 1 }}>{label}</span>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <button style={qBtn}>−</button>
        <span className="tnum" style={{ fontWeight: 700, minWidth: 18, textAlign: "center" }}>{qty}</span>
        <button style={qBtn}>+</button>
      </div>
    </div>
  );
}
const qBtn = {
  width: 24, height: 24, borderRadius: 4,
  border: "1px solid var(--c-line-strong)", background: "#fff",
  display: "grid", placeItems: "center", cursor: "pointer", fontSize: 14, lineHeight: 1, color: "var(--c-ink-2)",
};

Object.assign(window, { Proposta, Frete });
