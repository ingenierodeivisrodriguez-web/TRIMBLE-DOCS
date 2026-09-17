export default function StatCard({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div
      style={{
        background: "var(--tc-white)",
        borderRadius: "var(--tc-radius)",
        boxShadow: "var(--tc-shadow)",
        padding: "18px 22px",
        flex: "1 1 200px",
        minWidth: 200,
      }}
    >
      <div style={{ fontSize: 13, color: "var(--tc-gray-500)", fontWeight: 600, letterSpacing: 0.3 }}>
        {label.toUpperCase()}
      </div>
      <div style={{ fontSize: 30, color: "var(--tc-blue-800)", fontWeight: 700, marginTop: 6 }}>
        {value}
      </div>
      {hint && <div style={{ fontSize: 12, color: "var(--tc-gray-500)", marginTop: 4 }}>{hint}</div>}
    </div>
  );
}
