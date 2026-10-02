import { NextRequest, NextResponse } from "next/server";
import { handle, readJson } from "../../../../lib/propiedades/routes";
import { createDefinition, getCatalog } from "../../../../lib/propiedades/service";

export const dynamic = "force-dynamic";

/** The project's attribute catalog (active and inactive), and whether the caller may edit it. */
export async function GET(req: NextRequest) {
  return handle(req, async ({ projectId, caller, store }) =>
    NextResponse.json(await getCatalog(store, caller, projectId))
  );
}

/** Creates an attribute definition: { title, dataType, group, sortOrder? }. Administrators only. */
export async function POST(req: NextRequest) {
  return handle(req, async ({ projectId, caller, store }) => {
    const definition = await createDefinition(store, caller, projectId, await readJson(req));
    return NextResponse.json(definition, { status: 201 });
  });
}
