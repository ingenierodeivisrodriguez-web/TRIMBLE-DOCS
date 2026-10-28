import type { IfcAPI } from "web-ifc";
import type { ArchivoLeido, Vec3 } from "../../lib/ra/modelo";

/**
 * web-ifc in the browser, loaded only when someone prepares a model (it is
 * large). The .wasm is served from /public/web-ifc (a test keeps it equal to
 * the installed package). Single-threaded: the multi-threaded build needs
 * cross-origin isolation, which an iframe inside Trimble Connect does not have.
 */
let motor: Promise<IfcAPI> | null = null;

function abrirMotor(): Promise<IfcAPI> {
  motor ??= (async () => {
    const WebIFC = await import("web-ifc");
    const api = new WebIFC.IfcAPI();
    api.SetWasmPath("/web-ifc/", true);
    await api.Init(undefined, true);
    return api;
  })().catch((err) => {
    motor = null;
    throw err;
  });
  return motor;
}

/** Opens one IFC, reads its elements and closes it again (frees the browser's memory). */
export async function leerIfc(datos: Uint8Array, archivo: number, origen?: Vec3): Promise<ArchivoLeido> {
  const [api, { leerArchivo }] = await Promise.all([abrirMotor(), import("../../lib/ra/modelo")]);
  const id = api.OpenModel(datos, { COORDINATE_TO_ORIGIN: false });
  if (id < 0) throw new Error("El archivo no se pudo abrir como IFC.");
  try {
    return leerArchivo(api, id, archivo, origen);
  } finally {
    api.CloseModel(id);
  }
}
