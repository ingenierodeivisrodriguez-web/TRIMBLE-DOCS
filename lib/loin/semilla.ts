// Seed data: the DYCO parameter list (sheet "1. Lista de parámetros DYCO" of
// Lista_de_parametros_dyco.xlsx, 89 parameters), the TDI group names, and a
// starter set of disciplines and elements. The owner approved the spelling
// fixes (Decripcion → Descripción, permehabilidad, contructor, famila,
// deriba, grnade, compañia, DEMOLISION → DEMOLICION and accents in the
// names); each parameter keeps an alias with its original DYCO name, so
// models whose parameters carry the old spelling still match.
import { CATEGORY_COLORS, OTHER_COLOR } from "../graficos/colors";
import { normalizarNombre } from "./alias";
import { Alias, GrupoTdi, Ndi, NivelNdi, OrigenDato, ParametroData, REGLA_VACIA, TipoDato } from "./types";

export const TDI_INICIALES: GrupoTdi[] = [
  { codigo: "A", nombre: "Proyecto / administrativo" },
  { codigo: "B", nombre: "Dimensiones y cantidades" },
  { codigo: "C", nombre: "Ubicación y espacios" },
  { codigo: "D", nombre: "Identificación y materiales" },
  { codigo: "E", nombre: "Producto y fabricante" },
  { codigo: "J", nombre: "Sistemas (MEP)" },
  { codigo: "K", nombre: "Requisitos técnicos, seguridad y ocupación" },
  { codigo: "L", nombre: "Programación (4D)" },
];

/** The three levels the DYCO list uses; it gives them no names. */
export const NDI_INICIALES: NivelNdi[] = [
  { numero: 1, nombre: "" },
  { numero: 2, nombre: "" },
  { numero: 3, nombre: "" },
];

/** "A ingresar" / "Automática" / "" as the DYCO list writes them. */
const ORIGEN: Record<string, OrigenDato> = { i: "a_ingresar", a: "automatica", "": "por_definir" };

interface Fila {
  n: number;
  tdi: string;
  ndi: Ndi;
  dato: "i" | "a" | "";
  /** Name with the approved fixes. */
  nombre: string;
  /** Name as the DYCO list writes it, when it differs. */
  original?: string;
  descripcion: string;
  tipo?: TipoDato;
  unidad?: string;
  valores?: string[];
  patron?: string;
  /** IFC equivalences proposed by the app (they stay "sugerida" until someone confirms them). */
  ifc?: string[];
}

