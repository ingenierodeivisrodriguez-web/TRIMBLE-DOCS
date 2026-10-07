import { NextRequest, NextResponse } from "next/server";
import { handleLector, idParam } from "../../../../lib/manuales/routes";
import { listarCarpeta } from "../../../../lib/manuales/service";

export const dynamic = "force-dynamic";

/** The manuals folder (or `?folderId=` one of its subfolders): its files and folders, and the path to it. */
export async function GET(req: NextRequest) {
  return handleLector(req, async ({ tc, abierta }) => NextResponse.json(await listarCarpeta(tc, abierta, idParam(req, "folderId", false))));
}
