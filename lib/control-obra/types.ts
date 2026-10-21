// Shared by the API and the "Control de Obra" screens (project menu and, later, the 3D viewer panel).

// ---------------------------------------------------------------- permissions matrix

/**
 * The parts of the tool a permission refers to, including later phases, so
 * the roles are set once. Administering companies, people and the project
 * structure are not permissions: they belong to the administrators (technical,
 * company and project), kept apart from the operational permissions.
 */
export type Modulo =
  | "panel"
  | "estructura"
  | "modelos"
  | "cantidades"
  | "avance"
  | "actas_cliente"
  | "actas_sub"
  | "costos"
  | "almacen"
  | "criterios"
  | "lotes"
  | "ensayos"
  | "inspecciones"
  | "nc"
  | "aceptacion"
  | "documentos"
  | "reportes"
  | "bitacora"
  | "accesos";

export type Accion = "ver" | "crear" | "editar" | "verificar" | "aprobar" | "anular" | "documentos" | "exportar" | "administrar";

/** "modulo.accion", e.g. "cantidades.verificar". */
export type Permiso = `${Modulo}.${Accion}`;

/** What the license sells: groups of modules. Panel, bitácora and accesos always come with it. */
export type GrupoLicencia = "bim" | "cantidades" | "costos" | "almacen" | "calidad" | "documentos" | "reportes";

export const GRUPOS_LICENCIA: { id: GrupoLicencia; nombre: string; modulos: Modulo[] }[] = [
  { id: "bim", nombre: "Estructura de obra y modelos 3D", modulos: ["estructura", "modelos"] },
  { id: "cantidades", nombre: "Mediciones, actas y avance físico", modulos: ["cantidades", "avance", "actas_cliente", "actas_sub"] },
  { id: "costos", nombre: "Costos", modulos: ["costos"] },
  { id: "almacen", nombre: "Almacén y consumo de materiales", modulos: ["almacen"] },
  { id: "calidad", nombre: "Calidad, inspecciones y aceptación", modulos: ["criterios", "lotes", "ensayos", "inspecciones", "nc", "aceptacion"] },
  { id: "documentos", nombre: "Documentos y CDE", modulos: ["documentos"] },
  { id: "reportes", nombre: "Reportes", modulos: ["reportes"] },
];

/** Modules every license includes. */
export const MODULOS_BASE: Modulo[] = ["panel", "bitacora", "accesos"];

export const MODULOS: { id: Modulo; nombre: string; ayuda: string }[] = [
  { id: "panel", nombre: "Panel de control", ayuda: "Indicadores del proyecto con su fecha de corte, alcance, fuente y regla." },
  { id: "estructura", nombre: "Estructura de obra", ayuda: "Torres, etapas, zonas, niveles, frentes y disciplinas del proyecto, con responsables y fechas." },
  { id: "modelos", nombre: "Modelos 3D y elementos", ayuda: "Versiones leídas, elementos por IFCGUID e incidencias de identificación." },
  { id: "cantidades", nombre: "Mediciones de obra", ayuda: "Lo ejecutado por partida, medido desde el modelo o a mano, con su ubicación y su contrato." },
  { id: "avance", nombre: "Avance físico", ayuda: "Cortes de avance: planificado, reportado, verificado y aceptado." },
  { id: "actas_cliente", nombre: "Actas al cliente", ayuda: "Actas de obra al cliente a precio de venta, con su flujo de aprobación." },
  { id: "actas_sub", nombre: "Actas de subcontratistas", ayuda: "Actas de cada contrato de Compras a su precio, con amortización y retención." },
  { id: "costos", nombre: "Costos", ayuda: "Costo real (materiales consumidos y actas de subcontrato) frente al presupuesto." },
  { id: "almacen", nombre: "Almacén", ayuda: "Entradas desde Compras, vales de salida, existencias, consumo y desperdicio." },
  { id: "criterios", nombre: "Materiales y criterios", ayuda: "Materiales y criterios de aceptación del proyecto (los aprueba el responsable técnico)." },
  { id: "lotes", nombre: "Lotes y muestras", ayuda: "Lotes de material, sus certificados y las muestras tomadas." },
  { id: "ensayos", nombre: "Ensayos", ayuda: "Resultados de laboratorio evaluados contra el criterio aprobado." },
  { id: "inspecciones", nombre: "Inspecciones", ayuda: "Listas de chequeo e inspecciones de elementos y de recepción." },
  { id: "nc", nombre: "No conformidades", ayuda: "No conformidades, acciones correctivas y cierre." },
  { id: "aceptacion", nombre: "Aceptación de elementos", ayuda: "Aceptar o revocar la aceptación de un elemento (solo sin pendientes)." },
  { id: "documentos", nombre: "Documentos y CDE", ayuda: "Soportes, fotos y certificados en el CDE del proyecto." },
  { id: "reportes", nombre: "Reportes", ayuda: "Reportes de cantidades, costos, avance y calidad." },
  { id: "bitacora", nombre: "Bitácora", ayuda: "El registro de todo lo que se hizo y se intentó, que nadie puede cambiar." },
  { id: "accesos", nombre: "Accesos y roles", ayuda: "Consultar quién tiene acceso y con qué rol (los administran los administradores)." },
];

