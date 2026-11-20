import { test } from "node:test";
import assert from "node:assert/strict";
import { detalleSinAcceso, repartirRevision, textoSinAcceso } from "./avisoRevision";
import type { ResumenRevision } from "./types";

const resumen = (hito: string, o: Partial<ResumenRevision> = {}): ResumenRevision => ({
  flujoId: hito,
  hito,
  ocupado: false,
  completo: true,
  nuevos: 0,
  nuevasVersiones: 0,
  retirados: 0,
  reaparecidos: 0,
  sinCambios: 1,
  carpetas: 1,
  mensaje: `«${hito}»: sin cambios.`,
  ...o,
});

test("al abrir: las novedades quedan en el aviso y los flujos que solo no se pudieron leer van a una línea", () => {
  const { noticias, sinAcceso } = repartirRevision([
    resumen("Sin novedad"),
    resumen("Versión nueva", { nuevasVersiones: 1 }),
    resumen("Compras", { completo: false, sinAcceso: true, noLeidos: ["Obra / Compras / plan.xlsx"] }),
    resumen("Se acabó el tiempo", { completo: false, mensaje: "«Se acabó el tiempo»: sin cambios. Revisión incompleta (se acabó el tiempo de esta revisión): …" }),
    resumen("Ocupado", { ocupado: true }),
  ]);
  assert.deepEqual(
    noticias.map((r) => r.hito),
    ["Versión nueva", "Se acabó el tiempo", "Ocupado"]
  );
  assert.deepEqual(
    sinAcceso.map((r) => r.hito),
    ["Compras"]
  );
});

test("la línea de los flujos sin acceso y su detalle", () => {
  assert.equal(textoSinAcceso(1), "En 1 flujo hay archivos que tu cuenta no puede ver en Trimble: esos no se revisaron, y no cambia nada.");
  assert.equal(textoSinAcceso(7), "En 7 flujos hay archivos que tu cuenta no puede ver en Trimble: esos no se revisaron, y no cambia nada.");
  assert.equal(detalleSinAcceso({ hito: "Plan de suministro", noLeidos: ["Obra / Compras / a.xlsx", "Obra / Compras / b.xlsx"] }), "«Plan de suministro»: Obra / Compras / a.xlsx; Obra / Compras / b.xlsx");
  assert.equal(detalleSinAcceso({ hito: "Viejo" }), "«Viejo»: algunos archivos");
});
