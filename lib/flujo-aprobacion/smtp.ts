/**
 * Sending the extension's e-mails through Gmail (11-11-2026): the account and
 * its app password live only in Vercel's variables (never in the code):
 *   FLUJO_CORREO_USUARIO  the Gmail address that sends
 *   FLUJO_CORREO_CLAVE    its 16-letter app password (spaces are ignored)
 *   FLUJO_CORREO_NOMBRE   the sender name people see (optional)
 *   FLUJO_EXTENSION_ID    another extension id for the links (optional)
 * Without the first two nothing is sent and nothing is noted.
 */
import { createTransport } from "nodemailer";
import type { Correo } from "./correo";

export const NOMBRE_REMITENTE = "Flujo de aprobación";

/** This app's public address, for the e-mails' links (`FLUJO_URL_PUBLICA`, else the one asked). */
export function urlPublica(pedida: string | null, env: Record<string, string | undefined> = process.env): string {
  return (env.FLUJO_URL_PUBLICA?.trim() || pedida || "https://trimble-docs.vercel.app").replace(/\/+$/, "");
}

export function correoDesdeEntorno(env: Record<string, string | undefined> = process.env): Correo | undefined {
  const usuario = env.FLUJO_CORREO_USUARIO?.trim();
  const clave = env.FLUJO_CORREO_CLAVE?.replace(/\s+/g, "");
  if (!usuario || !clave) return undefined;
  const nombre = env.FLUJO_CORREO_NOMBRE?.trim() || NOMBRE_REMITENTE;
  let transporte: ReturnType<typeof createTransport> | null = null;
  return {
    desde: usuario,
    idExtension: env.FLUJO_EXTENSION_ID?.trim() || undefined,
    async enviar(m) {
      transporte ??= createTransport({
        host: "smtp.gmail.com",
        port: 465,
        secure: true,
        auth: { user: usuario, pass: clave },
        connectionTimeout: 15_000,
        greetingTimeout: 10_000,
        socketTimeout: 20_000,
      });
      await transporte.sendMail({
        from: { name: nombre, address: usuario },
        to: { name: m.para.nombre, address: m.para.correo },
        ...(m.copia?.length ? { cc: m.copia } : {}),
        subject: m.asunto,
        text: m.texto,
        html: m.html,
      });
    },
  };
}
