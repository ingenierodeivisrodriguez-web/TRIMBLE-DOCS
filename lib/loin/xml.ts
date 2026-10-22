// A small XML reader and writer for IDS files: enough for elements,
// attributes, text, CDATA, comments and the five entities plus numeric
// character references. Namespace prefixes are dropped (IDS only mixes its own
// names with XML Schema's, and they don't clash), so "ids:property" and
// "property" read the same. No DTDs, no external entities.

export interface NodoXml {
  nombre: string;
  atributos: Record<string, string>;
  hijos: NodoXml[];
  /** The element's own text (CDATA included), trimmed. */
  texto: string;
}

export class ErrorXml extends Error {}

const ENTIDADES: Record<string, string> = { lt: "<", gt: ">", amp: "&", quot: '"', apos: "'" };

function desescapar(t: string): string {
  return t.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);/g, (todo, e: string) => {
    if (e[0] === "#") {
      const n = e[1] === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : todo;
    }
    return ENTIDADES[e] ?? todo;
  });
}

const sinPrefijo = (nombre: string) => nombre.slice(nombre.indexOf(":") + 1);

/** Parses a document and returns its root element. */
export function leerXml(texto: string): NodoXml {
  const s = texto.replace(/^﻿/, "");
  const pila: NodoXml[] = [];
  const partes: string[][] = [];
  let raiz: NodoXml | null = null;
  let i = 0;
  const agregarTexto = (t: string) => {
    if (pila.length) partes[partes.length - 1].push(t);
    else if (t.trim()) throw new ErrorXml("Hay texto fuera del elemento principal.");
  };
  while (i < s.length) {
    const lt = s.indexOf("<", i);
    if (lt < 0) {
      agregarTexto(desescapar(s.slice(i)));
      break;
    }
    if (lt > i) agregarTexto(desescapar(s.slice(i, lt)));
    if (s.startsWith("<!--", lt)) {
      const fin = s.indexOf("-->", lt + 4);
      if (fin < 0) throw new ErrorXml("Un comentario no se cierra.");
      i = fin + 3;
    } else if (s.startsWith("<![CDATA[", lt)) {
      const fin = s.indexOf("]]>", lt + 9);
      if (fin < 0) throw new ErrorXml("Un bloque CDATA no se cierra.");
      agregarTexto(s.slice(lt + 9, fin));
      i = fin + 3;
    } else if (s.startsWith("<?", lt)) {
      const fin = s.indexOf("?>", lt + 2);
      if (fin < 0) throw new ErrorXml("Una declaración <? no se cierra.");
      i = fin + 2;
    } else if (s.startsWith("<!", lt)) {
      // DOCTYPE and the like: skipped, never expanded.
      const fin = s.indexOf(">", lt + 2);
      if (fin < 0) throw new ErrorXml("Una declaración <! no se cierra.");
      i = fin + 1;
    } else if (s[lt + 1] === "/") {
      const fin = s.indexOf(">", lt);
      if (fin < 0) throw new ErrorXml("Una etiqueta de cierre no termina.");
      const nombre = sinPrefijo(s.slice(lt + 2, fin).trim());
      const abierto = pila.pop();
      if (!abierto || abierto.nombre !== nombre) throw new ErrorXml(`La etiqueta </${nombre}> no corresponde a la que estaba abierta.`);
      abierto.texto = partes.pop()!.join("").trim();
      i = fin + 1;
    } else {
      const { nodo, fin, cerrado } = leerApertura(s, lt);
      if (pila.length) pila[pila.length - 1].hijos.push(nodo);
      else if (raiz) throw new ErrorXml("Hay más de un elemento principal.");
      else raiz = nodo;
      if (!cerrado) {
        pila.push(nodo);
        partes.push([]);
      }
      i = fin;
    }
  }
  if (pila.length) throw new ErrorXml(`La etiqueta <${pila[pila.length - 1].nombre}> no se cierra.`);
  if (!raiz) throw new ErrorXml("El archivo no tiene contenido XML.");
  return raiz;
}

function leerApertura(s: string, lt: number): { nodo: NodoXml; fin: number; cerrado: boolean } {
  let i = lt + 1;
  const nombreRe = /[^\s/>]+/y;
  nombreRe.lastIndex = i;
  const m = nombreRe.exec(s);
  if (!m) throw new ErrorXml("Hay una etiqueta sin nombre.");
  const nodo: NodoXml = { nombre: sinPrefijo(m[0]), atributos: {}, hijos: [], texto: "" };
  i = nombreRe.lastIndex;
  const atributoRe = /\s*([^\s=/>]+)\s*=\s*("([^"]*)"|'([^']*)')/y;
  for (;;) {
    while (i < s.length && /\s/.test(s[i])) i++;
    if (s[i] === ">") return { nodo, fin: i + 1, cerrado: false };
    if (s[i] === "/" && s[i + 1] === ">") return { nodo, fin: i + 2, cerrado: true };
    atributoRe.lastIndex = i;
    const a = atributoRe.exec(s);
    if (!a) throw new ErrorXml(`La etiqueta <${nodo.nombre}> está mal escrita.`);
    const nombre = a[1];
    // Namespace declarations aren't data.
    if (nombre !== "xmlns" && !nombre.startsWith("xmlns:")) nodo.atributos[sinPrefijo(nombre)] = desescapar(a[3] ?? a[4] ?? "");
    i = atributoRe.lastIndex;
  }
}

/** The first child with that name. */
export const hijo = (n: NodoXml | null | undefined, nombre: string): NodoXml | null => n?.hijos.find((h) => h.nombre === nombre) ?? null;
export const hijos = (n: NodoXml | null | undefined, nombre: string): NodoXml[] => n?.hijos.filter((h) => h.nombre === nombre) ?? [];

// ---------------------------------------------------------------- writing

export function escaparXml(t: string): string {
  return t.replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[c]!);
}

/** An element to write: name (with its prefix), attributes (undefined / "" left out) and children or text. */
export interface ElementoXml {
  nombre: string;
  atributos?: Record<string, string | undefined>;
  hijos?: (ElementoXml | null)[];
  texto?: string;
}

export function escribirXml(raiz: ElementoXml): string {
  const lineas: string[] = ['<?xml version="1.0" encoding="UTF-8"?>'];
  const escribir = (e: ElementoXml, sangria: string) => {
    const atributos = Object.entries(e.atributos ?? {})
      .filter(([, v]) => v !== undefined && v !== "")
      .map(([k, v]) => ` ${k}="${escaparXml(v!)}"`)
      .join("");
    const hijos = (e.hijos ?? []).filter((h): h is ElementoXml => h !== null);
    if (hijos.length) {
      lineas.push(`${sangria}<${e.nombre}${atributos}>`);
      for (const h of hijos) escribir(h, `${sangria}  `);
      lineas.push(`${sangria}</${e.nombre}>`);
    } else if (e.texto !== undefined && e.texto !== "") {
      lineas.push(`${sangria}<${e.nombre}${atributos}>${escaparXml(e.texto)}</${e.nombre}>`);
    } else {
      lineas.push(`${sangria}<${e.nombre}${atributos}/>`);
    }
  };
  escribir(raiz, "");
  return `${lineas.join("\n")}\n`;
}
