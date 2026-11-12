import { NextRequest, NextResponse } from "next/server";
import { correoPrueba } from "../../../../lib/flujo-aprobacion/correo";
import { handle } from "../../../../lib/flujo-aprobacion/routes";

export const dynamic = "force-dynamic";

/** «Enviar correo de prueba» (administrators): a sample e-mail to the caller's own address. */
export async function POST(req: NextRequest) {
  return handle(req, async ({ ctx }) => NextResponse.json(await correoPrueba(ctx)));
}
