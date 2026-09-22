"use client";

import { useEffect, useMemo, useState } from "react";
import { List, useListRef } from "react-window";
import { fetchWithProgress, CrawlProgress } from "../../lib/apiClient";
import { colorForLevel, LEVEL_OVERFLOW_COLOR, TreeFolderNode } from "../../lib/folderTree";
import {
  allFolderIds,
  AncestorRef,
  flattenTree,
  loadExpandedIds,
  saveExpandedIds,
  SearchMatch,
  searchTree,
} from "../../lib/folderTreeClient";
import Card from "../Card";
import PermissionsPanel from "./PermissionsPanel";
import TreeRow from "./TreeRow";

interface TreeResponse {
  project: { id: string; name: string };
  root: TreeFolderNode;
}

const ROW_HEIGHT = 34;
const LIST_HEIGHT = 560;
const LEVELS_WITH_OWN_COLOR = [1, 2, 3, 4, 5, 6];

export default function FolderTreeTab({
  projectId,
  accessToken,
}: {
  projectId: string;
  accessToken: string;
}) {
  const [root, setRoot] = useState<TreeFolderNode | null>(null);
  const [loading, setLoading] = useState(true);
  const [progress, setProgress] = useState<CrawlProgress | null>(null);
  const [error, setError] = useState("");

  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [expandedLoadedFor, setExpandedLoadedFor] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [searchMatches, setSearchMatches] = useState<SearchMatch[] | null>(null);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const [pendingScrollId, setPendingScrollId] = useState<string | null>(null);

  const [permissionsTarget, setPermissionsTarget] = useState<{
    folder: TreeFolderNode;
    ancestors: AncestorRef[];
  } | null>(null);

  const listRef = useListRef(null);

  // Restore this browser's remembered expand/collapse state for this
  // project (see lib/folderTreeClient.ts) before the first paint of the tree.
  useEffect(() => {
    if (!projectId) return;
    setExpanded(loadExpandedIds(projectId));
    setExpandedLoadedFor(projectId);
  }, [projectId]);

  useEffect(() => {
    if (expandedLoadedFor !== projectId) return; // don't overwrite storage with the empty initial state
    saveExpandedIds(projectId, expanded);
  }, [projectId, expanded, expandedLoadedFor]);

  useEffect(() => {
    if (!projectId || !accessToken) return;
    let cancelled = false;
    setLoading(true);
    setError("");
    setProgress(null);
    fetchWithProgress<TreeResponse>(
      `/api/tree?projectId=${encodeURIComponent(projectId)}`,
      accessToken,
      (p) => {
        if (!cancelled) setProgress(p);
      },
      () => cancelled
    )
      .then((json) => {
        if (!cancelled && json) setRoot(json.root);
      })
      .catch((err) => {
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, accessToken]);

  const rows = useMemo(() => (root ? flattenTree(root, expanded) : []), [root, expanded]);

  // Once a reveal (search pick, "Expandir todo", etc.) has updated `expanded`
  // and the row list has been recomputed, scroll to and highlight the target.
  useEffect(() => {
    if (!pendingScrollId) return;
    const index = rows.findIndex((r) => r.node.id === pendingScrollId);
    if (index >= 0) {
      listRef.current?.scrollToRow({ index, align: "center", behavior: "smooth" });
      setHighlightId(pendingScrollId);
      setPendingScrollId(null);
    }
  }, [rows, pendingScrollId, listRef]);

  function toggleFolder(folderId: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(folderId)) next.delete(folderId);
      else next.add(folderId);
      return next;
    });
  }

  function revealMatch(match: SearchMatch) {
    setExpanded((prev) => {
      const next = new Set(prev);
      for (const id of match.pathIds) next.add(id);
      return next;
    });
    setPendingScrollId(match.id);
    setSearchMatches(null);
  }

  function handleSearchChange(value: string) {
    setSearch(value);
    setHighlightId(null);
    if (!root) return;
    const matches = searchTree(root, value);
    if (matches.length === 0) {
      setSearchMatches(value.trim() ? [] : null);
    } else if (matches.length === 1) {
      revealMatch(matches[0]);
      setSearchMatches(null);
    } else {
      setSearchMatches(matches);
    }
  }

  if (loading) {
    return (
      <CenteredMessage>
        Cargando la estructura de carpetas...
        {progress && progress.folders > 0 && (
          <div style={{ marginTop: 8, fontSize: 13 }}>
            {progress.files.toLocaleString("es")} archivos encontrados en{" "}
            {progress.folders.toLocaleString("es")} carpetas recorridas
          </div>
        )}
      </CenteredMessage>
    );
  }
  if (error) return <CenteredMessage isError>{error}</CenteredMessage>;
  if (!root) return <CenteredMessage>Sin datos disponibles.</CenteredMessage>;

  return (
    <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 16 }}>
      <header>
        <h1 style={{ color: "var(--tc-blue-900)", margin: "0 0 4px" }}>Estructura de Carpetas</h1>
        <p style={{ color: "var(--tc-gray-500)", margin: 0 }}>
          {root.name} · {root.fileCount.toLocaleString("es")} archivos en total
        </p>
      </header>

      <Card>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 14, alignItems: "center" }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: "var(--tc-gray-500)" }}>NIVELES:</span>
          {LEVELS_WITH_OWN_COLOR.map((level) => (
            <LegendItem key={level} color={colorForLevel(level)} label={`Nivel ${level}`} />
          ))}
          <LegendItem color={LEVEL_OVERFLOW_COLOR} label="Nivel 7+" />
        </div>
      </Card>

      <Card>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
          <div style={{ position: "relative", flex: "1 1 260px", minWidth: 220 }}>
            <input
              type="text"
              value={search}
              onChange={(e) => handleSearchChange(e.target.value)}
              placeholder="Buscar carpeta o archivo..."
              style={searchInputStyle}
            />
            {searchMatches && (
              <div style={searchResultsStyle}>
                {searchMatches.length === 0 ? (
                  <div style={{ padding: "8px 12px", color: "var(--tc-gray-500)", fontSize: 13 }}>
                    Sin resultados.
                  </div>
                ) : (
                  searchMatches.map((match) => (
                    <button
                      key={match.id}
                      onClick={() => revealMatch(match)}
                      style={searchResultButtonStyle}
                    >
                      {match.kind === "folder" ? "📁" : "📄"} {match.name}
                    </button>
                  ))
                )}
              </div>
            )}
          </div>
          <button style={toolbarButtonStyle} onClick={() => setExpanded(new Set(allFolderIds(root)))}>
            Expandir todo
          </button>
          <button style={toolbarButtonStyle} onClick={() => setExpanded(new Set())}>
            Contraer todo
          </button>
        </div>
      </Card>

      <Card>
        {rows.length === 0 ? (
          <p style={{ color: "var(--tc-gray-500)", fontSize: 13, margin: 0 }}>
            Este proyecto no tiene carpetas ni archivos.
          </p>
        ) : (
          <List
            listRef={listRef}
            rowComponent={TreeRow}
            rowCount={rows.length}
            rowHeight={ROW_HEIGHT}
            rowProps={{
              rows,
              expanded,
              onToggle: toggleFolder,
              onOpenPermissions: (folder: TreeFolderNode, ancestors: AncestorRef[]) =>
                setPermissionsTarget({ folder, ancestors }),
              highlightId,
            }}
            style={{ height: LIST_HEIGHT }}
          />
        )}
      </Card>

      {permissionsTarget && (
        <PermissionsPanel
          projectId={projectId}
          accessToken={accessToken}
          folderId={permissionsTarget.folder.id}
          folderName={permissionsTarget.folder.name}
          ancestors={permissionsTarget.ancestors}
          onClose={() => setPermissionsTarget(null)}
        />
      )}
    </div>
  );
}

