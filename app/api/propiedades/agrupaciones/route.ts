import { NextRequest, NextResponse } from "next/server";
import { handle, readJson } from "../../../../lib/propiedades/routes";
import { createSavedGrouping, listSavedGroupings } from "../../../../lib/propiedades/service";

export const dynamic = "force-dynamic";

/** Saved "Seleccionar por agrupación" configurations of the project. */
export async function GET(req: NextRequest) {
  return handle(req, async ({ projectId, caller, store }) =>
    NextResponse.json({ groupings: await listSavedGroupings(store, caller, projectId) })
  );
}

/** Saves one: { name, fields: [{ key, label, group }], modelNames }. Any member of the project. */
export async function POST(req: NextRequest) {
  return handle(req, async ({ projectId, caller, store }) =>
    NextResponse.json(await createSavedGrouping(store, caller, projectId, await readJson(req)), { status: 201 })
  );
}
