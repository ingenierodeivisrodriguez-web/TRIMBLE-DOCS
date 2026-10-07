import { NextRequest, NextResponse } from "next/server";
import { handleLector, idParam } from "../../../../lib/manuales/routes";
import { archivo } from "../../../../lib/manuales/service";

export const dynamic = "force-dynamic";

/**
 * `?fileId=` (`&pdf=1` for a PDF rendition): a fresh link to the file's
 * content and the link to open it in Trimble Connect.
 */
export async function GET(req: NextRequest) {
  return handleLector(req, async ({ tc, abierta }) => {
    const fileId = idParam(req, "fileId", true)!;
    return NextResponse.json(await archivo(tc, abierta, fileId, req.nextUrl.searchParams.get("pdf") === "1"));
  });
}
