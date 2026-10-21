import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { accionesPosibles, accionFlujo, ActorFlujo, avisosFlujo, describirFlujo, DocumentoEnFlujo, flujosSugeridos, ResultadoFlujo, revisarPasos } from "./flujos";
import { ROLES_INICIALES } from "./roles";
import { PasoFlujo, Permiso } from "./types";

// The initial roles, with ids equal to their keys.
const ROLES = ROLES_INICIALES.map((r) => ({ id: r.clave, clave: r.clave, nombre: r.nombre, activo: true, permisos: r.permisos }));
const permisos = (clave: string) => ROLES.find((r) => r.clave === clave)!.permisos;
const actor = (id: string, rolId: string): ActorFlujo => ({ id, rolId, permisos: permisos(rolId) });

const residente = actor("rosa", "residente");
const otroResidente = actor("raul", "residente");
const director = actor("dario", "director");
const interventor = actor("ines", "interventoria");

const ACTA: PasoFlujo[] = [
  { nombre: "Elabora", rolId: "residente", rolNombre: "Residente de obra" },
  { nombre: "Preaprueba", rolId: "director", rolNombre: "Director de proyecto" },
  { nombre: "Aprueba", rolId: "interventoria", rolNombre: "Interventoría" },
];

const borrador = (elaboradoPorId = "rosa"): DocumentoEnFlujo => ({ estado: "borrador", elaboradoPorId, flujo: null });

/** Applies the action and expects it to go through. */
function hacer(doc: DocumentoEnFlujo, accion: Parameters<typeof accionFlujo>[2], quien: ActorFlujo, motivo = "", pasosVigentes: PasoFlujo[] | null = ACTA): DocumentoEnFlujo {
  const r = accionFlujo("acta_cliente", doc, accion, quien, { motivo, pasosVigentes });
  assert.equal(typeof r, "object", `${accion} de ${quien.id} fue rechazado: ${String(r)}`);
  const ok = r as ResultadoFlujo;
  return { ...doc, estado: ok.estado, flujo: ok.flujo };
}

describe("flujos de aprobación: configuración", () => {
  it("un flujo necesita al menos quien elabora y quien aprueba, y como máximo 6 pasos", () => {
    assert.match(revisarPasos("acta_cliente", [{ nombre: "Elabora", rolId: "residente" }], ROLES)!, /al menos 2 pasos/);
    const siete = Array.from({ length: 7 }, (_, i) => ({ nombre: `Paso ${i}`, rolId: i === 0 ? "residente" : "director" }));
    assert.match(revisarPasos("acta_cliente", siete, ROLES)!, /hasta 6 pasos/);
    assert.equal(revisarPasos("acta_cliente", ACTA, ROLES), null);
  });

  it("cada paso exige un rol activo con el permiso del módulo: crear en el primero, aprobar en los demás", () => {
    assert.match(revisarPasos("acta_cliente", [ACTA[0], { nombre: "Aprueba", rolId: "costos" }], ROLES)!, /Profesional de costos no tiene permiso de aprobar en actas al cliente/);
    assert.match(revisarPasos("acta_cliente", [{ nombre: "Elabora", rolId: "interventoria" }, ACTA[1]], ROLES)!, /Interventoría no tiene permiso de crear/);
    // Closing a non-conformity starts with whoever corrected it: they need to edit it, not create it.
    assert.equal(revisarPasos("cierre_nc", [{ nombre: "Envía", rolId: "residente" }, { nombre: "Cierra", rolId: "responsable_tecnico" }], ROLES), null);
    const inactivos = ROLES.map((r) => (r.id === "director" ? { ...r, activo: false } : r));
    assert.match(revisarPasos("acta_cliente", ACTA, inactivos)!, /Director de proyecto está desactivado/);
    assert.match(revisarPasos("acta_cliente", [ACTA[0], { nombre: " ", rolId: "director" }], ROLES)!, /Paso 2: escribe su nombre/);
  });

  it("avisa los pasos que nadie puede atender hoy y el rol repetido sin personas suficientes", () => {
    const personas = { residente: ["Rosa"], director: ["Darío"] };
    assert.deepEqual(avisosFlujo("acta_cliente", ACTA, ROLES, personas), ["Paso 3 (Aprueba): nadie tiene hoy el rol Interventoría en este proyecto."]);
    const dosDirectores = [ACTA[0], ACTA[1], { nombre: "Aprueba", rolId: "director" }];
    assert.match(avisosFlujo("acta_cliente", dosDirectores, ROLES, personas).join(" "), /Director de proyecto está en varios pasos/);
    assert.deepEqual(avisosFlujo("acta_cliente", dosDirectores, ROLES, { ...personas, director: ["Darío", "Diana"] }), []);
  });

  it("los flujos sugeridos salen de los roles iniciales y se omiten si falta un rol", () => {
    const s = flujosSugeridos(ROLES);
    assert.equal(describirFlujo(s.acta_cliente!), "Residente de obra (elabora) → Director de proyecto (preaprueba) → Interventoría (aprueba)");
    assert.equal(describirFlujo(s.vale_salida!), "Almacenista (elabora) → Residente de obra (aprueba)");
    for (const [tipo, pasos] of Object.entries(s)) assert.equal(revisarPasos(tipo as never, pasos, ROLES), null, tipo);
    const sinInterventoria = flujosSugeridos(ROLES.filter((r) => r.clave !== "interventoria"));
    assert.equal(sinInterventoria.acta_cliente, undefined);
    assert.ok(sinInterventoria.acta_subcontrato);
  });
});

