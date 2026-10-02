import { NextRequest, NextResponse } from "next/server";
import { handle } from "../../../../../lib/propiedades/routes";
import { deleteSavedGrouping } from "../../../../../lib/propiedades/service";

export const dynamic = "force-dynamic";

/** Deletes a saved configuration: whoever saved it, or a project administrator. */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handle(req, async ({ projectId, caller, store }) => {
    await deleteSavedGrouping(store, caller, projectId, id);
    return NextResponse.json({ ok: true });
  });
}
