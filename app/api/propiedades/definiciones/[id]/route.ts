import { NextRequest, NextResponse } from "next/server";
import { handle, readJson } from "../../../../../lib/propiedades/routes";
import { deleteDefinition, updateDefinition } from "../../../../../lib/propiedades/service";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/** Edits a definition: any of { title, dataType, group, sortOrder, active }. Administrators only. */
export async function PATCH(req: NextRequest, { params }: Params) {
  const { id } = await params;
  return handle(req, async ({ projectId, caller, store }) =>
    NextResponse.json(await updateDefinition(store, caller, projectId, id, await readJson(req)))
  );
}

/**
 * Deletes a definition that has no values yet. One with values answers 409
 * ("has-values"): it can only be deactivated (PATCH { active: false }).
 */
export async function DELETE(req: NextRequest, { params }: Params) {
  const { id } = await params;
  return handle(req, async ({ projectId, caller, store }) => {
    await deleteDefinition(store, caller, projectId, id);
    return NextResponse.json({ deleted: true });
  });
}