// Four rows have no N° in the DYCO list: they got 86 to 89.
const FILAS: Fila[] = [
  { n: 1, tdi: "A", ndi: 1, dato: "i", nombre: "Código de proyecto", original: "Codigo de proyecto", descripcion: "Se refiere al código del proyecto" },
  { n: 2, tdi: "A", ndi: 1, dato: "", nombre: "Constructor responsable", descripcion: "Nombre del constructor que aparece en la licencia." },
  { n: 3, tdi: "A", ndi: 1, dato: "i", nombre: "Descripción del Proyecto", original: "Descripcion del Proyecto", descripcion: "Se refiere al campo para explicar de forma detallada el alcance y características principales del proyecto" },
  { n: 4, tdi: "A", ndi: 1, dato: "i", nombre: "Dirección del proyecto", original: "Direccion del proyecto", descripcion: "Se refiere a la dirección de la edificación" },
  { n: 5, tdi: "A", ndi: 1, dato: "i", nombre: "Disciplina BIM", descripcion: "Disciplina que corresponde al diseño en curso" },
  { n: 6, tdi: "A", ndi: 1, dato: "i", nombre: "Diseñador(a) Técnico(a)", original: "Diseñador(a) Tecnico(a)", descripcion: "Nombre del profesional que responde y avala el diseño" },
  {
    n: 7, tdi: "A", ndi: 1, dato: "i", nombre: "Función de la edificación o infraestructura", original: "Funcion de la edificacion o infraestructura",
    descripcion: "Se refiere al tipo de destino de la edificación o infraestructura: RESIDENCIAL, ACTIVIDADES PRODUCTIVAS, EQUIPAMIENTO, INFRAESTRUCTURA, ESPACIO PÚBLICO, ÁREA VERDE.",
    tipo: "lista", valores: ["RESIDENCIAL", "ACTIVIDADES PRODUCTIVAS", "EQUIPAMIENTO", "INFRAESTRUCTURA", "ESPACIO PÚBLICO", "ÁREA VERDE"],
  },
  { n: 8, tdi: "A", ndi: 1, dato: "i", nombre: "Mat. Profesional diseñadora técnico(a)", original: "Mat. Profesional diseñadora tecnico(a)", descripcion: "Numero de identificacion profesional" },
  { n: 9, tdi: "A", ndi: 1, dato: "i", nombre: "Nombre de empresa contratista", descripcion: "Nombre de la compañía adjudicada" },
  { n: 10, tdi: "A", ndi: 1, dato: "i", nombre: "Nombre de la organización", original: "Nombre de la organizacion", descripcion: "Nombre del contratante y /o propietario del proyecto" },
  { n: 11, tdi: "A", ndi: 1, dato: "i", nombre: "Nombre de Proyecto", descripcion: "Se refiere al nombre del proyecto para el cual se genera el modelo BIM" },
  { n: 12, tdi: "A", ndi: 1, dato: "i", nombre: "Nombre del edificio (unidad estructural)", descripcion: "Se refiere al nombre de la unidad estructural del proyecto Ejemplo: Torre 1, torre 2, porteria. Etc." },
  { n: 13, tdi: "A", ndi: 1, dato: "i", nombre: "Número de Teléfono", original: "Numero de Telefono", descripcion: "número telefónico del diseñador(a) tecnico(a)" },
  { n: 14, tdi: "A", ndi: 1, dato: "i", nombre: "Número de título del terreno", original: "Numero de titulo del terreno", descripcion: "Se refiere al número de matricula de la propiedad. Por ejemplo, ROL-1000-05." },
  { n: 15, tdi: "B", ndi: 1, dato: "a", nombre: "Altura", descripcion: "Se refiere al alto nominal de las familias. Este dato es vinculado automáticamente", tipo: "numero", unidad: "m", ifc: ["Qto_*BaseQuantities.Height"] },
  { n: 16, tdi: "B", ndi: 1, dato: "a", nombre: "Ancho", descripcion: "Se refiere al ancho o espesor nominal de las familias. Este dato es vinculado automáticamente", tipo: "numero", unidad: "m", ifc: ["Qto_*BaseQuantities.Width"] },
  {
    n: 17, tdi: "B", ndi: 1, dato: "a", nombre: "Área", original: "Area",
    descripcion: "Se refiere al área extruida total de las familias. Está puede ser bruta o neta según corresponda. Este dato es vinculado automáticamente",
    tipo: "numero", unidad: "m²", ifc: ["Qto_*BaseQuantities.NetArea", "Qto_*BaseQuantities.NetSideArea", "Qto_*BaseQuantities.GrossArea"],
  },
  {
    n: 18, tdi: "B", ndi: 1, dato: "i", nombre: "Capacidad de carga",
    descripcion: "Se refiere a si la familia está destinada a transportar cargas o no. Puede ser uno de estos dos valores: TRUE (Verdadero) o FALSE (Falso).",
    tipo: "booleano", ifc: ["*.LoadBearing"],
  },
  { n: 19, tdi: "B", ndi: 1, dato: "a", nombre: "Diámetro", original: "Diametro", descripcion: "Se refiere al diámetro de las familias o de partes de esta.En algunos casos el dato es vinculado automáticamente", tipo: "numero", unidad: "m", ifc: ["Pset_PipeSegmentTypeCommon.NominalDiameter"] },
  {
    n: 20, tdi: "B", ndi: 1, dato: "a", nombre: "Estado del Elemento",
    descripcion: "Se refiere al estado o fase del componente, que se utiliza generalmente en proyectos de renovación o rehabilitación. Su contenido debe corresponder a los siguientes tipos predefinidos: NUEVO, EXISTENTE, DEMOLICION, TEMPORAL, OTRO, DESCONOCIDO.",
    tipo: "lista", valores: ["NUEVO", "EXISTENTE", "DEMOLICION", "TEMPORAL", "OTRO", "DESCONOCIDO"], ifc: ["*.Status"],
  },
  // In IFC the slab's thickness is Qto_SlabBaseQuantities.Width (its Depth is a plan dimension).
  { n: 21, tdi: "B", ndi: 1, dato: "a", nombre: "Grosor", descripcion: "Se refiere al espesor de la losa. Este dato es vinculado automáticamente", tipo: "numero", unidad: "m", ifc: ["Qto_SlabBaseQuantities.Width"] },
  {
    n: 22, tdi: "B", ndi: 1, dato: "i", nombre: "Inclinación", original: "Inclinacion",
    descripcion: "Se refiere al ángulo de inclinación de la entidad Losas o rampas si corresponde. Especificar 0 grados define un plano horizontal.",
    tipo: "numero", unidad: "°", ifc: ["Pset_SlabCommon.PitchAngle"],
  },
  { n: 23, tdi: "B", ndi: 1, dato: "a", nombre: "Longitud", descripcion: "Se refiere al largo nominal total de las Familias que corresponda. Esta información es vinculada automáticamente", tipo: "numero", unidad: "m", ifc: ["Qto_*BaseQuantities.Length"] },
  {
    n: 24, tdi: "B", ndi: 1, dato: "a", nombre: "Perímetro", original: "Perimetro",
    descripcion: "Se refiere al perímetro medido a lo largo de los límites exteriores de las familias. Esto puede tener restricciones según el tipo de familia. Esta información es vinculada automáticamente",
    tipo: "numero", unidad: "m", ifc: ["Qto_*BaseQuantities.Perimeter"],
  },
  { n: 25, tdi: "B", ndi: 1, dato: "i", nombre: "Tipo de Operación", original: "Tipo de Operacion", descripcion: "Se refiere al tipo de operación de las familias Puertas (IfcDoor) y Ventana (IfcWindow).", ifc: ["@OperationType"] },
  {
    n: 26, tdi: "B", ndi: 1, dato: "a", nombre: "Volumen",
    descripcion: "Se refiere al volumen de las familias según corresponda. Está puede ser bruta o neta según corresponda. Esta información es vinculada automáticamente",
    tipo: "numero", unidad: "m³", ifc: ["Qto_*BaseQuantities.NetVolume", "Qto_*BaseQuantities.GrossVolume"],
  },
  {
    n: 27, tdi: "B", ndi: 2, dato: "a", nombre: "Área de sección transversal", original: "Area de seccion transversal",
    descripcion: "Se refiere al área total de la sección transversal (o perfil) de la entidad correspondiente. Este dato es vinculado automáticamente",
    tipo: "numero", unidad: "m²", ifc: ["Qto_*BaseQuantities.CrossSectionArea"],
  },
  { n: 28, tdi: "B", ndi: 2, dato: "i", nombre: "Código de forma de doblado", original: "Codigo de forma de doblado", descripcion: "Se refiere al código de forma de la entidad Barra de refuerzo" },
  {
    n: 29, tdi: "B", ndi: 2, dato: "a", nombre: "Masa",
    descripcion: "Se refiere al peso bruto total de las entidades, según corresponda, sin piezas añadidas, sin tener en cuenta las posibles características de procesamiento (cortes, etc.) o aberturas y rebajes. Esta información es vinculada automáticamente",
    tipo: "numero", unidad: "kg", ifc: ["Qto_*BaseQuantities.GrossWeight", "Qto_*BaseQuantities.NetWeight"],
  },
  { n: 30, tdi: "B", ndi: 2, dato: "a", nombre: "Número de Contrahuellas", original: "Numero de Contrahuellas", descripcion: "Se refiere al número total de contrahuellas incluidas en una familia Escaleras (IfcStair)", tipo: "numero", ifc: ["Pset_StairCommon.NumberOfRiser"] },
  { n: 31, tdi: "B", ndi: 2, dato: "a", nombre: "Número de Huellas", original: "Numero de Huellas", descripcion: "Se refiere a la cantidad total de peldaños de una familia Escaleras (IfcStair)", tipo: "numero", ifc: ["Pset_StairCommon.NumberOfTreads"] },
  { n: 32, tdi: "B", ndi: 2, dato: "i", nombre: "Recuento total de elementos de refuerzo", descripcion: "Se refiere al número o conteo de la cantidad entidades Elementos de refuerzo. Esta información puede ser vinculada automáticamente", tipo: "numero" },
  {
    n: 33, tdi: "B", ndi: 3, dato: "i", nombre: "Ángulo de inclinación desde el eje Z", original: "Angulo de inclinacion desde el eje Z",
    descripcion: "Se refiere a la rotación contra el eje longitudinal de la entidad Viga (IfcBeam) relativa a la dirección Z global para todas las vigas que no son verticales con respecto al sistema de coordenadas global (la dirección del perfil es igual a la Z global es Roll = 0).",
    tipo: "numero", unidad: "°",
  },
  {
    n: 34, tdi: "B", ndi: 3, dato: "i", nombre: "Dimensión ‘a’ de la soldadura", original: "Dimension ‘a’ de la soldadura",
    descripcion: "Se refiere a la dimensión ‘a’ de la soldadura de acuerdo con la ISO 2553 para la entidad Fijaciones (IfcFastener) cuando se utiliza el Tipo Predefinido WELD. Este dato debe ser incorporado en la entidad a través del parámetro ‘a’ en el Pset_FastenerWeld.",
    tipo: "numero", unidad: "m", ifc: ["Pset_FastenerWeld.a"],
  },
  { n: 35, tdi: "B", ndi: 3, dato: "i", nombre: "Forma de cabeza", descripcion: "Se refiere a la forma de la cabeza del perno de la entidad Fijaciones Mecánicas" },
  { n: 36, tdi: "B", ndi: 3, dato: "i", nombre: "Profundidad", descripcion: "Se refiere a la profundidad del marco de la entidad Puerta", tipo: "numero", unidad: "m" },
  {
    n: 37, tdi: "B", ndi: 3, dato: "i", nombre: "Tipo de cordón de soldadura", original: "Tipo de cordon de soldadura",
    descripcion: "Se refiere al tipo de cordón de soldadura según la ISO 2553. Las soldaduras combinadas reciben los dos símbolos correspondientes en la dirección del eje normal del sistema de coordenadas. Por ejemplo, una soldadura X se especifica como: Type1 = ‘V’ y Type2 = ‘V’. Este dato debe ser incorporado en la entidad a través del parámetro Type1 o Type2 en el Pset_FastenerWeld.",
    ifc: ["Pset_FastenerWeld.Type1", "Pset_FastenerWeld.Type2"],
  },
  {
    n: 38, tdi: "C", ndi: 1, dato: "i", nombre: "De uso en exterior",
    descripcion: "Se refiere a la indicación de si la entidad está diseñada para su uso en el exterior (TRUE) o no (FALSE). Si es un elemento externo y da al exterior del edificio debe utilizar TRUE.",
    tipo: "booleano", ifc: ["*.IsExternal"],
  },
  { n: 39, tdi: "C", ndi: 1, dato: "i", nombre: "Nivel", descripcion: "Se refiere al nivel del piso en una edificación donde se encuentra asociada o referenciada la familia." },
  {
    n: 40, tdi: "C", ndi: 1, dato: "a", nombre: "Nombre de apto o área común", original: "Nombre de apto o area comun",
    descripcion: "Se refiere al nombre del apto o zona comun que se puede utilizar para agrupar los Espacios de una vivienda o zona comun. Por ejemplo: APTO 403, Pasillo.",
  },
  {
    n: 41, tdi: "C", ndi: 1, dato: "i", nombre: "Zona",
    descripcion: "Son espacios determinantes que pueden conglomerar un conjunto de espacios, pueden ser internos o externos. Algunos nombres son, por ejemplo: comercio, zona comun, residencial, publico, entre otros para una infraestructura.",
  },
  {
    n: 86, tdi: "C", ndi: 2, dato: "i", nombre: "Espacio",
    descripcion: "Nombre descriptivo del espacio: Estos  espacios pueden ser internos o externos. Algunos nombres son, por ejemplo: COCINA, ESTAR, SALA_DE_BASURA, SALA_DE_BOMBAS, etc o PEATONAL, VEHICULAR, SEGURIDAD, entre otros para una infraestructura. Se recomienda que el dato sea escrito en mayúsculas, sin tildes",
    patron: "[A-ZÑ0-9_ ]+", ifc: ["@LongName"],
  },
  { n: 42, tdi: "C", ndi: 2, dato: "i", nombre: "tramo de tubería", original: "tramo de tuberia", descripcion: "se refiere al nombre donde el elemento hace conexión : lavamano, interruptor, toma, ducha" },
  {
    n: 43, tdi: "D", ndi: 1, dato: "i", nombre: "Código de sistema de clasificación materiales", original: "Codigo de sistema de clasificacion materiales",
    descripcion: "Se refiere al código del sistema de clasificación utilizado la para los insumo predominante de la familia.  Ejemplo, si se utiliza el sistema de clasificación omniclass se podría utilizar el código 23-01 00 00. Los códigos podrán ir avanzando en sus niveles del sistema de clasificación (1, 2, 3 y 4)",
  },
  {
    n: 44, tdi: "D", ndi: 1, dato: "i", nombre: "Código de sistema de clasificación(Código de montaje)", original: "Codigo de sistema de clasificacion(Codigo de montaje)",
    descripcion: "Se refiere al código del sistema de clasificación utilizado que está asignado en la familia.  Ejemplo, si se utiliza el sistema de clasificación omniclass se podría utilizar el código 21-01 00 00 Substructure. Los códigos podrán ir avanzando en sus niveles del sistema de clasificación (1, 2, 3 y 4)",
  },
  { n: 45, tdi: "D", ndi: 1, dato: "a", nombre: "Material", descripcion: "Se refiere al material predominante de la familia correspondiente Ejemplo: ladrillo h5, acero, aluminio, concreto 5000 psi" },
  { n: 46, tdi: "D", ndi: 2, dato: "i", nombre: "Amperaje", descripcion: "Se refiere al amperaje de la entidad correspondiente.", tipo: "numero", unidad: "A", ifc: ["Pset_ElectricalDeviceCommon.RatedCurrent"] },
  { n: 47, tdi: "D", ndi: 2, dato: "i", nombre: "Cantidad de polos", descripcion: "Se refiere al numero de polos de la familia", tipo: "numero", ifc: ["Pset_ElectricalDeviceCommon.NumberOfPoles"] },
  { n: 48, tdi: "D", ndi: 2, dato: "i", nombre: "Capacidad de almacenamiento de agua", descripcion: "Se refiere a la capacidad de almacenamiento de agua de la familia calentador", tipo: "numero" },
  { n: 49, tdi: "D", ndi: 2, dato: "", nombre: "Código de clasificación de actividad ( keynote)", original: "Codigo de clasificacion de actividad ( keynote)", descripcion: "Se refiere al codigo de la tabla omniclass 22 en keynote" },
  {
    n: 50, tdi: "D", ndi: 2, dato: "i", nombre: "Descripción", original: "Decripcion",
    descripcion: "Se refiere al campo para describir la entidad correspondiente o cualquier información adicional que se quiera incluir del componente. Este campo puede ser utilizado para la incorporación de las especificaciones técnicas de las entidades como muros (IfcWall), vigas (IfcBeam), puertas (IfcDoor),",
    ifc: ["@Description"],
  },
  { n: 51, tdi: "D", ndi: 2, dato: "i", nombre: "Fuente de energía", original: "Fuente de energia", descripcion: "Se refiere al tipo de energía que alimenta, gas, electrico." },
  {
    n: 52, tdi: "D", ndi: 2, dato: "a", nombre: "Nombre del componente",
    descripcion: "Se refiere al nombre del componente que representa una instancia particular del Tipo en el modelo, por ejemplo del tipo VENTANA ALUMINIO su nombre de componente podría ser V-001, V-002",
    ifc: ["@Name"],
  },
  { n: 53, tdi: "D", ndi: 2, dato: "i", nombre: "Voltaje", descripcion: "se refiere al voltaje que requiere para funcionamiento", tipo: "numero", unidad: "V", ifc: ["Pset_ElectricalDeviceCommon.RatedVoltage"] },
  {
    n: 54, tdi: "D", ndi: 3, dato: "i", nombre: "Resistencia a la permeabilidad del concreto", original: "Resistencia a la permehabilidad del concreto",
    descripcion: "se refiere a la capacidad del concreto de permitir el paso del agua, Baja , alta", tipo: "lista", valores: ["Baja", "Alta"],
  },
  { n: 55, tdi: "E", ndi: 2, dato: "", nombre: "Calibre del conductor", descripcion: "Tamaño o sección del conductor eléctrico. Ejemplo 12 AWG" },
  { n: 56, tdi: "E", ndi: 2, dato: "i", nombre: "Color del equipo o producto", descripcion: "Se refiere al color principal de las entidades que representen equipos o productos." },
  { n: 57, tdi: "E", ndi: 2, dato: "", nombre: "Color fase", descripcion: "Identificación del conductor según normativa de colores." },
  { n: 58, tdi: "E", ndi: 2, dato: "i", nombre: "Es Empotrado", descripcion: "Se refiere a si la familia Luminaria,  está destinado a estar \"integrado\", verdadero o falso", tipo: "booleano" },
  { n: 59, tdi: "E", ndi: 2, dato: "", nombre: "Tipo de conductor", descripcion: "Tipo de cable utilizado según especificación técnica. Ejemplo THHN / THWN" },
  {
    n: 60, tdi: "E", ndi: 3, dato: "i", nombre: "URL (Referencia de modelo del producto)",
    descripcion: "Se refiere al catálogo del fabricante o el recurso de referencia, como el sitio web, donde se puede encontrar información sobre el tipo de producto instalado.",
  },
  {
    n: 61, tdi: "J", ndi: 1, dato: "i", nombre: "Clasificación del sistema", original: "Clasificacion del sistema",
    descripcion: "Define la categoría o tipo específico dentro del sistema al que pertenece el elemento. Permite una clasificación más detallada para fines de gestión, análisis y filtrado de información (por ejemplo: suministro, sanitario, baja tensión, media tensión).",
  },
  { n: 62, tdi: "J", ndi: 1, dato: "i", nombre: "Origen de alimentación", original: "Origen de alimentacion", descripcion: "Identifica el punto desde el cual se alimenta el elemento dentro de la red. Subestación / Transformador / Tablero general" },
  {
    n: 63, tdi: "J", ndi: 1, dato: "i", nombre: "Sistema",
    descripcion: "Identifica el sistema técnico o red a la que pertenece el elemento modelado dentro del proyecto. Permite agrupar los componentes según su función operativa (por ejemplo: sistema eléctrico, sistema hidrosanitario, red de telecomunicaciones, red contra incendios).",
  },
  { n: 64, tdi: "J", ndi: 1, dato: "i", nombre: "Subsistema eléctrico", original: "Subsistema electrico", descripcion: "Define el subsistema dentro de la red eléctrica del proyecto. Ejemplo: Alimentación general / Alumbrado / Tomacorrientes / Fuerza" },
  { n: 65, tdi: "J", ndi: 1, dato: "i", nombre: "Tablero de distribución", original: "Tablero de distribucion", descripcion: "Identifica el tablero eléctrico desde donde se distribuye el circuito. Ejemplo TDP-01 / TDA-02" },
  { n: 66, tdi: "J", ndi: 2, dato: "i", nombre: "Contiene cable?", descripcion: "Parámetro de tipo booleano (Sí/No) que indica si una canalización, tubería o elemento modelado incluye conductores eléctricos en su interior.", tipo: "booleano" },
  {
    n: 67, tdi: "J", ndi: 2, dato: "i", nombre: "Número de cables", original: "Numero de cables",
    descripcion: "Indica la cantidad de conductores presentes dentro de un ducto, canalización o sistema eléctrico específico. Permite verificar la capacidad de las canalizaciones y apoyar los cálculos de diseño eléctrico.",
    tipo: "numero",
  },
  {
    n: 68, tdi: "J", ndi: 2, dato: "i", nombre: "Número de circuito", original: "Numero de circuito",
    descripcion: "Código o identificador asignado a un circuito eléctrico dentro del sistema de distribución. Permite relacionar los elementos eléctricos con su circuito correspondiente en tableros y esquemas eléctricos.",
  },
  {
    n: 69, tdi: "J", ndi: 2, dato: "i", nombre: "Segmento del sistema",
    descripcion: "Identifica el tramo o sección específica de una red de tuberías dentro de un sistema mayor. Este parámetro permite diferenciar partes del sistema para facilitar el control de diseño, la coordinación y el mantenimiento de la red. Ejemplo: tuberia trafico pesado, trafico liviano, ventilacion.",
  },
  { n: 70, tdi: "J", ndi: 2, dato: "i", nombre: "Tipo de circuito", descripcion: "Define el uso del circuito eléctrico." },
  {
    n: 71, tdi: "K", ndi: 1, dato: "i", nombre: "Accesible al Público", original: "Accesible al Publico",
    descripcion: "Se refiere a si el Espacio (IfcSpace) o Zona (IfcZone) está diseñado para servir como un acceso público, por ejemplo, para un baño público (VERDADERO) o no (FALSO).",
    tipo: "booleano", ifc: ["Pset_SpaceCommon.PubliclyAccessible"],
  },
  { n: 72, tdi: "K", ndi: 1, dato: "a", nombre: "altura libre", descripcion: "Se refiere a la altura libre requerido por una entidad", tipo: "numero", unidad: "m", ifc: ["Pset_SpaceOccupancyRequirements.MinimumHeadroom"] },
  { n: 73, tdi: "K", ndi: 1, dato: "a", nombre: "ancho libre", descripcion: "Se refiere al ancho libre requerido por una entidad", tipo: "numero", unidad: "m" },
  { n: 74, tdi: "K", ndi: 1, dato: "i", nombre: "Capacidad de personas", descripcion: "Se refiere a medida en número de personas que puede estar en el espacio ejemplo: 1 persona/m²", tipo: "numero" },
  {
    n: 75, tdi: "K", ndi: 1, dato: "i", nombre: "Cálculo Carga de ocupación", original: "Calculo Carga de ocupacion",
    descripcion: "Se refiere al número calculado de personas que permite el Espacio ejemplo de calculo= 120 m² / 1 m²/persona = 120 personas",
    tipo: "numero", ifc: ["Pset_SpaceOccupancyRequirements.OccupancyNumber"],
  },
  { n: 76, tdi: "K", ndi: 1, dato: "a", nombre: "Frente libre", descripcion: "Se refiere al frente libre requerido por una entidad", tipo: "numero", unidad: "m" },
  // A yes/no in DYCO; IFC's FireRating is a text (e.g. "2h"), so it goes with n° 79 instead.
  {
    n: 77, tdi: "K", ndi: 1, dato: "a", nombre: "Resistencia al Fuego",
    descripcion: "Se refiere a si el elemento debe ser resistente al fuego (verdadero/ falso). Esta clasificación se otorga de acuerdo con las regulaciones nacionales de seguridad contra incendios.",
    tipo: "booleano",
  },
  { n: 78, tdi: "K", ndi: 1, dato: "i", nombre: "Salida de Emergencia", descripcion: "Se refiere a si la entidad está diseñada para servir como salida en caso de incendio (VERDADERO) o no (FALSO).", tipo: "booleano", ifc: ["*.FireExit"] },
  { n: 79, tdi: "K", ndi: 1, dato: "i", nombre: "Tiempo de resistencia al fuego (horas)", descripcion: "Se refiere al tiempo de soporte incendio asignado de acuerdo con las normas de construcción locales", tipo: "numero", unidad: "h", ifc: ["*.FireRating"] },
  { n: 80, tdi: "K", ndi: 2, dato: "i", nombre: "Grado de protección IP", original: "Grado de proteccion IP", descripcion: "hace referencia al grado de proteccion del elemento respecto al agua, viento, arena", ifc: ["Pset_ElectricalDeviceCommon.IP_Code"] },
  { n: 81, tdi: "L", ndi: 3, dato: "i", nombre: "Fecha de inicio programada", descripcion: "Fecha de inicio programada", tipo: "fecha" },
  { n: 82, tdi: "L", ndi: 3, dato: "i", nombre: "Fecha final programada", descripcion: "Fecha final programada", tipo: "fecha" },
  {
    n: 83, tdi: "L", ndi: 3, dato: "i", nombre: "Fecha final real de instalación del equipo o producto", original: "Fecha final real de instalacion del equipo o producto",
    descripcion: "Se refiere a la fecha en que el equipo o producto fue colocado en su ubicación definitiva.", tipo: "fecha",
  },
  {
    n: 84, tdi: "L", ndi: 3, dato: "i", nombre: "Fecha inicio real de instalación del equipo o producto", original: "Fecha inicio real de instalacion del equipo o producto",
    descripcion: "Se refiere a la fecha en que el equipo o producto se inicia a colocar en su ubicación definitiva.", tipo: "fecha",
  },
  { n: 85, tdi: "L", ndi: 3, dato: "i", nombre: "Tiempo de finalización", original: "Tiempo de finalizacion", descripcion: "Se refiere a los dias de finalización de la tarea del plan de trabajo.", tipo: "numero", unidad: "días" },
  {
    n: 87, tdi: "K", ndi: 1, dato: "i", nombre: "Clasificación de ocupación según NSR-10",
    descripcion: "se refiere a el tipo  de ocupacion segun norma nsr 10 ejemplo: Parqueaderos → Ocupación de almacenamiento o parqueaderos; Cuartos técnicos → Ocupación de servicios; Zonas comunes → Ocupación de reunión o residencial; Vivienda → Ocupación Residencial; Locales comerciales → Ocupación Comercial;",
    ifc: ["Pset_SpaceOccupancyRequirements.OccupancyType"],
  },
  { n: 88, tdi: "C", ndi: 2, dato: "i", nombre: "Bloque o etapa", descripcion: "Se refiere al nombre del grupo de Espacios o etapas. Algunos ejemplos son, etapa 1, bloque 1" },
  {
    n: 89, tdi: "C", ndi: 2, dato: "i", nombre: "Paquete de trabajo o conjunto",
    descripcion: "Se refiere al nombre del desglose de unidad estructural que deriva de un bloque mas grande ejemplo: Piscina, zona comun, comercio,",
  },
];

