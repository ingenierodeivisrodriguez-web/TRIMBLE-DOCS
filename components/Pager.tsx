const buttonStyle: React.CSSProperties = {
  border: "1px solid var(--tc-gray-300)",
  background: "var(--tc-white)",
  borderRadius: 6,
  padding: "6px 14px",
  cursor: "pointer",
  fontSize: 13,
  color: "var(--tc-blue-700)",
  fontFamily: "inherit",
};

export default function Pager({
  page,
  pageSize,
  total,
  noun,
  onPageChange,
}: {
  page: number;
  pageSize: number;
  total: number;
  noun: string;
  onPageChange: (page: number) => void;
}) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  if (total <= pageSize) return null;

  return (
    <div style={{ display: "flex", justifyContent: "center", gap: 12, marginTop: 14 }}>
      <button
        style={{ ...buttonStyle, opacity: page <= 1 ? 0.5 : 1 }}
        disabled={page <= 1}
        onClick={() => onPageChange(page - 1)}
      >
        ← Anterior
      </button>
      <span style={{ color: "var(--tc-gray-500)", alignSelf: "center", fontSize: 13 }}>
        Pagina {page} de {totalPages} ({total.toLocaleString("es")} {noun})
      </span>
      <button
        style={{ ...buttonStyle, opacity: page >= totalPages ? 0.5 : 1 }}
        disabled={page >= totalPages}
        onClick={() => onPageChange(page + 1)}
      >
        Siguiente →
      </button>
    </div>
  );
}
