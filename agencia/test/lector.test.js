// Lector web propio del Auditor: conversión a texto y protecciones de seguridad.
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { htmlATexto, leerPagina } from "../src/lectorWeb.js";

test("convierte HTML en texto útil para auditar", () => {
  const t = htmlATexto(`<html><head><title>Tienda</title><meta name="description" content="Ropa de lino"><script>x()</script></head>
    <body><h1>Vestidos</h1><img src="a.jpg"><img src="b.jpg" alt="Vestido blanco"><a href="/p/1">Ver vestido</a><button>Comprar</button><p>$ 45.000</p></body></html>`, "https://t.example.com/");
  assert.match(t, /Título: Tienda/);
  assert.match(t, /# Vestidos/);
  assert.match(t, /imagen sin texto alternativo/);
  assert.match(t, /imagen: Vestido blanco/);
  assert.match(t, /Ver vestido \[enlace: https:\/\/t\.example\.com\/p\/1\]/);
  assert.match(t, /\[botón: Comprar\]/);
  assert.match(t, /No tiene meta viewport/);
  assert.doesNotMatch(t, /x\(\)/);
});

test("no lee direcciones locales o privadas (protección de la red interna)", async () => {
  delete process.env.ESCALA_LECTURA_LOCAL;
  await assert.rejects(leerPagina("http://127.0.0.1:9/"), /red privada o local/);
  await assert.rejects(leerPagina("http://192.168.0.10/"), /red privada o local/);
  await assert.rejects(leerPagina("file:///etc/passwd"), /http o https/);
});

test("solo lee páginas del dominio auditado y sigue funcionando en modo demo local", async () => {
  const srv = http.createServer((req, res) => { res.setHeader("content-type", "text/html"); res.end("<title>Demo</title><h1>Hola</h1>"); });
  await new Promise((r) => srv.listen(0, r));
  process.env.ESCALA_LECTURA_LOCAL = "1";
  try {
    const url = `http://127.0.0.1:${srv.address().port}/`;
    assert.match(await leerPagina(url, { dominioPermitido: "127.0.0.1" }), /# Hola/);
    await assert.rejects(leerPagina(url, { dominioPermitido: "mitienda.com" }), /Solo se pueden leer páginas de mitienda\.com/);
  } finally {
    delete process.env.ESCALA_LECTURA_LOCAL;
    srv.close();
  }
});