export function codigoDyco(numero: number): string {
  return `DYCO-${String(numero).padStart(3, "0")}`;
}

/** The parameter's own name (and its DYCO spelling, when different) in any group, then the suggested IFC places. */
function aliasDe(f: Fila): Alias[] {
  const out: Alias[] = [{ grupo: "*", propiedad: f.nombre, sugerida: false }];
  if (f.original && normalizarNombre(f.original) !== normalizarNombre(f.nombre)) out.push({ grupo: "*", propiedad: f.original, sugerida: false });
  for (const ruta of f.ifc ?? []) {
    const i = ruta.indexOf(".");
    out.push(ruta.startsWith("@") ? { grupo: "@", propiedad: ruta.slice(1), sugerida: true } : { grupo: ruta.slice(0, i), propiedad: ruta.slice(i + 1), sugerida: true });
  }
  return out;
}

/** The 89 parameters of the DYCO list, ready to compare with a catalog. */
export function parametrosDyco(): ParametroData[] {
  return FILAS.map((f) => ({
    codigo: codigoDyco(f.n),
    numero: f.n,
    nombre: f.nombre,
    descripcion: f.descripcion,
    tdi: f.tdi,
    ndi: f.ndi,
    origen: ORIGEN[f.dato],
    tipoDato: f.tipo ?? "texto",
    unidad: f.unidad ?? "",
    valoresPermitidos: f.valores ?? [],
    regla: { ...REGLA_VACIA, patron: f.patron ?? "" },
    alias: aliasDe(f),
    idsUri: "",
    activo: true,
  }));
}

