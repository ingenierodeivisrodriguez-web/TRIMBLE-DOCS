// TEMPORARY (Inspección 360°, Fase 0). Pure helpers of the menu spikes. Remove when Fase 0 closes.

const CAMPOS_PROYECTO = ["location", "size", "filesCount", "foldersCount", "versionsCount", "usersCount", "access", "rootId"];
const CAMPOS_LICENCIA = [
  "type", "sku", "skuType", "name", "policyType", "maxProjects", "usedProjects", "maxStorage", "usedStorage",
  "maxUsers", "maxInvites", "usedInvites", "maxCollaborators",
];

/** What the API says about a project and its license, without names, e-mails or account ids. */
export function resumenProyecto(cuerpo: Record<string, unknown>): Record<string, unknown> {
  const salida: Record<string, unknown> = {};
  for (const k of CAMPOS_PROYECTO) if (k in cuerpo) salida[k] = cuerpo[k];
  const lic = cuerpo.license;
  if (lic && typeof lic === "object") {
    const l = lic as Record<string, unknown>;
    salida.licencia = Object.fromEntries(CAMPOS_LICENCIA.filter((k) => k in l).map((k) => [k, l[k]]));
  }
  return salida;
}

type V3 = { x: number; y: number; z: number };

/**
 * Body of a BCF viewpoint: the selected element by IFCGUID, the camera of the embedded viewer
 * (metres) and its snapshot (data URL from getSnapshot), each only when available.
 */
export function cuerpoPuntoDeVista(p: {
  version: string;
  guid: string;
  camara?: { position?: V3; lookAt?: V3; upDirection?: V3; fieldOfView?: number } | null;
  imagen?: string | null;
}): Record<string, unknown> {
  const cuerpo: Record<string, unknown> = {};
  if (p.guid) cuerpo.components = { selection: [{ ifc_guid: p.guid }], visibility: { default_visibility: true } };
  const c = p.camara;
  if (c?.position && c.lookAt) {
    const d = { x: c.lookAt.x - c.position.x, y: c.lookAt.y - c.position.y, z: c.lookAt.z - c.position.z };
    const largo = Math.hypot(d.x, d.y, d.z) || 1;
    cuerpo.perspective_camera = {
      camera_view_point: c.position,
      camera_direction: { x: d.x / largo, y: d.y / largo, z: d.z / largo },
      camera_up_vector: c.upDirection ?? { x: 0, y: 0, z: 1 },
      field_of_view: c.fieldOfView ?? 60,
      ...(p.version === "3.0" ? { aspect_ratio: 1.6 } : {}),
    };
  }
  const m = p.imagen ? /^data:image\/(png|jpe?g);base64,(.+)$/i.exec(p.imagen) : null;
  if (m) cuerpo.snapshot = { snapshot_type: m[1].toLowerCase() === "png" ? "png" : "jpg", snapshot_data: m[2] };
  return cuerpo;
}
