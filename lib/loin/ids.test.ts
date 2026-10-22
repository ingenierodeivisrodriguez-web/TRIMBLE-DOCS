import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { variantesClase } from "./clasificacion";
import { factorSi, generarIds, grupoComoPatron, nombreArchivoIds, patronXsd, requisitoIds, tipoEstandar } from "./ids";
import { aplicarFilas, buscarParametro, elementoDesdeEspecificacion, elementoSugerido, filasEspecificacion, globDesdePatron, leerIds, planIds } from "./importarIds";
import { clave, SIN_REQUERIMIENTO } from "./matriz";
import { Alias, CeldaMatriz, Disciplina, Elemento, Etapa, Parametro, ParametroExigido, REGLA_VACIA, Requerimiento } from "./types";
import { escribirXml, hijo, hijos, leerXml } from "./xml";

const alias = (t: string, sugerida = false): Alias => (t.startsWith("@") ? { grupo: "@", propiedad: t.slice(1), sugerida } : { grupo: t.slice(0, t.indexOf(".")), propiedad: t.slice(t.indexOf(".") + 1), sugerida });
const parametro = (id: string, p: Partial<Parametro>): Parametro => ({
  id, codigo: id.toUpperCase(), numero: null, nombre: id, descripcion: "", tdi: "B", ndi: 1, origen: "a_ingresar", tipoDato: "texto", unidad: "", valoresPermitidos: [],
  regla: REGLA_VACIA, alias: [], idsUri: "", activo: true, version: 1, actualizado: "", actualizadoPor: null, ...p,
});
const exigido = (parametroId: string, obligatorio = true, extra: Partial<ParametroExigido> = {}): ParametroExigido => ({ parametroId, obligatorio, ndi: null, regla: null, ...extra });
const elemento = (id: string, disciplinaId: string, claseIfc: string, parametros: ParametroExigido[], extra: Partial<Elemento> = {}): Elemento => ({
  id, disciplinaId, codigo: id.toUpperCase(), nombre: id[0].toUpperCase() + id.slice(1), claseIfc, tipoPredefinido: "", clasificacionSistema: "", clasificacionCodigo: "", notas: "",
  parametros, regla: null, orden: 0, activo: true, version: 1, actualizado: "", actualizadoPor: null, ...extra,
});
const disciplina = (id: string, codigo: string): Disciplina => ({ id, codigo, nombre: codigo, color: "#2a78d6", orden: 0, activo: true, version: 1, actualizado: "", actualizadoPor: null });
const celda = (elementoId: string, r: Partial<Requerimiento>): CeldaMatriz => ({ ...SIN_REQUERIMIENTO, ...r, id: `c-${elementoId}`, elementoId, etapaId: "e2", version: 1, actualizado: "", actualizadoPor: null });

