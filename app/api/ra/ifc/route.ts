import { NextRequest, NextResponse } from "next/server";
import { ServiceError } from "../../../../lib/propiedades/service";
import { handle } from "../../../../lib/ra/routes";
import { getDownloadUrl, resolveProjectBaseUrl } from "../../../../lib/trimbleApi";

export const dynamic = "force-dynamic";
// Large IFC files take a while to stream through.
export const maxDuration = 300;

const ID = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * `?fileId=&versionId=`: the IFC's content, streamed from Trimble Connect's
 * storage with the caller's own token (Trimble decides whether they may read
 * it), so the browser can convert it without depending on that storage's CORS.
 */
export async function GET(req: NextRequest) {
  return handle(req, async ({ projectId, accessToken }) => {
    const fileId = req.nextUrl.searchParams.get("fileId") ?? "";
    const versionId = req.nextUrl.searchParams.get("versionId") ?? "";
    if (!ID.test(fileId) || (versionId && !ID.test(versionId))) throw new ServiceError("El archivo pedido no es válido.", 400, "invalido");
    const baseUrl = await resolveProjectBaseUrl(accessToken, projectId);
    const url = await getDownloadUrl(baseUrl, accessToken, fileId, versionId ? { versionId } : {});
    const upstream = await fetch(url, { cache: "no-store" });
    if (!upstream.ok || !upstream.body) {
      console.error(`[ra] el almacenamiento respondió ${upstream.status} para ${fileId}`);
      return NextResponse.json({ error: `Trimble Connect no entregó el archivo (HTTP ${upstream.status}).`, code: "sin-contenido" }, { status: 502 });
    }
    const headers = new Headers({ "Content-Type": "application/octet-stream", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" });
    const largo = upstream.headers.get("content-length");
    if (largo) headers.set("Content-Length", largo);
    return new Response(upstream.body, { headers });
  });
}
