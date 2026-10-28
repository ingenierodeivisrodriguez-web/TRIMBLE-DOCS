/** How big a model the phone can take, and the upload limit (the bucket's). */

export const TRIANGULOS_AVISO = 1_000_000;
export const TRIANGULOS_MAX = 3_000_000;
export const BYTES_MAX = 50 * 1024 * 1024;
/** IFC files above this may take long or not fit in the browser's memory. */
export const IFC_AVISO_BYTES = 150 * 1024 * 1024;

export interface Revision {
  puede: boolean;
  aviso: string | null;
}

const miles = (n: number) => n.toLocaleString("en-US");

export function tamanoLegible(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Whether a prepared model can be sent to the phone (`bytes` already compressed). */
export function revisarTamano(triangulos: number, bytes: number | null): Revision {
  if (triangulos <= 0) return { puede: false, aviso: "Con lo que quedó elegido no hay ningún elemento con geometría." };
  if (triangulos > TRIANGULOS_MAX) {
    return { puede: false, aviso: `Son ${miles(triangulos)} triángulos y el celular aguanta hasta ${miles(TRIANGULOS_MAX)}. Quite niveles o clases (por ejemplo, instalaciones o mobiliario).` };
  }
  if (bytes !== null && bytes > BYTES_MAX) {
    return { puede: false, aviso: `El archivo para el celular pesa ${tamanoLegible(bytes)} y el máximo es ${tamanoLegible(BYTES_MAX)}. Quite niveles o clases.` };
  }
  if (triangulos > TRIANGULOS_AVISO) {
    return { puede: true, aviso: `Son ${miles(triangulos)} triángulos: en celulares de gama media puede ir lento. Si es así, prepárelo de nuevo con menos niveles o clases.` };
  }
  return { puede: true, aviso: null };
}