const catalogo = [
  parametro("ancho", { nombre: "Ancho", tipoDato: "numero", unidad: "m", regla: { min: 0.1, max: 0.5, patron: "" }, alias: [alias("*.Ancho"), alias("Qto_*BaseQuantities.Width", true)], origen: "automatica", descripcion: "Espesor nominal" }),
  parametro("carga", { nombre: "Capacidad de carga", tipoDato: "booleano", alias: [alias("Pset_WallCommon.LoadBearing")] }),
  parametro("fuego", { nombre: "Tiempo de resistencia al fuego", tipoDato: "numero", unidad: "h", regla: { min: 1, max: null, patron: "" }, alias: [alias("*.FireRating")] }),
  parametro("pendiente", { nombre: "Inclinación", tipoDato: "numero", unidad: "°", regla: { min: 0, max: 45, patron: "" }, alias: [alias("Pset_SlabCommon.PitchAngle")] }),
  parametro("estado", { nombre: "Estado", tipoDato: "lista", valoresPermitidos: ["NEW", "EXISTING"], alias: [alias("*.Status")] }),
  parametro("material", { nombre: "Material", regla: { min: null, max: null, patron: "^[A-Z].*$" }, alias: [alias("Datos.Material")] }),
  parametro("nombre", { nombre: "Nombre", alias: [alias("@Name")] }),
  parametro("codigo", { nombre: "Código de proyecto", tdi: "A", idsUri: "https://identifier.buildingsmart.org/uri/x/prop/Codigo" }),
  parametro("nivel3", { nombre: "Fabricante", ndi: 3, alias: [alias("*.Fabricante")] }),
];
const porId = new Map(catalogo.map((p) => [p.id, p]));
const disciplinas = [disciplina("arq", "ARQ"), disciplina("est", "EST")];
const elementos = [
  elemento("muro", "arq", "IfcWall", [exigido("ancho"), exigido("carga"), exigido("fuego"), exigido("estado"), exigido("material", false), exigido("nombre"), exigido("codigo")], { notas: "Por capas" }),
  elemento("losa", "est", "IfcSlab", [exigido("pendiente"), exigido("ancho", true, { regla: { min: 0.08, max: 0.5, patron: "" } })], { tipoPredefinido: "floor" }),
  elemento("piso", "arq", "IfcCovering", [exigido("material")], { orden: 2 }),
  elemento("cielo", "arq", "IfcCovering", [exigido("material")], { orden: 3 }),
  elemento("sinclase", "arq", "", [exigido("material")], { orden: 4 }),
  elemento("solo3", "arq", "IfcDoor", [exigido("nivel3")], { orden: 5 }),
  elemento("sinndi", "arq", "IfcWindow", [exigido("material")], { orden: 6 }),
];
const etapa: Etapa = { id: "e2", codigo: "PRY", nombre: "Proyecto", fecha: "2026-11-30", orden: 1, activo: true, version: 1, actualizado: "", actualizadoPor: null };
const celdas = new Map(
  [
    celda("muro", { lod: 300, ndi: 2, propositos: ["Coordinación"], actor: "Arquitecto" }),
    celda("losa", { lod: 300, ndi: 1, propositos: ["Cantidades"] }),
    celda("piso", { ndi: 1 }),
    celda("cielo", { ndi: 1 }),
    celda("sinclase", { ndi: 1 }),
    celda("solo3", { ndi: 2 }),
    celda("sinndi", { lod: 200, ndi: null }),
  ].map((c) => [clave(c.elementoId, c.etapaId), c])
);
const datos = { proyecto: "Torre Norte", etapa, disciplinas, elementos, celdas, catalogo: porId, versiones: ["IFC2X3", "IFC4"] as ("IFC2X3" | "IFC4")[], fecha: "2026-10-21" };

describe("XML", () => {
  it("lee prefijos, entidades, CDATA y comentarios, y escribe escapando", () => {
    const x = leerXml(`<?xml version="1.0"?><!-- hola --><ids:ids xmlns:ids="u"><ids:a b="x &amp; y">uno &lt;2&gt; &#xD1;<![CDATA[<tres>]]></ids:a><c/></ids:ids>`);
    assert.equal(x.nombre, "ids");
    assert.deepEqual(x.atributos, {});
    assert.equal(hijo(x, "a")?.atributos.b, "x & y");
    assert.equal(hijo(x, "a")?.texto, "uno <2> Ñ<tres>");
    assert.equal(hijos(x, "c").length, 1);
    assert.throws(() => leerXml("<a><b></a>"), /no corresponde/);
    assert.throws(() => leerXml("texto suelto"), /fuera del elemento|no tiene contenido/);
    const xml = escribirXml({ nombre: "a", atributos: { v: 'dice "sí" & <no>', vacio: "" }, hijos: [{ nombre: "b", texto: "1 < 2" }, null] });
    assert.match(xml, /<a v="dice &quot;sí&quot; &amp; &lt;no&gt;">/);
    assert.match(xml, /<b>1 &lt; 2<\/b>/);
    assert.equal(leerXml(xml).atributos.v, 'dice "sí" & <no>');
  });
});

