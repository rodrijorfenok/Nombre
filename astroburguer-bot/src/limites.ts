/** Semáforo: como mucho N tareas a la vez; el resto espera su turno en orden de llegada. */
export class Semaforo {
  private libres: number;
  private espera: (() => void)[] = [];

  constructor(readonly maximo: number) {
    this.libres = maximo;
  }

  get enUso() {
    return this.maximo - this.libres;
  }

  get enEspera() {
    return this.espera.length;
  }

  async usar<T>(fn: () => Promise<T>): Promise<T> {
    if (this.libres > 0) this.libres--;
    else await new Promise<void>((r) => this.espera.push(r));
    try {
      return await fn();
    } finally {
      const sig = this.espera.shift();
      if (sig) sig();
      else this.libres++;
    }
  }
}

/** Reintenta con espera creciente (0,5 s, 1 s, 2 s…) mientras `reintentable` diga que sí. */
export async function conReintentos<T>(fn: () => Promise<T>, intentos = 4, reintentable: (e: unknown) => boolean = () => true): Promise<T> {
  let ultimo: unknown;
  for (let i = 0; i < intentos; i++) {
    try {
      return await fn();
    } catch (e) {
      ultimo = e;
      if (i === intentos - 1 || !reintentable(e)) break;
      await new Promise((r) => setTimeout(r, 500 * 2 ** i + Math.random() * 250));
    }
  }
  throw ultimo;
}
