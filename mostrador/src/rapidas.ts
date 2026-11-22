import type { Menu, Negocio } from "./config.ts";
import { textoMenu } from "./herramientas.ts";
import { normalizar, pesos } from "./money.ts";
import { cuentas, type Pedido } from "./order.ts";
import { horaLocal, proximaApertura, textoHorarios } from "./tiempos.ts";

/**
 * Respuestas instantáneas para las preguntas que más se repiten (saludo, carta, horario,
 * dirección, alias, estado del pedido). No usan IA: salen en milisegundos y no cuestan nada.
 * Cada una tiene varias versiones para que no suene a robot. Cualquier mensaje que no sea
 * exactamente una de estas preguntas va al asistente con IA.
 */

export interface ContextoRapido {
  menu: Menu;
  negocio: Negocio;
  pedido: Pedido;
  /** true si es el primer mensaje de la conversación */
  primerMensaje: boolean;
  abierto: boolean;
  ahora: Date;
  azar?: () => number;
}

const SALUDO = "(?:hola+|holis|ola|buenas+|buen dia|buenos dias|buenas (?:tardes|noches)|hola buenas(?: tardes| noches)?|hey|que tal|como va|como andan)";
const CORTESIA = "(?: (?:por favor|porfa|porfi|gracias))?";
const re = (cuerpo: string) => new RegExp(`^(?:${SALUDO} )?(?:${cuerpo})${CORTESIA}$`);

const PATRONES = {
  saludo: new RegExp(`^${SALUDO}(?: (?:como (?:estas|estan|andas|andan|va)|que tal))?$`),
  menu: re(
    "(?:(?:me )?(?:pasas|pasan|pasarias|mandas|mandan|podes pasar|podrias pasar|pasame|mandame) )?(?:el |la )?(?:menu|carta|precios|lista de precios)|que (?:tienen|tenes|hay)(?: para comer)?|que venden",
  ),
  horario: re("(?:que )?horarios?(?: tienen| tenes)?|a que hora (?:abren|cierran|abris|cerras)(?: hoy)?|hasta que hora (?:estan|abren|atienden|tenes)(?: hoy)?|(?:estan|esta) abiertos?(?: hoy)?|abren hoy|atienden hoy"),
  direccion: re("donde (?:estan|queda|quedan|los encuentro)(?: ubicados)?|(?:cual es )?la direccion(?: del local)?|direccion|donde retiro|donde paso a buscar"),
  alias: re("(?:(?:me )?(?:pasas|pasame|cual es) )?(?:el )?(?:alias|cbu|cvu)|a donde (?:te )?transfiero|datos para transferir"),
  estado: re("(?:cuanto (?:falta|tarda|demora)|ya (?:sale|salio|esta)|viene en camino|como va mi pedido|y mi pedido|falta mucho)(?: mi pedido| el pedido)?"),
  gracias: new RegExp(`^(?:(?:dale|genial|joya|perfecto|ok|buenisimo|barbaro|listo) )?(?:muchas |mil )?(?:gracias|grax|graciass+)(?: (?:genio|crack|capo|maestro|amigo|che))?$`),
} as const;

export type IntencionRapida = keyof typeof PATRONES;

export function detectarIntencion(texto: string): IntencionRapida | null {
  const t = normalizar(texto);
  if (!t || t.length > 70) return null;
  for (const k of Object.keys(PATRONES) as IntencionRapida[]) if (PATRONES[k].test(t)) return k;
  return null;
}

function elegir<T>(opciones: T[], azar: () => number): T {
  return opciones[Math.floor(azar() * opciones.length) % opciones.length];
}

