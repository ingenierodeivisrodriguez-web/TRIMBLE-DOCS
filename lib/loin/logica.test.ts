import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buscarValor, coincideGrupo, leerAlias, leerListaAlias, PropiedadesObjeto, textoListaAlias } from "./alias";
import { agregarGrupo, conteoPorNdi, exigidosHasta, nivelesCon, nivelesLibres, nombreNdi, textoUsos, usosDeNiveles } from "./ndi";
import { codigoLibre, contenidoPlantilla, elementosDePlantilla } from "./plantillas";
import { errorPatron, leerBooleano, leerFecha, leerNumero, revisarValor, VALORES_BASURA_INICIALES } from "./reglas";
import { codigoDyco, disciplinasSugeridas, parametrosDyco, TDI_INICIALES } from "./semilla";
import { Disciplina, Elemento, Parametro, Plantilla, REGLA_VACIA } from "./types";

const parametro = (p: Partial<Parametro>): Parametro => ({
  id: "p1", codigo: "P-1", numero: 1, nombre: "Altura", descripcion: "", tdi: "B", ndi: 1, origen: "automatica", tipoDato: "texto",
  unidad: "", valoresPermitidos: [], regla: REGLA_VACIA, alias: [], idsUri: "", activo: true, version: 1, actualizado: "", actualizadoPor: null, ...p,
});

describe("equivalencias de lectura (alias)", () => {
  it("se escriben Grupo.Propiedad, *.Propiedad o @Atributo y solo el primer punto separa", () => {
    assert.deepEqual(leerAlias("Pset_WallCommon.LoadBearing"), { grupo: "Pset_WallCommon", propiedad: "LoadBearing", sugerida: false });
    assert.deepEqual(leerAlias("Datos de identidad.Mat. Profesional"), { grupo: "Datos de identidad", propiedad: "Mat. Profesional", sugerida: false });
    assert.deepEqual(leerAlias("@Name"), { grupo: "@", propiedad: "Name", sugerida: false });
    assert.equal(leerAlias("SinPunto"), null);
    assert.equal(leerAlias(".Altura"), null);
  });

  it("la celda de Excel conserva cuáles son sugeridas y avisa las que no se entienden", () => {
    const { alias, errores } = leerListaAlias("*.LoadBearing (sugerida); Datos de identidad.Capacidad de carga; malo");
    assert.equal(alias.length, 2);
    assert.equal(alias[0].sugerida, true);
    assert.deepEqual(errores, ["malo"]);
    assert.equal(textoListaAlias(alias), "*.LoadBearing (sugerida); Datos de identidad.Capacidad de carga");
  });

  it("el grupo admite comodines y los nombres no distinguen mayúsculas ni tildes", () => {
    assert.ok(coincideGrupo("*", "Lo que sea"));
    assert.ok(coincideGrupo("Qto_*BaseQuantities", "Qto_WallBaseQuantities"));
    assert.ok(!coincideGrupo("Qto_*BaseQuantities", "Pset_WallCommon"));
    assert.ok(coincideGrupo("Datos de identidad", "DATOS DE IDENTIDAD"));
  });

  it("toma la primera equivalencia que tiene valor, en el orden de preferencia", () => {
    const objeto: PropiedadesObjeto = {
      grupos: [
        { nombre: "Pset_WallCommon", propiedades: [{ nombre: "LoadBearing", valor: "" }] },
        { nombre: "Datos de identidad", propiedades: [{ nombre: "Codigo de proyecto", valor: "P-01" }, { nombre: "Capacidad de carga", valor: true }] },
      ],
      atributos: { Name: "Muro 1" },
    };
    const alias = leerListaAlias("Pset_WallCommon.LoadBearing; *.Capacidad de carga").alias;
    assert.deepEqual(buscarValor(objeto, alias), { valor: true, ruta: "Datos de identidad.Capacidad de carga", alias: alias[1] });
    // Accents aside: "Código" finds "Codigo".
    assert.equal(buscarValor(objeto, [{ grupo: "*", propiedad: "Código de proyecto", sugerida: false }])?.valor, "P-01");
    assert.equal(buscarValor(objeto, [{ grupo: "@", propiedad: "name", sugerida: false }])?.valor, "Muro 1");
    // Present but empty counts as found (the content check decides); absent is null.
    assert.equal(buscarValor(objeto, [alias[0]])?.valor, "");
    assert.equal(buscarValor(objeto, [{ grupo: "*", propiedad: "Volumen", sugerida: false }]), null);
  });
});

