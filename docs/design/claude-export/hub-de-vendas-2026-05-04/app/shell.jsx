/* global React, IconHome, IconProposal, IconTruck, IconScore, IconTable, IconAdmin, IconWifi */

const { useState, useEffect, useRef } = React;

// ----- Status bar (faux iOS, in mobile frame) -----
function StatusBar({ tone = "light" }) {
  const fg = tone === "dark" ? "#fff" : "#0E1116";
  return (
    <div style={{
      height: 44, padding: "0 22px",
      display: "flex", alignItems: "center", justifyContent: "space-between",
      color: fg, fontSize: 14, fontWeight: 600, letterSpacing: 0.2,
      flexShrink: 0
    }}>
      <span>9:41</span>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <svg width="18" height="11" viewBox="0 0 18 11" fill="none" aria-hidden>
          <rect x="0.5" y="6" width="2.5" height="4.5" rx="0.5" fill={fg} />
          <rect x="4.5" y="4" width="2.5" height="6.5" rx="0.5" fill={fg} />
          <rect x="8.5" y="2" width="2.5" height="8.5" rx="0.5" fill={fg} />
          <rect x="12.5" y="0" width="2.5" height="10.5" rx="0.5" fill={fg} />
        </svg>
        <svg width="16" height="11" viewBox="0 0 16 11" fill="none" aria-hidden>
          <path d="M8 2c2.4 0 4.6.9 6.4 2.4l-1 1.2A7.5 7.5 0 0 0 8 3.7a7.5 7.5 0 0 0-5.4 1.9l-1-1.2A9.5 9.5 0 0 1 8 2z" fill={fg} />
          <path d="M8 5.5c1.6 0 3 .6 4.1 1.6l-1 1.2A4.5 4.5 0 0 0 8 7c-1.2 0-2.3.4-3.1 1.3l-1-1.2A6 6 0 0 1 8 5.5z" fill={fg} />
          <circle cx="8" cy="9.5" r="1.2" fill={fg} />
        </svg>
        <svg width="26" height="12" viewBox="0 0 26 12" fill="none" aria-hidden>
          <rect x="0.5" y="0.5" width="22" height="11" rx="2.5" stroke={fg} fill="none" />
          <rect x="2" y="2" width="18" height="8" rx="1.5" fill={fg} />
          <rect x="23" y="4" width="2" height="4" rx="0.5" fill={fg} />
        </svg>
      </div>
    </div>);

}

// ----- Top app header (per-module) -----
function ModuleHeader({ title, subtitle, onBack, right, sticky = true, env = "homologação" }) {
  return (
    <div style={{
      position: sticky ? "sticky" : "static",
      top: 0, zIndex: 5,
      background: "var(--c-surface)",
      borderBottom: "1px solid var(--c-line)",
      flexShrink: 0
    }}>
      <div style={{ padding: "10px 14px 12px", display: "flex", alignItems: "center", gap: 10 }}>
        {onBack &&
        <button onClick={onBack} aria-label="voltar"
        style={{
          width: 36, height: 36, borderRadius: 8,
          border: "1px solid var(--c-line-strong)",
          background: "#fff", display: "grid", placeItems: "center",
          cursor: "pointer", flexShrink: 0
        }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M15 5l-7 7 7 7" /></svg>
          </button>
        }
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: "var(--c-ink)", letterSpacing: -0.1 }}>{title}</div>
          {subtitle &&
          <div style={{ fontSize: 12, color: "var(--c-ink-4)", marginTop: 1 }}>{subtitle}</div>
          }
        </div>
        {right}
      </div>
    </div>);

}

// ----- Brand mark (wordmark) -----
function BrandMark({ compact = false }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <div style={{
        width: 28, height: 28, borderRadius: 7,
        background: "var(--c-brand)",
        display: "grid", placeItems: "center",
        color: "var(--c-brand-ink)", fontWeight: 900, fontSize: 14, letterSpacing: 0.4,
        boxShadow: "inset 0 -2px 0 rgba(0,0,0,0.16)"
      }}>M</div>
      {!compact &&
      <div style={{ display: "flex", flexDirection: "column", lineHeight: 1 }}>
          <span style={{ fontSize: 13, fontWeight: 700, letterSpacing: -0.1, color: "var(--c-ink)" }}>Hub de Vendas</span>
          <span style={{ fontSize: 10, color: "var(--c-ink-4)", marginTop: 2, letterSpacing: 0.04, fontWeight: 600, textTransform: "uppercase" }}>Makfil · v1.0</span>
        </div>
      }
    </div>);

}

// ----- Bottom nav -----
function BottomNav({ active, onChange, isAdmin }) {
  const items = [
  { id: "home", label: "Hub", Icon: IconHome },
  { id: "proposta", label: "Proposta", Icon: IconProposal },
  { id: "frete", label: "Frete", Icon: IconTruck },
  { id: "score", label: "MakScore", Icon: IconScore },
  { id: "tabela", label: "Preços", Icon: IconTable }];

  return (
    <nav style={{
      flexShrink: 0,
      borderTop: "1px solid var(--c-line)",
      background: "rgba(255,255,255,0.96)",
      backdropFilter: "saturate(140%) blur(8px)",
      WebkitBackdropFilter: "saturate(140%) blur(8px)",
      display: "grid",
      gridTemplateColumns: `repeat(${items.length}, 1fr)`,
      paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 6px)",
      paddingTop: 6
    }}>
      {items.map(({ id, label, Icon }) => {
        const on = active === id;
        return (
          <button
            key={id}
            onClick={() => onChange(id)}
            style={{
              background: "transparent", border: "none",
              display: "flex", flexDirection: "column", alignItems: "center", gap: 3,
              padding: "6px 0",
              color: on ? "var(--c-ink)" : "var(--c-ink-4)",
              cursor: "pointer",
              position: "relative"
            }}>
            {on &&
            <span style={{
              position: "absolute", top: -6, left: "50%", transform: "translateX(-50%)",
              width: 30, height: 3, background: "var(--c-brand)", borderRadius: 2
            }} />
            }
            <Icon size={20} strokeWidth={on ? 2 : 1.6} />
            <span style={{ fontSize: 10.5, fontWeight: on ? 700 : 600, letterSpacing: 0.02, color: on ? "var(--c-ink)" : "var(--c-ink-4)" }}>{label}</span>
          </button>);

      })}
    </nav>);

}

// ----- Toast / connectivity strip -----
function ConnBanner({ state }) {
  if (state === "online") return null;
  const map = {
    weak: { bg: "var(--c-warn-bg)", color: "var(--c-warn)", text: "Conexão instável — rascunho preservado localmente." },
    offline: { bg: "var(--c-risk-bg)", color: "var(--c-risk)", text: "Sem conexão — algumas ações estão indisponíveis." }
  }[state];
  return (
    <div style={{
      background: map.bg, color: map.color,
      padding: "6px 14px", fontSize: 12, fontWeight: 600,
      borderBottom: "1px solid currentColor",
      display: "flex", alignItems: "center", gap: 8, flexShrink: 0
    }}>
      <IconWifi size={14} />
      <span>{map.text}</span>
    </div>);

}

Object.assign(window, { StatusBar, ModuleHeader, BrandMark, BottomNav, ConnBanner });