/** Devuelve los mensajes a enviar, o null si el mensaje tiene que ir a la IA. */
export function respuestaRapida(texto: string, ctx: ContextoRapido): string[] | null {
  const intencion = detectarIntencion(texto);
  if (!intencion) return null;
  const { negocio, menu, pedido } = ctx;
  const azar = ctx.azar ?? Math.random;
  const usted = negocio.asistente.tono === "formal";
  const e = (emoji: string) => (negocio.asistente.emojis ? ` ${emoji}` : "");
  const yo = negocio.asistente.nombre ? (usted ? `Le habla ${negocio.asistente.nombre}, de ` : `Soy ${negocio.asistente.nombre}, de `) : "";
  const apertura = proximaApertura(negocio, ctx.ahora);
  const cerrado = `${usted ? "En este momento estamos cerrados" : "Ahora estamos cerrados"}${apertura ? `, abrimos ${apertura}` : ""}.`;
  const activo = !["armando", "entregado", "cancelado"].includes(pedido.estado);

  switch (intencion) {
    case "saludo": {
      if (!ctx.primerMensaje) return null; // a mitad de un pedido, que conteste la IA con contexto
      if (!ctx.abierto) {
        return [
          elegir(
            usted
              ? [`¡Hola! ${yo}${negocio.nombre}. ${cerrado} Cuando quiera nos escribe y le tomamos el pedido.`]
              : [
                  `¡Hola! ${cerrado} Cuando abramos escribinos y te lo preparamos${e("🙌")}`,
                  `¡Buenas! ${yo}${negocio.nombre}. ${cerrado} ¡Te esperamos!${e("🍔")}`,
                ],
            azar,
          ),
        ];
      }
      return [
        elegir(
          usted
            ? [
                `¡Hola! ${yo}${negocio.nombre}. ¿Qué le gustaría pedir hoy? Si quiere, le paso la carta.`,
                `Buenas, bienvenido a ${negocio.nombre}. ¿Le paso la carta o ya sabe qué va a pedir?`,
              ]
            : [
                `¡Hola! ${yo}${negocio.nombre}${e("👋")} ¿Qué tenés ganas de comer hoy? Si querés te paso la carta.`,
                `¡Buenas! ${yo}${negocio.nombre}. ¿Te paso la carta o ya sabés qué vas a pedir?${e("🍔")}`,
                `¡Hola, qué tal! ${yo}${negocio.nombre}. Decime qué se te antoja y lo armamos${e("🙌")}`,
              ],
          azar,
        ),
      ];
    }
    case "menu": {
      const cierre = ctx.abierto
        ? elegir(
            usted
              ? ["Cuando lo tenga decidido, escríbame qué quiere y lo armo.", "Dígame qué le gustaría y lo cargo."]
              : ["Decime qué te tienta y lo armo.", "Cuando sepas, escribime qué querés y lo cargo.", "Pedime como te salga, que yo lo entiendo 😉".replace(" 😉", e("😉"))],
            azar,
          )
        : cerrado;
      return [textoMenu(menu), cierre];
    }
    case "horario": {
      const estado = ctx.abierto ? (usted ? "Ahora estamos abiertos." : `¡Ahora estamos abiertos!${e("🔥")}`) : cerrado;
      return [`${estado} Nuestros horarios: ${textoHorarios(negocio)}.`];
    }
    case "direccion":
      return [
        elegir(
          usted
            ? [`Estamos en ${negocio.direccionLocal}. Puede pedir para retirar o con delivery.`]
            : [`Estamos en ${negocio.direccionLocal}${e("📍")} Podés pasar a retirar o te lo mandamos.`, `Nos encontrás en ${negocio.direccionLocal}${e("📍")}`],
          azar,
        ),
      ];
    case "alias": {
      const datos = `Alias: *${negocio.pago.alias}*${negocio.pago.cvu ? `\nCVU: ${negocio.pago.cvu}` : ""}\nTitular: ${negocio.pago.titular}`;
      if (pedido.estado === "esperando_pago") {
        const c = cuentas(menu, negocio, pedido);
        const monto = c.transferenciaBase;
        const texto = c.efectivo > 0 ? `Por transferencia van *${pesos(monto)}* (el resto, ${pesos(c.efectivo)}, en efectivo).` : `El total es *${pesos(monto)}*.`;
        return [`${datos}\n\n${texto} ${usted ? "Cuando transfiera, envíeme" : "Cuando transfieras, mandame"} la captura del comprobante.`];
      }
      if (pedido.estado === "armando") return null; // que la IA lo encamine: primero hay que cerrar el pedido
      return [datos];
    }
    case "estado": {
      if (!activo) return null;
      const hora = pedido.horaEstimada ? horaLocal(new Date(pedido.horaEstimada), negocio.zonaHoraria) : null;
      const textos: Partial<Record<Pedido["estado"], string>> = {
        esperando_pago: `Tu pedido #${pedido.id} está esperando el comprobante de la transferencia. Apenas lo mandes, va a cocina.`,
        pago_en_revision: `Estamos chequeando tu comprobante, en un ratito te confirmo y pasa a cocina.`,
        en_cocina: elegir(
          [
            `Tu pedido #${pedido.id} ya está en cocina${e("🔥")}${hora ? ` Calculamos que ${pedido.entrega?.modo === "delivery" ? "llega" : "está listo"} tipo ${hora}.` : ""}`,
            `¡Se está preparando!${hora ? ` Para las ${hora} aprox. ${pedido.entrega?.modo === "delivery" ? "lo tenés en tu casa" : "lo podés retirar"}.` : ""}${e("👨‍🍳")}`,
          ],
          azar,
        ),
        listo: pedido.entrega?.modo === "delivery" ? `¡Ya está listo! Sale en un toque con el repartidor${e("🛵")}` : `¡Ya está listo! Podés pasar a retirarlo por ${negocio.direccionLocal}.`,
        en_camino: `¡Ya salió! El repartidor está en camino${e("🛵")}`,
      };
      const t = textos[pedido.estado];
      return t ? [usted ? t.replace("Tu pedido", "Su pedido").replace("mandes", "envíe").replace("lo tenés en tu casa", "lo tiene en su domicilio").replace("lo podés", "lo puede").replace("Podés", "Puede") : t] : null;
    }
    case "gracias": {
      if (pedido.estado === "armando" && !ctx.primerMensaje && pedido.lineas.length) return null; // en medio del pedido decide la IA
      if (pedido.estado === "armando" && !pedido.lineas.length && !ctx.primerMensaje) return null;
      return [
        elegir(
          usted
            ? ["¡Gracias a usted! Que lo disfrute.", "Un gusto. ¡Buen provecho!"]
            : [`¡A vos!${e("🙌")}`, `¡Gracias a vos! Que lo disfrutes${e("🍔")}`, `¡De nada! Cualquier cosa escribime${e("😉")}`],
          azar,
        ),
      ];
    }
  }
}