describe("regla de valor", () => {
  const basura = VALORES_BASURA_INICIALES;
  const texto = { tipoDato: "texto" as const, valoresPermitidos: [], unidad: "" };

  it("vacío y valores de relleno no cumplen en texto", () => {
    assert.deepEqual(revisarValor(texto, REGLA_VACIA, "  ", basura).ok, false);
    const r = revisarValor(texto, REGLA_VACIA, "n/a", basura);
    assert.equal(r.ok, false);
    assert.equal(!r.ok && r.motivo, "basura");
    assert.equal(revisarValor(texto, REGLA_VACIA, "0", basura).ok, false);
  });

  it("un 0 es un número válido (inclinación de 0° = plano horizontal), salvo que el mínimo lo impida", () => {
    const numero = { tipoDato: "numero" as const, valoresPermitidos: [], unidad: "°" };
    assert.deepEqual(revisarValor(numero, REGLA_VACIA, 0, basura), { ok: true, valor: 0 });
    const r = revisarValor(numero, { ...REGLA_VACIA, min: 0.08, max: 0.5 }, "0", basura);
    assert.equal(!r.ok && r.motivo, "rango");
    assert.equal(revisarValor(numero, { ...REGLA_VACIA, min: 0.08, max: 0.5 }, "0,15", basura).ok, true);
    assert.equal(!revisarValor(numero, REGLA_VACIA, "alto", basura).ok && "tipo", "tipo");
    // "N/A" in a number or a yes/no is a garbage value (not filled in), not a wrong type.
    const na = revisarValor({ tipoDato: "booleano", valoresPermitidos: [], unidad: "" }, REGLA_VACIA, "N/A", basura);
    assert.equal(!na.ok && na.motivo, "basura");
    assert.equal(revisarValor({ tipoDato: "booleano", valoresPermitidos: [], unidad: "" }, REGLA_VACIA, "0", basura).ok, true);
  });

  it("lee números, verdadero/falso y fechas como los escriben los modelos", () => {
    assert.equal(leerNumero("250 mm"), 250);
    assert.equal(leerNumero("1.234,5"), 1234.5);
    assert.equal(leerNumero("abc"), null);
    assert.equal(leerBooleano("TRUE"), true);
    assert.equal(leerBooleano("Sí"), true);
    assert.equal(leerBooleano(".F."), false);
    assert.equal(leerBooleano("tal vez"), null);
    assert.equal(leerFecha("05-10-2026"), "2026-10-05");
    assert.equal(leerFecha("2026-10-05T10:00:00Z"), "2026-10-05");
    assert.equal(leerFecha("31-02-2026"), null);
  });

  it("la lista solo acepta sus valores (sin importar mayúsculas ni tildes) y el patrón se aplica completo", () => {
    const lista = { tipoDato: "lista" as const, valoresPermitidos: ["NUEVO", "DEMOLICION"], unidad: "" };
    assert.equal(revisarValor(lista, REGLA_VACIA, "Demolición", basura).ok, true);
    const r = revisarValor(lista, REGLA_VACIA, "NEW", basura);
    assert.equal(!r.ok && r.motivo, "lista");
    const regla = { ...REGLA_VACIA, patron: "[A-ZÑ0-9_ ]+" };
    assert.equal(revisarValor(texto, regla, "SALA_DE_BOMBAS", basura).ok, true);
    assert.equal(!revisarValor(texto, regla, "Cocina", basura).ok, true);
    assert.equal(errorPatron("[A-Z"), "El patrón no es una expresión regular válida (Invalid regular expression: /^(?:[A-Z)$/u: Unterminated character class).");
    assert.equal(errorPatron(""), null);
  });
});

