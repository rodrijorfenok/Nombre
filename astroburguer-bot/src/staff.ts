import type { Bot } from "./bot.ts";
import { buscarItem } from "./catalogo.ts";
import { comandaTexto } from "./comanda.ts";
import { pesos } from "./money.ts";
import { calcularTotales, type EstadoPedido } from "./order.ts";
import { horaLocal } from "./tiempos.ts";

export const AYUDA_STAFF = `🛠️ *Comandos del local*
• pedidos — lista de pedidos activos
• ver N — comanda del pedido N
• pago ok N — aprobar transferencia y mandar a cocina
• pago no N motivo — rechazar comprobante
• listo N — pedido listo (take away: avisa que retire)
• sale N — salió el delivery
• entregado N — cerrar pedido
• cancelar N motivo — cancelar y avisar al cliente
• precio NOMBRE MONTO — cambiar un precio (ej: precio doble orbita 13500)
• agotado NOMBRE — se terminó (el bot deja de ofrecerlo)
• hay NOMBRE — volvió a haber
• carta — precios y faltantes de hoy
• demora M — sumar M minutos a todos los tiempos (demora 0 = normal)
• cerrar / abrir / auto — forzar local cerrado, abierto o volver al horario
• feriado / feriado 14/6 — abrir en horario de feriado hoy o esa fecha (no feriado 14/6 lo quita)
• bot off / bot on — apagar o prender el bot para TODOS (apagado, los mensajes te llegan a vos)
• atender N — tomar vos la charla del pedido N
• r N mensaje — responderle vos al cliente del pedido N
• bot N — que el bot vuelva a atender a ese cliente
• ayuda`;

const ETIQUETA: Record<EstadoPedido, string> = {
  armando: "🛒 armando",
  esperando_pago: "💸 esperando pago",
  pago_en_revision: "🔎 revisar pago",
  en_cocina: "🔥 en cocina",
  listo: "✅ listo",
  en_camino: "🛵 en camino",
  entregado: "📦 entregado",
  cancelado: "❌ cancelado",
};

