/** An error the person can act on: its message is shown as is. */
export class PublicarError extends Error {
  constructor(
    message: string,
    public status = 400,
    public code?: string
  ) {
    super(message);
  }
}

/** Trimble Connect ids (projects, folders, files, versions, uploads). */
const ID_TRIMBLE = /^[A-Za-z0-9_.:-]{1,200}$/;

export function esIdTrimble(v: unknown): v is string {
  return typeof v === "string" && ID_TRIMBLE.test(v);
}
