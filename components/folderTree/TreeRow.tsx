"use client";

import type { RowComponentProps } from "react-window";
import { colorForLevel, TreeFolderNode } from "../../lib/folderTree";
import type { FlatRow } from "../../lib/folderTreeClient";
import { formatBytes } from "../../lib/format";

export interface TreeRowProps {
  rows: FlatRow[];
  expanded: ReadonlySet<string>;
  onToggle: (folderId: string) => void;
  onOpenPermissions: (folder: TreeFolderNode, ancestors: FlatRow["ancestors"]) => void;
  highlightId: string | null;
}

const INDENT_PX = 20;

export default function TreeRow({
  index,
  style,
  rows,
  expanded,
  onToggle,
  onOpenPermissions,
  highlightId,
}: RowComponentProps<TreeRowProps>) {
  const row = rows[index];
  const { node, depth, ancestors } = row;
  const isFolder = node.kind === "folder";
  const isOpen = isFolder && expanded.has(node.id);
  const isHighlighted = node.id === highlightId;

  return (
    <div
      id={`tree-row-${node.id}`}
      style={{
        ...style,
        display: "flex",
        alignItems: "center",
        paddingLeft: depth * INDENT_PX + 8,
        paddingRight: 10,
        gap: 6,
        cursor: isFolder ? "pointer" : "default",
        background: isHighlighted ? "var(--tc-blue-100)" : "transparent",
        outline: isHighlighted ? "2px solid var(--tc-blue-500)" : "none",
        outlineOffset: -2,
        borderRadius: 6,
        fontSize: 13.5,
        whiteSpace: "nowrap",
        overflow: "hidden",
      }}
      onClick={isFolder ? () => onToggle(node.id) : undefined}
    >
      {isFolder ? (
        <span
          aria-hidden
          style={{
            display: "inline-block",
            width: 14,
            flexShrink: 0,
            transform: isOpen ? "rotate(90deg)" : "rotate(0deg)",
            transition: "transform 100ms ease",
            color: "var(--tc-gray-500)",
          }}
        >
          ▶
        </span>
      ) : (
        <span style={{ width: 14, flexShrink: 0 }} />
      )}

      {isFolder ? (
        <span
          aria-hidden
          style={{
            width: 9,
            height: 9,
            borderRadius: 3,
            background: colorForLevel(node.level),
            flexShrink: 0,
          }}
        />
      ) : (
        <span aria-hidden style={{ flexShrink: 0, fontSize: 13, color: "var(--tc-gray-500)" }}>
          📄
        </span>
      )}

      <span
        style={{
          overflow: "hidden",
          textOverflow: "ellipsis",
          color: isFolder ? "var(--tc-gray-700)" : "var(--tc-gray-500)",
          fontWeight: isFolder ? 600 : 400,
        }}
      >
        {node.name}
      </span>

      {isFolder ? (
        <>
          <span style={{ color: "var(--tc-gray-500)", fontSize: 12, flexShrink: 0 }}>
            {node.fileCount.toLocaleString("es")} {node.fileCount === 1 ? "archivo en total" : "archivos en total"}
          </span>
          <button
            type="button"
            title="Ver permisos de la carpeta"
            aria-label={`Ver permisos de ${node.name}`}
            onClick={(e) => {
              e.stopPropagation();
              onOpenPermissions(node, ancestors);
            }}
            style={peopleButtonStyle}
          >
            👤
          </button>
        </>
      ) : (
        <span style={{ color: "var(--tc-gray-500)", fontSize: 12, flexShrink: 0, marginLeft: "auto" }}>
          {formatBytes(node.size)}
        </span>
      )}
    </div>
  );
}

const peopleButtonStyle: React.CSSProperties = {
  marginLeft: "auto",
  border: "none",
  background: "transparent",
  cursor: "pointer",
  borderRadius: 6,
  padding: "2px 6px",
  fontSize: 13,
  flexShrink: 0,
  lineHeight: 1,
};