/** Devuelve la respuesta para el staff, o null si el texto no es un comando. */
export async function comandoStaff(bot: Bot, texto: string): Promise<string | null> {
  const t = texto.trim().toLowerCase().replace(/\s+/g, " ").replace(/^[#/]/, "");
  const catalogo = await comandoCatalogo(bot, t);
  if (catalogo) return catalogo;

  // Botón de apagado general
  if (/^(bot off|apagar bot|apaga(r)? el bot|bot apagado)$/.test(t)) {
    bot.store.setAjuste("bot_apagado", "1");
    return "⏸️ *Bot apagado.* Desde ahora todos los mensajes de los clientes te llegan a vos; respondé con *r N mensaje*. Para prenderlo: *bot on*";
  }
  if (/^(bot on|prender bot|prende(r)? el bot|bot prendido)$/.test(t)) {
    bot.store.setAjuste("bot_apagado", null);
    return "▶️ *Bot prendido.* Vuelve a atender a los clientes (los que estás atendiendo vos siguen con vos hasta que escribas *bot N*).";
  }
  let mt = t.match(/^atender (\d+)$/);
  if (mt) {
    const p = bot.store.pedido(Number(mt[1]));
    if (!p) return `⚠️ No encuentro el pedido ${mt[1]}.`;
    bot.store.setAjuste(`humano:${p.telefono}`, new Date(Date.now() + 12 * 3_600_000).toISOString());
    return `🙋 Ahora atendés vos a ${p.cliente ?? p.telefono} (pedido #${p.id}). Respondé con *r ${p.id} mensaje*; para devolvérselo al bot: *bot ${p.id}*`;
  }
  // Feriados: "feriado" = hoy; "feriado 14/6" o "feriado 2027-06-14" = esa fecha; "no feriado 14/6" lo quita.
  mt = t.match(/^(no )?feriado(?: (hoy|\d{1,2}\/\d{1,2}(?:\/\d{2,4})?|\d{4}-\d{2}-\d{2}))?$/);
  if (mt) {
    const tz = bot.negocio.zonaHoraria;
    const hoy = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
    let fecha = hoy;
    if (mt[2] && mt[2] !== "hoy") {
      if (mt[2].includes("-")) fecha = mt[2];
      else {
        const [d, m, a] = mt[2].split("/");
        const anio = a ? (a.length === 2 ? `20${a}` : a) : hoy.slice(0, 4);
        fecha = `${anio}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
        if (!a && fecha < hoy) fecha = `${Number(anio) + 1}${fecha.slice(4)}`; // "feriado 2/1" en diciembre = el año que viene
      }
    }
    const f = bot.negocio.feriados;
    if (mt[1]) {
      bot.store.setAjuste(`feriado:${fecha}`, null);
      return `🗓️ ${fecha} ya no figura como feriado.`;
    }
    bot.store.setAjuste(`feriado:${fecha}`, "1");
    return `🗓️ ${fecha} marcado como feriado: el bot toma pedidos de ${f?.abre ?? "20:00"} a ${f?.cierra ?? "00:00"}.`;
  }
  if (t === "estado bot" || t === "estado") {
    return bot.apagado ? "⏸️ El bot está APAGADO (escribí *bot on*)." : "▶️ El bot está PRENDIDO (escribí *bot off* para apagarlo).";
  }
  const m = t.match(/^(pedidos|ver|pago ok|pago no|listo|sale|salio|salió|entregado|cancelar|demora|cerrar|abrir|auto|ayuda|responder|r|bot)\b ?(\d+)? ?(.*)$/);
  if (!m) return null;
  const [, cmd, numStr, resto] = m;
  // "listo", "ver", "sale"… sin número de pedido no son comandos: puede ser el encargado charlando o haciendo un pedido.
  if (!numStr && ["ver", "pago ok", "pago no", "listo", "sale", "salio", "salió", "entregado", "cancelar", "responder", "r", "bot"].includes(cmd)) return null;
  const n = numStr ? Number(numStr) : NaN;
  const { store, menu, negocio, mensajero } = bot;

  const necesitaPedido = () => {
    const p = Number.isFinite(n) ? store.pedido(n) : null;
    if (!p) throw new Error(`No encuentro el pedido ${numStr ?? ""}. Escribí por ejemplo: ${cmd} 12`);
    return p;
  };
  const avisar = async (tel: string, txt: string, evento: string) => {
    await mensajero.enviarTexto(tel, txt);
    bot.registrarEvento(tel, evento, txt);
  };

  try {
    switch (cmd) {
      case "ayuda":
        return AYUDA_STAFF;
      case "r":
      case "responder": {
        // el texto original, sin pasar a minúsculas
        const original = texto.trim().replace(/^[#/]?\s*(responder|r)\s+\d+\s*/i, "");
        if (!original) return `Escribí el mensaje después del número: r ${n} hola, ¿qué necesitás?`;
        return await bot.responderComoLocal(n, original);
      }
      case "bot":
        return bot.devolverAlBot(n);
      case "pedidos": {
        const ps = store.pedidosActivos();
        if (!ps.length) return "No hay pedidos activos.";
        return ps
          .map((p) => {
            const tot = calcularTotales(menu, negocio, p).total;
            const hora = p.horaEstimada ? ` · ⏱️ ${horaLocal(new Date(p.horaEstimada), negocio.zonaHoraria)}` : "";
            return `#${p.id} ${ETIQUETA[p.estado]} · ${p.cliente ?? p.telefono} · ${p.entrega?.modo === "delivery" ? "delivery" : "take away"} · ${pesos(tot)}${hora}`;
          })
          .join("\n");
      }
      case "ver":
        return comandaTexto(menu, negocio, necesitaPedido());
      case "pago ok": {
        const p = necesitaPedido();
        if (!["esperando_pago", "pago_en_revision"].includes(p.estado)) return `El pedido #${p.id} está ${ETIQUETA[p.estado]}, no esperando pago.`;
        for (const c of store.comprobantesDePedido(p.id!)) if (c.veredicto === "revisar") store.actualizarVeredicto(c.id, "aprobado");
        bot.pasarACocina(p);
        await avisar(
          p.telefono,
          `✅ ¡Pago confirmado! Tu pedido #${p.id} ya está en cocina. Llega/está listo aprox. a las *${horaLocal(new Date(p.horaEstimada!), negocio.zonaHoraria)}* 🍔`,
          `[El local aprobó manualmente el pago del pedido #${p.id}.]`,
        );
        await bot.enviarComanda(p.id!);
        return `👍 Pedido #${p.id} aprobado y enviado a cocina.`;
      }
      case "pago no": {
        const p = necesitaPedido();
        for (const c of store.comprobantesDePedido(p.id!)) if (c.veredicto === "revisar") store.actualizarVeredicto(c.id, "rechazado");
        p.estado = "esperando_pago";
        store.guardarPedido(p);
        const motivo = resto || "no pudimos verificar la transferencia";
        await avisar(
          p.telefono,
          `⚠️ No pudimos confirmar tu pago del pedido #${p.id}: ${motivo}. Si ya transferiste, mandanos de nuevo el comprobante. Alias: *${negocio.pago.alias}* (${negocio.pago.titular}).`,
          `[El local rechazó el comprobante del pedido #${p.id}: ${motivo}.]`,
        );
        return `Pedido #${p.id}: comprobante rechazado y cliente avisado.`;
      }
      case "listo": {
        const p = necesitaPedido();
        p.estado = "listo";
        store.guardarPedido(p);
        if (p.entrega?.modo === "take_away") {
          const cobrar = p.pago?.metodo === "efectivo" ? ` Recordá traer ${pesos(calcularTotales(menu, negocio, p).total)} en efectivo.` : "";
          await avisar(p.telefono, `🔔 ¡Tu pedido #${p.id} está listo! Ya podés pasar a retirarlo por ${negocio.direccionLocal}.${cobrar}`, `[Pedido #${p.id} listo para retirar.]`);
        }
        return `Pedido #${p.id} marcado como listo.`;
      }
      case "sale":
      case "salio":
      case "salió": {
        const p = necesitaPedido();
        p.estado = "en_camino";
        store.guardarPedido(p);
        await avisar(p.telefono, `🛵 ¡Tu pedido #${p.id} salió! En unos minutos está en tu puerta.`, `[Pedido #${p.id} salió con el repartidor.]`);
        return `Pedido #${p.id} en camino.`;
      }
      case "entregado": {
        const p = necesitaPedido();
        p.estado = "entregado";
        store.guardarPedido(p);
        await avisar(p.telefono, `🚀 ¡Gracias por elegir ${negocio.nombre}! Que lo disfrutes. Cuando quieras, pedinos de nuevo por acá.`, `[Pedido #${p.id} entregado.]`);
        return `Pedido #${p.id} cerrado.`;
      }
      case "cancelar": {
        const p = necesitaPedido();
        p.estado = "cancelado";
        store.guardarPedido(p);
        await avisar(
          p.telefono,
          `😔 Tuvimos que cancelar tu pedido #${p.id}${resto ? `: ${resto}` : ""}. Si ya habías transferido, te contactamos para devolverte el dinero.`,
          `[El local canceló el pedido #${p.id}.]`,
        );
        return `Pedido #${p.id} cancelado.`;
      }
      case "demora": {
        const min = Number.isFinite(n) ? n : 0;
        store.setAjuste("demora_extra", min ? String(min) : null);
        return min ? `⏱️ Ahora se suman ${min} minutos a todos los tiempos estimados.` : "⏱️ Demora extra quitada.";
      }
      case "cerrar":
        store.setAjuste("abierto_manual", "0");
        return "🔒 Local marcado como CERRADO. No se toman pedidos nuevos (escribí *auto* para volver al horario).";
      case "abrir":
        store.setAjuste("abierto_manual", "1");
        return "🔓 Local marcado como ABIERTO aunque esté fuera de horario (escribí *auto* para volver al horario).";
      case "auto":
        store.setAjuste("abierto_manual", null);
        return "🕒 Volvemos a usar el horario configurado.";
    }
  } catch (e) {
    return `⚠️ ${(e as Error).message}`;
  }
  return null;
}

