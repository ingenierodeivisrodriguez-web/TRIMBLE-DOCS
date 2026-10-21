"use client";

import { useMemo, useRef, useState } from "react";
import { textoAlias } from "../../lib/loin/alias";
import type { LoinApi } from "../../lib/loin/client";
import { exportarCatalogo, leerLibroParametros } from "../../lib/loin/excel";
import { entradasDyco, leerHojaParametros, planificarImportacion, PlanImportacion } from "../../lib/loin/importar";
import { CamposModelo, CatalogoResponse, EstadoResponse, NDIS, ORIGENES, OrigenDato, Parametro, TIPOS_DATO } from "../../lib/loin/types";
import { nombreSeguro } from "../../lib/presupuesto/excel";
import { coincide } from "../../lib/presupuesto/format";
import { baseInput, C, message, Notice } from "../presupuesto/ui";
import { botonPrincipal, botonSecundario, ETIQUETA_NDI, inactivo, select, sugerida, td, th } from "./estilos";
import ImportarDialog from "./ImportarDialog";
import ParametroDialog from "./ParametroDialog";

/** The data dictionary: every parameter that can be required, with its TDI group, NDI and where it is read from. */
export default function Catalogo({
  api,
  estado,
  catalogo,
  proyecto,
  camposModelo,
  onGuardados,
}: {
  api: LoinApi;
  estado: EstadoResponse;
  catalogo: CatalogoResponse;
  proyecto: string;
  camposModelo: CamposModelo | null;
  onGuardados: (p: Parametro[]) => void;
}) {
  const [busqueda, setBusqueda] = useState("");
  const [tdi, setTdi] = useState("");
  const [ndi, setNdi] = useState(0);
  const [origen, setOrigen] = useState<OrigenDato | "">("");
  const [porConfirmar, setPorConfirmar] = useState(false);
  const [inactivos, setInactivos] = useState(false);
  const [editando, setEditando] = useState<Parametro | "nuevo" | null>(null);
  const [plan, setPlan] = useState<{ titulo: string; plan: PlanImportacion } | null>(null);
  const [error, setError] = useState("");
  const [aviso, setAviso] = useState("");
  const [ocupado, setOcupado] = useState("");
  const archivo = useRef<HTMLInputElement>(null);
  const puede = estado.canEditBase;
  const { parametros, tdiGrupos } = catalogo;
  const nombreTdi = useMemo(() => new Map(tdiGrupos.map((g) => [g.codigo, g.nombre])), [tdiGrupos]);

  const visibles = useMemo(
    () =>
      parametros.filter(
        (p) =>
          (inactivos || p.activo) &&
          (!tdi || p.tdi === tdi) &&
          (!ndi || p.ndi === ndi) &&
          (!origen || p.origen === origen) &&
          (!porConfirmar || p.alias.some((a) => a.sugerida)) &&
          coincide(`${p.codigo} ${p.numero ?? ""} ${p.nombre} ${p.descripcion}`, busqueda)
      ),
    [parametros, inactivos, tdi, ndi, origen, porConfirmar, busqueda]
  );
  const sugeridas = parametros.filter((p) => p.activo && p.alias.some((a) => a.sugerida)).length;

  function abrirPlan(titulo: string, p: PlanImportacion) {
    setAviso("");
    if (p.filas.length === 0 && p.errores.length === 0) {
      setAviso(`${titulo}: no hay nada nuevo ni distinto (${p.iguales} parámetro(s) iguales a los del catálogo).`);
      return;
    }
    setPlan({ titulo, plan: p });
  }

  async function importarExcel(file: File) {
    setError("");
    setOcupado("Leyendo el archivo…");
    try {
      const hoja = await leerLibroParametros(await file.arrayBuffer());
      if (!hoja) throw new Error("El archivo no tiene una hoja con la columna \"Parámetro\".");
      const { entradas, errores } = leerHojaParametros(hoja);
      const p = planificarImportacion(entradas, parametros);
      abrirPlan(`Importar "${file.name}"`, { ...p, errores: [...errores, ...p.errores] });
    } catch (err) {
      setError(message(err));
    } finally {
      setOcupado("");
    }
  }

  async function exportar() {
    setOcupado("Preparando el Excel…");
    try {
      await exportarCatalogo(parametros, tdiGrupos, `${nombreSeguro(`Parámetros LOIN - ${proyecto}`)}.xlsx`);
    } catch (err) {
      setError(message(err));
    } finally {
      setOcupado("");
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10, minHeight: 0, flex: 1 }}>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <input value={busqueda} onChange={(e) => setBusqueda(e.target.value)} placeholder="Buscar por código, N°, nombre o descripción" aria-label="Buscar parámetros" style={{ ...baseInput, flex: "1 1 260px", padding: "6px 10px" }} />
        <select value={tdi} onChange={(e) => setTdi(e.target.value)} style={select} aria-label="Grupo TDI">
          <option value="">Todos los TDI</option>
          {tdiGrupos.map((g) => (
            <option key={g.codigo} value={g.codigo}>
              TDI-{g.codigo} · {g.nombre}
            </option>
          ))}
        </select>
        <select value={ndi} onChange={(e) => setNdi(Number(e.target.value))} style={select} aria-label="NDI">
          <option value={0}>Todos los NDI</option>
          {NDIS.map((n) => (
            <option key={n} value={n}>
              NDI-{n}
            </option>
          ))}
        </select>
        <select value={origen} onChange={(e) => setOrigen(e.target.value as OrigenDato | "")} style={select} aria-label="Origen del dato">
          <option value="">Todo origen</option>
          {(Object.entries(ORIGENES) as [OrigenDato, string][]).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
        <label style={chk}>
          <input type="checkbox" checked={porConfirmar} onChange={(e) => setPorConfirmar(e.target.checked)} /> Equivalencias por confirmar
        </label>
        <label style={chk}>
          <input type="checkbox" checked={inactivos} onChange={(e) => setInactivos(e.target.checked)} /> Ver inactivos
        </label>
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        {puede && (
          <>
            <button type="button" style={botonPrincipal} onClick={() => setEditando("nuevo")}>
              + Parámetro
            </button>
            <button type="button" style={botonSecundario} onClick={() => abrirPlan("Listado DYCO", planificarImportacion(entradasDyco(), parametros))} title="Compara el listado DYCO (89 parámetros) con el catálogo: los nuevos se agregan y lo distinto se te muestra para que decidas">
              Cargar listado DYCO
            </button>
            <button type="button" style={botonSecundario} onClick={() => archivo.current?.click()} disabled={!!ocupado}>
              Importar Excel
            </button>
            <input
              ref={archivo}
              type="file"
              accept=".xlsx"
              style={{ display: "none" }}
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (f) importarExcel(f);
              }}
            />
          </>
        )}
        <button type="button" style={botonSecundario} onClick={exportar} disabled={!!ocupado} title="El catálogo completo, con las columnas del listado DYCO y las que agrega la app (sirve de plantilla para importar)">
          Exportar Excel
        </button>
        <span style={{ fontSize: 13, color: "var(--tc-gray-500)" }}>
          {visibles.length} de {parametros.length} parámetro(s)
          {sugeridas > 0 && ` · ${sugeridas} con equivalencias IFC sugeridas por confirmar`}
          {ocupado && ` · ${ocupado}`}
        </span>
      </div>

      {!puede && <Notice kind="info">{estado.baseNote}</Notice>}
      {error && <Notice kind="error">{error}</Notice>}
      {aviso && <Notice kind="info">{aviso}</Notice>}
      {parametros.length === 0 && (
        <Notice kind="info">
          El catálogo está vacío. {puede ? "Pulsa \"Cargar listado DYCO\" para traer los 89 parámetros del listado, o importa tu propio Excel." : "Lo llenan los administradores y editores del catálogo."}
        </Notice>
      )}

      <div style={{ flex: 1, minHeight: 200, overflow: "auto", background: "#fff", border: `1px solid ${C.border}`, borderRadius: 4 }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={th}>Código</th>
              <th style={{ ...th, textAlign: "right" }}>N°</th>
              <th style={th}>TDI</th>
              <th style={th}>NDI</th>
              <th style={th}>Dato</th>
              <th style={th}>Parámetro</th>
              <th style={th}>Tipo</th>
              <th style={th}>Equivalencias de lectura</th>
            </tr>
          </thead>
          <tbody>
            {visibles.map((p) => (
              <tr key={p.id} onClick={() => setEditando(p)} style={{ cursor: "pointer", opacity: p.activo ? 1 : 0.55 }} title={p.descripcion}>
                <td style={{ ...td, whiteSpace: "nowrap" }}>{p.codigo}</td>
                <td style={{ ...td, textAlign: "right" }}>{p.numero ?? ""}</td>
                <td style={{ ...td, whiteSpace: "nowrap" }} title={nombreTdi.get(p.tdi) ?? "Grupo sin nombre"}>
                  TDI-{p.tdi}
                </td>
                <td style={td}>
                  <span style={ETIQUETA_NDI[p.ndi]}>NDI-{p.ndi}</span>
                </td>
                <td style={{ ...td, whiteSpace: "nowrap", color: p.origen === "por_definir" ? "var(--tc-gray-500)" : undefined }}>{ORIGENES[p.origen]}</td>
                <td style={td}>
                  {p.nombre} {!p.activo && <span style={inactivo}>Inactivo</span>}
                </td>
                <td style={{ ...td, whiteSpace: "nowrap" }}>
                  {TIPOS_DATO[p.tipoDato]}
                  {p.unidad ? ` (${p.unidad})` : ""}
                </td>
                <td style={{ ...td, fontSize: 12.5 }}>
                  {p.alias.slice(0, 3).map((a, i) => (
                    <span key={i} style={{ marginRight: 6, whiteSpace: "nowrap" }}>
                      {textoAlias(a)}
                      {a.sugerida && <span style={{ ...sugerida, marginLeft: 3 }}>sugerida</span>}
                    </span>
                  ))}
                  {p.alias.length > 3 && <span style={{ color: "var(--tc-gray-500)" }}>+{p.alias.length - 3}</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editando && (
        <ParametroDialog
          api={api}
          estado={estado}
          tdiGrupos={tdiGrupos}
          parametros={parametros}
          parametro={editando === "nuevo" ? null : editando}
          puedeEditar={puede}
          camposModelo={camposModelo}
          onGuardado={(p) => {
            onGuardados([p]);
            setEditando(null);
          }}
          onClose={() => setEditando(null)}
        />
      )}
      {plan && (
        <ImportarDialog
          api={api}
          titulo={plan.titulo}
          plan={plan.plan}
          onGuardados={(guardados) => {
            onGuardados(guardados);
            setAviso(`Listo: ${guardados.length} parámetro(s) guardado(s) en el catálogo.`);
          }}
          onClose={() => setPlan(null)}
        />
      )}
    </div>
  );
}

const chk = { fontSize: 13.5, display: "inline-flex", alignItems: "center", gap: 4, cursor: "pointer" } as const;
