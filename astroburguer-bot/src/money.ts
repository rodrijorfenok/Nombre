const fmt = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 0 });

/** $12.800 */
export function pesos(n: number): string {
  return `$${fmt.format(Math.round(n))}`;
}

export function normalizar(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}
