import type { Bot } from "./bot.ts";
import { buscarItem } from "./catalogo.ts";
import { comandaTexto } from "./comanda.ts";
import { pesos } from "./money.ts";
import { calcularTotales, cuentas, type EstadoPedido, type Pedido } from "./order.ts";
import { horaLocal } from "./tiempos.ts";

export const AYUDA_STAFF = `🛠️ *Comandos del local*
• pedidos — lista de pedidos activos
• resumen / resumen ayer / resumen semana / resumen mes — ventas
• ver N — comanda del pedido N
• pago ok N — aprobar transferencia y mandar a cocina
• pago no N motivo — rechazar comprobante
• aviso N — faltan ~5 min: le avisa al cliente que ya puede venir a retirar (o que sale el delivery)
• demorado N M — se atrasó: suma M minutos (10 si no ponés nada) y le pide disculpas al cliente
• listo N — pedido listo (take away: avisa que retire)
• sale N — salió el delivery
• entregado N — cerrar pedido (y pedirle una nota del 1 al 5)
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
  if (/^(resumen|ventas|caja)( de)?( hoy)?$/.test(t)) return bot.resumen(0, 1);
  if (/^(resumen|ventas|caja)( de)? ayer$/.test(t)) return bot.resumen(1, 1);
  if (/^(resumen|ventas|caja)( de la)? semana$/.test(t)) return bot.resumen(0, 7);
  if (/^(resumen|ventas|caja)( del)? mes$/.test(t)) return bot.resumen(0, 30);
  if (t === "estado bot" || t === "estado") {
    return bot.apagado ? "⏸️ El bot está APAGADO (escribí *bot on*)." : "▶️ El bot está PRENDIDO (escribí *bot off* para apagarlo).";
  }
  // "5 min 12", "5min 12", "casi 12" = aviso 12
  const t2 = t.replace(/^(5 ?min(utos)?|casi( listo)?|avisar)\b/, "aviso").replace(/^(atrasado|retrasado|retraso|demorado)\b/, "demorado");
  const m = t2.match(/^(pedidos|ver|pago ok|pago no|aviso|demorado|listo|sale|salio|salió|entregado|cancelar|demora|cerrar|abrir|auto|ayuda|responder|r|bot)\b ?(\d+)? ?(.*)$/);
  if (!m) return null;
  const [, cmd, numStr, resto] = m;
  // "listo", "ver", "sale"… sin número de pedido no son comandos: puede ser el encargado charlando o haciendo un pedido.
  if (!numStr && ["ver", "pago ok", "pago no", "aviso", "demorado", "listo", "sale", "salio", "salió", "entregado", "cancelar", "responder", "r", "bot"].includes(cmd)) return null;
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
            const hora = p.horaEstimada ? ` · ${p.programadoPara ? "🕘 para las" : "⏱️"} ${horaLocal(new Date(p.horaEstimada), negocio.zonaHoraria)}` : "";
            return `#${p.id} ${ETIQUETA[p.estado]} · ${p.cliente ?? p.telefono} · ${p.entrega?.modo === "delivery" ? "delivery" : "take away"} · ${pesos(tot)}${hora}`;
          })
          .join("\n");
      }
      case "ver":
      {
        const p = necesitaPedido();
        return comandaTexto(menu, negocio, p, undefined, bot.infoComanda(p));
      }
      case "pago ok": {
        const p = necesitaPedido();
        if (p.estado === "en_cocina" && cuentas(menu, negocio, p).agregadosPorTransferir.length) {
          for (const c of store.comprobantesDePedido(p.id!)) if (c.veredicto === "revisar") store.actualizarVeredicto(c.id, "aprobado");
          const n = await bot.aprobarAgregados(p);
          await avisar(p.telefono, `✅ ¡Recibimos el pago de lo que sumaste! Sale todo junto con tu pedido #${p.id}.`, `[El local aprobó el pago de lo sumado al pedido #${p.id}.]`);
          return `👍 Pedido #${p.id}: ${n === 1 ? "agregado aprobado" : `${n} agregados aprobados`} y enviado a cocina.`;
        }
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
      case "aviso": {
        const p = necesitaPedido();
        if (!["en_cocina", "listo"].includes(p.estado)) return `El pedido #${p.id} está ${ETIQUETA[p.estado]}: el aviso es para pedidos en cocina.`;
        if (p.avisoCasiListo) return `Al cliente del pedido #${p.id} ya se le avisó a las ${horaLocal(new Date(p.avisoCasiListo), negocio.zonaHoraria)}.`;
        p.avisoCasiListo = bot.ahora().toISOString();
        store.guardarPedido(p);
        await avisar(p.telefono, textoCasiListo(bot, p), `[La cocina avisó que al pedido #${p.id} le faltan unos 5 minutos.]`);
        return `⏰ Avisado: al pedido #${p.id} le faltan ~5 min.`;
      }
      case "demorado": {
        const p = necesitaPedido();
        if (!["en_cocina", "listo", "esperando_pago", "pago_en_revision"].includes(p.estado)) return `El pedido #${p.id} está ${ETIQUETA[p.estado]}: no hace falta avisar demora.`;
        const min = Math.min(120, Math.max(1, Number(resto.match(/\d+/)?.[0] ?? 10)));
        const base = Math.max(bot.ahora().getTime(), p.horaEstimada ? new Date(p.horaEstimada).getTime() : 0);
        p.horaEstimada = new Date(base + min * 60_000).toISOString();
        if (p.avisos) p.avisos.atraso = undefined;
        store.guardarPedido(p);
        const hora = horaLocal(new Date(p.horaEstimada), negocio.zonaHoraria);
        await avisar(
          p.telefono,
          `🙏 Perdón, tu pedido #${p.id} se nos demoró un poquito. ${p.entrega?.modo === "delivery" ? "Llega" : "Va a estar listo"} aprox. a las *${hora}*. ¡Gracias por la paciencia!`,
          `[El local avisó que el pedido #${p.id} se demora ${min} minutos más: nueva hora ${hora}.]`,
        );
        return `🕒 Pedido #${p.id}: nueva hora ${hora} (+${min} min). Cliente avisado.`;
      }
      case "listo": {
        const p = necesitaPedido();
        if (p.estado === "listo") return `El pedido #${p.id} ya estaba listo.`;
        if (p.estado !== "en_cocina") return `El pedido #${p.id} está ${ETIQUETA[p.estado]}: solo se marca listo un pedido en cocina.`;
        p.estado = "listo";
        (p.tiempos ??= {}).listo = bot.ahora().toISOString();
        store.guardarPedido(p);
        if (p.entrega?.modo === "take_away") {
          const ef = cuentas(menu, negocio, p).efectivo;
          const cobrar = ef > 0 ? ` Recordá traer ${pesos(ef)} en efectivo.` : "";
          await avisar(p.telefono, `🔔 ¡Tu pedido #${p.id} está listo! Ya podés pasar a retirarlo por ${negocio.direccionLocal}.${cobrar}`, `[Pedido #${p.id} listo para retirar.]`);
        }
        return `Pedido #${p.id} marcado como listo.`;
      }
      case "sale":
      case "salio":
      case "salió": {
        const p = necesitaPedido();
        if (p.entrega?.modo !== "delivery") return `El pedido #${p.id} es take away: cuando lo retiren, *entregado ${p.id}*.`;
        if (!["en_cocina", "listo"].includes(p.estado)) return `El pedido #${p.id} está ${ETIQUETA[p.estado]}: no puede salir.`;
        p.estado = "en_camino";
        (p.tiempos ??= {}).enCamino = bot.ahora().toISOString();
        if (!p.tiempos.listo) p.tiempos.listo = p.tiempos.enCamino;
        store.guardarPedido(p);
        await avisar(p.telefono, `🛵 ¡Tu pedido #${p.id} salió! En unos minutos está en tu puerta.`, `[Pedido #${p.id} salió con el repartidor.]`);
        return `Pedido #${p.id} en camino.`;
      }
      case "entregado": {
        const p = necesitaPedido();
        if (p.estado === "entregado") return `El pedido #${p.id} ya estaba entregado.`;
        if (!["en_cocina", "listo", "en_camino"].includes(p.estado)) {
          return `El pedido #${p.id} está ${ETIQUETA[p.estado]}: ${p.estado === "cancelado" ? "está cancelado" : "todavía no se pagó ni pasó a cocina"}. Si igual se entregó, primero *pago ok ${p.id}*.`;
        }
        p.estado = "entregado";
        (p.tiempos ??= {}).entregado = bot.ahora().toISOString();
        if (!p.tiempos.listo) p.tiempos.listo = p.tiempos.entregado;
        const pedirNota = negocio.asistente.pedirCalificacion;
        if (pedirNota) (p.avisos ??= {}).pedidoCalificacion = bot.ahora().toISOString();
        store.guardarPedido(p);
        await avisar(
          p.telefono,
          `🚀 ¡Gracias por elegir ${negocio.nombre}! Que lo disfrutes.${pedirNota ? "\n⭐ Si tenés un segundo, contanos qué tal estuvo con un número del *1 al 5*." : " Cuando quieras, pedinos de nuevo por acá."}`,
          `[Pedido #${p.id} entregado.${pedirNota ? " Se le pidió una nota del 1 al 5." : ""}]`,
        );
        return `Pedido #${p.id} cerrado.`;
      }
      case "cancelar": {
        const p = necesitaPedido();
        if (p.estado === "cancelado") return `El pedido #${p.id} ya estaba cancelado.`;
        if (p.estado === "entregado") return `El pedido #${p.id} ya se entregó: no se puede cancelar.`;
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

/** Mensaje al cliente cuando la cocina avisa que faltan unos 5 minutos. */
export function textoCasiListo(bot: Bot, p: Pedido): string {
  const { menu, negocio } = bot;
  const ef = cuentas(menu, negocio, p).efectivo;
  if (p.entrega?.modo === "delivery") {
    return `⏰ ¡Tu pedido #${p.id} sale en unos 5 minutos! 🛵${ef > 0 ? ` Tené a mano ${pesos(ef)} en efectivo.` : ""}`;
  }
  return `⏰ ¡Tu pedido #${p.id} está casi listo! En unos 5 minutos lo tenés: ya podés venir a retirarlo por ${negocio.direccionLocal}, así te lo llevás calentito 🙌${ef > 0 ? `\nTraé ${pesos(ef)} en efectivo.` : ""}`;
}

/** Lo que puede hacer un teléfono de cocina (no toca precios, pagos ni el bot). */
export async function comandoCocina(bot: Bot, texto: string): Promise<string | null> {
  const t = texto.trim().toLowerCase().replace(/\s+/g, " ").replace(/^[#/]/, "");
  if (!/^(pedidos|ver \d|aviso \d|5 ?min(utos)? \d|casi( listo)? \d|avisar \d|(demorado|atrasado|retrasado|retraso) \d|listo \d|sale \d|salio \d|salió \d)/.test(t)) return null;
  return comandoStaff(bot, texto);
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
