"use client";

import { useState } from "react";
import { prepareLogo } from "../../lib/graficos/pdfReport";
import type { ReportSettings } from "../../lib/graficos/reportSettings";

/**
 * Branding for the executive PDF (title, company, author, logo). Remembered in
 * this browser, so it only needs filling in once.
 */
export default function ReportSettingsForm({
  settings,
  onChange,
  onGenerate,
  onCancel,
}: {
  settings: ReportSettings;
  onChange: (settings: ReportSettings) => void;
  onGenerate: () => void;
  onCancel: () => void;
}) {
  const [logoError, setLogoError] = useState("");

  async function pickLogo(file: File | undefined) {
    setLogoError("");
    if (!file) return;
    if (!/^image\/(png|jpeg)$/.test(file.type)) {
      setLogoError("El logo debe ser una imagen PNG o JPG.");
      return;
    }
    try {
      const logo = await prepareLogo(file);
      onChange({ ...settings, logo: { dataUrl: logo.dataUrl, width: logo.width, height: logo.height } });
    } catch (err) {
      setLogoError(err instanceof Error ? err.message : "No se pudo leer el logo.");
    }
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onGenerate();
      }}
      style={{
        border: "1px solid var(--tc-blue-500)",
        borderRadius: 8,
        padding: 12,
        marginBottom: 10,
        display: "flex",
        flexDirection: "column",
        gap: 8,
      }}
    >
      <div style={{ fontSize: 13, fontWeight: 700, color: "var(--tc-blue-800)" }}>Informe ejecutivo PDF</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 8 }}>
        <Field label="Título del informe">
          <input value={settings.title} onChange={(e) => onChange({ ...settings, title: e.target.value })} style={inputStyle} />
        </Field>
        <Field label="Empresa">
          <input
            value={settings.company}
            placeholder="Nombre de tu empresa"
            onChange={(e) => onChange({ ...settings, company: e.target.value })}
            style={inputStyle}
          />
        </Field>
        <Field label="Elaborado por">
          <input
            value={settings.preparedBy}
            onChange={(e) => onChange({ ...settings, preparedBy: e.target.value })}
            style={inputStyle}
          />
        </Field>
      </div>
      <Field label="Logo de la empresa (PNG o JPG)">
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          {settings.logo && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={settings.logo.dataUrl}
              alt="Logo"
              style={{ maxHeight: 36, maxWidth: 140, border: "1px solid var(--tc-gray-100)", borderRadius: 4, padding: 2 }}
            />
          )}
          <input type="file" accept="image/png,image/jpeg" onChange={(e) => pickLogo(e.target.files?.[0])} style={{ fontSize: 12 }} />
          {settings.logo && (
            <button type="button" onClick={() => onChange({ ...settings, logo: null })} style={linkButtonStyle}>
              Quitar logo
            </button>
          )}
        </div>
      </Field>
      {logoError && <div style={{ fontSize: 12, color: "#8a1c14" }}>{logoError}</div>}
      <div style={{ fontSize: 11.5, color: "var(--tc-gray-500)" }}>
        Incluye portada, resumen ejecutivo con hallazgos, una sección por gráfico con el modelo coloreado, notas y control
        del documento. Encuadra el modelo en el visor antes de generarlo: las capturas usan la vista actual.
      </div>
      <div style={{ display: "flex", gap: 6 }}>
        <button type="submit" style={primaryButtonStyle}>
          Generar PDF
        </button>
        <button type="button" onClick={onCancel} style={secondaryButtonStyle}>
          Cancelar
        </button>
      </div>
    </form>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 0 }}>
      <span style={{ fontSize: 11.5, fontWeight: 600, color: "var(--tc-gray-500)" }}>{label}</span>
      {children}
    </label>
  );
}

const inputStyle: React.CSSProperties = {
  border: "1px solid var(--tc-gray-300)",
  borderRadius: 6,
  padding: "6px 8px",
  fontSize: 13,
  color: "var(--tc-gray-700)",
  fontFamily: "inherit",
  minWidth: 0,
};

const primaryButtonStyle: React.CSSProperties = {
  border: "1px solid var(--tc-blue-700)",
  background: "var(--tc-blue-600)",
  color: "var(--tc-white)",
  borderRadius: 6,
  padding: "6px 14px",
  fontSize: 12.5,
  fontWeight: 600,
  cursor: "pointer",
};

const secondaryButtonStyle: React.CSSProperties = {
  border: "1px solid var(--tc-blue-500)",
  background: "var(--tc-white)",
  color: "var(--tc-blue-700)",
  borderRadius: 6,
  padding: "6px 14px",
  fontSize: 12.5,
  fontWeight: 600,
  cursor: "pointer",
};

const linkButtonStyle: React.CSSProperties = {
  border: "none",
  background: "transparent",
  color: "var(--tc-blue-700)",
  fontSize: 12,
  fontWeight: 600,
  cursor: "pointer",
  padding: 0,
};
