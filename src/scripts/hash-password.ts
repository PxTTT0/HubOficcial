import { hashPassword } from "../security";

async function main() {
  const password = process.argv[2];
  if (!password || password.length < 8) {
    // eslint-disable-next-line no-console
    console.error("Uso: npm run auth:hash -- <senha-com-8+-chars>");
    process.exitCode = 1;
    return;
  }
  const hash = await hashPassword(password);
  // eslint-disable-next-line no-console
  console.log(hash);
}

void main();