function LegendItem({ color, label }: { color: string; label: string }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12.5, color: "var(--tc-gray-700)" }}>
      <span style={{ width: 10, height: 10, borderRadius: 3, background: color, display: "inline-block" }} />
      {label}
    </span>
  );
}

function CenteredMessage({ children, isError }: { children: React.ReactNode; isError?: boolean }) {
  return (
    <div
      style={{
        minHeight: "60vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: isError ? "#b3261e" : "var(--tc-gray-500)",
        padding: 24,
        textAlign: "center",
      }}
    >
      {children}
    </div>
  );
}

const toolbarButtonStyle: React.CSSProperties = {
  border: "1px solid var(--tc-blue-500)",
  background: "var(--tc-blue-50)",
  color: "var(--tc-blue-700)",
  borderRadius: 6,
  padding: "8px 14px",
  fontSize: 13,
  fontWeight: 600,
  cursor: "pointer",
  whiteSpace: "nowrap",
};

const searchInputStyle: React.CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  padding: "9px 14px",
  border: "1px solid var(--tc-gray-300)",
  borderRadius: 8,
  fontSize: 14,
  color: "var(--tc-gray-700)",
  outline: "none",
};

const searchResultsStyle: React.CSSProperties = {
  position: "absolute",
  top: "calc(100% + 4px)",
  left: 0,
  right: 0,
  background: "var(--tc-white)",
  border: "1px solid var(--tc-gray-300)",
  borderRadius: 8,
  boxShadow: "0 8px 20px rgba(10,61,98,0.18)",
  maxHeight: 260,
  overflowY: "auto",
  zIndex: 20,
};

const searchResultButtonStyle: React.CSSProperties = {
  display: "block",
  width: "100%",
  textAlign: "left",
  border: "none",
  background: "transparent",
  padding: "8px 12px",
  fontSize: 13,
  cursor: "pointer",
  color: "var(--tc-gray-700)",
};
