import { NextRequest, NextResponse } from "next/server";
import { StoreError } from "../../../../../../lib/propiedades/store";
import { abrirModelo } from "../../../../../../lib/ra/service";
import { raStore } from "../../../../../../lib/ra/store";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ codigo: string }> };

/**
 * For the phone, no login: the model of an active wall QR (short-lived link
 * to its file, point and wall direction). Opening it renews the model's term.
 */
export async function GET(_req: NextRequest, { params }: Params) {
  const { codigo } = await params;
  try {
    return NextResponse.json(await abrirModelo(raStore(), codigo), { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    console.error("[ra] abrir el modelo del QR:", err);
    const status = err instanceof StoreError ? err.status : 500;
    return NextResponse.json({ error: "No se pudo abrir el modelo. Intente de nuevo en un momento." }, { status });
  }
}