// ---------------------------------------------------------------- starter disciplines

export interface ElementoSugerido {
  codigo: string;
  nombre: string;
  claseIfc: string;
  tipoPredefinido?: string;
  notas?: string;
  /** Codes of catalog parameters it requires from the start. */
  parametros?: string[];
}

export interface DisciplinaSugerida {
  codigo: string;
  nombre: string;
  color: string;
  elementos: ElementoSugerido[];
}

const A_NDI1 = FILAS.filter((f) => f.tdi === "A" && f.ndi === 1).map((f) => codigoDyco(f.n));

/**
 * A starting point the coordinator adjusts: the usual disciplines with the
 * elements usually modeled and their IFC class. Parameters start empty
 * ("Agregar todos los NDI-1 del grupo…" fills them), except the project's
 * data (TDI-A), required only from the project object, not from every element.
 */
export function disciplinasSugeridas(): DisciplinaSugerida[] {
  const c = (i: number) => CATEGORY_COLORS[i % CATEGORY_COLORS.length];
  return [
    {
      codigo: "GEN",
      nombre: "General (datos del proyecto)",
      color: OTHER_COLOR,
      elementos: [
        {
          codigo: "PROY",
          nombre: "Información del proyecto",
          claseIfc: "IfcProject",
          notas: "Los datos del proyecto (TDI-A) se exigen a este objeto y no a cada elemento. Según cómo exporte el software, pueden quedar en IfcProject o en IfcBuilding.",
          parametros: A_NDI1,
        },
      ],
    },
    {
      codigo: "ARQ",
      nombre: "Arquitectura",
      color: c(0),
      elementos: [
        { codigo: "MUR", nombre: "Muro", claseIfc: "IfcWall" },
        { codigo: "PIS", nombre: "Piso / acabado de piso", claseIfc: "IfcCovering", tipoPredefinido: "FLOORING" },
        { codigo: "CIE", nombre: "Cielo raso", claseIfc: "IfcCovering", tipoPredefinido: "CEILING" },
        { codigo: "PUE", nombre: "Puerta", claseIfc: "IfcDoor" },
        { codigo: "VEN", nombre: "Ventana", claseIfc: "IfcWindow" },
        { codigo: "ESC", nombre: "Escalera", claseIfc: "IfcStair" },
        { codigo: "BAR", nombre: "Baranda", claseIfc: "IfcRailing" },
        { codigo: "CUB", nombre: "Cubierta", claseIfc: "IfcRoof" },
        { codigo: "MOB", nombre: "Mobiliario", claseIfc: "IfcFurniture" },
        { codigo: "ESP", nombre: "Espacio", claseIfc: "IfcSpace" },
      ],
    },
    {
      codigo: "EST",
      nombre: "Estructura",
      color: c(1),
      elementos: [
        { codigo: "ZAP", nombre: "Zapata", claseIfc: "IfcFooting" },
        { codigo: "PIL", nombre: "Pilote", claseIfc: "IfcPile" },
        { codigo: "COL", nombre: "Columna", claseIfc: "IfcColumn" },
        { codigo: "VIG", nombre: "Viga", claseIfc: "IfcBeam" },
        { codigo: "LOS", nombre: "Losa", claseIfc: "IfcSlab" },
        { codigo: "MUR", nombre: "Muro estructural", claseIfc: "IfcWall" },
        { codigo: "REF", nombre: "Barra de refuerzo", claseIfc: "IfcReinforcingBar" },
        { codigo: "SOL", nombre: "Fijación / soldadura", claseIfc: "IfcFastener" },
      ],
    },
    {
      codigo: "HID",
      nombre: "Hidrosanitaria",
      color: c(2),
      elementos: [
        { codigo: "TUB", nombre: "Tubería", claseIfc: "IfcPipeSegment" },
        { codigo: "ACC", nombre: "Accesorio de tubería", claseIfc: "IfcPipeFitting" },
        { codigo: "APA", nombre: "Aparato sanitario", claseIfc: "IfcSanitaryTerminal" },
        { codigo: "VAL", nombre: "Válvula", claseIfc: "IfcValve" },
        { codigo: "TAN", nombre: "Tanque", claseIfc: "IfcTank" },
        { codigo: "BOM", nombre: "Bomba", claseIfc: "IfcPump" },
      ],
    },
    {
      codigo: "ELE",
      nombre: "Eléctrica",
      color: c(3),
      elementos: [
        { codigo: "LUM", nombre: "Luminaria", claseIfc: "IfcLightFixture" },
        { codigo: "TAB", nombre: "Tablero", claseIfc: "IfcElectricDistributionBoard" },
        { codigo: "TOM", nombre: "Tomacorriente", claseIfc: "IfcOutlet" },
        { codigo: "INT", nombre: "Interruptor", claseIfc: "IfcSwitchingDevice" },
        { codigo: "CON", nombre: "Conductor", claseIfc: "IfcCableSegment" },
        { codigo: "BAN", nombre: "Bandeja portacables", claseIfc: "IfcCableCarrierSegment", tipoPredefinido: "CABLETRAYSEGMENT" },
        { codigo: "DUC", nombre: "Tubería eléctrica (conduit)", claseIfc: "IfcCableCarrierSegment", tipoPredefinido: "CONDUITSEGMENT" },
      ],
    },
    {
      codigo: "MEC",
      nombre: "Mecánica",
      color: c(4),
      elementos: [
        { codigo: "DUC", nombre: "Ducto", claseIfc: "IfcDuctSegment" },
        { codigo: "ACC", nombre: "Accesorio de ducto", claseIfc: "IfcDuctFitting" },
        { codigo: "REJ", nombre: "Rejilla / difusor", claseIfc: "IfcAirTerminal" },
        { codigo: "EQU", nombre: "Equipo", claseIfc: "IfcUnitaryEquipment" },
        { codigo: "VEN", nombre: "Ventilador / extractor", claseIfc: "IfcFan" },
      ],
    },
    {
      codigo: "RCI",
      nombre: "Red contra incendio",
      color: c(5),
      elementos: [
        { codigo: "TUB", nombre: "Tubería", claseIfc: "IfcPipeSegment" },
        { codigo: "ROC", nombre: "Rociador", claseIfc: "IfcFireSuppressionTerminal", tipoPredefinido: "SPRINKLER" },
        { codigo: "GAB", nombre: "Gabinete contra incendio", claseIfc: "IfcFireSuppressionTerminal", tipoPredefinido: "HOSEREEL" },
        { codigo: "VAL", nombre: "Válvula", claseIfc: "IfcValve" },
      ],
    },
    {
      codigo: "GAS",
      nombre: "Gas",
      color: c(6),
      elementos: [
        { codigo: "TUB", nombre: "Tubería", claseIfc: "IfcPipeSegment" },
        { codigo: "VAL", nombre: "Válvula", claseIfc: "IfcValve" },
        { codigo: "MED", nombre: "Medidor", claseIfc: "IfcFlowMeter" },
      ],
    },
    {
      codigo: "TEL",
      nombre: "Telecomunicaciones",
      color: c(7),
      elementos: [
        { codigo: "SAL", nombre: "Salida de voz y datos", claseIfc: "IfcOutlet", tipoPredefinido: "DATAOUTLET" },
        { codigo: "CAB", nombre: "Cable", claseIfc: "IfcCableSegment" },
        { codigo: "BAN", nombre: "Bandeja", claseIfc: "IfcCableCarrierSegment" },
        { codigo: "EQU", nombre: "Equipo / rack", claseIfc: "IfcCommunicationsAppliance" },
      ],
    },
    {
      codigo: "URB",
      nombre: "Urbanismo",
      color: c(8),
      elementos: [
        { codigo: "PAV", nombre: "Pavimento / zona dura", claseIfc: "IfcPavement" },
        { codigo: "VER", nombre: "Zona verde", claseIfc: "IfcGeographicElement" },
        { codigo: "MOB", nombre: "Mobiliario urbano", claseIfc: "IfcFurniture" },
        { codigo: "CER", nombre: "Cerramiento", claseIfc: "IfcRailing" },
      ],
    },
  ];
}
