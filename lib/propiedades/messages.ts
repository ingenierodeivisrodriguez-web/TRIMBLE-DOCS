// Messages between this app's two 3D viewer extensions (Propiedades, on the
// left, and Seleccionar por agrupación, on the right), sent with
// extension.broadcast and received as the "extension.broadcast" event.

/** Attribute values or the catalog changed: whoever shows them reads them again. */
export const VALUES_CHANGED = "propiedades:valores-cambiados";

/** Whether a broadcast payload (the message itself, or wrapped as { data }) is VALUES_CHANGED. */
export function isValuesChanged(payload: unknown): boolean {
  const unwrap = (p: unknown) => (p && typeof p === "object" && "data" in p ? (p as { data: unknown }).data : p);
  const message = unwrap(payload);
  return message === VALUES_CHANGED || (typeof message === "object" && message !== null && (message as { type?: unknown }).type === VALUES_CHANGED);
}
