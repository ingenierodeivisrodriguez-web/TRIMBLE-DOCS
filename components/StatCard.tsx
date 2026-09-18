export default function StatCard({
  label,
  value,
  hint,
  onClick,
  active,
  title,
}: {
  label: string;
  value: string;
  hint?: string;
  /** When given, the card behaves like a button (e.g. to filter a table). */
  onClick?: () => void;
  /** Highlights the card as the current selection. */
  active?: boolean;
  title?: string;
}) {
  const style: React.CSSProperties = {
    background: "var(--tc-white)",
    borderRadius: "var(--tc-radius)",
    boxShadow: active ? "0 0 0 2px var(--tc-blue-600), var(--tc-shadow)" : "var(--tc-shadow)",
    padding: "18px 22px",
    flex: "1 1 200px",
    minWidth: 200,
    textAlign: "left",
    border: "none",
    font: "inherit",
    transition: "box-shadow 120ms ease, transform 120ms ease",
    cursor: onClick ? "pointer" : undefined,
  };

  const content = (
    <>
      <div style={{ fontSize: 13, color: "var(--tc-gray-500)", fontWeight: 600, letterSpacing: 0.3 }}>
        {label.toUpperCase()}
      </div>
      <div style={{ fontSize: 30, color: "var(--tc-blue-800)", fontWeight: 700, marginTop: 6 }}>
        {value}
      </div>
      {hint && <div style={{ fontSize: 12, color: "var(--tc-gray-500)", marginTop: 4 }}>{hint}</div>}
    </>
  );

  if (!onClick) return <div style={style}>{content}</div>;

  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-pressed={active}
      style={style}
      onMouseEnter={(e) => (e.currentTarget.style.transform = "translateY(-2px)")}
      onMouseLeave={(e) => (e.currentTarget.style.transform = "none")}
    >
      {content}
    </button>
  );
}
