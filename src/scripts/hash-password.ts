import { hashPassword, validatePasswordPolicy } from "../security";

async function main() {
  const password = process.argv[2];
  if (!password) {
    // eslint-disable-next-line no-console
    console.error("Uso: npm run auth:hash -- <senha-forte>");
    process.exitCode = 1;
    return;
  }
  const policy = validatePasswordPolicy(password);
  if (!policy.ok) {
    // eslint-disable-next-line no-console
    console.error(`Senha recusada:\n- ${policy.errors.join("\n- ")}`);
    process.exitCode = 1;
    return;
  }
  const hash = await hashPassword(password);
  // eslint-disable-next-line no-console
  console.log(hash);
}

void main();
