import type { Metadata } from "next";
import Link from "next/link";
import { NEGOCIO } from "../../lib/sitio/negocio";
import "./sitio.css";

export const metadata: Metadata = {
  title: { default: `${NEGOCIO.nombre}`, template: `%s · ${NEGOCIO.nombre}` },
  description:
    "Extensiones para Trimble Connect: Manuales, una biblioteca técnica con licencia por usuario de 1 a 12 meses, y otras herramientas BIM. Pagos con Mercado Pago y Wompi.",
};

/** The public website: header, the page, and the footer with the legal pages. */
export default function SitioLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="sitio">
      <header className="sitio-cabecera">
        <div className="sitio-contenedor">
          <Link href="/bim-apps" className="sitio-marca">
            <span className="sitio-logo" aria-hidden="true">
              BIM
            </span>
            <span>
              BIM Apps <small>para Trimble Connect</small>
            </span>
          </Link>
          <nav className="sitio-nav" aria-label="Secciones">
            <Link href="/bim-apps#manuales">Manuales</Link>
            <Link href="/bim-apps#planes">Planes</Link>
            <Link href="/bim-apps#como-comprar">Cómo comprar</Link>
            <Link href="/bim-apps#contacto">Contacto</Link>
          </nav>
        </div>
      </header>
      <main>{children}</main>
      <footer className="sitio-pie">
        <div className="sitio-contenedor">
          <div className="sitio-pie-enlaces">
            <Link href="/bim-apps/terminos">Términos y condiciones</Link>
            <Link href="/bim-apps/privacidad">Política de tratamiento de datos personales</Link>
            <Link href="/bim-apps#contacto">Contacto</Link>
          </div>
          <div>
            © {new Date().getFullYear()} {NEGOCIO.nombre} · {NEGOCIO.responsable} · {NEGOCIO.ciudad}
          </div>
          <div style={{ fontSize: 12.5, opacity: 0.85 }}>
            Trimble y Trimble Connect son marcas de Trimble Inc. {NEGOCIO.nombre} es un desarrollo independiente: no está afiliado a Trimble ni cuenta
            con su respaldo.
          </div>
        </div>
      </footer>
    </div>
  );
}