function unico(bot: Bot, nombre: string) {
  const r = buscarItem(bot.menuBase, nombre);
  if (!r.length) throw new Error(`No encuentro "${nombre}" en la carta. Escribí *carta* para ver los nombres.`);
  if (r.length > 1) throw new Error(`"${nombre}" coincide con varios: ${r.map((i) => i.nombre).join(", ")}. Sé más específico.`);
  return r[0];
}

/** Cambios de carta del día a día, sin tocar archivos: precio, agotado, hay, carta. */
async function comandoCatalogo(bot: Bot, t: string): Promise<string | null> {
  const { store } = bot;
  try {
    let m = t.match(/^precio (.+?) \$?\s?(\d[\d.,]*)$/);
    if (m) {
      const item = unico(bot, m[1]);
      const monto = Number(m[2].replace(/[.,](?=\d{3}\b)/g, "").replace(",", "."));
      if (!Number.isFinite(monto) || monto <= 0) throw new Error("El monto no es válido.");
      const base = (item.tipo === "producto" ? bot.menuBase.productos : bot.menuBase.extras).find((x) => x.id === item.id)!.precio;
      store.setAjuste(`precio:${item.id}`, monto === base ? null : String(monto));
      return `💲 ${item.nombre}: ahora ${pesos(monto)}. Los pedidos ya cargados mantienen el precio anterior.`;
    }
    m = t.match(/^(agotado|agotada|no hay|se termino|sin stock) (.+)$/);
    if (m) {
      const item = unico(bot, m[2]);
      store.setAjuste(`agotado:${item.id}`, "1");
      return `🚫 ${item.nombre} marcado como agotado. Escribí *hay ${m[2]}* cuando vuelva.`;
    }
    m = t.match(/^(hay|volvio|volvió|repuesto) (.+)$/);
    if (m) {
      const item = unico(bot, m[2]);
      store.setAjuste(`agotado:${item.id}`, null);
      return `✅ ${item.nombre} disponible de nuevo.`;
    }
    if (t === "carta" || t === "precios") {
      const menu = bot.menu;
      const lineas = menu.productos.map((p) => `${p.disponible ? "•" : "🚫"} ${p.nombre} ${pesos(p.precio)}`);
      const extras = menu.extras.map((e) => `${e.disponible ? "•" : "🚫"} ${e.nombre} +${pesos(e.precio)}`);
      return `📋 *Carta de hoy*\n${lineas.join("\n")}\n\n*Extras*\n${extras.join("\n")}`;
    }
  } catch (e) {
    return `⚠️ ${(e as Error).message}`;
  }
  return null;
}
