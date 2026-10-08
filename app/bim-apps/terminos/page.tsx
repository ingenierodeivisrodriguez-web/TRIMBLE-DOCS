import type { Metadata } from "next";
import Link from "next/link";
import { NEGOCIO } from "../../../lib/sitio/negocio";

export const metadata: Metadata = { title: "Términos y condiciones" };

export default function Terminos() {
  const correo = <a href={`mailto:${NEGOCIO.correo}`}>{NEGOCIO.correo}</a>;
  return (
    <article className="sitio-legal">
      <h1>Términos y condiciones</h1>
      <p className="sitio-fecha">Última actualización: {NEGOCIO.actualizado}</p>

      <h2>1. Quién presta el servicio</h2>
      <p>
        {NEGOCIO.nombre} es un servicio de {NEGOCIO.responsable}, {NEGOCIO.tipo}, con domicilio en {NEGOCIO.ciudad}. Contacto: {correo} · WhatsApp{" "}
        <a href={NEGOCIO.whatsappLink} target="_blank" rel="noreferrer">
          {NEGOCIO.whatsapp}
        </a>
        .
      </p>

      <h2>2. Qué compras</h2>
      <p>
        Una <strong>licencia de uso personal, no exclusiva e intransferible</strong> para consultar, en solo lectura, la biblioteca de documentos de la
        extensión «Manuales» dentro de Trimble Connect, durante el número de meses del plan que elijas (de 1 a 12). La licencia queda asociada al
        correo de tu cuenta de Trimble Connect con la que haces la compra.
      </p>

      <h2>3. Requisitos</h2>
      <ul className="sitio-lista">
        <li>Una cuenta activa de Trimble Connect, que es un servicio de Trimble Inc. con sus propios términos.</li>
        <li>Tener la extensión «Manuales» instalada en al menos un proyecto al que tengas acceso.</li>
        <li>Conexión a internet y un navegador compatible con Trimble Connect.</li>
      </ul>

      <h2>4. Precios y pagos</h2>
      <p>
        Los precios se muestran en pesos colombianos (COP) antes de pagar. Los pagos se procesan en las plataformas de <strong>Mercado Pago</strong> o{" "}
        <strong>Wompi</strong>, según elijas, que aplican sus propios términos y medios de pago. No recibimos ni guardamos datos de tarjetas ni de
        cuentas bancarias.
      </p>

      <h2>5. Activación, vigencia y renovación</h2>
      <ul className="sitio-lista">
        <li>Tu acceso se activa automáticamente cuando la pasarela aprueba el pago. Los pagos pendientes (por ejemplo, en efectivo) se activan al acreditarse.</li>
        <li>La licencia vence al terminar su último día, en hora de Colombia. Dentro de la extensión ves la fecha de vencimiento.</li>
        <li>Si renuevas antes de que venza, los meses nuevos se suman a partir de tu fecha de vencimiento; si ya venció, empiezan el día del pago.</li>
        <li>No hay cobros automáticos: cada renovación es una compra nueva que haces tú.</li>
      </ul>

      <h2>6. Uso permitido</h2>
      <ul className="sitio-lista">
        <li>La licencia es para una sola persona: no compartas tu cuenta ni permitas que otros lean con ella.</li>
        <li>
          Los documentos de la biblioteca están protegidos por derechos de autor y pertenecen a sus titulares. No está permitido copiarlos,
          redistribuirlos, venderlos ni publicarlos, salvo autorización por escrito.
        </li>
        <li>Si detectamos un uso contrario a estos términos, podemos suspender el acceso mientras se aclara la situación.</li>
      </ul>

      <h2>7. Derecho de retracto y reembolsos</h2>
      <p>
        De acuerdo con el artículo 47 de la Ley 1480 de 2011 (Estatuto del Consumidor), puedes ejercer el derecho de retracto dentro de los cinco (5)
        días hábiles siguientes a la compra, salvo las excepciones de la ley, entre ellas los servicios cuya prestación ya comenzó con tu acuerdo: el
        acceso a la biblioteca se activa en cuanto se aprueba el pago. Para solicitar el retracto, un reembolso o reportar un cobro que no reconoces,
        escribe a {correo} indicando tu correo de Trimble Connect y el número del pago. Los reembolsos aprobados se hacen por el mismo medio de pago, a
        través de la pasarela.
      </p>

      <h2>8. Disponibilidad</h2>
      <p>
        El servicio funciona dentro de Trimble Connect y depende de su disponibilidad y de la de nuestros proveedores tecnológicos. Hacemos lo posible
        por mantenerlo disponible, pero puede haber interrupciones por mantenimiento o por causas ajenas a nosotros. Si el servicio no está disponible
        por causas atribuibles a nosotros durante un tiempo prolongado, escríbenos para compensar el tiempo de tu licencia.
      </p>

      <h2>9. Responsabilidad</h2>
      <p>
        Los documentos se ofrecen como material de consulta. Las decisiones técnicas que tomes con base en ellos son tu responsabilidad y la de los
        profesionales a cargo de cada proyecto. Nada de lo anterior limita los derechos que la ley colombiana te reconoce como consumidor.
      </p>

      <h2>10. Datos personales</h2>
      <p>
        Tratamos tus datos según nuestra <Link href="/bim-apps/privacidad">política de tratamiento de datos personales</Link>.
      </p>

      <h2>11. Cambios a estos términos</h2>
      <p>
        Podemos actualizar estos términos; la versión vigente es la publicada en esta página, con su fecha. Los cambios no afectan las licencias ya
        pagadas durante su vigencia.
      </p>

      <h2>12. Ley aplicable y quejas</h2>
      <p>
        Estos términos se rigen por la ley colombiana. Si tienes una queja, escríbenos a {correo}; también puedes acudir a la Superintendencia de
        Industria y Comercio.
      </p>
    </article>
  );
}
