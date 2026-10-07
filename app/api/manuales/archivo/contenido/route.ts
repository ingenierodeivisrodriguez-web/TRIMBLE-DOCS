import { NextRequest, NextResponse } from "next/server";
import { handleLector, idParam } from "../../../../../lib/manuales/routes";
import { archivo } from "../../../../../lib/manuales/service";
import { tipoMime } from "../../../../../lib/manuales/tipos";

export const dynamic = "force-dynamic";

/**
 * `?fileId=` (`&pdf=1` for a PDF rendition): the file's content, streamed
 * from Trimble Connect's storage so the screen can show it inline (the
 * storage link alone may make the browser download it).
 */
export async function GET(req: NextRequest) {
  return handleLector(req, async ({ tc, abierta }) => {
    const fileId = idParam(req, "fileId", true)!;
    const pdf = req.nextUrl.searchParams.get("pdf") === "1";
    const a = await archivo(tc, abierta, fileId, pdf);
    const upstream = await fetch(a.url, { cache: "no-store" });
    if (!upstream.ok || !upstream.body) {
      console.error(`[manuales] el almacenamiento respondió ${upstream.status} para ${fileId}`);
      return NextResponse.json(
        {
          error: pdf
            ? "Trimble Connect no tiene una versión PDF de este archivo."
            : `Trimble Connect no entregó el archivo (HTTP ${upstream.status}).`,
          code: "sin-contenido",
        },
        { status: 502 }
      );
    }
    const headers = new Headers({
      "Content-Type": pdf ? "application/pdf" : tipoMime(a.ext, upstream.headers.get("content-type")),
      "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(pdf ? `${a.nombre}.pdf` : a.nombre)}`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    });
    const length = upstream.headers.get("content-length");
    if (length) headers.set("Content-Length", length);
    return new Response(upstream.body, { headers });
  });
}
