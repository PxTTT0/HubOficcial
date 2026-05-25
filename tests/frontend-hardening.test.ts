import { test } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";

const ENV_KEYS = [
  "NODE_ENV", "DATABASE_URL", "REDIS_URL", "AUDIT_LOG_PATH",
  "MAKSCORE_EPOSI_MODE", "AUTH_SESSION_SECRET", "AUTH_SECURE_COOKIES",
  "AUTH_MFA_REQUIRED_ROLES", "AUTH_SESSION_BIND_IP_ROLES",
];
function snapshot() { return Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]])); }
function restore(s: Record<string, string | undefined>) {
  for (const k of ENV_KEYS) { if (s[k] === undefined) delete process.env[k]; else process.env[k] = s[k]!; }
}

async function startServer() {
  const env: Record<string, string> = {
    NODE_ENV: "test",
    DATABASE_URL: "",
    REDIS_URL: "",
    AUDIT_LOG_PATH: "",
    MAKSCORE_EPOSI_MODE: "mock",
    AUTH_SESSION_SECRET: "frontend-hardening-secret",
    AUTH_SECURE_COOKIES: "false",
    AUTH_MFA_REQUIRED_ROLES: "",
    AUTH_SESSION_BIND_IP_ROLES: "",
  };
  for (const [k, v] of Object.entries(env)) process.env[k] = v;
  const { buildApp } = await import("../src/server");
  const { app } = buildApp();
  const server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("porta indisponivel");
  return { base: `http://127.0.0.1:${addr.port}`, close: () => new Promise<void>((r, j) => server.close((e) => (e ? j(e) : r()))) };
}

test("CSP nao permite unsafe-inline e trava script/style em 'self'", { concurrency: false }, async () => {
  const snap = snapshot();
  const server = await startServer();
  try {
    const res = await fetch(`${server.base}/healthz`);
    const csp = res.headers.get("content-security-policy") || "";
    assert.ok(csp.length > 0, "CSP presente");
    assert.ok(!csp.includes("unsafe-inline"), "CSP nao pode ter unsafe-inline");
    assert.match(csp, /script-src 'self'/);
    assert.match(csp, /style-src 'self'/);
  } finally {
    restore(snap);
    await server.close();
  }
});

test("assets externos servidos: app.js e app.css", { concurrency: false }, async () => {
  const snap = snapshot();
  const server = await startServer();
  try {
    const js = await fetch(`${server.base}/makscore/app.js`);
    assert.equal(js.status, 200);
    const jsBody = await js.text();
    assert.match(jsBody, /function esc\(/, "helper de escape presente");
    // UX: gauges + stepper presentes
    assert.match(jsBody, /renderGaugeInto/, "render de gauge presente");
    assert.match(jsBody, /qSections/, "stepper do questionario presente");
    // gauge dinamico via CSSOM (CSP-safe), nunca setAttribute('style')/cssText
    assert.match(jsBody, /setProperty\("--v"/, "gauge usa CSSOM setProperty");
    assert.ok(!/setAttribute\(\s*["']style["']/.test(jsBody), "sem setAttribute('style')");
    assert.ok(!/\.style\.cssText/.test(jsBody), "sem style.cssText");

    const css = await fetch(`${server.base}/makscore/app.css`);
    assert.equal(css.status, 200);
    const cssBody = await css.text();
    assert.match(cssBody, /\.gauge\b/, "estilos de gauge presentes");
    assert.match(cssBody, /\.q-step\b/, "estilos de stepper presentes");
  } finally {
    restore(snap);
    await server.close();
  }
});

test("index.html nao tem JS/CSS inline nem style= (compativel com CSP estrita)", { concurrency: false }, async () => {
  const snap = snapshot();
  const server = await startServer();
  try {
    const res = await fetch(`${server.base}/makscore/`);
    assert.equal(res.status, 200);
    const html = await res.text();
    // referencia os assets externos
    assert.match(html, /<link[^>]+href="\/makscore\/app\.css"/);
    assert.match(html, /<script[^>]+src="\/makscore\/app\.js"/);
    // nenhum <script> sem src (inline)
    assert.ok(!/<script(?![^>]*\bsrc=)[^>]*>/.test(html), "sem <script> inline");
    // nenhum bloco <style>
    assert.ok(!/<style[\s>]/.test(html), "sem <style> inline");
    // nenhum atributo style=
    assert.ok(!/\sstyle=/.test(html), "sem atributo style= inline");
  } finally {
    restore(snap);
    await server.close();
  }
});
