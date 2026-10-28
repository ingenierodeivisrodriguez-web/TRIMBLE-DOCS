import type { Metadata } from "next";
import type { CSSProperties, ReactNode } from "react";

export const metadata: Metadata = {
  title: "Guía de Realidad aumentada",
  description: "Cómo preparar un modelo BIM, crear el QR y verlo a escala real en la obra desde el celular.",
};

const AZUL = "#2f55b0";

/** Public how-to of the AR extension: office side, site side, problems and the site test. Readable on a phone and printable. */
export default function Page() {
  return (
    <main style={{ maxWidth: 760, margin: "0 auto", padding: "18px 16px 40px", fontFamily: "system-ui, sans-serif", color: "#1f2937", lineHeight: 1.55, fontSize: 15.5 }}>
      <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: 0.5, color: AZUL }}>REALIDAD AUMENTADA · GUÍA DE USO</div>
      <h1 style={{ fontSize: 26, margin: "4px 0 6px" }}>El modelo BIM a escala real en la obra</h1>
      <p style={{ marginTop: 0, color: "#4b5563" }}>
        Se pega en un muro una hoja con un QR. Al escanearla con el celular, el modelo aparece a escala 1:1, fijo en ese punto, y se puede caminar dentro de él
        con cortes, transparencia y colores para tomar decisiones en sitio.
      </p>
      <nav style={{ ...caja, background: "#f5f7fb" }}>
        <b>Contenido:</b> <a href="#antes">1. Antes de empezar</a> · <a href="#oficina">2. En la oficina</a> · <a href="#obra">3. En la obra</a> ·{" "}
        <a href="#herramientas">4. Herramientas</a> · <a href="#problemas">5. Problemas frecuentes</a> · <a href="#prueba">6. Prueba en obra</a>
      </nav>

      <Seccion id="antes" titulo="1. Antes de empezar (una sola vez)">
        <ol>
          <li>
            Un administrador del proyecto instala la extensión en Trimble Connect: <i>Configuración del proyecto → Apps &amp; Capabilities → Add Custom</i> con{" "}
            <code>https://trimble-docs.vercel.app/manifest-ra.json</code>. Si en el visor 3D no aparece el panel, instale también{" "}
            <code>https://trimble-docs.vercel.app/manifest-ra-visor.json</code>.
          </li>
          <li>
            El celular de obra debe ser <b>Android con Google Chrome</b> y tener <b>«Servicios de Google Play para RA» (ARCore)</b>. Ábralo en{" "}
            <a href="/ra-prueba">trimble-docs.vercel.app/ra-prueba</a>: revisa el celular y deja poner un volumen de prueba de 2 × 2 × 3 m. Los iPhone todavía no sirven.
          </li>
        </ol>
      </Seccion>

      <Seccion id="oficina" titulo="2. En la oficina (Trimble Connect)">
        <h3 style={sub}>Preparar el modelo</h3>
        <ol>
          <li>Abra en el visor 3D los modelos IFC que quiere llevar a la obra (pueden ser varios, por ejemplo arquitectura y estructura).</li>
          <li>
            En el panel de extensiones abra <b>Realidad aumentada</b>, pestaña <b>Preparar</b>. Marque los modelos, póngales un nombre y pulse <b>Leer modelos</b>.
          </li>
          <li>
            Quite los <b>niveles</b> y <b>clases</b> que no hacen falta en obra (mobiliario, instalaciones que no se van a revisar…). Cuantos menos triángulos, más
            fluido en el celular: sobre 1 millón avisa, sobre 3 millones no deja enviar.
          </li>
          <li>
            Pulse <b>Ver vista previa</b>, revise y pulse <b>Guardar para el celular</b>.
          </li>
        </ol>
        <h3 style={sub}>Crear el QR</h3>
        <ol>
          <li>
            En la pestaña <b>Punto QR</b> elija el modelo preparado y pulse <b>Elegir el punto en el visor</b>.
          </li>
          <li>
            Haga <b>un clic sobre la cara del muro o columna</b> donde irá la hoja, a la altura de los ojos (unos 1.40 m). Elija un muro que ya esté construido y
            que se vea desde donde se va a trabajar.
          </li>
          <li>
            Escriba el nombre del punto, <b>dónde se pega la hoja</b> (por ejemplo «muro del eje 3 entre B y C, cara hacia el patio») y hasta qué día abre (máximo
            un año).
          </li>
          <li>
            Pulse <b>Crear QR</b> y <b>Descargar hoja para imprimir (PDF)</b>. Imprímala en tamaño carta, al 100 % (sin «ajustar a la página»).
          </li>
        </ol>
        <p style={nota}>
          <b>Importante:</b> quien tenga el QR ve el modelo sin iniciar sesión hasta la fecha elegida. Si una hoja se pierde o ya no se necesita, anúlela en el
          menú del proyecto (<b>Realidad aumentada → Puntos QR → Anular</b>). Un modelo que nadie abre en 30 días (o los días que fije el administrador) se
          elimina solo y sus QR dejan de abrir; se puede preparar de nuevo.
        </p>
      </Seccion>

      <Seccion id="obra" titulo="3. En la obra">
        <h3 style={sub}>Pegar la hoja</h3>
        <ol>
          <li>
            Con las coordenadas impresas en la hoja (X, Y y la altura Z), topografía marca el punto en el muro indicado. Sin la marca exacta, el modelo queda
            corrido lo mismo que esté corrida la hoja.
          </li>
          <li>
            Pegue la hoja <b>plana y derecha</b> («ESTE LADO ARRIBA»), con la cruz naranja exactamente sobre la marca, fija por las cuatro esquinas. No la mueva
            después.
          </li>
        </ol>
        <h3 style={sub}>Ver el modelo</h3>
        <ol>
          <li>
            Escanee el QR con la cámara del celular o con el botón <a href="/ra/escanear">Escanear QR</a>.
          </li>
          <li>
            Pulse <b>Descargar el modelo</b> (con buena señal o wifi) y luego <b>Ver en realidad aumentada</b>; acepte el permiso de la cámara.
          </li>
          <li>
            Párese a 1 o 2 metros de la hoja y mueva el celular despacio frente al muro hasta que aparezca el <b>círculo amarillo</b>. Póngalo sobre la{" "}
            <b>cruz</b> y toque la pantalla.
          </li>
          <li>
            El modelo queda fijo. Camine con calma. Si lo ve corrido, vuelva frente a la hoja y toque <b>Recalibrar</b>.
          </li>
        </ol>
      </Seccion>

      <Seccion id="herramientas" titulo="4. Herramientas (abajo de la cámara)">
        <ul>
          <li>
            <b>Corte horizontal</b>: corta a una cota Z (como una planta); empieza a la altura de la hoja. «Ver lo de arriba» invierte.
          </li>
          <li>
            <b>Corte vertical</b>: por el eje X o Y del modelo, con deslizador; «Ver el otro lado» invierte. Se pueden usar los dos cortes a la vez.
          </li>
          <li>
            <b>Transparencia</b>: de 0 a 90 %, para ver lo real a través del modelo.
          </li>
          <li>
            <b>Colorear</b>: encienda «Colorear el elemento que toque», elija un color y toque los elementos. Sirve para marcar en la reunión de obra. Los
            colores <b>no se guardan</b>: se pierden al salir.
          </li>
          <li>
            <b>Tocar un elemento</b> muestra su nombre, clase y nivel.
          </li>
        </ul>
      </Seccion>

      <Seccion id="problemas" titulo="5. Problemas frecuentes">
        <dl>
          <Pregunta p="No aparece el círculo amarillo.">
            Acérquese a 1 o 2 m, que haya buena luz y mueva el celular despacio de lado a lado. En muros lisos y blancos cuesta más: la hoja impresa ayuda. Si
            apunta al piso, avisa «Eso no es un muro».
          </Pregunta>
          <Pregunta p="El modelo quedó corrido o girado.">
            Revise que la hoja esté sobre la marca de topografía y derecha. Toque <b>Recalibrar</b> frente a la hoja y ponga el círculo justo en el centro de la
            cruz. Después de caminar mucho el celular puede correr el modelo unos centímetros; vuelva a la hoja y recalibre.
          </Pregunta>
          <Pregunta p="El celular va lento o se calienta.">
            Prepare el modelo de nuevo con menos niveles o clases (por ejemplo, solo el piso donde se trabaja).
          </Pregunta>
          <Pregunta p="El QR dice que venció, que fue anulado o que el modelo ya no está.">
            Pida en la oficina un QR nuevo (y, si el modelo se eliminó por falta de uso, que lo preparen otra vez).
          </Pregunta>
          <Pregunta p="Tengo un iPhone.">Por ahora solo funciona en Android con Google Chrome.</Pregunta>
          <Pregunta p="El modelo se ve delante de una persona o de un muro real.">
            Es normal: el modelo siempre se dibuja por encima de lo que ve la cámara. Use la transparencia o los cortes.
          </Pregunta>
        </dl>
      </Seccion>

      <Seccion id="prueba" titulo="6. Prueba en obra (para validar la herramienta)">
        <p style={{ marginTop: 0 }}>
          Haga esta prueba una vez, con un modelo de una parte ya construida, y anote los resultados. Con ellos se decide para qué tareas sirve la precisión.
        </p>
        <ol>
          <li>Prepare el modelo, cree el QR en un muro construido, pida a topografía la marca y pegue la hoja.</li>
          <li>Ubique el modelo y anote cuánto tardó en aparecer el círculo y en quedar ubicado.</li>
          <li>
            Elija <b>3 puntos de control</b> construidos y fáciles de ver (una esquina de columna, un borde de losa, el marco de un vano) a distintas distancias
            de la hoja. Para cada uno mida con flexómetro cuánto se separa el modelo de lo real.
          </li>
          <li>Camine unos 10 m, vuelva frente a la hoja y mida cuánto se corrió la cruz del modelo respecto a la hoja.</li>
          <li>Pruebe cada herramienta (cortes, transparencia, colorear) y anote lo que no sea claro.</li>
        </ol>
        <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 14 }}>
          <tbody>
            {[
              "Celular (marca y modelo)",
              "Luz (sol, sombra, interior)",
              "Tiempo hasta ubicar el modelo",
              "Punto de control 1: distancia a la hoja / diferencia medida",
              "Punto de control 2: distancia a la hoja / diferencia medida",
              "Punto de control 3: distancia a la hoja / diferencia medida",
              "Corrimiento de la cruz después de caminar 10 m",
              "¿Fue fluido? ¿Se calentó?",
              "Observaciones",
            ].map((f) => (
              <tr key={f}>
                <td style={{ border: "1px solid #cbd2da", padding: "8px 10px", width: "55%" }}>{f}</td>
                <td style={{ border: "1px solid #cbd2da", padding: "8px 10px" }} />
              </tr>
            ))}
          </tbody>
        </table>
      </Seccion>
    </main>
  );
}

function Seccion({ id, titulo, children }: { id: string; titulo: string; children: ReactNode }) {
  return (
    <section id={id} style={{ marginTop: 22 }}>
      <h2 style={{ fontSize: 20, margin: "0 0 6px", color: AZUL, borderBottom: "2px solid #dfe4ea", paddingBottom: 4 }}>{titulo}</h2>
      {children}
    </section>
  );
}

function Pregunta({ p, children }: { p: string; children: ReactNode }) {
  return (
    <>
      <dt style={{ fontWeight: 700, marginTop: 10 }}>{p}</dt>
      <dd style={{ margin: "2px 0 0 0" }}>{children}</dd>
    </>
  );
}

const caja: CSSProperties = { border: "1px solid #dfe4ea", borderRadius: 8, padding: 12, margin: "12px 0" };
const sub: CSSProperties = { fontSize: 16.5, margin: "12px 0 4px" };
const nota: CSSProperties = { background: "#fff8db", border: "1px solid #d4b106", borderRadius: 8, padding: "10px 12px" };
