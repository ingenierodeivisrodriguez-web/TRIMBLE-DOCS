import { test } from "node:test";
import assert from "node:assert/strict";
import { advertenciasCorreo, cambiosCorreo, CONFIG_INICIAL, conInicial, idDeExtension, rellenar, revisarConfigCorreo, TEXTOS_INICIALES } from "./configCorreo";

const P = "BUJGfcZ3AEI";
const valida = (cambios: Record<string, unknown> = {}) => ({ ...CONFIG_INICIAL, ...cambios });

test("los datos entre llaves se reemplazan; sin código no queda el separador al principio", () => {
  const v = { codigo: "FLUJO-07", flujo: "Planos torre 1", paso: "Revisa", archivo: "A-101.pdf" };
  assert.equal(rellenar(TEXTOS_INICIALES.revision.asunto, v), "FLUJO-07 · Te toca «Revisa»: Planos torre 1");
  assert.equal(rellenar(TEXTOS_INICIALES.revision.asunto, { ...v, codigo: "" }), "Te toca «Revisa»: Planos torre 1");
  assert.equal(rellenar("Hola {persona}\nrevisa {archivo}", { persona: "Luz", archivo: "A.pdf" }), "Hola Luz\nrevisa A.pdf", "the lines of a text stay");
  assert.equal(rellenar("{otro} queda", {}), "{otro} queda");
});

test("lo guardado sin algún dato toma el valor inicial; nada guardado es la configuración inicial", () => {
  assert.deepEqual(conInicial(null), CONFIG_INICIAL);
  const c = conInicial({ activo: false, eventos: { correccion: false }, textos: { revision: { asunto: "Toca {paso}" } }, copia: ["a@b.co", "malo"], idExtension: "x y" });
  assert.equal(c.activo, false);
  assert.equal(c.tareasTrimble, true);
  assert.deepEqual(c.eventos, { revision: true, correccion: false });
  assert.deepEqual(c.textos.revision, { asunto: "Toca {paso}", intro: TEXTOS_INICIALES.revision.intro });
  assert.deepEqual(c.textos.correccion, TEXTOS_INICIALES.correccion);
  assert.deepEqual(c.copia, ["a@b.co"]);
  assert.equal(c.idExtension, null);
});

test("la dirección de la extensión se toma de lo que se pega en el navegador, y debe ser de este proyecto", () => {
  assert.deepEqual(idDeExtension("https://web.connect.trimble.com/projects/BUJGfcZ3AEI/extension/8e7cd6d3-3e0e-16d7-12f4-02d6a673090e/flujo_aprobacion_open", P), { id: "8e7cd6d3-3e0e-16d7-12f4-02d6a673090e", error: null });
  assert.deepEqual(idDeExtension("  ", P), { id: null, error: null });
  assert.deepEqual(idDeExtension("abcd1234-0000", P), { id: "abcd1234-0000", error: null });
  assert.match(idDeExtension("https://web.connect.trimble.com/projects/OTRO/extension/abc12345/flujo_aprobacion_open", P).error ?? "", /es de otro proyecto \(OTRO\)/);
  assert.match(idDeExtension("https://google.com", P).error ?? "", /Pega la dirección del navegador/);
});

test("lo que manda la ventana se revisa: textos, datos conocidos, correos de copia y la regla de no quedar sin avisos", () => {
  const ok = revisarConfigCorreo({ ...valida(), copia: "jefe@obra.co; JEFE@obra.co, bim@obra.co", enlace: "" }, P);
  assert.equal(ok.error, null);
  assert.deepEqual(ok.config?.copia, ["jefe@obra.co", "bim@obra.co"]);

  const malo = (cambios: Record<string, unknown>) => revisarConfigCorreo({ ...valida(), ...cambios }, P).error;
  assert.match(malo({ textos: { ...TEXTOS_INICIALES, revision: { asunto: "x", intro: "Te toca" } } }) ?? "", /Asunto de «Te toca un paso»: escribe de 3 a 160 caracteres/);
  assert.match(malo({ textos: { ...TEXTOS_INICIALES, correccion: { asunto: "Rechazado {archivo}", intro: "Lo rechazó {jefe}" } } }) ?? "", /Texto de «Archivo rechazado»: «\{jefe\}» no es un dato/);
  assert.match(malo({ copia: "jefe@obra" }) ?? "", /«jefe@obra» no es un correo válido/);
  assert.match(malo({ copia: "a@o.co b@o.co c@o.co d@o.co e@o.co f@o.co" }) ?? "", /caben hasta 5 correos/);
  assert.match(malo({ activo: false, tareasTrimble: false }) ?? "", /los correos de la extensión deben quedar activos/);
  assert.match(malo({ enlace: "https://web.connect.trimble.com/projects/OTRO/extension/abc12345/x" }) ?? "", /otro proyecto/);

  const saltos = revisarConfigCorreo({ ...valida(), textos: { revision: { asunto: "Toca\n{paso}", intro: "Hola\r\n{persona}" }, correccion: TEXTOS_INICIALES.correccion } }, P);
  assert.deepEqual(saltos.config?.textos.revision, { asunto: "Toca {paso}", intro: "Hola\n{persona}" }, "the subject stays on one line; the text keeps its lines");
});

test("las advertencias dicen quién se queda sin aviso, sin impedir guardar", () => {
  assert.deepEqual(advertenciasCorreo(CONFIG_INICIAL, true), []);
  assert.deepEqual(advertenciasCorreo(CONFIG_INICIAL, false), ["No hay cuenta de Gmail en Vercel: los correos no saldrán hasta ponerla."]);
  const sinTareas = { ...CONFIG_INICIAL, tareasTrimble: false, eventos: { revision: true, correccion: false } };
  assert.deepEqual(advertenciasCorreo(sinTareas, true), ["Nadie recibirá aviso cuando le rechacen un archivo (sin tarea de Trimble ni correo)."]);
});

test("el historial dice qué cambió en palabras", () => {
  const despues = { ...CONFIG_INICIAL, tareasTrimble: false, copia: ["jefe@obra.co"], textos: { ...TEXTOS_INICIALES, revision: { asunto: "Revisar {flujo}", intro: TEXTOS_INICIALES.revision.intro } } };
  assert.deepEqual(cambiosCorreo(CONFIG_INICIAL, despues), ["Crear también la tarea de Trimble: no", "Asunto de «Te toca un paso»: «Revisar {flujo}»", "Enviar copia a: jefe@obra.co"]);
  assert.deepEqual(cambiosCorreo(CONFIG_INICIAL, CONFIG_INICIAL), []);
});