describe("NDI acumulado", () => {
  const catalogo = new Map(
    [
      parametro({ id: "a", ndi: 1, tdi: "B" }),
      parametro({ id: "b", ndi: 2, tdi: "B" }),
      parametro({ id: "c", ndi: 3, tdi: "B" }),
      parametro({ id: "d", ndi: 1, tdi: "B", activo: false }),
    ].map((p) => [p.id, p])
  );
  const asignados = ["a", "b", "c", "d", "x"].map((id) => ({ parametroId: id, obligatorio: id !== "b", ndi: null, regla: null }));

  it("NDI-2 exige los parámetros de nivel 1 y 2; los inactivos o borrados del catálogo no cuentan", () => {
    assert.deepEqual(exigidosHasta(asignados, catalogo, 1).map((e) => e.parametro.id), ["a"]);
    assert.deepEqual(exigidosHasta(asignados, catalogo, 2).map((e) => e.parametro.id), ["a", "b"]);
    assert.deepEqual(exigidosHasta(asignados, catalogo, 3).map((e) => e.parametro.id), ["a", "b", "c"]);
  });

  it("el elemento puede cambiar el NDI y la regla de un parámetro solo para él", () => {
    const propios = [{ parametroId: "c", obligatorio: true, ndi: 1 as const, regla: { ...REGLA_VACIA, min: 1 } }];
    const [e] = exigidosHasta(propios, catalogo, 1);
    assert.equal(e.ndi, 1);
    assert.equal(e.regla.min, 1);
    assert.deepEqual(conteoPorNdi([...asignados, ...propios], catalogo, [1, 2, 3]).get(1), { obligatorios: 2, opcionales: 0 });
  });

  it("los niveles se configuran: el conteo trae cada nivel del catálogo y los que el elemento usa aunque no estén", () => {
    const cuatro = new Map([...catalogo, ["g", parametro({ id: "g", ndi: 4 })]]);
    const conteo = conteoPorNdi([...asignados, { parametroId: "g", obligatorio: false, ndi: null, regla: null }], cuatro, [1, 2, 5]);
    assert.deepEqual([...conteo.keys()], [1, 2, 3, 4, 5]);
    assert.deepEqual(conteo.get(4), { obligatorios: 0, opcionales: 1 });
    assert.deepEqual(conteo.get(5), { obligatorios: 0, opcionales: 0 });
    // Cumulative by number, whatever the levels are.
    assert.deepEqual(exigidosHasta([{ parametroId: "g", obligatorio: true, ndi: null, regla: null }], cuatro, 5).map((e) => e.ndi), [4]);
  });

  it("nombres, menú y siguiente número libre de los niveles NDI", () => {
    const niveles = [{ numero: 1, nombre: "" }, { numero: 2, nombre: "Diseño" }, { numero: 4, nombre: "" }];
    assert.equal(nombreNdi(2, niveles), "NDI-2 · Diseño");
    assert.equal(nombreNdi(1, niveles), "NDI-1");
    assert.equal(nombreNdi(3, niveles), "NDI-3 (no configurado)");
    assert.deepEqual(nivelesCon(niveles, 7, null, 2), [1, 2, 4, 7]);
    assert.deepEqual(nivelesLibres(niveles), [3, 5, 6, 7, 8, 9]);
    assert.deepEqual(nivelesLibres([1, 2, 3, 4, 5, 6, 7, 8, 9].map((numero) => ({ numero, nombre: "" }))), []);
  });

  it("dice dónde se usa un nivel antes de quitarlo", () => {
    const plantilla = {
      contenido: { disciplina: { codigo: "ARQ", nombre: "Arquitectura", color: "#000000" }, elementos: [{ parametros: [{ parametroId: "a", obligatorio: true, ndi: 4, regla: null }] }] },
    } as unknown as Plantilla;
    const usos = usosDeNiveles(new Set([3, 4]), {
      parametros: [...catalogo.values()],
      elementos: [{ parametros: [{ parametroId: "a", obligatorio: true, ndi: 4, regla: null }, { parametroId: "b", obligatorio: true, ndi: 4, regla: null }] }, { parametros: asignados }],
      plantillas: [plantilla],
      celdas: [{ ndi: 4 }, { ndi: 4 }, { ndi: 1 }, { ndi: null }],
    });
    assert.deepEqual([...usos.keys()], [3, 4]);
    assert.deepEqual(usos.get(4), { parametros: 0, elementos: 1, plantillas: 1, celdas: 2 });
    assert.equal(textoUsos(usos.get(4)!), "1 elemento(s) (con un NDI propio en algún parámetro), 1 plantilla(s) y 2 celda(s) de la matriz");
    assert.equal(textoUsos(usos.get(3)!), "1 parámetro(s) del catálogo");
  });

  it("\"Agregar todos los NDI-1 del grupo\" agrega solo los que faltan", () => {
    const todos = [...catalogo.values(), parametro({ id: "e", ndi: 1, tdi: "B" }), parametro({ id: "f", ndi: 1, tdi: "C" })];
    const out = agregarGrupo([{ parametroId: "a", obligatorio: false, ndi: null, regla: null }], todos, "B", 1);
    assert.deepEqual(out.map((p) => [p.parametroId, p.obligatorio]), [["a", false], ["e", true]]);
  });
});