export const ACCIONES: { id: Accion; nombre: string; ayuda: string }[] = [
  { id: "ver", nombre: "Ver", ayuda: "Consultar." },
  { id: "crear", nombre: "Crear / reportar", ayuda: "Registrar nuevos." },
  { id: "editar", nombre: "Editar", ayuda: "Corregir borradores mientras su estado lo permita." },
  { id: "verificar", nombre: "Verificar", ayuda: "Comprobar por medición o inspección lo que reportó otra persona." },
  { id: "aprobar", nombre: "Aprobar / aceptar", ayuda: "Decidir sobre lo verificado." },
  { id: "anular", nombre: "Anular / revocar", ayuda: "Dejar sin efecto con motivo (nunca se borra)." },
  { id: "documentos", nombre: "Adjuntar documentos", ayuda: "Subir soportes al CDE y abrirlos." },
  { id: "exportar", nombre: "Exportar", ayuda: "Descargar reportes (solo con lo que el rol puede ver)." },
  { id: "administrar", nombre: "Configurar", ayuda: "Configurar el módulo (criterios, plantillas de inspección)." },
];

/** Which actions make sense in each module; the matrix only offers these. */
export const ACCIONES_POR_MODULO: Record<Modulo, Accion[]> = {
  panel: ["ver"],
  estructura: ["ver"],
  modelos: ["ver", "crear", "verificar"],
  cantidades: ["ver", "crear", "editar", "verificar", "aprobar", "anular", "documentos", "exportar"],
  avance: ["ver", "crear", "editar", "aprobar", "anular", "documentos", "exportar"],
  actas_cliente: ["ver", "crear", "editar", "aprobar", "anular", "documentos", "exportar"],
  actas_sub: ["ver", "crear", "editar", "aprobar", "anular", "documentos", "exportar"],
  costos: ["ver", "crear", "editar", "aprobar", "anular", "documentos", "exportar"],
  almacen: ["ver", "crear", "editar", "aprobar", "anular", "exportar"],
  criterios: ["ver", "crear", "editar", "aprobar", "anular", "administrar"],
  lotes: ["ver", "crear", "editar", "aprobar", "anular", "documentos"],
  ensayos: ["ver", "crear", "editar", "verificar", "aprobar", "anular", "documentos", "exportar"],
  inspecciones: ["ver", "crear", "editar", "verificar", "aprobar", "anular", "documentos", "exportar", "administrar"],
  nc: ["ver", "crear", "editar", "aprobar", "anular", "documentos", "exportar"],
  aceptacion: ["ver", "aprobar", "anular"],
  documentos: ["ver", "documentos", "anular", "administrar"],
  reportes: ["ver", "exportar"],
  bitacora: ["ver", "exportar"],
  accesos: ["ver"],
};

