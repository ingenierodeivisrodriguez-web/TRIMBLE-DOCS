// The model tree of the 3D viewer: building, levels, assemblies... In Trimble
// Connect, hiding a parent object hides everything under it, and showing a
// child doesn't bring it back while its parent is hidden. So tools that hide
// and show elements must leave those containers alone.
import type { ViewerAPI } from "trimble-connect-workspace-api";
import type { Members } from "../graficos/modelData";

type ParentsViewer = Pick<ViewerAPI, "getHierarchyParents">;
type HierarchyKind = Parameters<ViewerAPI["getHierarchyParents"]>[2];

/**
 * The trees asked about: the viewer's default, spatial structure (site,
 * building, levels), spatial containment, containment and element assemblies
 * (e.g. a curtain wall and its panels). Values of the API's HierarchyType.
 */
const KINDS: (HierarchyKind | undefined)[] = [undefined, 1, 2, 3, 4] as (HierarchyKind | undefined)[];
const CHUNK = 2000;

/**
 * Every ancestor (in any of those trees) of the given objects, per model
 * (dataset key). `viewerModelIds` maps each key to the model id the viewer
 * answers with. A tree the model doesn't have, or a failing call, adds nothing.
 */
export async function ancestorsOf(
  viewer: ParentsViewer,
  members: Members,
  viewerModelIds: Record<string, string>
): Promise<Map<string, Set<number>>> {
  const out = new Map<string, Set<number>>();
  for (const [key, ids] of Object.entries(members)) {
    const modelId = viewerModelIds[key];
    if (!modelId || ids.length === 0) continue;
    const found = new Set<number>();
    for (const kind of KINDS) {
      for (let i = 0; i < ids.length; i += CHUNK) {
        try {
          const parents = await viewer.getHierarchyParents(modelId, ids.slice(i, i + CHUNK), kind, true);
          for (const p of parents ?? []) if (typeof p?.id === "number") found.add(p.id);
        } catch {
          // this tree isn't available for the model
        }
      }
    }
    out.set(key, found);
  }
  return out;
}

/** `members` without the protected objects (e.g. containers that must not be hidden). */
export function withoutProtected(members: Members, protectedIds: Map<string, Set<number>>): Members {
  const out: Members = {};
  for (const [key, ids] of Object.entries(members)) {
    const skip = protectedIds.get(key);
    const kept = skip ? ids.filter((id) => !skip.has(id)) : ids;
    if (kept.length) out[key] = kept;
  }
  return out;
}
