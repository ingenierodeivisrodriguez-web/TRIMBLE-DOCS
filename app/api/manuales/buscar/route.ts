import { NextRequest, NextResponse } from "next/server";
import { handleLector } from "../../../../lib/manuales/routes";
import { buscar } from "../../../../lib/manuales/service";

export const dynamic = "force-dynamic";

/** `?q=`: files and folders below the manuals folder whose name has every word. */
export async function GET(req: NextRequest) {
  return handleLector(req, async ({ tc, abierta }) => {
    const q = (req.nextUrl.searchParams.get("q") ?? "").trim().slice(0, 100);
    return NextResponse.json(await buscar(tc, abierta, q));
  });
}
