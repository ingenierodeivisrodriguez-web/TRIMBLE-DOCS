import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { claveDe, nivelesEfectivos, revisarNivel, revisarNodo, rutaNodo } from "./estructura";
import { CambioNivel, CambioNodo, Nivel, Nodo } from "./types";

const nivel = (clave: string, extra: Partial<Nivel> = {}): Nivel => ({
  id: `n-${clave}`,
  projectId: null,
  clave,
  nombre: clave,
  orden: 1,
  padreClave: null,
  fuente: "manual",
  claveFuente: "",
  activo: true,
  version: 1,
  ...extra,
});
const nodo = (id: string, nivelClave: string, valor: string, padreId: string | null = null): Nodo => ({
  id,
  nivelClave,
  valor,
  padreId,
  responsableId: null,
  responsableNombre: "",
  inicio: null,
  fin: null,
  estado: "activo",
  nota: "",
  version: 1,
});

const plantilla = [nivel("torre", { orden: 1 }), nivel("nivel", { orden: 5, padreClave: "torre", fuente: "modelo", claveFuente: "Nivel" }), nivel("frente", { orden: 6 })];

describe("niveles de la estructura", () => {
  it("el proyecto hereda la plantilla y la reemplaza con sus propios niveles de la misma clave", () => {
    const propios = [nivel("nivel", { id: "p-nivel", projectId: "p1", orden: 5, padreClave: "torre", fuente: "propiedad", claveFuente: "attr-1" }), nivel("frente", { id: "p-frente", projectId: "p1", activo: false })];
    const ef = nivelesEfectivos(plantilla, propios);
    assert.deepEqual(
      ef.map((n) => [n.clave, n.fuente, n.heredado]),
      [
        ["torre", "manual", true],
        ["nivel", "propiedad", false],
      ],
      "frente se desactivó en el proyecto"
    );
  });

  it("clave desde el nombre, sin tildes ni espacios", () => {
    assert.equal(claveDe("Nombre de zona"), "nombre_de_zona");
    assert.equal(claveDe("Étapa 2"), "etapa_2");
    assert.equal(claveDe("1er bloque"), "n_1er_bloque");
  });

  const nuevo = (extra: Partial<CambioNivel>): CambioNivel => ({ projectId: null, clave: "bloque", nombre: "Bloque", orden: 8, padreClave: null, fuente: "manual", claveFuente: "", activo: true, version: 0, ...extra });

  it("clave válida y no reservada (capítulo, actividad y paquete vienen de Presupuesto)", () => {
    assert.equal(revisarNivel(nuevo({}), plantilla, plantilla), null);
    assert.equal(revisarNivel(nuevo({ clave: "capitulo" }), plantilla, plantilla), "datos");
    assert.equal(revisarNivel(nuevo({ clave: "Bloque" }), plantilla, plantilla), "datos");
    assert.equal(revisarNivel(nuevo({ clave: "torre" }), plantilla, plantilla), "clave-repetida");
  });

  it("del modelo o de Propiedades necesita la propiedad; a mano, no", () => {
    assert.equal(revisarNivel(nuevo({ fuente: "modelo" }), plantilla, plantilla), "datos");
    assert.equal(revisarNivel(nuevo({ fuente: "modelo", claveFuente: "Bloque" }), plantilla, plantilla), null);
    assert.equal(revisarNivel(nuevo({ claveFuente: "Bloque" }), plantilla, plantilla), "datos");
  });

  it("el nivel superior debe existir y no formar ciclos", () => {
    assert.equal(revisarNivel(nuevo({ padreClave: "torre" }), plantilla, plantilla), null);
    assert.equal(revisarNivel(nuevo({ padreClave: "manzana" }), plantilla, plantilla), "padre-no-valido");
    const torre = plantilla[0];
    assert.equal(revisarNivel({ ...torre, padreClave: "nivel", version: 1 }, plantilla, plantilla), "padre-no-valido", "torre bajo nivel bajo torre");
  });

  it("no se cambia la clave de un nivel guardado y la versión debe coincidir", () => {
    const torre = plantilla[0];
    assert.equal(revisarNivel({ ...torre, clave: "edificio", version: 1 }, plantilla, plantilla), "datos");
    assert.equal(revisarNivel({ ...torre, nombre: "Edificio", version: 0 }, plantilla, plantilla), "version-conflict");
    assert.equal(revisarNivel({ ...torre, nombre: "Edificio", version: 1 }, plantilla, plantilla), null);
  });
});

describe("valores de los niveles", () => {
  const nodos = [nodo("t1", "torre", "Torre 1"), nodo("p5", "nivel", "Piso 5", "t1")];
  const nuevo = (extra: Partial<CambioNodo>): CambioNodo => ({
    nivelClave: "nivel",
    valor: "Piso 6",
    padreId: "t1",
    responsableId: null,
    responsableNombre: "",
    inicio: null,
    fin: null,
    estado: "activo",
    nota: "",
    version: 0,
    ...extra,
  });

  it("Piso 6 cuelga de Torre 1; no de otro piso ni de un nivel sin superior", () => {
    assert.equal(revisarNodo(nuevo({}), plantilla, nodos), null);
    assert.equal(revisarNodo(nuevo({ padreId: "p5" }), plantilla, nodos), "padre-no-valido");
    assert.equal(revisarNodo(nuevo({ nivelClave: "torre", valor: "Torre 2" }), plantilla, nodos), "padre-no-valido");
    assert.equal(revisarNodo(nuevo({ nivelClave: "torre", valor: "Torre 2", padreId: null }), plantilla, nodos), null);
  });

  it("un valor repetido en el mismo nivel y dentro del mismo valor superior (sin importar mayúsculas) se rechaza", () => {
    assert.equal(revisarNodo(nuevo({ valor: " piso 5 " }), plantilla, nodos), "valor-repetido");
    // Piso 5 of another tower is another place.
    const conTorre2 = [...nodos, { ...nodos[0], id: "t2", valor: "Torre 2" }];
    assert.equal(revisarNodo(nuevo({ valor: "Piso 5", padreId: "t2" }), plantilla, conTorre2), null);
  });

  it("nivel inexistente, fechas al revés y responsable a medias se rechazan", () => {
    assert.equal(revisarNodo(nuevo({ nivelClave: "manzana" }), plantilla, nodos), "nivel-no-valido");
    assert.equal(revisarNodo(nuevo({ inicio: "2026-10-20", fin: "2026-10-01" }), plantilla, nodos), "datos");
    assert.equal(revisarNodo(nuevo({ responsableId: "ana" }), plantilla, nodos), "datos");
    assert.equal(revisarNodo(nuevo({ responsableId: "ana", responsableNombre: "Ana Gómez" }), plantilla, nodos), null);
  });

  it("la ruta de un valor muestra sus superiores", () => {
    assert.equal(rutaNodo(nodos[1], nodos), "Torre 1 › Piso 5");
  });
});