describe("semilla DYCO", () => {
  const dyco = parametrosDyco();

  it("trae los 89 parámetros con códigos únicos y N° del 1 al 89", () => {
    assert.equal(dyco.length, 89);
    assert.equal(new Set(dyco.map((p) => p.codigo)).size, 89);
    assert.deepEqual([...dyco.map((p) => p.numero)].sort((a, b) => (a ?? 0) - (b ?? 0)), Array.from({ length: 89 }, (_, i) => i + 1));
    assert.equal(codigoDyco(7), "DYCO-007");
  });

  it("respeta TDI, NDI y origen del listado, con las correcciones aprobadas", () => {
    const de = (n: number) => dyco.find((p) => p.numero === n)!;
    assert.deepEqual([de(1).tdi, de(1).ndi, de(1).origen], ["A", 1, "a_ingresar"]);
    assert.deepEqual([de(2).origen, de(49).origen, de(55).origen], ["por_definir", "por_definir", "por_definir"]);
    assert.equal(de(50).nombre, "Descripción");
    assert.ok(de(50).alias.some((a) => a.propiedad === "Decripcion" && !a.sugerida));
    assert.deepEqual(de(20).valoresPermitidos, ["NUEVO", "EXISTENTE", "DEMOLICION", "TEMPORAL", "OTRO", "DESCONOCIDO"]);
    assert.equal(de(86).nombre, "Espacio");
    assert.equal(de(86).regla.patron, "[A-ZÑ0-9_ ]+");
    assert.ok(dyco.every((p) => TDI_INICIALES.some((g) => g.codigo === p.tdi)));
  });

  it("las equivalencias IFC quedan sugeridas; Resistencia al Fuego no lleva FireRating", () => {
    const de = (n: number) => dyco.find((p) => p.numero === n)!;
    assert.ok(de(18).alias.some((a) => a.propiedad === "LoadBearing" && a.sugerida));
    assert.ok(de(79).alias.some((a) => a.propiedad === "FireRating" && a.sugerida));
    assert.ok(!de(77).alias.some((a) => a.propiedad === "FireRating"));
    assert.ok(de(21).alias.some((a) => a.grupo === "Qto_SlabBaseQuantities" && a.propiedad === "Width"));
  });

  it("las disciplinas sugeridas exigen los datos del proyecto solo al objeto Proyecto", () => {
    const sugeridas = disciplinasSugeridas();
    assert.equal(new Set(sugeridas.map((d) => d.codigo)).size, sugeridas.length);
    const gen = sugeridas.find((d) => d.codigo === "GEN")!;
    assert.equal(gen.elementos[0].parametros?.length, 14);
    for (const d of sugeridas) {
      assert.equal(new Set(d.elementos.map((e) => e.codigo)).size, d.elementos.length, d.codigo);
      for (const e of d.elementos) assert.match(e.claseIfc, /^Ifc[A-Za-z]+$/);
      if (d.codigo !== "GEN") assert.ok(d.elementos.every((e) => !e.parametros?.length));
    }
  });
});

describe("plantillas de disciplina", () => {
  const disciplina: Disciplina = { id: "d1", codigo: "ARQ", nombre: "Arquitectura", color: "#2a78d6", orden: 1, activo: true, version: 1, actualizado: "", actualizadoPor: null };
  const elemento = (e: Partial<Elemento>): Elemento => ({
    id: "e1", disciplinaId: "d1", codigo: "MUR", nombre: "Muro", claseIfc: "IfcWall", tipoPredefinido: "", clasificacionSistema: "", clasificacionCodigo: "",
    notas: "Por capas", parametros: [{ parametroId: "a", obligatorio: true, ndi: null, regla: null }, { parametroId: "z", obligatorio: true, ndi: null, regla: null }],
    regla: null, orden: 2, activo: true, version: 3, actualizado: "", actualizadoPor: null, ...e,
  });

  it("guarda los elementos activos de la disciplina con sus imágenes copiadas aparte", () => {
    const { contenido, copias } = contenidoPlantilla(
      disciplina,
      [elemento({}), elemento({ id: "e2", codigo: "VIEJO", activo: false }), elemento({ id: "e3", disciplinaId: "otra" }), elemento({ id: "e4", codigo: "PUE", orden: 1 })],
      [{ id: "i1", elementoId: "e1", ruta: "p/e1/i1.webp", nombre: "muro.webp", tipo: "image/webp", ancho: 800, alto: 600, bytes: 9000 }],
      (img) => `plantillas/t1/${img.id}.webp`
    );
    assert.deepEqual(contenido.elementos.map((e) => e.codigo), ["PUE", "MUR"]);
    assert.deepEqual(copias, [{ desde: "p/e1/i1.webp", hacia: "plantillas/t1/i1.webp" }]);
    assert.equal(contenido.elementos[1].imagenes[0].ruta, "plantillas/t1/i1.webp");

    const { elementos, parametrosQuitados } = elementosDePlantilla(contenido, "nueva", new Set(["a"]));
    assert.equal(parametrosQuitados, 2);
    assert.equal(elementos[1].datos.disciplinaId, "nueva");
    assert.deepEqual(elementos[1].datos.parametros.map((p) => p.parametroId), ["a"]);
  });

  it("si el código de la disciplina ya existe en el proyecto, se le agrega -2, -3…", () => {
    assert.equal(codigoLibre("ARQ", ["EST"]), "ARQ");
    assert.equal(codigoLibre("ARQ", ["arq", "ARQ-2"]), "ARQ-3");
  });
});
