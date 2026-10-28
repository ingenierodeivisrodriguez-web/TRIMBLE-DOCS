import { NextRequest, NextResponse } from "next/server";
import { StoreError } from "../../../../../lib/propiedades/store";
import { publico } from "../../../../../lib/ra/service";
import { raStore } from "../../../../../lib/ra/store";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ codigo: string }> };

/**
 * For the phone that scanned a QR: no login (owner's decision). The code is
 * the key; without a valid one nothing about the project is returned.
 */
export async function GET(_req: NextRequest, { params }: Params) {
  const { codigo } = await params;
  try {
    return NextResponse.json(await publico(raStore(), codigo), { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    console.error("[ra] consulta pública del QR:", err);
    const status = err instanceof StoreError ? err.status : 500;
    return NextResponse.json({ error: "No se pudo consultar el QR. Intente de nuevo en un momento." }, { status });
  }
}
