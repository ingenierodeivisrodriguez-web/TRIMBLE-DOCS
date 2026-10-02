import { NextRequest, NextResponse } from "next/server";
import { handle, readJson } from "../../../../../lib/propiedades/routes";
import { queryValues } from "../../../../../lib/propiedades/service";

export const dynamic = "force-dynamic";

/** Values stored for one or several elements: { ifcGuids: [...] }. POST, since a selection can be long. */
export async function POST(req: NextRequest) {
  return handle(req, async ({ projectId, store }) =>
    NextResponse.json({ values: await queryValues(store, projectId, await readJson(req)) })
  );
}
