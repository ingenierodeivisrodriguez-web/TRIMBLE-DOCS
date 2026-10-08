import type { Metadata } from "next";
import Link from "next/link";
import { manualesStore } from "../../lib/manuales/store";
import { etiquetaMeses, pesos } from "../../lib/manuales/textos";
import type { Plan } from "../../lib/manuales/types";
import { MANIFIESTO_MANUALES, NEGOCIO } from "../../lib/sitio/negocio";

export const metadata: Metadata = { title: { absolute: `${NEGOCIO.nombre} · Manuales y herramientas BIM` } };

/** The plans on sale are read again every 5 minutes. */
export const revalidate = 300;

async function planes(): Promise<Plan[]> {
  try {
    const venta = await manualesStore().getVenta();
    return venta.habilitada ? venta.planes : [];
  } catch (err) {
    console.error("[sitio] planes:", err);
    return [];
  }
}

const FUNCIONES = [
  {
    titulo: "Lee sin descargar",
    texto: "PDF, Word, Excel, PowerPoint, planos DWG/DXF (en su versión PDF), imágenes y video se abren dentro de Trimble Connect.",
  },
  { titulo: "Busca en segundos", texto: "Encuentra cualquier manual por su nombre en todas las carpetas de la biblioteca." },
  {
    titulo: "Acceso con licencia",
    texto: "Cada persona entra con su cuenta de Trimble Connect y su licencia, sin necesidad de ser miembro del proyecto donde se guardan los documentos.",
  },
  { titulo: "Siempre la versión vigente", texto: "Cuando un documento se actualiza, todos leen la versión nueva al instante." },
  { titulo: "De 1 a 12 meses", texto: "Licencias por persona, renovables en línea: al renovar, los meses se suman a los que te quedan." },
  { titulo: "Pago en línea", texto: "Paga con Mercado Pago o Wompi y tu acceso se activa solo, apenas se aprueba el pago." },
];

const OTRAS = [
  { titulo: "Presupuesto", texto: "Presupuesto de obra con catálogos de insumos y partidas (APU) bajo OmniClass, asociado a los elementos del modelo 3D." },
  { titulo: "Propiedades", texto: "Atributos propios para los elementos de los modelos IFC, asignados desde el visor 3D." },
  { titulo: "Validación", texto: "Revisa la nomenclatura de los archivos del proyecto con reglas configurables." },
  { titulo: "Resumen de archivos y gráficos", texto: "Estadísticas de los documentos del proyecto y gráficos con los datos de los modelos." },
];

