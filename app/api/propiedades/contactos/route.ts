import { NextRequest, NextResponse } from "next/server";
import { projectContacts } from "../../../../lib/propiedades/caller";
import { handle } from "../../../../lib/propiedades/routes";
import { listContacts } from "../../../../lib/propiedades/service";

export const dynamic = "force-dynamic";

/** The project's people and groups (Trimble Connect's team), to choose an attribute's responsables. */
export async function GET(req: NextRequest) {
  return handle(req, async ({ projectId, caller, accessToken }) =>
    NextResponse.json(await listContacts(caller, () => projectContacts(accessToken, projectId)))
  );
}
