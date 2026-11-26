import { NextRequest, NextResponse } from "next/server";
import { handle } from "../../../../../../lib/inspeccion-360/routes";
import { archivoFoto } from "../../../../../../lib/inspeccion-360/service";
import { getDownloadUrl, resolveProjectBaseUrl } from "../../../../../../lib/trimbleApi";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

type Params = { params: Promise<{ id: string }> };

/**
 * The photo's content, streamed from Trimble Connect's storage with the caller's own token
 * (Trimble decides whether they may read it), so the 360° viewer does not depend on that
 * storage's CORS (the same way Realidad aumentada reads the IFC).
 */
export async function GET(req: NextRequest, { params }: Params) {
  const { id } = await params;
  return handle(req, async (ctx) => {
    const archivo = await archivoFoto(ctx, id);
    const baseUrl = await resolveProjectBaseUrl(ctx.accessToken, ctx.projectId);
    const url = await getDownloadUrl(baseUrl, ctx.accessToken, archivo.fileId, { versionId: archivo.versionId });
    const upstream = await fetch(url, { cache: "no-store" });
    if (!upstream.ok || !upstream.body) {
      console.error(`[inspeccion-360] el almacenamiento respondió ${upstream.status} para ${archivo.fileId}`);
      return NextResponse.json({ error: `Trimble Connect no entregó la foto (HTTP ${upstream.status}).`, code: "sin-contenido" }, { status: 502 });
    }
    const headers = new Headers({ "Content-Type": "image/jpeg", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" });
    const largo = upstream.headers.get("content-length");
    if (largo) headers.set("Content-Length", largo);
    return new Response(upstream.body, { headers });
  });
}
