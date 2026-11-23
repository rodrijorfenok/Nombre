// Carga un cliente ficticio para probar el sistema sin datos reales.
// Uso: node scripts/cliente-ficticio.js   (con el servidor apagado o prendido, da igual)
const { store } = await import("../src/store.js");
const { crearCliente } = await import("../src/memoria.js");

const existente = store.find("clientes", { marca: "Trama Lino (ficticio)" });
const cliente = existente || crearCliente({
  marca: "Trama Lino (ficticio)",
  rubro: "Indumentaria femenina de lino",
  url: "https://trama-lino.example.com",
  redes: "@tramalino.ficticio en Instagram y TikTok",
  publico: "Mujeres de 28 a 45 años, AMBA y Córdoba, interesadas en moda sustentable",
  tono: "Cálido, cercano y con foco en la calidad del material",
  productos: "Vestidos y camisas de lino, línea verano",
  objetivo: "Subir la conversión de la tienda de 0,7% a 1,2% y crecer en Instagram para el lanzamiento de verano",
  plan: "Growth 360",
  responsable: "Vos",
});
console.log(existente ? "El cliente ficticio ya existía." : "Cliente ficticio creado.");
console.log(`ID: ${cliente.id}`);
console.log(`Portal: http://localhost:${process.env.PORT || 3000}/portal/${cliente.portalToken}`);
console.log("Abrí el panel, pestaña Clientes, y tocá «Diagnóstico + plan 90 días».");