describe("IDS: piezas", () => {
  it("los patrones del catálogo pasan a XML Schema o se dice por qué no", () => {
    assert.deepEqual(patronXsd("^[A-ZÑ0-9_ ]+$"), { ok: true, patron: "[A-ZÑ0-9_ ]+" });
    assert.deepEqual(patronXsd("DT\\d{2}"), { ok: true, patron: "DT\\d{2}" });
    assert.deepEqual(patronXsd("\\u00D1A\\$"), { ok: true, patron: "ÑA$" });
    assert.equal(patronXsd("(?=a)b").ok, false);
    assert.equal(patronXsd("a.*?b").ok, false);
    assert.equal(patronXsd("\\bpalabra").ok, false);
    assert.equal(patronXsd("a|^b").ok, false);
    assert.equal(grupoComoPatron("Qto_*BaseQuantities"), "Qto_.*BaseQuantities");
    assert.equal(grupoComoPatron("*"), ".*");
    assert.equal(grupoComoPatron("Mat. (2)*"), "Mat\\. \\(2\\).*");
    assert.equal(globDesdePatron("Qto_.*BaseQuantities"), "Qto_*BaseQuantities");
    assert.equal(globDesdePatron("Mat\\. \\(2\\).*"), "Mat. (2)*");
    assert.equal(globDesdePatron("Pset_[A-Z]+"), null);
  });

  it("tipos de dato IFC de las propiedades estándar y unidades SI", () => {
    assert.equal(tipoEstandar("Pset_WallCommon", "FireRating"), "IFCLABEL");
    assert.equal(tipoEstandar("*", "LoadBearing"), "IFCBOOLEAN");
    assert.equal(tipoEstandar("Qto_*BaseQuantities", "NetVolume"), "IFCVOLUMEMEASURE");
    assert.equal(tipoEstandar("Pset_FastenerWeld", "a"), "IFCPOSITIVELENGTHMEASURE");
    assert.equal(tipoEstandar("Datos de identidad", "FireRating"), null);
    assert.equal(factorSi("m", "IFCLENGTHMEASURE"), 1);
    assert.equal(factorSi("mm", "IFCPOSITIVELENGTHMEASURE"), 0.001);
    assert.equal(factorSi("°", "IFCPLANEANGLEMEASURE"), Math.PI / 180);
    assert.equal(factorSi("h", "IFCTIMEMEASURE"), 3600);
    assert.equal(factorSi("m", "IFCAREAMEASURE"), null);
    assert.equal(factorSi("", "IFCREAL"), 1);
    assert.deepEqual(variantesClase("IfcWallStandardCase"), ["IFCWALL", "IFCWALLSTANDARDCASE", "IFCWALLELEMENTEDCASE"]);
    assert.deepEqual(variantesClase("IfcCovering"), ["IFCCOVERING"]);
    assert.equal(nombreArchivoIds("Torre: Norte", "Proyecto / detalle", "2026-10-21"), "Requisitos LOIN 21-10-2026 - Torre- Norte - Proyecto - detalle.ids");
  });
});