describe("flujos de aprobación: un documento", () => {
  it("residente → director → interventoría; la interventoría devuelve una vez y vuelve al director (prueba de aceptación)", () => {
    let acta = hacer(borrador(), "enviar", residente);
    assert.equal(acta.estado, "en_tramite");
    assert.equal(acta.flujo!.paso, 1);
    acta = hacer(acta, "aprobar", director);
    assert.equal(acta.flujo!.paso, 2);
    // Returned with a reason: back to the previous step (the director), not to the start.
    assert.equal(accionFlujo("acta_cliente", acta, "devolver", interventor, { motivo: " ", pasosVigentes: ACTA }), "motivo-requerido");
    acta = hacer(acta, "devolver", interventor, "Revisar la cantidad del Piso 2");
    assert.equal(acta.estado, "en_tramite");
    assert.equal(acta.flujo!.paso, 1);
    assert.deepEqual(acta.flujo!.firmas, { "0": "rosa" }, "la firma del director ya no cuenta");
    acta = hacer(acta, "aprobar", director);
    acta = hacer(acta, "aprobar", interventor);
    assert.equal(acta.estado, "aprobado");
    assert.deepEqual(acta.flujo!.firmas, { "0": "rosa", "1": "dario", "2": "ines" });
    assert.equal(accionFlujo("acta_cliente", acta, "aprobar", interventor, { pasosVigentes: ACTA }), "estado-no-permite");
    assert.equal(accionFlujo("acta_cliente", acta, "anular", director, { motivo: "x", pasosVigentes: ACTA }), "estado-no-permite");
  });

  it("devolver desde el primer paso de aprobación deja el documento devuelto a quien lo elabora, que puede corregir y reenviar", () => {
    let acta = hacer(borrador(), "enviar", residente);
    acta = hacer(acta, "devolver", director, "Falta el antepecho");
    assert.equal(acta.estado, "devuelto");
    assert.equal(acta.flujo!.paso, 0);
    assert.deepEqual(acta.flujo!.firmas, {});
    acta = hacer(acta, "enviar", residente);
    assert.equal(acta.flujo!.paso, 1);
  });

  it("quien elabora no aprueba lo suyo aunque tenga el rol del paso", () => {
    // Darío prepared it (as director he can't send it: step 0 is the resident's).
    const suyo = borrador("dario");
    assert.equal(accionFlujo("acta_cliente", suyo, "enviar", director, { pasosVigentes: ACTA }), "paso-ajeno");
    const enviado = hacer(suyo, "enviar", residente);
    assert.equal(accionFlujo("acta_cliente", enviado, "aprobar", director, { pasosVigentes: ACTA }), "auto-aprobacion");
  });

  it("una persona firma un solo paso del mismo documento", () => {
    // A company whose residents may also approve: Rosa prepares, another resident reviews.
    const conAprobar = (a: ActorFlujo): ActorFlujo => ({ ...a, permisos: [...a.permisos, "actas_cliente.aprobar"] });
    const pasos: PasoFlujo[] = [ACTA[0], { nombre: "Revisa", rolId: "residente" }, ACTA[1]];
    const r = accionFlujo("acta_cliente", borrador("raul"), "enviar", conAprobar(residente), { pasosVigentes: pasos });
    const enviado = { ...borrador("raul"), ...(r as ResultadoFlujo) };
    // Rosa sent it: she can't also review it, nor can Raúl, who prepared it; a third resident can.
    assert.equal(accionFlujo("acta_cliente", enviado, "aprobar", conAprobar(residente), { pasosVigentes: pasos }), "auto-aprobacion");
    assert.equal(accionFlujo("acta_cliente", enviado, "aprobar", conAprobar(otroResidente), { pasosVigentes: pasos }), "auto-aprobacion");
    assert.equal(typeof accionFlujo("acta_cliente", enviado, "aprobar", conAprobar(actor("rita", "residente")), { pasosVigentes: pasos }), "object");
  });

  it("cada paso lo atiende su rol con su permiso; sin flujo configurado no se envía", () => {
    assert.equal(accionFlujo("acta_cliente", borrador(), "enviar", residente, { pasosVigentes: null }), "sin-flujo");
    assert.equal(accionFlujo("acta_cliente", borrador(), "enviar", director, { pasosVigentes: ACTA }), "paso-ajeno");
    const acta = hacer(borrador(), "enviar", residente);
    assert.equal(accionFlujo("acta_cliente", acta, "aprobar", interventor, { pasosVigentes: ACTA }), "paso-ajeno", "todavía le toca al director");
    const sinPermiso: ActorFlujo = { ...director, permisos: director.permisos.filter((p) => p !== ("actas_cliente.aprobar" as Permiso)) };
    assert.equal(accionFlujo("acta_cliente", acta, "aprobar", sinPermiso, { pasosVigentes: ACTA }), "sin-permiso");
  });

  it("el documento conserva el flujo con que se envió aunque el proyecto lo cambie después", () => {
    const acta = hacer(borrador(), "enviar", residente);
    const nuevo: PasoFlujo[] = [ACTA[0], ACTA[2]];
    // The project now skips the director, but this acta keeps its three steps.
    const r = accionFlujo("acta_cliente", acta, "aprobar", director, { pasosVigentes: nuevo }) as ResultadoFlujo;
    assert.equal(r.estado, "en_tramite");
    assert.equal(r.flujo!.pasos.length, 3);
  });

  it("anular exige motivo y permiso, y no aplica a lo aprobado", () => {
    assert.equal(accionFlujo("acta_cliente", borrador(), "anular", residente, { motivo: "Duplicada", pasosVigentes: ACTA }), "sin-permiso");
    assert.equal(accionFlujo("acta_cliente", borrador(), "anular", director, { motivo: "", pasosVigentes: ACTA }), "motivo-requerido");
    const r = accionFlujo("acta_cliente", borrador(), "anular", director, { motivo: "Duplicada", pasosVigentes: ACTA }) as ResultadoFlujo;
    assert.equal(r.estado, "anulado");
  });

  it("los botones muestran solo lo que la persona puede hacer ahora", () => {
    const acta = hacer(borrador(), "enviar", residente);
    assert.deepEqual(accionesPosibles("acta_cliente", acta, director, ACTA), ["aprobar", "devolver", "anular"]);
    assert.deepEqual(accionesPosibles("acta_cliente", acta, interventor, ACTA), []);
    assert.deepEqual(accionesPosibles("acta_cliente", borrador(), residente, ACTA), ["enviar"]);
  });
});
