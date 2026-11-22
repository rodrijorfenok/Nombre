/**
 * Números de WhatsApp de Argentina.
 * Los celulares llegan por la API como 549 + área + número (ej. 5491136397582), pero a veces Meta
 * los tiene registrados sin el 9 (541136397582): pasa con el número de prueba y su lista de destinatarios.
 */

/** Pasa cualquier forma ("11 3639-7582", "+54 9 11 3639 7582", "01136397582") a 549 + área + número. */
export function normalizarTelefono(entrada: string, paisPorDefecto = "54"): string {
  let d = entrada.replace(/\D/g, "");
  if (paisPorDefecto !== "54") return d;
  if (d.startsWith("00")) d = d.slice(2);
  if (d.startsWith("0")) d = d.slice(1); // 011 3639 7582
  if (d.length === 10) d = `549${d}`; // 11 3639 7582 (área + número)
  if (d.startsWith("54") && !d.startsWith("549") && d.length === 12) d = `549${d.slice(2)}`;
  // 549 11 15 3639 7582: sacar el 15 de los celulares escritos a la antigua
  if (d.startsWith("549") && d.length === 15) {
    const resto = d.slice(3);
    for (const largoArea of [2, 3, 4]) {
      if (resto.slice(largoArea, largoArea + 2) === "15") return `549${resto.slice(0, largoArea)}${resto.slice(largoArea + 2)}`;
    }
  }
  return d;
}

/**
 * Otras formas en que Meta puede tener registrado el mismo celular argentino, en orden de prueba.
 * La lista de destinatarios del número de prueba suele aceptar solo 54 + área + 15 + número
 * (ej. 54111536397582), aunque el mensaje entrante llegue como 5491136397582.
 */
export function variantesAR(tel: string): string[] {
  let local: string | null = null; // área + número, 10 dígitos
  if (tel.startsWith("549") && tel.length === 13) local = tel.slice(3);
  else if (tel.startsWith("54") && tel.length === 12) local = tel.slice(2);
  if (!local) return [];
  const formas = [`549${local}`, `54${local}`];
  // con el 15 después del código de área (2, 3 o 4 dígitos: 11, 351, 2994…)
  for (const largoArea of [2, 3, 4]) formas.push(`54${local.slice(0, largoArea)}15${local.slice(largoArea)}`);
  return formas.filter((f) => f !== tel);
}

export function mismoNumero(a: string, b: string): boolean {
  return normalizarTelefono(a) === normalizarTelefono(b);
}
