// Inspección 360°, Fase 0 (T0.9): diagnosis of an IFC before using it for progress control.
// Reads the file with web-ifc (already installed for Realidad aumentada) and writes a report in
// Spanish: schema and units, storeys, spaces and zones, elements per class, IFCGUID quality,
// property inventory and coverage of the location parameters (tower, floor, unit, space…).
//
//   node scripts/inspeccion-360/diagnostico-ifc.mjs <modelo.ifc> [informe.md]
//
// The full inventory with IfcOpenShell comes in Fase 2 (worker-360); this only answers
// "does this model have what the plan needs?" without installing Python.

import fs from "node:fs";
import path from "node:path";
import * as W from "web-ifc";

const [, , rutaIfc, rutaInforme] = process.argv;
if (!rutaIfc) {
  console.error("Uso: node scripts/inspeccion-360/diagnostico-ifc.mjs <modelo.ifc> [informe.md]");
  process.exit(1);
}

// Classes the progress control may use (entregable 8, §8.7). Missing constants (schema) are skipped.
const CLASES = [
  "IFCWALL", "IFCWALLSTANDARDCASE", "IFCSLAB", "IFCCOLUMN", "IFCBEAM", "IFCDOOR", "IFCWINDOW", "IFCCOVERING",
  "IFCRAILING", "IFCSTAIR", "IFCSTAIRFLIGHT", "IFCRAMP", "IFCCURTAINWALL", "IFCPLATE", "IFCMEMBER", "IFCROOF",
  "IFCFLOWTERMINAL", "IFCSANITARYTERMINAL", "IFCPIPESEGMENT", "IFCPIPEFITTING", "IFCCABLECARRIERSEGMENT",
  "IFCDUCTSEGMENT", "IFCLIGHTFIXTURE", "IFCOUTLET", "IFCFURNISHINGELEMENT", "IFCFURNITURE",
  "IFCBUILDINGELEMENTPROXY", "IFCSPACE",
];
// Property names that may carry a location or control parameter (entregable 8, §8.6).
const PARAMETROS = {
  torre: /torre|tower|bloque|edificio|building/i,
  piso: /piso|nivel|level|storey|planta/i,
  unidad: /apart|apto|unidad|unit|vivienda|local|depart/i,
  espacio: /espacio|room|space|recinto|habitaci/i,
  zona: /zona|zone/i,
  actividad: /actividad|activity|partida|item|capitulo|cap[ií]tulo|wbs|edt/i,
};
const GUID_VALIDO = /^[0-3][0-9A-Za-z_$]{21}$/;

const texto = (v) => (v && typeof v === "object" && "value" in v && v.value != null ? String(v.value) : "");
const numero = (v) => (v && typeof v === "object" && typeof v.value === "number" ? v.value : null);
const ids = (v) => (Array.isArray(v) ? v : v ? [v] : []).map((x) => x?.value).filter((x) => typeof x === "number");
const pct = (a, b) => (b ? `${((100 * a) / b).toFixed(1)} %` : "—");

const api = new W.IfcAPI();
await api.Init();
const bytes = new Uint8Array(fs.readFileSync(rutaIfc));
const m = api.OpenModel(bytes, { COORDINATE_TO_ORIGIN: false });
if (m < 0) {
  console.error("El archivo no se pudo abrir como IFC.");
  process.exit(1);
}
const linea = (id) => api.GetLine(m, id);
function cada(tipo, fn) {
  if (typeof tipo !== "number") return;
  const lista = api.GetLineIDsWithType(m, tipo);
  for (let i = 0; i < lista.size(); i++) fn(lista.get(i));
}

// ---------------------------------------------------------------- units
let unidadLongitud = "no declarada";
cada(W.IFCSIUNIT, (id) => {
  const u = linea(id);
  if (texto(u.UnitType) === "LENGTHUNIT") unidadLongitud = `${texto(u.Prefix) ? texto(u.Prefix) + " " : ""}${texto(u.Name)}`.trim();
});

// ---------------------------------------------------------------- spatial structure
const contenedor = new Map();
const padre = new Map();
cada(W.IFCRELCONTAINEDINSPATIALSTRUCTURE, (id) => {
  const r = linea(id);
  const [e] = ids(r.RelatingStructure);
  if (e !== undefined) for (const x of ids(r.RelatedElements)) contenedor.set(x, e);
});
cada(W.IFCRELAGGREGATES, (id) => {
  const r = linea(id);
  const [todo] = ids(r.RelatingObject);
  if (todo !== undefined) for (const x of ids(r.RelatedObjects)) padre.set(x, todo);
});
const pisos = new Map();
cada(W.IFCBUILDINGSTOREY, (id) => {
  const s = linea(id);
  pisos.set(id, { nombre: texto(s.Name) || texto(s.LongName) || `#${id}`, elevacion: numero(s.Elevation), espacios: 0, elementos: 0 });
});
const edificios = [];
cada(W.IFCBUILDING, (id) => edificios.push(texto(linea(id).Name) || `#${id}`));
function pisoDe(id) {
  let actual = id;
  for (let paso = 0; actual !== undefined && paso < 50; paso++) {
    if (paso > 0 && pisos.has(actual)) return actual;
    actual = contenedor.get(actual) ?? padre.get(actual);
  }
  return undefined;
}

