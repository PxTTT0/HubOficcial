// Runner minimalista para os testes em tests/**/*.test.ts.
// Registra ts-node e carrega os arquivos; o `node:test` (importado pelos
// proprios testes) processa as suites e marca o exit code automaticamente.
"use strict";

const path = require("path");
const fs = require("fs");

require("ts-node").register({
  transpileOnly: true,
  compilerOptions: { module: "commonjs" },
});

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(p, out);
    else if (entry.isFile() && /\.test\.ts$/i.test(entry.name)) out.push(p);
  }
  return out;
}

const root = __dirname;
if (fs.existsSync(root)) {
  for (const f of walk(root)) require(f);
}