export default async function Inicio() {
  const lista = await planes();
  return (
    <>
      <section className="sitio-hero">
        <div className="sitio-contenedor">
          <h1>Herramientas BIM que trabajan dentro de Trimble Connect</h1>
          <p>
            Extensiones para consultar manuales técnicos, presupuestar y validar la información de tus proyectos sin salir de Trimble Connect.
            Desarrolladas en Colombia por {NEGOCIO.responsable}.
          </p>
          <div className="sitio-botones">
            <a className="sitio-boton primario" href="#planes">
              Ver planes de Manuales
            </a>
            <a className="sitio-boton secundario" href={NEGOCIO.whatsappLink} target="_blank" rel="noreferrer">
              Escríbenos por WhatsApp
            </a>
          </div>
        </div>
      </section>

      <section className="sitio-seccion" id="manuales">
        <div className="sitio-contenedor">
          <h2>Manuales: tu biblioteca técnica en Trimble Connect</h2>
          <p className="sitio-intro">
            Una biblioteca de manuales, procedimientos y documentos técnicos que se consulta en solo lectura desde cualquier proyecto de Trimble
            Connect donde esté instalada la extensión. Quien tenga licencia vigente la abre con su propia cuenta.
          </p>
          <div className="sitio-rejilla">
            {FUNCIONES.map((f) => (
              <div key={f.titulo} className="sitio-tarjeta">
                <h3>{f.titulo}</h3>
                <p>{f.texto}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="sitio-seccion gris" id="planes">
        <div className="sitio-contenedor">
          <h2>Planes</h2>
          <p className="sitio-intro">Licencia personal para una cuenta de Trimble Connect. Precios en pesos colombianos (COP).</p>
          {lista.length ? (
            <div className="sitio-rejilla">
              {lista.map((p) => (
                <div key={p.meses} className="sitio-tarjeta sitio-plan">
                  <h3>{etiquetaMeses(p.meses)}</h3>
                  <div className="sitio-precio">{pesos(p.precio)}</div>
                  <div className="sitio-mes">{p.meses > 1 ? `${pesos(Math.round(p.precio / p.meses))} al mes` : "Pago único por un mes"}</div>
                </div>
              ))}
            </div>
          ) : (
            <div className="sitio-tarjeta">
              <p>
                Escríbenos por{" "}
                <a href={NEGOCIO.whatsappLink} target="_blank" rel="noreferrer">
                  WhatsApp
                </a>{" "}
                o a <a href={`mailto:${NEGOCIO.correo}`}>{NEGOCIO.correo}</a> para conocer los planes y precios vigentes.
              </p>
            </div>
          )}
          <p style={{ marginTop: 18, fontSize: 15, color: "#56616e" }}>
            <strong>Medios de pago:</strong> Mercado Pago (tarjetas de crédito y débito, PSE, Efecty) y Wompi (Nequi, PSE, botón Bancolombia, tarjetas).
            Los pagos se hacen en las plataformas de Mercado Pago y Wompi: no recibimos ni guardamos datos de tarjetas ni de cuentas bancarias.
          </p>
        </div>
      </section>

      <section className="sitio-seccion" id="como-comprar">
        <div className="sitio-contenedor">
          <h2>Cómo comprar</h2>
          <p className="sitio-intro">La compra se hace dentro de Trimble Connect, con tu propia cuenta: la licencia queda a nombre de tu correo.</p>
          <ol className="sitio-pasos">
            <li>
              <strong>Instala Manuales</strong>
              El administrador de tu proyecto la agrega en Trimble Connect (configuración del proyecto → extensiones) con el manifiesto{" "}
              <code className="sitio-codigo">{MANIFIESTO_MANUALES}</code>.
            </li>
            <li>
              <strong>Ábrela con tu cuenta</strong>
              En el menú del proyecto, abre «Manuales» con tu usuario de Trimble Connect.
            </li>
            <li>
              <strong>Elige tu plan y paga</strong>
              Selecciona de 1 a 12 meses y paga con Mercado Pago o Wompi.
            </li>
            <li>
              <strong>Listo</strong>
              Al aprobarse el pago, tu acceso se activa solo. Para renovar, usa el botón «Renovar» dentro de Manuales.
            </li>
          </ol>
          <p style={{ marginTop: 18, fontSize: 15, color: "#56616e" }}>
            ¿Necesitas licencias para todo tu equipo o una biblioteca con los manuales de tu empresa? Escríbenos y armamos una propuesta.
          </p>
        </div>
      </section>

      <section className="sitio-seccion gris" id="otras">
        <div className="sitio-contenedor">
          <h2>Otras extensiones</h2>
          <p className="sitio-intro">También desarrollamos estas herramientas para Trimble Connect. Consúltanos por su disponibilidad para tu empresa.</p>
          <div className="sitio-rejilla">
            {OTRAS.map((f) => (
              <div key={f.titulo} className="sitio-tarjeta">
                <h3>{f.titulo}</h3>
                <p>{f.texto}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="sitio-seccion" id="contacto">
        <div className="sitio-contenedor">
          <h2>Contacto</h2>
          <p className="sitio-intro">Resolvemos tus dudas sobre las licencias, los pagos y la instalación.</p>
          <div className="sitio-contacto">
            <div className="sitio-tarjeta">
              <h3>{NEGOCIO.responsable}</h3>
              <p>
                {NEGOCIO.nombre}
                <br />
                {NEGOCIO.ciudad}
              </p>
            </div>
            <div className="sitio-tarjeta">
              <h3>WhatsApp</h3>
              <p>
                <a href={NEGOCIO.whatsappLink} target="_blank" rel="noreferrer">
                  {NEGOCIO.whatsapp}
                </a>
              </p>
            </div>
            <div className="sitio-tarjeta">
              <h3>Correo</h3>
              <p>
                <a href={`mailto:${NEGOCIO.correo}`}>{NEGOCIO.correo}</a>
              </p>
            </div>
          </div>
          <p style={{ marginTop: 18, fontSize: 14.5, color: "#56616e" }}>
            Al comprar aceptas los <Link href="/bim-apps/terminos">términos y condiciones</Link> y la{" "}
            <Link href="/bim-apps/privacidad">política de tratamiento de datos personales</Link>.
          </p>
        </div>
      </section>
    </>
  );
}
