export function onlyDigits(input: string): string {
  return (input ?? "").replace(/\D+/g, "");
}

export function isValidCnpj(input: string): boolean {
  const cnpj = onlyDigits(input);
  if (cnpj.length !== 14) return false;
  if (/^(\d)\1{13}$/.test(cnpj)) return false;

  const calc = (base: string, weights: number[]): number => {
    const sum = base
      .split("")
      .reduce((acc, ch, i) => acc + Number(ch) * weights[i], 0);
    const mod = sum % 11;
    return mod < 2 ? 0 : 11 - mod;
  };

  const w1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const w2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];

  const d1 = calc(cnpj.slice(0, 12), w1);
  const d2 = calc(cnpj.slice(0, 12) + d1, w2);
  return d1 === Number(cnpj[12]) && d2 === Number(cnpj[13]);
}

export function maskCnpjForLog(input: string): string {
  const cnpj = onlyDigits(input);
  if (cnpj.length !== 14) return "***";
  return `${cnpj.slice(0, 2)}.***.***/****-${cnpj.slice(12, 14)}`;
}

export function maskCnpjForDisplay(input: string): string {
  const cnpj = onlyDigits(input);
  if (cnpj.length !== 14) return input;
  return `${cnpj.slice(0, 2)}.${cnpj.slice(2, 5)}.${cnpj.slice(5, 8)}/${cnpj.slice(8, 12)}-${cnpj.slice(12, 14)}`;
}
