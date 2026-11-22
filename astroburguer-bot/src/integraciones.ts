import type { Menu, Negocio } from "./config.ts";
import { conReintentos } from "./limites.ts";
import { calcularTotales, type EstadoPedido, type Pedido } from "./order.ts";

/**
 * Avisa a una URL externa (n8n, Make, Zapier, una planilla…) cada vez que un pedido cambia de estado.
 * No frena al bot: se manda en segundo plano y, si falla, se reintenta y se registra el error.
 */
export function avisarIntegracion(url: string, slug: string, menu: Menu, negocio: Negocio, p: Pedido, anterior: EstadoPedido | null) {
  if (!url || p.estado === "armando") return;
  const t = calcularTotales(menu, negocio, p);
  const cuerpo = {
    evento: "pedido.estado",
    local: slug,
    estado: p.estado,
    estadoAnterior: anterior,
    fecha: new Date().toISOString(),
    pedido: {
      id: p.id,
      cliente: p.cliente ?? null,
      telefono: p.telefono,
      entrega: p.entrega?.modo ?? null,
      direccion: p.entrega?.direccion ?? null,
      zona: t.zona?.nombre ?? null,
      pago: p.pago?.metodo ?? null,
      pagoVerificado: Boolean(p.pagoVerificado),
      items: t.lineas.map((l) => ({
        cantidad: l.cantidad,
        producto: l.nombre,
        opciones: l.opciones,
        extras: l.extras.map((e) => e.nombre),
        sin: l.sin,
        observacion: l.observacion,
        subtotal: l.subtotal,
      })),
      subtotal: t.subtotal,
      envio: t.envio,
      total: t.total,
      horaEstimada: p.horaEstimada ?? null,
      creadoEn: p.creadoEn,
    },
  };
  void conReintentos(async () => {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(cuerpo),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(`integración respondió ${res.status}`);
  }, 3).catch((e) => console.error(`[integracion ${slug}] no se pudo avisar el pedido #${p.id}:`, (e as Error).message));
}
