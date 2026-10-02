import { NextRequest, NextResponse } from "next/server";
import { handle, readJson } from "../../../../lib/propiedades/routes";
import { saveValues } from "../../../../lib/propiedades/service";

export const dynamic = "force-dynamic";

/**
 * Upserts values on several elements at once:
 * { elements: [{ ifcGuid, modelId }], changes: [{ attributeId, value }] }.
 * A null value clears that attribute on those elements. All or nothing.
 */
export async function PUT(req: NextRequest) {
  return handle(req, async ({ projectId, caller, store }) =>
    NextResponse.json(await saveValues(store, caller, projectId, await readJson(req)))
  );
}
