import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";
import { Caller, ServiceError } from "../propiedades/service";
import type { ProjectContacts } from "../propiedades/types";
import { expediente } from "./documentos";
import { memoriaLectura } from "./presupuestoLectura";
import { trimbleFalso } from "./pruebas/trimbleFalso";
import {
  abrirDocumento,
  activar,
  anularDocumento,
  confirmarDocumento,
  crearDocumento,
  Ctx,
  enviarDocumento,
  getAccesos,
  getDocumentos,
  guardarProveedor,
  guardarRequisicion,
  guardarTiposDocumento,
  guardarUsuario,
  inspeccionarCarpetas,
  prepararCarpetas,
  reintentarDocumento,
} from "./service";
import { memoryStore } from "./store";
import type { NuevoDocumento, Rol } from "./types";

const HOY = "2026-10-16";
const ana: Caller = { id: "ana", name: "Ana Gómez", isAdmin: true };
const luis: Caller = { id: "luis", name: "Luis Pérez", isAdmin: false };
const marta: Caller = { id: "marta", name: "Marta Díaz", isAdmin: false };
const pedro: Caller = { id: "pedro", name: "Pedro Rojas", isAdmin: false };
const EQUIPO: ProjectContacts = { users: [ana, luis, marta, pedro].map((p) => ({ id: p.id, name: p.name, email: "", pending: false })), groups: [] };
const lectura = memoriaLectura({
  obra1: {
    documento: {
      data: {
        subpresupuestos: [{ id: "sp", nombre: "E", pie: [], items: [{ id: "muro", tipo: "partida", nivel: 0, codigo: "", descripcion: "MURO", unidad: "M2", omniclass: "", rendimiento: 10, jornada: 8, metrado: 10, origenId: null, componentes: [{ tipo: "insumo", id: "blq", cuadrilla: null, cantidad: 12.5 }] }] }],
        insumos: { blq: { codigo: "MT-04", descripcion: "BLOQUE", unidad: "UND", precio: 2_100, tipo: "MT", iu: "", omniclass: "" } },
        subpartidas: {},
        gastos: { fijos: [], variables: [] },
      },
      version: 1,
      updatedAt: null,
      updatedBy: null,
    },
  },
});

