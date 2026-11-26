import { IMAGENES } from "../../../../../lib/i360-pruebas/imagenes";

// TEMPORARY (Inspección 360°, Fase 0): images for the viewer spikes. Remove when Fase 0 closes.
// /icono/<verde|rojo|azul>.png → point icon for viewer.addIcon.
// /tesela/<any path> → a colored tile for viewer.addPanorama. Every request path is logged so the
// Vercel runtime logs show which placeholders of tilesUrl the 3D viewer fills in (undocumented).
export const dynamic = "force-dynamic";

const CORS = { "Access-Control-Allow-Origin": "*", "Cache-Control": "no-store" };

export async function GET(req: Request, ctx: { params: Promise<{ ruta: string[] }> }) {
  const { ruta } = await ctx.params;
  const url = new URL(req.url);
  const camino = ruta.join("/");
  if (ruta[0] === "icono") {
    const color = (ruta[1] ?? "").replace(/\.png$/, "");
    const datos = color === "rojo" ? IMAGENES.icono_rojo : color === "azul" ? IMAGENES.icono_azul : IMAGENES.icono_verde;
    console.log(JSON.stringify({ i360prueba: "icono", camino, desde: req.headers.get("referer") ?? "" }));
    return new Response(Buffer.from(datos, "base64"), { headers: { ...CORS, "Content-Type": "image/png" } });
  }
  if (ruta[0] === "tesela") {
    console.log(JSON.stringify({ i360prueba: "tesela", camino, consulta: url.search, desde: req.headers.get("referer") ?? "" }));
    const tonos = [IMAGENES.tesela_a, IMAGENES.tesela_b, IMAGENES.tesela_c, IMAGENES.tesela_d];
    let h = 0;
    for (const c of camino) h = (h * 31 + c.charCodeAt(0)) >>> 0;
    return new Response(Buffer.from(tonos[h % tonos.length], "base64"), { headers: { ...CORS, "Content-Type": "image/jpeg" } });
  }
  return new Response("No encontrado", { status: 404, headers: CORS });
}
