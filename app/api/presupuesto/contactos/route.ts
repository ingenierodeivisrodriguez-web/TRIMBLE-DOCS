import { NextRequest, NextResponse } from "next/server";
import { projectContacts } from "../../../../lib/propiedades/caller";
import { listContacts } from "../../../../lib/propiedades/service";
import { handle } from "../../../../lib/presupuesto/routes";

export const dynamic = "force-dynamic";

/** The project's people and groups, to choose the budget's editors (administrators only). */
export async function GET(req: NextRequest) {
  return handle(req, async ({ projectId, caller, accessToken }) =>
    NextResponse.json(await listContacts(caller, () => projectContacts(accessToken, projectId)))
  );
}
