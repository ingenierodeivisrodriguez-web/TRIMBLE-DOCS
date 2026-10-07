// Where the manuals live: one folder of one Trimble Connect project (the
// company's "MANAGER PROJECT"), the same for every project the app is
// installed in. Set once in Vercel as MANUALES_CARPETA, with the folder's
// link copied from Trimble Connect's address bar.

export interface ConfigManuales {
  projectId: string;
  /** null: the whole project (its root folder). */
  folderId: string | null;
}

const ID = "[A-Za-z0-9_-]{4,64}";

/**
 * "https://web.connect.trimble.com/projects/{projectId}/data/folder/{folderId}",
 * a project link, or "projectId/folderId" -> the project and folder.
 */
export function parseCarpeta(text: string): ConfigManuales | null {
  const t = text.trim();
  if (!t) return null;
  const project = new RegExp(`projects/(${ID})`).exec(t)?.[1];
  if (project) {
    const folder = new RegExp(`folders?/(${ID})`).exec(t)?.[1] ?? new RegExp(`[?&]folderId=(${ID})`).exec(t)?.[1];
    return { projectId: project, folderId: folder ?? null };
  }
  const m = new RegExp(`^(${ID})(?:[/:](${ID}))?$`).exec(t);
  return m ? { projectId: m[1], folderId: m[2] ?? null } : null;
}

/** The company's manuals folder in "MANAGER PROJECT" (MANUALES_CARPETA overrides it). */
export const CARPETA_PREDETERMINADA = "https://web.connect.trimble.com/projects/KU8qY2Zf234/data/folder/T3InEwS6b9g";

export function configManuales(): ConfigManuales | null {
  const env = process.env.MANUALES_CARPETA?.trim();
  return parseCarpeta(env || CARPETA_PREDETERMINADA);
}