// ---------------------------------------------------------------- property sets (instance and type)
const psetsDe = new Map();
const agregar = (elemento, pset) => {
  const l = psetsDe.get(elemento) ?? [];
  l.push(pset);
  psetsDe.set(elemento, l);
};
cada(W.IFCRELDEFINESBYPROPERTIES, (id) => {
  const r = linea(id);
  const [p] = ids(r.RelatingPropertyDefinition);
  if (p !== undefined) for (const e of ids(r.RelatedObjects)) agregar(e, p);
});
cada(W.IFCRELDEFINESBYTYPE, (id) => {
  const r = linea(id);
  const [t] = ids(r.RelatingType);
  if (t === undefined) return;
  const tipo = linea(t);
  for (const p of ids(tipo.HasPropertySets)) for (const e of ids(r.RelatedObjects)) agregar(e, p);
});
const cachePset = new Map();
function leerPset(id) {
  if (cachePset.has(id)) return cachePset.get(id);
  const p = linea(id);
  const nombre = texto(p.Name) || `#${id}`;
  const valores = [];
  const esCantidades = api.GetLineType(m, id) === W.IFCELEMENTQUANTITY;
  for (const hijo of ids(esCantidades ? p.Quantities : p.HasProperties)) {
    const v = linea(hijo);
    const valor = esCantidades
      ? numero(v.LengthValue) ?? numero(v.AreaValue) ?? numero(v.VolumeValue) ?? numero(v.CountValue) ?? numero(v.WeightValue)
      : texto(v.NominalValue);
    valores.push({ nombre: texto(v.Name), valor });
  }
  const r = { nombre, esCantidades, valores };
  cachePset.set(id, r);
  return r;
}

// ---------------------------------------------------------------- elements
const porClase = [];
const guids = new Map();
const invalidos = [];
const inventario = new Map(); // "pset.prop" → { elementos, clases: Map, ejemplos: Set }
const espaciosEjemplo = [];
let totalElementos = 0;
for (const nombreClase of CLASES) {
  const codigo = W[nombreClase];
  if (typeof codigo !== "number") continue;
  const fila = { clase: api.GetNameFromTypeCode(codigo), total: 0, sinPiso: 0, conQto: 0, conPsets: 0 };
  cada(codigo, (id) => {
    const e = linea(id);
    fila.total++;
    totalElementos++;
    const guid = texto(e.GlobalId);
    if (!GUID_VALIDO.test(guid)) invalidos.push(`${fila.clase} #${id} "${guid}"`);
    guids.set(guid, [...(guids.get(guid) ?? []), `${fila.clase} #${id}`]);
    const piso = pisoDe(id);
    if (piso === undefined) fila.sinPiso++;
    else if (fila.clase.toUpperCase() === "IFCSPACE") pisos.get(piso).espacios++;
    else pisos.get(piso).elementos++;
    if (fila.clase.toUpperCase() === "IFCSPACE" && espaciosEjemplo.length < 12) espaciosEjemplo.push(`${texto(e.Name)} — ${texto(e.LongName)}`);
    const psets = (psetsDe.get(id) ?? []).map(leerPset);
    if (psets.length) fila.conPsets++;
    if (psets.some((p) => p.esCantidades)) fila.conQto++;
    const vistos = new Set();
    for (const p of psets) {
      for (const v of p.valores) {
        const clave = `${p.nombre}.${v.nombre}`;
        if (vistos.has(clave)) continue;
        vistos.add(clave);
        const item = inventario.get(clave) ?? { elementos: 0, clases: new Map(), ejemplos: new Set(), cantidad: p.esCantidades };
        item.elementos++;
        item.clases.set(fila.clase, (item.clases.get(fila.clase) ?? 0) + 1);
        if (item.ejemplos.size < 5 && v.valor !== "" && v.valor != null) item.ejemplos.add(String(v.valor).slice(0, 40));
        inventario.set(clave, item);
      }
    }
  });
  if (fila.total) porClase.push(fila);
}
const duplicados = [...guids.entries()].filter(([g, l]) => g && l.length > 1);

// ---------------------------------------------------------------- zones
const zonas = [];
const miembros = new Map();
cada(W.IFCRELASSIGNSTOGROUP, (id) => {
  const r = linea(id);
  const [g] = ids(r.RelatingGroup);
  if (g !== undefined) miembros.set(g, (miembros.get(g) ?? 0) + ids(r.RelatedObjects).length);
});
cada(W.IFCZONE, (id) => zonas.push(`${texto(linea(id).Name) || "#" + id} (${miembros.get(id) ?? 0} miembros)`));