describe("IDS: exportar los requisitos de una etapa", () => {
  const r = generarIds(datos);
  const ids = leerXml(r.xml);
  const specs = hijos(hijo(ids, "specifications"), "specification");
  const spec = (nombre: string) => specs.find((s) => s.atributos.name === nombre)!;
  const propiedad = (s: ReturnType<typeof spec>, nombre: string) =>
    hijo(s, "requirements")!.hijos.find((f) => hijo(hijo(f, f.nombre === "attribute" ? "name" : "baseName"), "simpleValue")?.texto === nombre)!;

  it("una especificación por elemento que pide NDI en la etapa, y dice qué deja por fuera", () => {
    assert.equal(r.especificaciones, 4);
    assert.deepEqual(specs.map((s) => s.atributos.name), ["ARQ · Muro", "ARQ · Piso", "ARQ · Cielo", "EST · Losa"]);
    assert.deepEqual(r.omitidos, [
      { elemento: "ARQ · Sinclase", motivo: "no tiene clase IFC" },
      { elemento: "ARQ · Solo3", motivo: "pide NDI-2 pero no tiene parámetros exigidos de ese nivel" },
    ]);
    assert.equal(r.sinExigencia, 1);
    assert.deepEqual(r.compartidas, [["ARQ · Piso", "ARQ · Cielo"]]);
    assert.equal(r.requisitos, 7 + 1 + 1 + 2);
  });

  it("encabezado: título, hito con su fecha DD-MM-AAAA, propósitos, versiones IFC y notas", () => {
    const info = hijo(ids, "info")!;
    assert.equal(hijo(info, "title")?.texto, "Requisitos BIM (LOIN) · Torre Norte · Proyecto");
    assert.equal(hijo(info, "milestone")?.texto, "Proyecto (30-11-2026)");
    assert.equal(hijo(info, "purpose")?.texto, "Coordinación, Cantidades");
    assert.equal(hijo(info, "date")?.texto, "2026-10-21");
    const muro = spec("ARQ · Muro");
    assert.equal(muro.atributos.ifcVersion, "IFC2X3 IFC4");
    assert.equal(muro.atributos.identifier, "MURO");
    assert.equal(muro.atributos.description, "LOD 300 · NDI-2 · Propósito: Coordinación · Entrega: Arquitecto");
    assert.equal(muro.atributos.instructions, "Por capas");
  });

  it("aplica a la clase IFC con sus casos estándar y al tipo predefinido en mayúsculas", () => {
    const ent = hijo(hijo(spec("EST · Losa"), "applicability"), "entity")!;
    assert.equal(hijo(hijo(hijo(ent, "name"), "restriction"), "pattern")?.atributos.value, "IFCSLAB|IFCSLABSTANDARDCASE|IFCSLABELEMENTEDCASE");
    assert.equal(hijo(hijo(ent, "predefinedType"), "simpleValue")?.texto, "FLOOR");
    assert.equal(hijo(hijo(hijo(hijo(spec("ARQ · Piso"), "applicability"), "entity"), "name"), "simpleValue")?.texto, "IFCCOVERING");
    assert.equal(hijo(spec("ARQ · Piso"), "applicability")?.atributos.minOccurs, "0");
  });

  it("cada parámetro va donde lo lee la auditoría, con su tipo IFC y su regla en unidades SI", () => {
    const muro = spec("ARQ · Muro");
    const ancho = propiedad(muro, "Ancho");
    assert.equal(hijo(hijo(hijo(ancho, "propertySet"), "restriction"), "pattern")?.atributos.value, ".*");
    assert.equal(ancho.atributos.dataType, "IFCLENGTHMEASURE");
    assert.equal(ancho.atributos.cardinality, "required");
    assert.equal(ancho.atributos.instructions, "Espesor nominal");
    const rango = hijo(hijo(ancho, "value"), "restriction")!;
    assert.equal(rango.atributos.base, "xs:double");
    assert.deepEqual([hijo(rango, "minInclusive")?.atributos.value, hijo(rango, "maxInclusive")?.atributos.value], ["0.1", "0.5"]);
    // The element's own rule wins over the catalog's.
    assert.equal(hijo(hijo(hijo(propiedad(spec("EST · Losa"), "Ancho"), "value"), "restriction"), "minInclusive")?.atributos.value, "0.08");
    // Degrees go as radians.
    assert.equal(hijo(hijo(hijo(propiedad(spec("EST · Losa"), "PitchAngle"), "value"), "restriction"), "maxInclusive")?.atributos.value, "0.785398163397");

    const carga = propiedad(muro, "LoadBearing");
    assert.equal(hijo(hijo(carga, "propertySet"), "simpleValue")?.texto, "Pset_WallCommon");
    assert.equal(carga.atributos.dataType, "IFCBOOLEAN");
    assert.equal(hijo(carga, "value"), null);

    // FireRating is a label in IFC: its numeric range can't go.
    const fuego = propiedad(muro, "FireRating");
    assert.equal(fuego.atributos.dataType, "IFCLABEL");
    assert.equal(hijo(fuego, "value"), null);
    assert.ok(r.avisos.some((a) => a.startsWith("FUEGO · Tiempo de resistencia al fuego: en IFC FireRating es IFCLABEL")));

    const estado = propiedad(muro, "Status");
    assert.deepEqual(hijos(hijo(hijo(estado, "value"), "restriction"), "enumeration").map((e) => e.atributos.value), ["NEW", "EXISTING"]);

    // Optional: needs its data type; the pattern loses its anchors.
    const material = propiedad(muro, "Material");
    assert.equal(material.atributos.cardinality, "optional");
    assert.equal(material.atributos.dataType, "IFCLABEL");
    assert.equal(hijo(hijo(hijo(material, "value"), "restriction"), "pattern")?.atributos.value, "[A-Z].*");

    const nombre = propiedad(muro, "Name");
    assert.equal(nombre.nombre, "attribute");

    // Without aliases: its name in any group, with its URI; a required custom property without a value goes without a data type.
    const codigo = propiedad(muro, "Código de proyecto");
    assert.equal(codigo.atributos.dataType, undefined);
    assert.equal(codigo.atributos.uri, "https://identifier.buildingsmart.org/uri/x/prop/Codigo");
    assert.ok(r.avisos.includes("CODIGO · Código de proyecto: no tiene equivalencias de lectura: se pide por su nombre en cualquier grupo"));
  });

  it("una fecha opcional va como IFCDATE, o como texto si se incluye IFC2X3 (que no tiene ese tipo)", () => {
    const fecha = parametro("fecha", { nombre: "Fecha", tipoDato: "fecha", alias: [alias("Programación.Inicio")] });
    const e = { parametro: fecha, obligatorio: false, ndi: 1 as const, regla: REGLA_VACIA };
    assert.equal(requisitoIds(e, false, false).facet.atributos?.dataType, "IFCDATE");
    assert.equal(requisitoIds(e, false, true).facet.atributos?.dataType, "IFCLABEL");
  });

  it("con \"preferir IFC\" toma la equivalencia estándar cuando la hay", () => {
    const x = leerXml(generarIds({ ...datos, preferirIfc: true }).xml);
    const muro = hijos(hijo(x, "specifications"), "specification")[0];
    const nombres = hijo(muro, "requirements")!.hijos.map((f) => hijo(hijo(f, f.nombre === "attribute" ? "name" : "baseName"), "simpleValue")?.texto);
    assert.ok(nombres.includes("Width"));
    assert.ok(!nombres.includes("Ancho"));
  });

  it("sin nada que exportar lo dice", () => {
    assert.throws(() => generarIds({ ...datos, disciplinas: [] }), /Ningún elemento/);
    assert.throws(() => generarIds({ ...datos, versiones: [] }), /versión de IFC/);
  });
});

