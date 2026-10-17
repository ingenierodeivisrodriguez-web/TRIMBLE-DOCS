import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { carpetaProveedor, expediente, nombreArchivo, nombreSeguro, revisarTipos, rutaCarpeta, sugerirVence, TIPOS_LEGALES_INICIALES, vigencia } from "./documentos";
import type { Documento } from "./types";

const HOY = "2026-10-16";

function doc(tipoDoc: string, estado: Documento["estado"], vence: string | null, creado = "2026-10-01T10:00:00Z"): Documento {
  return {
    id: `${tipoDoc}-${creado}`, entidadTipo: "proveedor", entidadId: "p1", tipoDoc, titulo: tipoDoc, nombreOriginal: "a.pdf", nombreArchivo: "a.pdf", carpetaId: "c", ruta: "",
    tamano: 1, sha256: "x", origen: "cargado", vence, estado, uploadId: null, fileId: estado === "respaldado" ? "f" : null, versionId: estado === "respaldado" ? "v" : null,
    revision: 1, intentos: 1, ultimoError: "", subidoPorId: "ana", subidoPor: "Ana", creado, confirmado: null, motivoAnulacion: "", version: 1,
  };
}

describe("carpetas y nombres en el CDE", () => {
  it("las rutas cuelgan de Compras y Contrataciones", () => {
    assert.equal(rutaCarpeta("proveedores"), "Compras y Contrataciones / Documentación legal de proveedores");
  });

  it("los nombres no llevan caracteres que Trimble rechaza", () => {
    assert.equal(nombreSeguro('RUT: 2026/10 "final"?'), "RUT- 2026-10 -final--");
    assert.equal(nombreSeguro("   "), "documento");
    assert.equal(carpetaProveedor("890.903.938-8", "Ferretería A / Sur"), "890.903.938-8 Ferretería A - Sur");
  });

  it("el nombre del archivo lleva el registro, el tipo, el original y el id: único y fijo para reintentar", () => {
    const n = nombreArchivo("OC-0007", "Orden de compra (PDF)", "orden final.PDF", "1a2b3c4d-0000-4000-8000-000000000000");
    assert.equal(n, "OC-0007 - Orden de compra (PDF) - orden final [1a2b3c4d].pdf");
    assert.equal(nombreArchivo("REQ-0001", "Soporte", "sin extension", "abcdef12-0000"), "REQ-0001 - Soporte - sin extension [abcdef12]");
  });
});

describe("expediente legal del proveedor", () => {
  const tipos = TIPOS_LEGALES_INICIALES;

  it("sugiere el vencimiento según la vigencia del tipo", () => {
    assert.equal(sugerirVence({ vigenciaDias: 30 }, HOY), "2026-11-15");
    assert.equal(sugerirVence({ vigenciaDias: null }, HOY), null);
    assert.equal(vigencia("2026-10-20", HOY), "por-vencer");
    assert.equal(vigencia("2026-10-15", HOY), "vencido");
    assert.equal(vigencia("2027-01-01", HOY), "vigente");
  });

  it("está incompleto si falta un obligatorio o aún no lo confirmó Trimble", () => {
    assert.equal(expediente("p1", [], tipos, HOY).estado, "incompleto");
    const casi = ["rut", "camara", "cedula", "bancaria"].map((t) => doc(t, "respaldado", t === "camara" ? "2026-11-10" : null));
    assert.equal(expediente("p1", [...casi, doc("seguridad_social", "pendiente", "2026-11-10")], tipos, HOY).estado, "incompleto");
    const item = expediente("p1", [...casi, doc("seguridad_social", "pendiente", "2026-11-10")], tipos, HOY).items.find((i) => i.tipo.clave === "seguridad_social")!;
    assert.equal(item.estado, "sin-respaldo");
  });

  it("completo, por vencer o vencido según el documento más reciente de cada tipo", () => {
    const base = ["rut", "cedula", "bancaria"].map((t) => doc(t, "respaldado", null));
    const completo = [...base, doc("camara", "respaldado", "2026-12-01"), doc("seguridad_social", "respaldado", "2026-12-01")];
    assert.equal(expediente("p1", completo, tipos, HOY).estado, "completo");
    const porVencer = [...base, doc("camara", "respaldado", "2026-10-25"), doc("seguridad_social", "respaldado", "2026-12-01")];
    assert.equal(expediente("p1", porVencer, tipos, HOY).estado, "por-vencer");
    // An expired Cámara replaced by a newer one is fine; an expired one alone is not.
    const vencido = [...base, doc("camara", "respaldado", "2026-10-01"), doc("seguridad_social", "respaldado", "2026-12-01")];
    assert.equal(expediente("p1", vencido, tipos, HOY).estado, "vencido");
    const renovado = [...vencido, doc("camara", "respaldado", "2026-11-30", "2026-10-15T10:00:00Z")];
    assert.equal(expediente("p1", renovado, tipos, HOY).estado, "completo");
    // Cancelled documents don't count.
    assert.equal(expediente("p1", [...base, doc("camara", "anulado", "2026-12-01"), doc("seguridad_social", "respaldado", "2026-12-01")], tipos, HOY).estado, "incompleto");
  });

  it("los tipos se ajustan pero no se quitan los que ya existían", () => {
    assert.equal(revisarTipos(tipos, tipos), null);
    assert.match(revisarTipos(tipos.slice(1), tipos)!, /No se quitan tipos/);
    assert.match(revisarTipos([...tipos, { ...tipos[0] }], tipos)!, /repetida/);
    assert.match(revisarTipos([{ ...tipos[0], vigenciaDias: 0 }, ...tipos.slice(1)], tipos)!, /vigencia/);
  });
});
