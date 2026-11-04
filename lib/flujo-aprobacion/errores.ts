export { esIdTrimble } from "../publicar/errores";

/** An error the person can act on: its message is shown as is. */
export class FlujoError extends Error {
  constructor(
    message: string,
    public status = 400,
    public code?: string
  ) {
    super(message);
  }
}
