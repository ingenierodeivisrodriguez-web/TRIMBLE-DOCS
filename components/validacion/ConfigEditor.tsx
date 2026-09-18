"use client";

import { useEffect, useMemo, useState } from "react";
import Card from "../Card";
import { validateConfig } from "../../lib/validacion/config";
import { TEMPLATE_KEYS, TemplateKey, ValidationConfig } from "../../lib/validacion/types";
import NameTester from "./NameTester";
import TemplateEditor from "./TemplateEditor";
import { noticeBase, noticeStyles, primaryButtonStyle, secondaryButtonStyle } from "./ui";

const serialize = (config: ValidationConfig) =>
  JSON.stringify({ graphic: config.graphic, nonGraphic: config.nonGraphic });

type Status = { kind: "ok" | "error"; text: string; details?: string[] } | null;

export default function ConfigEditor({
  projectId,
  accessToken,
  initial,
  onSaved,
  onDirtyChange,
}: {
  projectId: string;
  accessToken: string;
  initial: ValidationConfig;
  onSaved: (config: ValidationConfig) => void;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const [draft, setDraft] = useState<ValidationConfig>(initial);
  const [baseline, setBaseline] = useState<ValidationConfig>(initial);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<Status>(null);

  const dirty = serialize(draft) !== serialize(baseline);
  const errors = useMemo(() => validateConfig(draft), [draft]);

  useEffect(() => {
    onDirtyChange(dirty);
  }, [dirty, onDirtyChange]);

  const setTemplate = (key: TemplateKey, template: ValidationConfig[TemplateKey]) => {
    setDraft((current) => ({ ...current, [key]: template }));
    setStatus(null);
  };

  const moveExtension = (to: TemplateKey, ext: string) => {
    const from: TemplateKey = to === "graphic" ? "nonGraphic" : "graphic";
    setDraft((current) => ({
      ...current,
      [from]: { ...current[from], extensions: current[from].extensions.filter((e) => e !== ext) },
      [to]: {
        ...current[to],
        extensions: current[to].extensions.includes(ext)
          ? current[to].extensions
          : [...current[to].extensions, ext],
      },
    }));
    setStatus(null);
  };

  async function save() {
    setSaving(true);
    setStatus(null);
    try {
      const res = await fetch(`/api/validacion/config?projectId=${encodeURIComponent(projectId)}`, {
        method: "PUT",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setStatus({
          kind: "error",
          text: body.error ?? `No se pudo guardar (error ${res.status}).`,
          details: body.details,
        });
        return;
      }
      const savedConfig = body.config as ValidationConfig;
      setDraft(savedConfig);
      setBaseline(savedConfig);
      onSaved(savedConfig);
      setStatus({
        kind: "ok",
        text: "Configuración guardada. Ya se aplica a los próximos análisis de este proyecto.",
      });
    } catch (err) {
      setStatus({ kind: "error", text: err instanceof Error ? err.message : "No se pudo guardar." });
    } finally {
      setSaving(false);
    }
  }

  const discard = () => {
    setDraft(baseline);
    setStatus(null);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <Card>
        <p style={{ margin: 0, color: "var(--tc-gray-700)", fontSize: 14, lineHeight: 1.5 }}>
          Define cómo deben nombrarse los archivos de <strong>este proyecto</strong>. Hay dos plantillas
          fijas; a cada una le asignas sus extensiones y los campos que componen el nombre (sin la
          extensión), con el separador que va entre cada par de campos. La configuración se guarda por
          proyecto y la comparten todos sus usuarios.
        </p>
        {baseline.updatedAt && (
          <p style={{ margin: "8px 0 0", color: "var(--tc-gray-500)", fontSize: 12 }}>
            Última vez guardada: {new Date(baseline.updatedAt).toLocaleString("es")}
          </p>
        )}
      </Card>

      {TEMPLATE_KEYS.map((key) => (
        <TemplateEditor
          key={key}
          templateKey={key}
          template={draft[key]}
          otherTemplate={draft[key === "graphic" ? "nonGraphic" : "graphic"]}
          onChange={(template) => setTemplate(key, template)}
          onMoveFromOther={(ext) => moveExtension(key, ext)}
        />
      ))}

      <NameTester config={draft} />

      <div
        style={{
          position: "sticky",
          bottom: 0,
          zIndex: 5,
          background: "var(--tc-white)",
          borderRadius: "var(--tc-radius)",
          boxShadow: "0 -2px 10px rgba(10, 61, 98, 0.15)",
          padding: 14,
          display: "flex",
          flexDirection: "column",
          gap: 10,
        }}
      >
        {errors.length > 0 && (
          <div style={{ ...noticeBase, ...noticeStyles.error }}>
            <strong>Corrige esto antes de guardar:</strong>
            <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
              {errors.slice(0, 6).map((message) => (
                <li key={message}>{message}</li>
              ))}
              {errors.length > 6 && <li>… y {errors.length - 6} más.</li>}
            </ul>
          </div>
        )}
        {status && (
          <div style={{ ...noticeBase, ...(status.kind === "ok" ? noticeStyles.info : noticeStyles.error) }}>
            {status.text}
            {status.details && (
              <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
                {status.details.map((d) => (
                  <li key={d}>{d}</li>
                ))}
              </ul>
            )}
          </div>
        )}
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10 }}>
          <button
            type="button"
            style={{ ...primaryButtonStyle, opacity: saving || !dirty || errors.length > 0 ? 0.5 : 1 }}
            disabled={saving || !dirty || errors.length > 0}
            onClick={save}
          >
            {saving ? "Guardando..." : "Guardar configuración"}
          </button>
          <button
            type="button"
            style={{ ...secondaryButtonStyle, opacity: dirty && !saving ? 1 : 0.5 }}
            disabled={!dirty || saving}
            onClick={discard}
          >
            Descartar cambios
          </button>
          {dirty && (
            <span style={{ fontSize: 13, color: "#7a5300" }}>
              Hay cambios sin guardar; el análisis usa la configuración guardada.
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
