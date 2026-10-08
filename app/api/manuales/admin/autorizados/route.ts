import { NextRequest, NextResponse } from "next/server";
import { actualizar, agregar, infoAutorizado, quitar } from "../../../../../lib/manuales/acceso";
import { handleAdmin, hoy } from "../../../../../lib/manuales/routes";
import { ManualesError } from "../../../../../lib/manuales/service";

export const dynamic = "force-dynamic";

async function cuerpo(req: NextRequest): Promise<unknown> {
  const body = await req.json().catch(() => null);
  if (!body) throw new ManualesError("El cuerpo de la solicitud no es JSON válido.", 400, "parametro");
  return body;
}

/** The people authorized to read the manuals, with their license's status today. */
export async function GET(req: NextRequest) {
  return handleAdmin(req, async ({ store }) => {
    const dia = hoy();
    return NextResponse.json({ hoy: dia, autorizados: (await store.listarAutorizados()).map((a) => infoAutorizado(a, dia)) });
  });
}

/**
 * `{ texto: "ana@x.com, Luis <luis@y.com>...", licencia: { meses, inicio? } | { vence, inicio? } | { sinVencimiento: true } }`:
 * authorizes those e-mails with that license (12 months from today by default).
 */
export async function POST(req: NextRequest) {
  return handleAdmin(req, async ({ store, persona }) =>
    NextResponse.json(await agregar(store, await cuerpo(req), persona.email ? `${persona.nombre} (${persona.email})` : persona.nombre, hoy()))
  );
}

/** `{ email, licencia?, suspendido? }`: changes a person's license, or suspends / reactivates them. */
export async function PATCH(req: NextRequest) {
  return handleAdmin(req, async ({ store }) => {
    await actualizar(store, await cuerpo(req), hoy());
    return NextResponse.json({ ok: true });
  });
}

/** `?email=`: removes the authorization. */
export async function DELETE(req: NextRequest) {
  return handleAdmin(req, async ({ store }) => {
    await quitar(store, req.nextUrl.searchParams.get("email"));
    return NextResponse.json({ ok: true });
  });
}
