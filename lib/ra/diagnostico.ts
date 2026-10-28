/**
 * Whether this phone can show the model in augmented reality (WebXR "immersive-ar"),
 * and what to tell the person when it cannot. Pure: the page gathers the facts.
 */

export type Navegador = "chrome" | "samsung" | "firefox" | "edge" | "safari" | "otro";

export interface Plataforma {
  esAndroid: boolean;
  esIOS: boolean;
  navegador: Navegador;
}

export interface Capacidades extends Plataforma {
  /** https (or localhost): WebXR and the camera refuse to start otherwise. */
  seguro: boolean;
  /** navigator.xr exists. */
  webxr: boolean;
  /** isSessionSupported("immersive-ar"); null while it is still being asked. */
  ra: boolean | null;
  /** The browser reads QR codes by itself (BarcodeDetector); otherwise a bundled reader is used later. */
  lectorQR: boolean;
}

export interface Veredicto {
  listo: boolean;
  /** Still waiting for the browser's answer. */
  revisando: boolean;
  titulo: string;
  detalle: string;
}

export function detectarPlataforma(userAgent: string, maxTouchPoints = 0): Plataforma {
  const ua = userAgent || "";
  const esAndroid = /Android/i.test(ua);
  // iPadOS reports itself as a Mac; the touch screen gives it away.
  const esIOS = /iPhone|iPad|iPod/i.test(ua) || (/Macintosh/i.test(ua) && maxTouchPoints > 1);
  let navegador: Navegador = "otro";
  if (/SamsungBrowser/i.test(ua)) navegador = "samsung";
  else if (/EdgA?\/|EdgiOS/i.test(ua)) navegador = "edge";
  else if (/Firefox|FxiOS/i.test(ua)) navegador = "firefox";
  else if (/Chrome|CriOS/i.test(ua)) navegador = "chrome";
  else if (/Safari/i.test(ua)) navegador = "safari";
  return { esAndroid, esIOS, navegador };
}

export function veredicto(c: Capacidades): Veredicto {
  const no = (titulo: string, detalle: string): Veredicto => ({ listo: false, revisando: false, titulo, detalle });
  if (c.esIOS) {
    return no(
      "Este iPhone o iPad todavía no sirve",
      "Por ahora la realidad aumentada funciona en celulares Android con Google Chrome. Safari no permite abrir el modelo a escala real desde una página web."
    );
  }
  // Desktop Chrome has WebXR too but no camera AR: tell the person to use the phone.
  if (!c.esAndroid) return no("Esta prueba es para el celular", "Ábrala desde un celular Android con Google Chrome.");
  if (!c.seguro) return no("La página no se abrió de forma segura", "Ábrala con la dirección que empieza por https://.");
  if (!c.webxr) {
    return no("Este navegador no tiene realidad aumentada", "Ábrala en Google Chrome (no en el navegador de Samsung, Firefox ni dentro de WhatsApp).");
  }
  if (c.ra === null) return { listo: false, revisando: true, titulo: "Revisando el celular…", detalle: "" };
  if (!c.ra) {
    return no(
      "Este celular no permite realidad aumentada",
      "Instale o actualice «Servicios de Google Play para RA» (ARCore) desde la Play Store y vuelva a abrir la página. Si no aparece, el celular no es compatible."
    );
  }
  return { listo: true, revisando: false, titulo: "Este celular sirve", detalle: "Puede iniciar la realidad aumentada." };
}
