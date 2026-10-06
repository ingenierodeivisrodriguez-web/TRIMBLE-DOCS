"use client";

import { ReactNode, useState } from "react";
import { acceptButton, baseInput, labelStyle, Modal } from "./ui";

/** One text field and Aceptar (new title, subpresupuesto name...). */
export function TextoDialog({
  title,
  label,
  initial = "",
  maxLength = 300,
  onAccept,
  onClose,
}: {
  title: string;
  label: string;
  initial?: string;
  maxLength?: number;
  onAccept: (text: string) => void;
  onClose: () => void;
}) {
  const [text, setText] = useState(initial);
  const ok = text.trim().length > 0;
  return (
    <Modal
      title={title}
      onClose={onClose}
      width={620}
      footer={
        <button type="button" style={{ ...acceptButton, opacity: ok ? 1 : 0.6 }} disabled={!ok} onClick={() => onAccept(text.trim())}>
          Aceptar
        </button>
      }
    >
      <form
        style={{ padding: "16px 18px 4px" }}
        onSubmit={(e) => {
          e.preventDefault();
          if (ok) onAccept(text.trim());
        }}
      >
        <label>
          <span style={{ ...labelStyle, fontSize: 15 }}>{label}</span>
          <input autoFocus value={text} maxLength={maxLength} onChange={(e) => setText(e.target.value)} style={{ ...baseInput, width: "100%", fontSize: 15, padding: "9px 10px" }} />
        </label>
      </form>
    </Modal>
  );
}

/** A yes/no question before something that can't be undone. */
export function ConfirmDialog({
  title,
  children,
  confirmLabel = "Aceptar",
  danger,
  onConfirm,
  onClose,
}: {
  title: string;
  children: ReactNode;
  confirmLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Modal
      title={title}
      onClose={onClose}
      width={520}
      footer={
        <>
          <button type="button" onClick={onClose} style={{ ...acceptButton, background: "#e6e9ee", color: "var(--tc-gray-700)" }}>
            Cancelar
          </button>
          <button type="button" autoFocus onClick={onConfirm} style={{ ...acceptButton, background: danger ? "#b3261e" : acceptButton.background }}>
            {confirmLabel}
          </button>
        </>
      }
    >
      <div style={{ padding: "16px 18px", fontSize: 14.5, lineHeight: 1.5 }}>{children}</div>
    </Modal>
  );
}
