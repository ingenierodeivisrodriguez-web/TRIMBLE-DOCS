"use client";

import { CSSProperties, useState } from "react";
import type { PresupuestoApi } from "../../lib/presupuesto/client";
import { leerLibro, plantillaCatalogo } from "../../lib/presupuesto/excel";
import { PlanImportacion, planificarImportacion } from "../../lib/presupuesto/importar";
import { acceptButton, message, Modal, Notice } from "./ui";
import type { Catalogo } from "./usePresupuesto";

const MAX_ERRORES = 50;

/**
 * Loads catalogs from the Excel template: download it (empty or with the
 * current catalog), fill it, upload it, check what will change, import.
 */
export default function ImportarDialog({
  api,
  catalogo,
  canEdit,
  readOnlyNote,
  onImported,
  onClose,
}: {
  api: PresupuestoApi;
  catalogo: Catalogo;
  canEdit: boolean;
  readOnlyNote: string;
  onImported: () => void;
  onClose: () => void;
}) {
  const [plan, setPlan] = useState<PlanImportacion | null>(null);
  const [archivo, setArchivo] = useState("");
  const [leyendo, setLeyendo] = useState(false);
  const [progreso, setProgreso] = useState("");
  const [error, setError] = useState("");
  const [hecho, setHecho] = useState("");

  async function descargarPlantilla(conDatos: boolean) {
    setError("");
    try {
      await plantillaCatalogo(conDatos ? catalogo : null, conDatos ? "Catalogo de presupuesto.xlsx" : "Plantilla catalogo presupuesto.xlsx");
    } catch (err) {
      setError(message(err));
    }
  }

  async function leer(file: File) {
    setError("");
    setHecho("");
    setPlan(null);
    setArchivo(file.name);
    setLeyendo(true);
    try {
      const libro = await leerLibro(await file.arrayBuffer());
      if (!libro.insumos && !libro.partidas && !libro.apu && !libro.omniclass) {
        throw new Error('El archivo no tiene las hojas de la plantilla ("Insumos", "Partidas", "APU" u "OmniClass").');
      }
      setPlan(planificarImportacion(libro, catalogo));
    } catch (err) {
      setError(`No se pudo leer el archivo: ${message(err)}`);
    } finally {
      setLeyendo(false);
    }
  }

  async function importar() {
    if (!plan) return;
    setError("");
    try {
      if (plan.omniclass.length) {
        setProgreso("Importando códigos OmniClass...");
        await api.guardarOmniclass(plan.omniclass);
      }
      if (plan.insumos.length) {
        await api.guardarInsumos(plan.insumos, (n) => setProgreso(`Insumos: ${n.toLocaleString("es")} de ${plan.insumos.length.toLocaleString("es")}...`));
      }
      if (plan.partidas.length) {
        await api.guardarPartidas(plan.partidas, (n) => setProgreso(`Partidas: ${n.toLocaleString("es")} de ${plan.partidas.length.toLocaleString("es")}...`));
      }
      setHecho(
        `Importación terminada: ${plan.insumos.length.toLocaleString("es")} insumo(s), ${plan.partidas.length.toLocaleString("es")} partida(s) y ${plan.omniclass.length.toLocaleString("es")} código(s) OmniClass.`
      );
      setPlan(null);
      onImported();
    } catch (err) {
      setError(`La importación se detuvo: ${message(err)} Lo importado hasta ese punto quedó guardado; corrige y vuelve a importar el archivo (no se duplica).`);
    } finally {
      setProgreso("");
    }
  }

  const r = plan?.resumen;
  const hayCambios = !!plan && (plan.insumos.length > 0 || plan.partidas.length > 0 || plan.omniclass.length > 0);
  return (
    <Modal title="Importar catálogos desde Excel" onClose={onClose} width={860}>
      <div style={{ padding: "14px 18px 18px", display: "flex", flexDirection: "column", gap: 14 }}>
        {!canEdit && <Notice kind="info">{readOnlyNote}</Notice>}
        <section>
          <h3 style={h3}>1. Descarga la plantilla</h3>
          <p style={p}>Tiene las hojas Insumos, Partidas, APU (los insumos de cada partida) y OmniClass, con instrucciones y ejemplos.</p>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button type="button" style={secondary} onClick={() => descargarPlantilla(false)}>
              Plantilla vacía
            </button>
            <button type="button" style={secondary} onClick={() => descargarPlantilla(true)} disabled={catalogo.insumos.length + catalogo.partidas.length === 0}>
              Catálogo actual en la plantilla (para editarlo en Excel)
            </button>
          </div>
        </section>
        <section>
          <h3 style={h3}>2. Sube el archivo lleno</h3>
          <input
            type="file"
            accept=".xlsx"
            disabled={!canEdit || leyendo || !!progreso}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) leer(f);
              e.target.value = "";
            }}
          />
          {leyendo && <p style={p}>Leyendo {archivo}...</p>}
        </section>

        {error && <Notice kind="error">{error}</Notice>}
        {hecho && <Notice kind="info">{hecho}</Notice>}

        {plan && r && (
          <section>
            <h3 style={h3}>3. Revisa e importa</h3>
            <ul style={{ ...p, paddingLeft: 20 }}>
              <li>
                Insumos: {r.insumosNuevos} nuevo(s), {r.insumosActualizados} actualizado(s), {r.insumosSinCambios} sin cambios.
              </li>
              <li>
                Partidas: {r.partidasNuevas} nueva(s), {r.partidasActualizadas} actualizada(s), {r.partidasSinCambios} sin cambios.
              </li>
              <li>Códigos OmniClass: {plan.omniclass.length}.</li>
            </ul>
            {plan.errores.length > 0 && (
              <Notice kind="warning" style={{ marginBottom: 10 }}>
                <strong>{plan.errores.length} fila(s) con problemas no se importarán:</strong>
                <ul style={{ margin: "6px 0 0", paddingLeft: 18, maxHeight: 180, overflow: "auto" }}>
                  {plan.errores.slice(0, MAX_ERRORES).map((e, i) => (
                    <li key={i}>{e}</li>
                  ))}
                  {plan.errores.length > MAX_ERRORES && <li>... y {plan.errores.length - MAX_ERRORES} más.</li>}
                </ul>
              </Notice>
            )}
            <button type="button" style={acceptButton} disabled={!canEdit || !hayCambios || !!progreso} onClick={importar}>
              {progreso || (hayCambios ? "Importar" : "No hay cambios que importar")}
            </button>
          </section>
        )}
      </div>
    </Modal>
  );
}

const h3: CSSProperties = { margin: "0 0 6px", fontSize: 15.5, color: "var(--tc-blue-900)" };
const p: CSSProperties = { margin: "0 0 8px", fontSize: 14, lineHeight: 1.5 };
const secondary: CSSProperties = {
  border: "1px solid var(--tc-blue-500)",
  background: "var(--tc-white)",
  color: "var(--tc-blue-700)",
  borderRadius: 4,
  padding: "8px 14px",
  fontSize: 14,
  fontWeight: 600,
  cursor: "pointer",
  fontFamily: "inherit",
};
