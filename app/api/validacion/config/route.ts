import { NextRequest, NextResponse } from "next/server";
import { parseConfig } from "../../../../lib/validacion/config";
import { loadConfig, saveConfig } from "../../../../lib/validacion/configStore";
import { authorize, errorResponse } from "../../../../lib/validacion/routeHelpers";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const auth = await authorize(req);
  if (auth instanceof NextResponse) return auth;

  try {
    return NextResponse.json(await loadConfig(auth.projectId));
  } catch (err) {
    return errorResponse(err);
  }
}

export async function PUT(req: NextRequest) {
  const auth = await authorize(req);
  if (auth instanceof NextResponse) return auth;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "El cuerpo de la solicitud no es JSON válido." }, { status: 400 });
  }

  const { config, errors } = parseConfig(body);
  if (errors.length > 0) {
    return NextResponse.json(
      { error: "La configuración no es válida.", details: errors },
      { status: 400 }
    );
  }

  try {
    const saved = await saveConfig(auth.projectId, config);
    return NextResponse.json({ config: saved, exists: true });
  } catch (err) {
    return errorResponse(err);
  }
}