describe("IDS: importar", () => {
  const exportado = generarIds(datos).xml;

  it("lee lo que exporta la app (ida y vuelta)", () => {
    const leido = leerIds(exportado);
    assert.equal(leido.hito, "Proyecto (30-11-2026)");
    const muro = leido.especificaciones[0];
    assert.equal(muro.clase, "IFCWALL");
    assert.equal(muro.identificador, "MURO");
    assert.deepEqual(
      muro.requisitos.map((r) => [r.tipo, r.grupo, r.nombre, r.cardinalidad]),
      [
        ["propiedad", "*", "Ancho", "required"],
        ["propiedad", "Pset_WallCommon", "LoadBearing", "required"],
        ["propiedad", "*", "FireRating", "required"],
        ["propiedad", "*", "Status", "required"],
        ["propiedad", "Datos", "Material", "optional"],
        ["atributo", "@", "Name", "required"],
        ["propiedad", "*", "Código de proyecto", "required"],
      ]
    );
    assert.equal(leido.especificaciones[3].tipoPredefinido, "FLOOR");
  });

  it("contra el mismo catálogo y elementos: todo se reconoce y nada cambia", () => {
    const leido = leerIds(exportado);
    const plan = planIds(leido, { catalogo, elementos, disciplinas, tdi: "D", tdiCantidades: "B", ndi: 1 });
    assert.equal(plan.nuevos.size, 0);
    // Found by URI / name but read elsewhere: the alias is offered.
    assert.deepEqual(plan.equivalencias.map((e) => `${e.parametro.id} ${e.alias.grupo}.${e.alias.propiedad}`), ["codigo *.Código de proyecto"]);
    assert.deepEqual(plan.especificaciones.map((e) => e.elementoId), ["muro", "piso", "cielo", "losa"]);
    for (const e of plan.especificaciones) {
      const el = elementos.find((x) => x.id === e.elementoId)!;
      const filas = filasEspecificacion(e.leida, el, catalogo, plan);
      assert.deepEqual(filas.map((f) => f.accion), filas.map(() => "igual"), `${e.leida.nombre}: ${filas.map((f) => f.detalle).join(" | ")}`);
    }
  });

  it("en un catálogo vacío propone parámetros nuevos con su tipo, unidad, regla y dónde leerlos", () => {
    const leido = leerIds(exportado);
    const plan = planIds(leido, { catalogo: [], elementos: [], disciplinas, tdi: "D", tdiCantidades: "B", ndi: 2 });
    const nuevo = (nombre: string) => [...plan.nuevos.values()].find((n) => n.datos.nombre === nombre)!.datos;
    assert.deepEqual([nuevo("Ancho").tipoDato, nuevo("Ancho").unidad, nuevo("Ancho").regla, nuevo("Ancho").alias], ["numero", "m", { min: 0.1, max: 0.5, patron: "" }, [{ grupo: "*", propiedad: "Ancho", sugerida: false }]]);
    assert.equal(nuevo("Ancho").ndi, 2);
    assert.equal(nuevo("Ancho").tdi, "D");
    assert.equal(nuevo("Ancho").descripcion, "Espesor nominal");
    assert.equal(nuevo("LoadBearing").tipoDato, "booleano");
    assert.deepEqual([nuevo("Status").tipoDato, nuevo("Status").valoresPermitidos], ["lista", ["NEW", "EXISTING"]]);
    assert.equal(nuevo("Material").regla.patron, "[A-Z].*");
    assert.equal(nuevo("FireRating").tipoDato, "texto");
    assert.deepEqual(nuevo("Name").alias, [{ grupo: "@", propiedad: "Name", sugerida: false }]);
    assert.deepEqual([nuevo("PitchAngle").unidad, nuevo("PitchAngle").regla.max], ["°", 45]);
    assert.equal(nuevo("Código de proyecto").idsUri, "https://identifier.buildingsmart.org/uri/x/prop/Codigo");
    assert.deepEqual([...plan.nuevos.values()].map((n) => n.datos.codigo).slice(0, 3), ["IDS-001", "IDS-002", "IDS-003"]);
    // Every specification goes to a new element.
    assert.deepEqual(plan.especificaciones.map((e) => e.elementoId), [null, null, null, null]);
    const filas = filasEspecificacion(plan.especificaciones[0].leida, null, [], plan);
    assert.ok(filas.every((f) => f.accion === "agregar" && f.nuevo));
  });

  it("lo que ya exige el elemento con otra obligación o regla es un cambio que solo se aplica marcado", () => {
    const ids = `<ids xmlns="http://standards.buildingsmart.org/IDS" xmlns:xs="http://www.w3.org/2001/XMLSchema"><info><title>Cliente</title></info><specifications>
      <specification name="Muros" ifcVersion="IFC4"><applicability><entity><name><simpleValue>IFCWALL</simpleValue></name></entity></applicability>
      <requirements>
        <property dataType="IFCLENGTHMEASURE"><propertySet><simpleValue>Qto_WallBaseQuantities</simpleValue></propertySet><baseName><simpleValue>Width</simpleValue></baseName>
          <value><xs:restriction base="xs:double"><xs:minExclusive value="0.12"/><xs:maxInclusive value="0.4"/></xs:restriction></value></property>
        <property dataType="IFCBOOLEAN" cardinality="optional"><propertySet><simpleValue>Pset_WallCommon</simpleValue></propertySet><baseName><simpleValue>LoadBearing</simpleValue></baseName></property>
        <property dataType="IFCLABEL"><propertySet><simpleValue>Pset_WallCommon</simpleValue></propertySet><baseName><simpleValue>AcousticRating</simpleValue></baseName></property>
        <property cardinality="prohibited"><propertySet><simpleValue>Viejo</simpleValue></propertySet><baseName><simpleValue>Borrar</simpleValue></baseName></property>
        <classification><system><simpleValue>Uniclass</simpleValue></system></classification>
      </requirements></specification></specifications></ids>`;
    const leido = leerIds(ids);
    assert.deepEqual(leido.especificaciones[0].avisos, ["no se importa un requisito de clasificación"]);
    const muro = elementos[0];
    const plan = planIds(leido, { catalogo, elementos, disciplinas, tdi: "D", tdiCantidades: "B", ndi: 1 });
    assert.equal(plan.especificaciones[0].elementoId, "muro");
    const filas = filasEspecificacion(leido.especificaciones[0], muro, catalogo, plan);
    assert.deepEqual(filas.map((f) => f.accion), ["cambiar", "cambiar", "agregar", "omitir"]);
    assert.match(filas[0].detalle, /regla: la del catálogo → entre 0\.12 y 0\.4 m/);
    assert.match(filas[0].detalle, /excluye su valor/);
    assert.match(filas[1].detalle, /obligatorio → opcional/);
    // Ticking only the first change and the new one.
    const nuevoId = new Map([[filas[2].nuevo!, "acustica"]]);
    const resultado = aplicarFilas(muro.parametros, filas, new Set([0, 2]), nuevoId);
    assert.deepEqual(resultado.find((x) => x.parametroId === "ancho")?.regla, { min: 0.12, max: 0.4, patron: "" });
    assert.equal(resultado.find((x) => x.parametroId === "carga")?.obligatorio, true);
    assert.deepEqual(resultado.at(-1), { parametroId: "acustica", obligatorio: true, ndi: null, regla: null });
    assert.equal(resultado.length, muro.parametros.length + 1);
    // Nothing ticked: nothing changes.
    assert.deepEqual(aplicarFilas(muro.parametros, filas, new Set(), nuevoId), muro.parametros);
  });

  it("un elemento nuevo toma el nombre sin la disciplina, la clase con sus mayúsculas y una regla por clase", () => {
    const s = leerIds(exportado).especificaciones[3];
    const e = elementoDesdeEspecificacion(s, { id: "est", codigo: "EST" }, ["LOSA"], 7);
    assert.deepEqual([e.codigo, e.nombre, e.claseIfc, e.tipoPredefinido, e.orden], ["LOSA-2", "Losa", "IfcSlab", "FLOOR", 7]);
    assert.deepEqual(e.regla, { modo: "todas", condiciones: [{ campo: "@clase", operador: "igual", valor: "IfcSlab" }] });
    assert.equal(elementoDesdeEspecificacion({ ...s, clase: "IFCTRANSPORTELEMENT" }, { id: "arq", codigo: "ARQ" }, [], 1).claseIfc, "IfcTransportElement");
    assert.equal(factorSi("W/(m²·K)", "IFCTHERMALTRANSMITTANCEMEASURE"), 1);
    assert.equal(elementoSugerido({ ...s, identificador: "", nombre: "Otra", tipoPredefinido: "FLOOR" }, { elementos, disciplinas }), "losa");
  });

  it("la equivalencia exacta gana sobre la que tiene comodín", () => {
    const grosor = parametro("grosor", { nombre: "Grosor", tipoDato: "numero", unidad: "m", alias: [alias("Qto_SlabBaseQuantities.Width")] });
    const lista = [catalogo[0], grosor];
    const r = (grupo: string) => ({ tipo: "propiedad" as const, grupo, nombre: "Width", cardinalidad: "required" as const, tipoIfc: "", valor: null, uri: "", instrucciones: "" });
    assert.equal(buscarParametro(r("Qto_SlabBaseQuantities"), lista)?.parametro.id, "grosor");
    assert.equal(buscarParametro(r("Qto_WallBaseQuantities"), lista)?.parametro.id, "ancho");
    assert.equal(buscarParametro(r("Qto_*BaseQuantities"), lista)?.parametro.id, "ancho");
  });

  it("rechaza lo que no es un IDS", () => {
    assert.throws(() => leerIds("<a>"), /no es un XML válido/);
    assert.throws(() => leerIds("<otra/>"), /no es un IDS/);
    assert.throws(() => leerIds('<ids xmlns="x"><info/><specifications/></ids>'), /no tiene especificaciones/);
  });
});