/** Every valid permission, in matrix order (supabase/control-obra.sql lists the same ones). */
export const PERMISOS_VALIDOS: Permiso[] = MODULOS.flatMap((m) => ACCIONES_POR_MODULO[m.id].map((a) => `${m.id}.${a}` as Permiso));

// ---------------------------------------------------------------- companies and licenses

export interface Empresa {
  id: string;
  nombre: string;
  /** Digits only, without the check digit; "" when not recorded. */
  nit: string;
  dv: number | null;
  activa: boolean;
  version: number;
  creado: string;
  creadoPor: string;
}

/** What the technical administrator sends to create (version 0) or change a company. */
export interface CambioEmpresa {
  id?: string;
  nombre: string;
  /** "900123456-8", "900.123.456-8" or "" (no NIT). */
  nit: string;
  activa: boolean;
  version: number;
}

export type EventoLicencia ="activacion" | "renovacion" | "cambio" | "suspension" | "reactivacion";

/** One row of a company's license history; the newest one is in force. Rows are never changed. */
export interface Licencia {
  id: string;
  empresaId: string;
  evento: EventoLicencia;
  plan: string;
  /** YYYY-MM-DD: first day with access. */
  desde: string;
  /** Last day with access; null: no end. */
  hasta: string | null;
  maxProyectos: number;
  maxUsuarios: number;
  grupos: GrupoLicencia[];
  suspendida: boolean;
  motivo: string;
  soporte: string;
  otorgadaPor: string;
  creado: string;
}

export type EstadoLicencia = "sin-licencia" | "programada" | "activa" | "por-vencer" | "vencida" | "suspendida" | "sin-vencimiento" | "empresa-inactiva";

/** What the technical administrator sends to record a license event. */
export interface NuevaLicencia {
  empresaId: string;
  evento: EventoLicencia;
  plan: string;
  desde: string;
  hasta: string | null;
  maxProyectos: number;
  maxUsuarios: number;
  grupos: GrupoLicencia[];
  suspendida: boolean;
  motivo: string;
  soporte: string;
}

/** A project of Trimble Connect registered to a company (only one company at a time). */
export interface ProyectoEmpresa {
  empresaId: string;
  projectId: string;
  projectName: string;
  activo: boolean;
  vinculadoPor: string;
  vinculado: string;
  motivo: string;
}

// ---------------------------------------------------------------- roles and people

export interface Rol {
  id: string;
  /** Stable key: the initial roles keep theirs ("director"...); the ones created later get "personal_…". */
  clave: string;
  nombre: string;
  descripcion: string;
  /** One of the initial roles (can't be deactivated). */
  sistema: boolean;
  activo: boolean;
  permisos: Permiso[];
  version: number;
}

/**
 * A person of the company. Invited administrators are known by e-mail until
 * they open Control de Obra the first time (then their Trimble user id is kept).
 */
export interface UsuarioEmpresa {
  id: string;
  /** null: invited, hasn't opened Control de Obra yet. */
  userId: string | null;
  email: string;
  nombre: string;
  adminEmpresa: boolean;
  /** False: deactivated in the whole company (every access stops). */
  activo: boolean;
  version: number;
  otorgadoPor: string;
}

/** A person's role in a project, valid between two dates (hasta null: no end). */
export interface Asignacion {
  projectId: string;
  userId: string;
  nombre: string;
  email: string;
  rolId: string;
  /** Configures people, structure and settings of this project. */
  adminProyecto: boolean;
  desde: string;
  hasta: string | null;
  activo: boolean;
  version: number;
  otorgadoPor: string;
}

export type EstadoAsignacion = "vigente" | "programada" | "vencida" | "revocada";

export interface CambioAsignacion {
  userId: string;
  rolId: string;
  adminProyecto: boolean;
  desde: string;
  hasta: string | null;
  activo: boolean;
  /** 0 for a person without an access in this project yet. */
  version: number;
}

