import { NextRequest, NextResponse } from "next/server";
import { handle } from "../../../../lib/inspeccion-360/routes";
import { projectContacts } from "../../../../lib/propiedades/caller";
import { ServiceError } from "../../../../lib/propiedades/service";

export const dynamic = "force-dynamic";

/** The project's people, to choose the editors (administrators only). */
export async function GET(req: NextRequest) {
  return handle(req, async ({ caller, projectId, accessToken }) => {
    if (!caller.isAdmin) throw new ServiceError("Solo los administradores del proyecto eligen los editores.", 403, "sin-permiso");
    const { users } = await projectContacts(accessToken, projectId);
    return NextResponse.json(users.filter((u) => !u.pending).map((u) => ({ id: u.id, nombre: u.name })));
  });
}
