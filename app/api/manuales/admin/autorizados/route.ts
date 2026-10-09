import { NextRequest, NextResponse } from "next/server";
import { actualizar, agregar, infoAutorizado, leerEmails, normalizarEmail, quitar } from "../../../../../lib/manuales/acceso";
import { leerPago, PagoLeido, registrarPagoManual } from "../../../../../lib/manuales/pagoManual";
import { handleAdmin, hoy, Persona } from "../../../../../lib/manuales/routes";
import { ManualesError } from "../../../../../lib/manuales/service";
import type { ManualesStore } from "../../../../../lib/manuales/store";

export const dynamic = "force-dynamic";

async function cuerpo(req: NextRequest): Promise<unknown> {
  const body = await req.json().catch(() => null);
  if (!body) throw new ManualesError("El cuerpo de la solicitud no es JSON válido.", 400, "parametro");
  return body;
}

function quien(persona: Persona): string {
  return persona.email ? `${persona.nombre} (${persona.email})` : persona.nombre;
}

/** The payment sent with the request, read before changing anything (so an invalid one changes nothing). */
function pagoDe(body: unknown, dia: string): PagoLeido | null {
  const pago = (body as { pago?: unknown }).pago;
  return pago === undefined || pago === null ? null : leerPago(pago, dia);
}

async function registrar(store: ManualesStore, emails: string[], pago: PagoLeido, por: string): Promise<number> {
  let n = 0;
  for (const email of emails) {
    const a = await store.getAutorizado(email);
    if (a) {
      await registrarPagoManual(store, a, pago, por);
      n++;
    }
  }
  return n;
}

/** The people authorized to read the manuals, with their license's status today. */
export async function GET(req: NextRequest) {
  return handleAdmin(req, async ({ store }) => {
    const dia = hoy();
    return NextResponse.json({ hoy: dia, autorizados: (await store.listarAutorizados()).map((a) => infoAutorizado(a, dia)) });
  });
}

/**
 * `{ texto: "ana@x.com, Luis <luis@y.com>...", licencia: { meses, inicio? } | { vence, inicio? } | { sinVencimiento: true }, pago? }`:
 * authorizes those e-mails with that license (12 months from today by
 * default) and, with `pago`, registers that payment (or courtesy) for each one.
 */
export async function POST(req: NextRequest) {
  return handleAdmin(req, async ({ store, persona }) => {
    const body = await cuerpo(req);
    const dia = hoy();
    const pago = pagoDe(body, dia);
    const r = await agregar(store, body, quien(persona), dia);
    const pagos = pago ? await registrar(store, leerEmails((body as { texto: string }).texto).emails.map((e) => e.email), pago, quien(persona)) : 0;
    return NextResponse.json({ ...r, pagos });
  });
}

/**
 * `{ email, licencia?, suspendido?, pago? }`: changes a person's license, or
 * suspends / reactivates them; with `pago`, registers a payment (or
 * courtesy) for their license as it ends up.
 */
export async function PATCH(req: NextRequest) {
  return handleAdmin(req, async ({ store, persona }) => {
    const body = (await cuerpo(req)) as { email?: unknown; licencia?: unknown; suspendido?: unknown };
    const dia = hoy();
    const pago = pagoDe(body, dia);
    if (body.licencia !== undefined || body.suspendido !== undefined || !pago) await actualizar(store, body, dia);
    if (pago) {
      const email = typeof body.email === "string" ? normalizarEmail(body.email) : null;
      if (!email || !(await registrar(store, [email], pago, quien(persona)))) throw new ManualesError("Ese correo no está autorizado.", 404, "no-existe");
    }
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
