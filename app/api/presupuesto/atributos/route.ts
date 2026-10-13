import { NextRequest, NextResponse } from "next/server";
import { handle } from "../../../../lib/presupuesto/routes";
import { getAtributos } from "../../../../lib/presupuesto/service";

export const dynamic = "force-dynamic";

/** Attributes of the Propiedades app that can be columns of the memoria de cantidades. */
export async function GET(req: NextRequest) {
  return handle(req, async (ctx) => NextResponse.json(await getAtributos(ctx)));
}
