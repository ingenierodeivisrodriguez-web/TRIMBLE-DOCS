import { NextRequest, NextResponse } from "next/server";
import { esOrden, verificarOrden } from "../../../../../lib/manuales/pagos";
import { handleAdmin, hoy, pasarelasDe } from "../../../../../lib/manuales/routes";
import { ManualesError } from "../../../../../lib/manuales/service";

export const dynamic = "force-dynamic";

/** The purchases of licenses, newest first. */
export async function GET(req: NextRequest) {
  return handleAdmin(req, async ({ store }) => NextResponse.json({ hoy: hoy(), ordenes: await store.listarOrdenes({ limite: 500 }) }));
}

/** `{ orden }`: checks a pending purchase against its gateway now. */
export async function POST(req: NextRequest) {
  return handleAdmin(req, async ({ store }) => {
    const body = (await req.json().catch(() => null)) as { orden?: unknown } | null;
    if (!esOrden(body?.orden)) throw new ManualesError("Compra no válida.", 400, "parametro");
    const orden = await store.getOrden(body.orden);
    if (!orden) throw new ManualesError("No se encontró esa compra.", 404, "no-existe");
    const pasarelas = pasarelasDe();
    if (!pasarelas[orden.pasarela]) throw new ManualesError("La pasarela de esa compra ya no está configurada en Vercel.", 409, "sin-pasarela");
    return NextResponse.json({ orden: await verificarOrden(store, pasarelas, orden, hoy()) });
  });
}