export interface CambioRol {
  /** Absent: a new role. */
  id?: string;
  nombre: string;
  descripcion: string;
  permisos: Permiso[];
  activo: boolean;
  version: number;
}

// ---------------------------------------------------------------- structure of the work (doc §4.1, §5)

/** Where a level's values come from. */
export type FuenteNivel = "modelo" | "propiedad" | "manual";

/** A level of the structure (torre, zona, nivel…): of the company's template (projectId null) or of one project. */
export interface Nivel {
  id: string;
  projectId: string | null;
  clave: string;
  nombre: string;
  orden: number;
  /** The level it sits under (e.g. "nivel" under "torre"); null: top. */
  padreClave: string | null;
  fuente: FuenteNivel;
  /** Property of the model ("Set · Property" or its name) or attribute id of Propiedades; "" for manual. */
  claveFuente: string;
  activo: boolean;
  version: number;
}

export type CambioNivel = Omit<Nivel, "id" | "version"> & { id?: string; version: number };

export type EstadoNodo = "activo" | "cerrado" | "inactivo";

/** A value of a level ("Torre 1", "Piso 5") with who answers for it, its dates and state. */
export interface Nodo {
  id: string;
  nivelClave: string;
  valor: string;
  padreId: string | null;
  responsableId: string | null;
  responsableNombre: string;
  inicio: string | null;
  fin: string | null;
  estado: EstadoNodo;
  nota: string;
  version: number;
}

export type CambioNodo = Omit<Nodo, "id" | "version"> & { id?: string; version: number };

/** The levels that come from Presupuesto: shown in the structure, never duplicated. */
export const NIVELES_PRESUPUESTO: { clave: string; nombre: string; origen: string }[] = [
  { clave: "capitulo", nombre: "Capítulo", origen: "Subpresupuestos y títulos del presupuesto" },
  { clave: "actividad", nombre: "Actividad", origen: "Actividades de la programación (EDT)" },
  { clave: "paquete", nombre: "Paquete de trabajo", origen: "Nodos de la EDT de la programación" },
];

/** The levels a company's template starts with (doc §4.1): editable, deactivatable. */
export const NIVELES_INICIALES: Omit<CambioNivel, "projectId" | "version">[] = [
  { clave: "torre", nombre: "Torre", orden: 1, padreClave: null, fuente: "manual", claveFuente: "", activo: true },
  { clave: "etapa", nombre: "Etapa", orden: 2, padreClave: null, fuente: "manual", claveFuente: "", activo: true },
  { clave: "zona", nombre: "Zona", orden: 3, padreClave: "torre", fuente: "modelo", claveFuente: "Zona", activo: true },
  { clave: "nombre_zona", nombre: "Nombre de zona", orden: 4, padreClave: "torre", fuente: "modelo", claveFuente: "Nombre de zona", activo: true },
  { clave: "nivel", nombre: "Nivel", orden: 5, padreClave: "torre", fuente: "modelo", claveFuente: "Nivel", activo: true },
  { clave: "frente", nombre: "Frente", orden: 6, padreClave: null, fuente: "manual", claveFuente: "", activo: true },
  { clave: "disciplina", nombre: "Disciplina", orden: 7, padreClave: null, fuente: "manual", claveFuente: "", activo: true },
];

export const RESERVADAS: string[] = [...NIVELES_PRESUPUESTO.map((n) => n.clave), "proyecto", "empresa", "elemento"];

// ---------------------------------------------------------------- project settings

export interface ConfigProyecto {
  responsableTecnicoId: string | null;
  responsableTecnicoNombre: string;
  /** Difference between reported and verified (in % of the reported) that needs a reason. */
  toleranciaVerificacionPct: number;
  /** Inspections may end "aceptado con observaciones" (doc §7.4, off by default). */
  permiteAceptadoConObservaciones: boolean;
  version: number;
}

export const CONFIG_INICIAL: ConfigProyecto = {
  responsableTecnicoId: null,
  responsableTecnicoNombre: "",
  toleranciaVerificacionPct: 0,
  permiteAceptadoConObservaciones: false,
  version: 0,
};

