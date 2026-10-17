import { NextRequest, NextResponse } from "next/server";
import { handle, readJson } from "../../../../lib/compras/routes";
import { getProveedores, guardarProveedor } from "../../../../lib/compras/service";

export const dynamic = "force-dynamic";

/** The project's suppliers (and their quotations, for those who see quotations). */
export async function GET(req: NextRequest) {
  return handle(req, async (ctx) => NextResponse.json(await getProveedores(ctx)));
}

/** { id?, nit, tipoPersona, razonSocial, ..., version }: creates or changes a supplier. */
export async function PUT(req: NextRequest) {
  return handle(req, async (ctx) => NextResponse.json(await guardarProveedor(ctx, await readJson(req))));
}
