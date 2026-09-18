export default function Card({
  title,
  children,
  flex,
  action,
}: {
  title?: string;
  children: React.ReactNode;
  flex?: number;
  /** Optional element aligned to the right of the title (e.g. a button). */
  action?: React.ReactNode;
}) {
  return (
    <div
      style={{
        background: "var(--tc-white)",
        borderRadius: "var(--tc-radius)",
        boxShadow: "var(--tc-shadow)",
        padding: 20,
        flex: flex ? `${flex} 1 320px` : undefined,
        minWidth: 320,
      }}
    >
      {(title || action) && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            margin: "0 0 12px",
          }}
        >
          <h3 style={{ margin: 0, color: "var(--tc-blue-800)", fontSize: 16 }}>{title}</h3>
          {action}
        </div>
      )}
      {children}
    </div>
  );
}
