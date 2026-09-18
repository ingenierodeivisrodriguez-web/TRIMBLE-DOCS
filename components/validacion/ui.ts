import type { CSSProperties } from "react";

export const inputStyle: CSSProperties = {
  border: "1px solid var(--tc-gray-300)",
  borderRadius: 6,
  padding: "7px 10px",
  fontSize: 14,
  color: "var(--tc-gray-700)",
  background: "var(--tc-white)",
  outline: "none",
  boxSizing: "border-box",
  fontFamily: "inherit",
};

export const primaryButtonStyle: CSSProperties = {
  border: "1px solid var(--tc-blue-700)",
  background: "var(--tc-blue-600)",
  color: "var(--tc-white)",
  borderRadius: 6,
  padding: "8px 18px",
  fontSize: 14,
  fontWeight: 600,
  cursor: "pointer",
  fontFamily: "inherit",
};

export const secondaryButtonStyle: CSSProperties = {
  border: "1px solid var(--tc-blue-500)",
  background: "var(--tc-white)",
  color: "var(--tc-blue-700)",
  borderRadius: 6,
  padding: "7px 14px",
  fontSize: 13,
  fontWeight: 600,
  cursor: "pointer",
  fontFamily: "inherit",
};

export const iconButtonStyle: CSSProperties = {
  border: "1px solid var(--tc-gray-300)",
  background: "var(--tc-white)",
  color: "var(--tc-gray-700)",
  borderRadius: 6,
  width: 30,
  height: 30,
  cursor: "pointer",
  fontSize: 14,
  lineHeight: 1,
  fontFamily: "inherit",
};

export const smallLabelStyle: CSSProperties = {
  display: "block",
  fontSize: 12,
  fontWeight: 600,
  color: "var(--tc-gray-500)",
  marginBottom: 4,
};

export const noticeStyles = {
  warning: {
    background: "#fff6e0",
    border: "1px solid #f0c36d",
    color: "#7a5300",
  },
  info: {
    background: "var(--tc-blue-100)",
    border: "1px solid var(--tc-blue-500)",
    color: "var(--tc-blue-900)",
  },
  error: {
    background: "#fdecea",
    border: "1px solid #e5a29c",
    color: "#8a1c14",
  },
} satisfies Record<string, CSSProperties>;

export const noticeBase: CSSProperties = {
  borderRadius: 8,
  padding: "10px 14px",
  fontSize: 13,
  lineHeight: 1.45,
};
