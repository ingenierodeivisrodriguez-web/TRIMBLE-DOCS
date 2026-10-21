import { NextRequest, NextResponse } from "next/server";
import { handle, readJson } from "../../../../lib/loin/routes";
import { cambiarPlantilla, crearPlantilla, listPlantillas } from "../../../../lib/loin/service";

export const dynamic = "force-dynamic";

/** The discipline templates of the catalog's base project. */
export async function GET(req: NextRequest) {
  return handle(req, async (ctx) => NextResponse.json(await listPlantillas(ctx)));
}

/** { disciplinaId, nombre, descripcion }: saves a discipline of this project as a template. */
export async function POST(req: NextRequest) {
  return handle(req, async (ctx) => NextResponse.json(await crearPlantilla(ctx, await readJson(req))));
}

/** { id, version, nombre?, descripcion?, activo? }: renames or deactivates a template. */
export async function PUT(req: NextRequest) {
  return handle(req, async (ctx) => NextResponse.json(await cambiarPlantilla(ctx, await readJson(req))));
}