// ---------------------------------------------------------------- report
const espacios = porClase.find((f) => f.clase.toUpperCase() === "IFCSPACE")?.total ?? 0;
const sinEspacios = totalElementos - espacios;
const conQto = porClase.filter((f) => f.clase.toUpperCase() !== "IFCSPACE").reduce((s, f) => s + f.conQto, 0);
const sinPiso = porClase.reduce((s, f) => s + f.sinPiso, 0);
const candidatos = Object.fromEntries(
  Object.entries(PARAMETROS).map(([param, re]) => [
    param,
    [...inventario.entries()]
      .filter(([clave, item]) => !item.cantidad && re.test(clave.split(".").pop() ?? ""))
      .sort((a, b) => b[1].elementos - a[1].elementos)
      .slice(0, 4),
  ]),
);
const mejorUnidad = candidatos.unidad[0]?.[1].elementos ?? 0;
const veredicto = [
  [pisos.size > 0, `Pisos (IfcBuildingStorey): ${pisos.size}`],
  [espacios > 0, `Espacios (IfcSpace): ${espacios} — base de los acabados por espacio y de la ubicación de elementos`],
  [invalidos.length === 0 && duplicados.length === 0, `IFCGUID: ${invalidos.length} inválidos, ${duplicados.length} repetidos`],
  [sinPiso === 0, `Elementos sin piso: ${sinPiso}`],
  [conQto / Math.max(1, sinEspacios) >= 0.8, `Cantidades base (Qto) en ${pct(conQto, sinEspacios)} de los elementos`],
  [mejorUnidad / Math.max(1, sinEspacios) >= 0.9 || zonas.length > 0 || espacios > 0,
    `Unidad (apartamento): mejor propiedad en ${pct(mejorUnidad, sinEspacios)}; zonas ${zonas.length}; si falta, se infiere por espacio`],
];

const fecha = new Date().toLocaleDateString("es-CO", { day: "2-digit", month: "2-digit", year: "numeric" }).replace(/\//g, "-");
const md = [];
md.push(`# Diagnóstico IFC — ${path.basename(rutaIfc)}`, "", `Fecha: ${fecha}. Herramienta: web-ifc (Fase 0 de Inspección 360°).`, "");
md.push("## Veredicto", "", ...veredicto.map(([ok, t]) => `- ${ok ? "✔" : "⚠"} ${t}`), "");
md.push("## Archivo", "", `| Dato | Valor |`, `|---|---|`, `| Tamaño | ${(bytes.length / 1048576).toFixed(1)} MB |`, `| Esquema | ${api.GetModelSchema(m)} |`, `| Unidad de longitud | ${unidadLongitud} |`, `| Edificios | ${edificios.join(", ") || "—"} |`, "");
md.push("## Pisos", "", "| Piso | Elevación | Espacios | Elementos |", "|---|---|---|---|");
for (const p of [...pisos.values()].sort((a, b) => (a.elevacion ?? 0) - (b.elevacion ?? 0))) md.push(`| ${p.nombre} | ${p.elevacion ?? "—"} | ${p.espacios} | ${p.elementos} |`);
md.push("", "## Espacios y zonas", "", `Ejemplos de espacios (Nombre — Nombre largo): ${espaciosEjemplo.join("; ") || "ninguno"}`, "", `Zonas: ${zonas.join("; ") || "ninguna"}`, "");
md.push("## Elementos por clase", "", "| Clase | Total | Sin piso | Con propiedades | Con cantidades (Qto) |", "|---|---|---|---|---|");
for (const f of porClase) md.push(`| ${f.clase} | ${f.total} | ${f.sinPiso} | ${pct(f.conPsets, f.total)} | ${pct(f.conQto, f.total)} |`);
md.push("", "## Calidad del IFCGUID", "", `- Inválidos: ${invalidos.length}${invalidos.length ? " — " + invalidos.slice(0, 10).join("; ") : ""}`, `- Repetidos: ${duplicados.length}${duplicados.length ? " — " + duplicados.slice(0, 10).map(([g, l]) => `${g}: ${l.join(", ")}`).join("; ") : ""}`, "");
md.push("## Parámetros candidatos de ubicación y control", "", "| Parámetro | Propiedad | Elementos | Cobertura | Ejemplos |", "|---|---|---|---|---|");
for (const [param, lista] of Object.entries(candidatos)) {
  if (!lista.length) md.push(`| ${param} | (ninguna) | — | — | — |`);
  for (const [clave, item] of lista) md.push(`| ${param} | ${clave} | ${item.elementos} | ${pct(item.elementos, sinEspacios)} | ${[...item.ejemplos].join(", ")} |`);
}
md.push("", "## Inventario de propiedades (40 más frecuentes)", "", "| Pset.Propiedad | Elementos | Clases | Ejemplos |", "|---|---|---|---|");
for (const [clave, item] of [...inventario.entries()].sort((a, b) => b[1].elementos - a[1].elementos).slice(0, 40)) {
  md.push(`| ${clave} | ${item.elementos} | ${[...item.clases.entries()].map(([c, n]) => `${c} ${n}`).join(", ")} | ${[...item.ejemplos].join(", ")} |`);
}
md.push("");

const salida = rutaInforme ?? rutaIfc.replace(/\.ifc$/i, "") + "-diagnostico.md";
fs.writeFileSync(salida, md.join("\n"));
api.CloseModel(m);
console.log(veredicto.map(([ok, t]) => `${ok ? "OK " : "!! "} ${t}`).join("\n"));
console.log(`Informe: ${salida}`);
