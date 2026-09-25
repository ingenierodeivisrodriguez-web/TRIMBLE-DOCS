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
      <h1 style={{ color: "var(--tc-blue-800)" }}>Extensiones para Trimble Connect</h1>
      <p style={{ color: "var(--tc-gray-500)", maxWidth: 520 }}>
        Esta aplicacion contiene tres extensiones de Trimble Connect: <strong>Resumen Archivos</strong>,{" "}
        <strong>Validación</strong> y <strong>Gráficos de Modelos</strong> (esta última, para el visor
        3D). Se usan embebidas dentro de un proyecto de Trimble Connect, no como sitio independiente.
        Registra su manifiesto desde Configuracion del proyecto → Apps &amp; Capabilities:
      </p>
      <p style={{ color: "var(--tc-gray-700)" }}>
        <code>/manifest.json</code> (Resumen Archivos) · <code>/manifest-validacion.json</code>{" "}
        (Validación) · <code>/manifest-graficos.json</code> (Gráficos de Modelos)
      </p>
    </main>
  );
}