// ---------------------------------------------------------------- bitácora

export type ResultadoBitacora = "ok" | "denegado" | "error";
export type OrigenBitacora = "menu" | "visor" | "sistema";

export interface EntradaBitacora {
  /** Position in its chain (the company's, or "global" for the technical administrator). */
  n: number;
  cadena: string;
  creado: string;
  empresaId: string | null;
  projectId: string | null;
  actorId: string;
  actorNombre: string;
  /** e.g. "accesos.asignar", "licencias.registrar", "ingreso". */
  accion: string;
  modulo: string;
  objetoTipo: string;
  objetoId: string;
  /** Changed fields: { campo: [antes, después] } and other details. */
  cambios: Record<string, unknown>;
  motivo: string;
  resultado: ResultadoBitacora;
  origen: OrigenBitacora;
  hashAnterior: string;
  hash: string;
}

export type NuevaEntrada = Omit<EntradaBitacora, "n" | "cadena" | "creado" | "hashAnterior" | "hash">;

export interface FiltroBitacora {
  desde?: string;
  hasta?: string;
  actorId?: string;
  modulo?: string;
  resultado?: ResultadoBitacora;
  /** Only this project (and not the company-wide rows). */
  soloProyecto?: boolean;
  /** Older than this position. */
  antesDe?: number;
  limite?: number;
}

export const MAX_BITACORA = 200;

/** The result of checking a chain: where it breaks, if it does. */
export interface VerificacionBitacora {
  cadena: string;
  filas: number;
  integra: boolean;
  /** First position whose hash doesn't match, or that doesn't follow the previous one. */
  rotaEn: number | null;
}

// ---------------------------------------------------------------- approval flows

/** The kinds of documents that go through an approval flow, configured per project. */
export type TipoFlujo = "acta_cliente" | "acta_subcontrato" | "inspeccion" | "cierre_nc" | "vale_salida";

export const TIPOS_FLUJO: {
  id: TipoFlujo;
  nombre: string;
  /** The module whose permissions the steps need. */
  modulo: Modulo;
  /** What the first step (who prepares and sends) needs; the others need "aprobar". */
  accionInicial: Accion;
  ayuda: string;
}[] = [
  { id: "acta_cliente", nombre: "Actas al cliente", modulo: "actas_cliente", accionInicial: "crear", ayuda: "El acta de obra al cliente; al aprobarse, sus mediciones quedan aprobadas." },
  { id: "acta_subcontrato", nombre: "Actas de subcontratistas", modulo: "actas_sub", accionInicial: "crear", ayuda: "El acta de cada contrato de Compras." },
  { id: "inspeccion", nombre: "Inspecciones de calidad", modulo: "inspecciones", accionInicial: "crear", ayuda: "La lista de chequeo de una partida, por elementos o por ubicación." },
  { id: "cierre_nc", nombre: "Cierre de no conformidades", modulo: "nc", accionInicial: "editar", ayuda: "Quien corrigió la envía a verificar; quien la cierra no puede ser quien corrigió." },
  { id: "vale_salida", nombre: "Vales de salida de almacén", modulo: "almacen", accionInicial: "crear", ayuda: "El material que sale del almacén a una partida y una ubicación." },
];

export const MIN_PASOS = 2;
export const MAX_PASOS = 6;

/** One step: who acts in it (a role of the company) and what it is called ("Preaprueba"). */
export interface PasoFlujo {
  nombre: string;
  rolId: string;
  /** The role's name when the document was sent (shown even if the role is renamed later). */
  rolNombre?: string;
}

/** A project's flow for one kind of document; pasos empty: not configured yet. */
export interface Flujo {
  tipo: TipoFlujo;
  pasos: PasoFlujo[];
  version: number;
  actualizado: string | null;
  actualizadoPor: string | null;
}

export interface CambioFlujo {
  tipo: TipoFlujo;
  pasos: { nombre: string; rolId: string }[];
  /** 0: the first time. */
  version: number;
}

