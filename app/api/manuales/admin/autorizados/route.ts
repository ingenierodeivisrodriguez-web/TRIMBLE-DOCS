import { NextRequest, NextResponse } from "next/server";
import { agregar, quitar } from "../../../../../lib/manuales/acceso";
import { handleAdmin } from "../../../../../lib/manuales/routes";
import { ManualesError } from "../../../../../lib/manuales/service";

export const dynamic = "force-dynamic";

/** The people authorized to read the manuals. */
export async function GET(req: NextRequest) {
  return handleAdmin(req, async ({ store }) => NextResponse.json({ autorizados: await store.listarAutorizados() }));
}

/** `{ texto: "ana@x.com, Luis <luis@y.com>..." }`: authorizes those e-mails. */
export async function POST(req: NextRequest) {
  return handleAdmin(req, async ({ store, persona }) => {
    const body = (await req.json().catch(() => null)) as { texto?: unknown } | null;
    if (!body) throw new ManualesError("El cuerpo de la solicitud no es JSON válido.", 400, "parametro");
    return NextResponse.json(await agregar(store, body.texto, persona.email ? `${persona.nombre} (${persona.email})` : persona.nombre));
  });
}

/** `?email=`: removes the authorization. */
export async function DELETE(req: NextRequest) {
  return handleAdmin(req, async ({ store }) => {
    await quitar(store, req.nextUrl.searchParams.get("email"));
    return NextResponse.json({ ok: true });
  });
}
