export default function Home() {
  return (
    <main
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexDirection: "column",
        gap: 12,
        padding: 24,
        textAlign: "center",
      }}
    >
      <h1 style={{ color: "var(--tc-blue-800)" }}>Resumen Archivos</h1>
      <p style={{ color: "var(--tc-gray-500)", maxWidth: 480 }}>
        Esta aplicacion es una extension de Trimble Connect. Se usa embebida dentro de un
        proyecto de Trimble Connect, no como sitio independiente. Registra el manifiesto{" "}
        <code>/manifest.json</code> desde Configuracion del proyecto → Apps &amp; Capabilities.
      </p>
    </main>
  );
}