/**
 * Where a document stands in its flow: borrador (never sent), devuelto (back with
 * whoever prepares it), en_tramite (waiting for step `paso`), aprobado, anulado.
 */
export type EstadoFlujo = "borrador" | "devuelto" | "en_tramite" | "aprobado" | "anulado";
export type AccionFlujo = "enviar" | "aprobar" | "devolver" | "anular";

/** The flow a document follows: a copy of the project's flow when it was first sent, the step it waits for and who signed each step. */
export interface FlujoDocumento {
  pasos: PasoFlujo[];
  /** The step waiting (1…pasos.length − 1); pasos.length once approved; 0 while with whoever prepares it. */
  paso: number;
  /** Who signed each step in force, by step index ("0" sent it). A return to a step removes its signature. */
  firmas: Record<string, string>;
}

/** One action of a flow, kept forever (obra_aprobaciones). */
export interface Aprobacion {
  documentoTipo: TipoFlujo;
  documentoId: string;
  accion: AccionFlujo;
  pasoDesde: number;
  pasoHasta: number;
  pasoNombre: string;
  rolNombre: string;
  actorId: string;
  actorNombre: string;
  motivo: string;
  creado: string;
}

export interface FlujosResponse {
  /** One per kind of document of the modules the license includes (pasos empty: not configured). */
  flujos: Flujo[];
  /** The company's roles (to choose the role of each step). */
  roles: Pick<Rol, "id" | "nombre" | "activo" | "permisos">[];
  /** Who holds each role in this project today. */
  personasPorRol: Record<string, string[]>;
  /** The flows suggested from the initial roles, to start from. */
  sugeridos: Partial<Record<TipoFlujo, PasoFlujo[]>>;
  puedeEditar: boolean;
}

// ---------------------------------------------------------------- API responses

export interface Persona {
  id: string;
  name: string;
}

/** Who calls, in which company, with which license and what they may do here. */
export interface EstadoResponse {
  projectId: string;
  user: Persona & { email: string };
  esAdminTecnico: boolean;
  esAdminTrimble: boolean;
  /** The company this project is registered to (null: none). */
  empresa: { id: string; nombre: string } | null;
  licencia: { estado: EstadoLicencia; hasta: string | null; diasRestantes: number | null; grupos: GrupoLicencia[]; plan: string } | null;
  adminEmpresa: boolean;
  adminProyecto: boolean;
  acceso: { rol: { id: string; nombre: string }; desde: string; hasta: string | null; permisos: Permiso[] } | null;
  /** Companies where the caller is an administrator and could register this project (unregistered project, Trimble admin). */
  puedeVincularA: { id: string; nombre: string }[];
  /** Whom to ask for an access. */
  administradores: string[];
  hoy: string;
}

export interface AccesosResponse {
  roles: Rol[];
  usuarios: UsuarioEmpresa[];
  asignaciones: Asignacion[];
  misPermisos: Permiso[];
  adminEmpresa: boolean;
  adminProyecto: boolean;
  /** Projects of the company (for the company administrator). */
  proyectos: ProyectoEmpresa[];
  licencia: { maxUsuarios: number; maxProyectos: number; usuariosActivos: number; proyectosActivos: number } | null;
  hoy: string;
}

export interface EstructuraResponse {
  /** The levels in force in this project (template plus the project's own), in order. */
  niveles: (Nivel & { heredado: boolean })[];
  /** The company's template. */
  plantilla: Nivel[];
  /** The project's own levels, also the deactivated ones. */
  propios: Nivel[];
  nodos: Nodo[];
  config: ConfigProyecto;
  puedeEditarProyecto: boolean;
  puedeEditarPlantilla: boolean;
}

export interface EmpresaResumen extends Empresa {
  licencia: Licencia | null;
  estadoLicencia: EstadoLicencia;
  proyectos: ProyectoEmpresa[];
  administradores: UsuarioEmpresa[];
  usuariosActivos: number;
}

export interface EmpresasResponse {
  empresas: EmpresaResumen[];
  hoy: string;
}
