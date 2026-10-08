import type { Metadata } from "next";
import { NEGOCIO } from "../../../lib/sitio/negocio";

export const metadata: Metadata = { title: "Política de tratamiento de datos personales" };

export default function Privacidad() {
  const correo = <a href={`mailto:${NEGOCIO.correo}`}>{NEGOCIO.correo}</a>;
  return (
    <article className="sitio-legal">
      <h1>Política de tratamiento de datos personales</h1>
      <p className="sitio-fecha">Vigente desde: {NEGOCIO.actualizado}</p>
      <p>
        Esta política cumple la Ley 1581 de 2012 y el Decreto 1377 de 2013 (incorporado en el Decreto 1074 de 2015), y explica cómo tratamos los datos
        personales de quienes usan las extensiones de {NEGOCIO.nombre} y compran sus licencias.
      </p>

      <h2>1. Responsable del tratamiento</h2>
      <ul className="sitio-lista">
        <li>
          <strong>Responsable:</strong> {NEGOCIO.responsable}, {NEGOCIO.tipo} ({NEGOCIO.nombre}).
        </li>
        <li>
          <strong>Domicilio:</strong> {NEGOCIO.ciudad}.
        </li>
        <li>
          <strong>Correo:</strong> {correo}
        </li>
        <li>
          <strong>WhatsApp:</strong>{" "}
          <a href={NEGOCIO.whatsappLink} target="_blank" rel="noreferrer">
            {NEGOCIO.whatsapp}
          </a>
        </li>
      </ul>

      <h2>2. Qué datos tratamos</h2>
      <ul className="sitio-lista">
        <li>Nombre, correo e identificador de tu cuenta de Trimble Connect, que la plataforma nos entrega cuando abres la extensión.</li>
        <li>Datos de tu licencia: plan, fechas de inicio y vencimiento, y estado.</li>
        <li>Datos de tus compras: plan, valor, pasarela usada (Mercado Pago o Wompi), número y estado de la transacción.</li>
        <li>Lo que nos escribas al contactarnos.</li>
      </ul>
      <p>
        <strong>No recibimos ni guardamos datos de tarjetas ni de cuentas bancarias</strong>: los procesan Mercado Pago y Wompi, que son responsables
        de esos datos según sus propias políticas. No tratamos datos sensibles ni datos de menores de edad.
      </p>

      <h2>3. Para qué los usamos</h2>
      <ul className="sitio-lista">
        <li>Activar, renovar, suspender y administrar tu licencia, y darte acceso a la biblioteca.</li>
        <li>Verificar tus pagos con la pasarela y llevar el registro de las compras.</li>
        <li>Atender tus solicitudes de soporte, retracto, reembolso, consultas y reclamos.</li>
        <li>Enviarte avisos sobre tu licencia, por ejemplo sobre su vencimiento.</li>
        <li>Cumplir obligaciones legales, contables y tributarias.</li>
      </ul>
      <p>No vendemos ni cedemos tus datos a terceros para fines comerciales.</p>

      <h2>4. Con quién los compartimos</h2>
      <p>
        Solo con los proveedores que necesitamos para prestar el servicio, que los tratan por cuenta nuestra o como responsables de su parte: Trimble
        (plataforma Trimble Connect), Vercel (alojamiento de la aplicación), Supabase (base de datos), Mercado Pago y Wompi (pagos). Algunos de estos
        proveedores almacenan la información en servidores fuera de Colombia; al aceptar esta política autorizas esa transmisión o transferencia
        internacional, en la medida necesaria para prestar el servicio. También podemos entregar datos a autoridades que los soliciten conforme a la
        ley.
      </p>

      <h2>5. Tus derechos</h2>
      <p>Como titular de los datos tienes derecho a:</p>
      <ul className="sitio-lista">
        <li>Conocer, actualizar y rectificar tus datos personales.</li>
        <li>Solicitar prueba de la autorización que nos diste.</li>
        <li>Ser informado sobre el uso que les hemos dado.</li>
        <li>Presentar quejas ante la Superintendencia de Industria y Comercio por infracciones a la ley.</li>
        <li>Revocar la autorización o pedir la supresión de tus datos, cuando no exista un deber legal o contractual de conservarlos.</li>
        <li>Acceder gratuitamente a tus datos.</li>
      </ul>

      <h2>6. Cómo ejercer tus derechos</h2>
      <p>
        Escribe a {correo} con tu nombre, el correo de tu cuenta de Trimble Connect, tu solicitud y los documentos que quieras aportar.
      </p>
      <ul className="sitio-lista">
        <li>
          <strong>Consultas:</strong> las respondemos en máximo diez (10) días hábiles, prorrogables por cinco (5) días hábiles más, avisándote el
          motivo.
        </li>
        <li>
          <strong>Reclamos</strong> (corrección, actualización, supresión o incumplimiento): los atendemos en máximo quince (15) días hábiles,
          prorrogables por ocho (8) días hábiles más, avisándote el motivo. Si el reclamo está incompleto, te pediremos completarlo dentro de los cinco
          (5) días siguientes.
        </li>
      </ul>

      <h2>7. Autorización</h2>
      <p>
        Al abrir la extensión, comprar una licencia o escribirnos, autorizas el tratamiento de tus datos para las finalidades descritas en esta política.
      </p>

      <h2>8. Seguridad y conservación</h2>
      <p>
        Usamos conexiones cifradas, acceso restringido a la base de datos y credenciales cifradas para proteger la información. Conservamos los datos
        mientras tengas una licencia o una relación con nosotros, y después durante el tiempo que exijan las normas contables y tributarias.
      </p>

      <h2>9. Cambios a esta política</h2>
      <p>
        Si cambiamos esta política de forma sustancial, lo informaremos en esta página con la nueva fecha de vigencia antes de aplicar los cambios.
      </p>
    </article>
  );
}