const sha = (texto: string) => createHash("sha256").update(texto).digest("hex");
let n = 0;
const nuevoId = () => `d0000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;

async function obra() {
  const store = memoryStore(() => HOY);
  const t = trimbleFalso();
  const ctx = (caller: Caller): Ctx => ({ projectId: "obra1", caller, store, presupuesto: lectura, hoy: HOY, deps: { contactos: async () => EQUIPO, cde: async () => ({ cliente: t.cliente, rootId: "raiz" }), fetch: t.fetchFalso } });
  await activar(ctx(ana));
  const { roles } = await getAccesos(ctx(ana));
  const rol = (clave: string) => (roles.find((r) => r.clave === clave) as Rol).id;
  for (const [u, c] of [["luis", "residente"], ["marta", "presupuesto_costos"], ["pedro", "compras"]]) {
    await guardarUsuario(ctx(ana), { userId: u, rolId: rol(c), desde: HOY, hasta: null, activo: true, version: 0 });
  }
  const req = (await guardarRequisicion(ctx(luis), { fechaRequerida: "2026-10-30", prioridad: "normal", justificacion: "x", lineas: [{ insumoId: "blq", partidaItemId: null, cantidad: 10, justificacionExceso: "" }], version: 0 })).requisiciones[0];
  return { store, t, ctx, req };
}

const nuevo = (entidadId: string, contenido: string, extra: Partial<NuevoDocumento> = {}) => ({
  id: nuevoId(),
  entidadTipo: "requisicion" as const,
  entidadId,
  tipoDoc: "soporte",
  nombreOriginal: "cotización ferretería.pdf",
  tamano: contenido.length,
  sha256: sha(contenido),
  origen: "cargado" as const,
  vence: null,
  ...extra,
});

async function rejects(p: Promise<unknown>, status: number, code?: string) {
  await assert.rejects(p, (e: unknown) => {
    assert.ok(e instanceof ServiceError, String(e));
    assert.equal(e.status, status, e.message);
    if (code) assert.equal(e.code, code, e.message);
    return true;
  });
}

describe("carpetas del CDE", () => {
  it("primero se revisan, luego se crean las que faltan y se guardan; repetir no duplica", async () => {
    const { ctx, t, req } = await obra();
    await rejects(crearDocumento(ctx(luis), nuevo(req.id, "x")), 409, "carpetas-sin-preparar");
    const antes = await inspeccionarCarpetas(ctx(ana));
    assert.equal(antes.carpetas.filter((c) => c.existe).length, 0);
    assert.equal(t.carpetas.size, 1); // only the root: looking creates nothing
    const despues = await prepararCarpetas(ctx(ana));
    assert.deepEqual(despues.carpetas.map((c) => c.ruta).slice(0, 2), ["Compras y Contrataciones", "Compras y Contrataciones / Requisiciones"]);
    assert.ok(despues.carpetas.every((c) => c.folderId && c.guardada));
    await prepararCarpetas(ctx(ana));
    assert.equal(t.carpetas.size, 8);
    await rejects(prepararCarpetas(ctx(luis)), 403);
  });
});

describe("documentos de los registros", () => {
  it("se registra pendiente y solo queda respaldado cuando Trimble confirma", async () => {
    const { ctx, t, req } = await obra();
    await prepararCarpetas(ctx(ana));
    const s = await crearDocumento(ctx(luis), nuevo(req.id, "contenido del pdf"));
    assert.equal(s.documento.estado, "pendiente");
    assert.equal(s.documento.ruta, "Compras y Contrataciones / Requisiciones");
    assert.match(s.documento.nombreArchivo, /^REQ-0001 - Soporte - cotización ferretería \[d0000000\]\.pdf$/);
    assert.equal((await confirmarDocumento(ctx(luis), s.documento.id)).documento.estado, "pendiente");
    await t.fetchFalso(s.url!, { method: "PUT", body: "contenido del pdf" });
    const listo = (await confirmarDocumento(ctx(luis), s.documento.id)).documento;
    assert.deepEqual([listo.estado, listo.revision, !!listo.fileId], ["respaldado", 1, true]);
    assert.match((await abrirDocumento(ctx(luis), listo.id)).url, /^https:\/\/descarga\.falsa\//);
  });

  it("el servidor envía archivos pequeños solo si son los registrados", async () => {
    const { ctx, req } = await obra();
    await prepararCarpetas(ctx(ana));
    const s = await crearDocumento(ctx(luis), nuevo(req.id, "factura"));
    await rejects(enviarDocumento(ctx(luis), s.documento.id, new TextEncoder().encode("otra cosa")), 400, "archivo-distinto");
    await enviarDocumento(ctx(luis), s.documento.id, new TextEncoder().encode("factura"));
    assert.equal((await confirmarDocumento(ctx(luis), s.documento.id)).documento.estado, "respaldado");
  });

  it("un reintento no duplica: si Trimble ya lo tiene, solo confirma; si la subida venció, abre otra", async () => {
    const { ctx, t, req } = await obra();
    await prepararCarpetas(ctx(ana));
    // The content arrived but nobody confirmed (the page was closed).
    const a = await crearDocumento(ctx(luis), nuevo(req.id, "a"));
    await t.fetchFalso(a.url!, { method: "PUT", body: "a" });
    const r1 = await reintentarDocumento(ctx(luis), a.documento.id);
    assert.deepEqual([r1.documento.estado, r1.url], ["respaldado", null]);
    // The upload expired without content: error, and the retry opens a new one.
    const b = await crearDocumento(ctx(luis), nuevo(req.id, "b", { nombreOriginal: "otro.pdf" }));
    t.vencer(b.documento.uploadId!);
    assert.equal((await confirmarDocumento(ctx(luis), b.documento.id)).documento.estado, "error");
    const r2 = await reintentarDocumento(ctx(luis), b.documento.id);
    assert.ok(r2.url);
    assert.equal(r2.documento.intentos, 2);
    await t.fetchFalso(r2.url!, { method: "PUT", body: "b" });
    assert.equal((await confirmarDocumento(ctx(luis), b.documento.id)).documento.estado, "respaldado");
    assert.equal([...t.archivos.values()].length, 2);
  });

  it("permisos, validaciones y anulación", async () => {
    const { ctx, req } = await obra();
    await prepararCarpetas(ctx(ana));
    await rejects(crearDocumento(ctx(marta), nuevo(req.id, "x")), 403, "sin-permiso");
    await rejects(crearDocumento(ctx(luis), nuevo(req.id, "x", { tipoDoc: "camara" })), 400, "datos");
    await rejects(crearDocumento(ctx(luis), nuevo(req.id, "x", { vence: "2026-12-01" })), 400, "datos");
    await rejects(crearDocumento(ctx(luis), nuevo("e0000000-0000-4000-8000-000000000000", "x")), 404, "no-existe");
    await rejects(crearDocumento(ctx(luis), nuevo(req.id, "x", { tamano: 200 * 1024 * 1024 })), 400, "archivo-grande");
    const s = await crearDocumento(ctx(luis), nuevo(req.id, "x"));
    await rejects(abrirDocumento(ctx(luis), s.documento.id), 409, "estado-no-valido");
    await rejects(anularDocumento(ctx(luis), s.documento.id, { motivo: "" }), 400, "motivo-requerido");
    const anulado = (await anularDocumento(ctx(luis), s.documento.id, { motivo: "Archivo equivocado" })).documento;
    assert.equal(anulado.estado, "anulado");
    // Marta (no documents permission) sees the list but can't open them.
    assert.equal((await getDocumentos(ctx(marta), new URLSearchParams({ entidadTipo: "requisicion", entidadId: req.id }))).documentos.length, 1);
  });
});

describe("expediente legal del proveedor", () => {
  it("cada proveedor tiene su carpeta y su expediente se completa con documentos respaldados", async () => {
    const { ctx, t } = await obra();
    await prepararCarpetas(ctx(ana));
    const { proveedores } = await guardarProveedor(ctx(pedro), {
      nit: "890903938", tipoPersona: "juridica", razonSocial: "Ferretería A", nombreComercial: "", contacto: "", telefono: "", correo: "", ciudad: "", direccion: "", categorias: ["MT"], responsableIva: true, observaciones: "", version: 0,
    });
    const p = proveedores[0];
    const s = await crearDocumento(ctx(pedro), nuevo(p.id, "camara", { entidadTipo: "proveedor", tipoDoc: "camara", vence: "2026-11-15", nombreOriginal: "camara.pdf" }));
    assert.equal(s.documento.ruta, "Compras y Contrataciones / Documentación legal de proveedores / 890.903.938-8 Ferretería A");
    await t.fetchFalso(s.url!, { method: "PUT", body: "camara" });
    await confirmarDocumento(ctx(pedro), s.documento.id);
    const d = await getDocumentos(ctx(pedro), new URLSearchParams({ entidadTipo: "proveedor" }));
    const exp = expediente(p.id, d.documentos, d.tipos, HOY);
    assert.equal(exp.estado, "incompleto");
    assert.equal(exp.items.find((i) => i.tipo.clave === "camara")?.estado, "vigente");
  });

  it("los tipos legales se ajustan (no se quitan) solo con Documentos: administrar", async () => {
    const { ctx } = await obra();
    const d = await getDocumentos(ctx(ana), new URLSearchParams());
    await rejects(guardarTiposDocumento(ctx(ana), { tipos: d.tipos.slice(1), version: d.versionConfig }), 400, "datos");
    const cambiados = d.tipos.map((t) => (t.clave === "bancaria" ? { ...t, obligatorio: false } : t));
    const r = await guardarTiposDocumento(ctx(ana), { tipos: cambiados, version: d.versionConfig });
    assert.equal(r.tipos.find((t) => t.clave === "bancaria")?.obligatorio, false);
    await rejects(guardarTiposDocumento(ctx(pedro), { tipos: cambiados, version: r.versionConfig }), 403);
  });
});
