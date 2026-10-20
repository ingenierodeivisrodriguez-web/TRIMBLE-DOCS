# Flujo de desarrollo, verificación y despliegue

## Contenido
1. Verificaciones
2. Probar la interfaz con una API falsa
3. Manejar el navegador del panel
4. Probar el SQL
5. Confirmar, subir y esperar el despliegue
6. Trucos del entorno (Windows + Git Bash)
7. Lista final antes de responder

## 1. Verificaciones

```bash
npm test                 # tsx --test lib/**/*.test.ts (≈610 pruebas)
npx tsc --noEmit -p .    # tipos
npx next build           # build de producción (salida larga: mándala a un archivo del scratchpad)
```

- Pruebas por archivo: `npx tsx --test lib/presupuesto/calc.test.ts`.
- Si cambias un texto de instrucciones de la IA, sube su `VERSION_PROMPT_*` y la
  prueba que lo verifica (`apu-chat.test.ts`, `ia.test.ts`, `programa.test.ts`).
- Si renombras algo usado en muchos archivos, `grep -rl` + `sed -i 's/\bviejo\b/nuevo/g'`
  y luego `tsc`.

## 2. Probar la interfaz con una API falsa

Las páginas reales solo funcionan dentro de Trimble Connect. Para ver un cambio de
interfaz se crea una página **temporal** que monta `PresupuestoApp` con una
`PresupuestoApi` falsa. Plantilla lista en `assets/dev-preview-page.tsx`: cópiala a
`app/dev-preview-<tema>/page.tsx` y ajusta el documento y el catálogo al caso.

1. `preview_start` con la configuración `resumen-archivos-dev` (`.claude/launch.json`,
   `npm run dev`, puerto 3000) y navega a `http://localhost:3000/dev-preview-<tema>`.
2. Espera unos 4 s a que cargue; verifica con `get_page_text`, `javascript_tool`
   (lectura, no para cambiar la interfaz) y `read_console_messages`.
3. Para las capturas, `resize_window` 1300×800 y al final `preset: "desktop"`.
4. Al terminar: `preview_stop`, **borra la página** (`rm -rf app/dev-preview-<tema>`)
   y `rm -rf .next/dev` (si no, quedan tipos viejos que rompen `tsc`). Nunca la
   confirmes en git.

La API falsa solo necesita lo que la pantalla llama al cargar: `getEstado`,
`getCatalogo`, `getDocumento`, `getResumen`, `elementosDe`, `tomarVista`,
`getAtributos`; lo demás puede rechazar (`no`) o guardar las llamadas en
`window.__calls` para revisarlas.

**Compras** usa otra receta (`assets/dev-preview-compras.tsx`): la página monta
`ComprasApp` con una `ComprasApi` que llama al **servicio real** sobre
`memoryStore()` y el Trimble falso de `lib/compras/pruebas/trimbleFalso.ts`, y
siembra los datos con el mismo servicio (activar, usuarios con roles,
requisición, cotización, comparativo, orden, recepción). Así se prueban las
reglas de verdad en el navegador. Consecuencias:

- El servicio no puede importar módulos solo de Node (`node:crypto`…): usa Web
  Crypto (`globalThis.crypto.subtle`), que sirve en los dos lados.
- Cada vez que editas un archivo de `lib/` con la página abierta, la recarga en
  caliente **vuelve a crear la memoria**: recarga la página y vuelve a sembrar.
- La página expone `window.apiFalsa` y `window.trimbleFalso` para crear casos y
  revisar qué quedó en las "carpetas" de Trimble desde `javascript_tool`.
- El envío directo del archivo a la URL firmada falsa falla en el navegador
  (`ERR_NAME_NOT_RESOLVED`) y la subida pasa por el servidor: es lo esperado.

## 3. Manejar el navegador del panel

- La grilla del presupuesto selecciona la fila en `mousedown`: para elegir una
  partida por script, dispara `pointerdown`, `mousedown`, `pointerup`, `mouseup`,
  `click` sobre la celda y sube por sus padres hasta que aparezca el análisis.
- `NumInput` guarda con Enter o al salir: para escribir usa `find` (ref) +
  `triple_click` + `type` + `key Return/Tab`. Poner solo `value` por JavaScript
  no dispara el guardado; si la ventana está oculta y no hay clics, sí funciona
  esto: `el.focus()` + evento `focusin`, el *setter* nativo
  (`Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set`),
  evento `input` y luego `el.blur()` + evento `focusout`.
- Con ventanas superpuestas (un diálogo de motivo encima de otro), busca el botón
  dentro del `[role=dialog]` que contiene el texto del diálogo de encima; si no,
  pulsas el botón del diálogo de abajo.
- Para probar una descarga (Excel), reemplaza por un momento
  `URL.createObjectURL` y `HTMLAnchorElement.prototype.click` para capturar el
  nombre y el tamaño del archivo sin descargarlo.
- Clics por coordenadas solo después de una captura nueva; si la ventana está
  oculta, las coordenadas fallan: usa refs.
- Los mensajes de consola persisten entre recargas: para saber si un aviso es
  nuevo, cuenta los mensajes antes y después de repetir la acción.

## 4. Probar el SQL

`supabase/presupuesto.sql` debe poder ejecutarse **dos veces seguidas** sin error
(`create … if not exists`, `create or replace`, columnas con `add column if not
exists`). `scripts/probar-sql.mjs` lo comprueba con PGlite (Postgres en memoria):

```bash
mkdir -p <scratchpad>/pg && cd <scratchpad>/pg && npm init -y >/dev/null && npm i @electric-sql/pglite
cp <skill>/scripts/probar-sql.mjs <scratchpad>/pg/     # Node busca el paquete junto al script
node <scratchpad>/pg/probar-sql.mjs "<repo>/supabase/presupuesto.sql"
```

Agrega al final del script las consultas que prueban tu función nueva. Después,
recuerda al dueño ejecutar el SQL en el SQL Editor de Supabase.

Para `supabase/compras.sql` hay un script por fase que además siembra y
comprueba cada regla, incluidas escrituras directas a las tablas para ver
disparar los triggers diferidos (receta en `compras.md`, sección 11).

Al unir SQL nuevo a un archivo existente con un script, **no uses
`String.replace`**: interpreta `$$` del texto de reemplazo y rompe los cuerpos
`$$ … $$` de las funciones. Usa `s.split(ancla).join(nuevo)`.

## 5. Confirmar, subir y esperar el despliegue

- Rama `main`, sin ramas de funcionalidad (así se ha trabajado). Mensaje en
  español: título "Área: qué cambió (y para qué)" y viñetas con lo que nota el
  usuario y los cambios de comportamiento. Termina con la línea de coautoría que
  indique el sistema.
- `git push` → Vercel despliega solo. Espera el estado en segundo plano con
  `scripts/esperar-despliegue.sh` (consulta la API de GitHub cada 15 s, hasta 10
  min) y avisa al dueño cuando salga `deploy success` para que recargue la pestaña
  de Trimble Connect.
- Si el despliegue falla, mira los registros con las herramientas de Vercel antes
  de cambiar nada.

## 6. Trucos del entorno (Windows + Git Bash)

- Ediciones de varias líneas con apóstrofes o comillas: no uses `node -e` ni
  heredocs con comillas mezcladas. Escribe un script `.cjs` en el scratchpad con la
  herramienta Write (patrón: leer, `replace` por anclas exactas que **fallan si no
  aparecen exactamente una vez**, escribir) y ejecútalo con `node script.cjs "$(pwd)"`.
- Para cambios puntuales, la herramienta Edit es lo más seguro. `sed` con
  expresiones regulares complejas ya rompió una línea (un `.` coincidió con un
  apóstrofe).
- Rutas del scratchpad: siempre absolutas.
- `rm -rf .next/dev` falla si el servidor de desarrollo sigue corriendo: detenlo
  antes.
- `npm run build` imprime mucho: redirige a un archivo y lee solo el final.
- **No ejecutes `prettier`**: el repo no tiene configuración y lo reformatea todo
  a 80 columnas, distinto del estilo del código (líneas largas). Formatea a mano
  como el código vecino.
- `node -e '…'` con textos en español falla en cuanto aparece un apóstrofo
  ("isn't", "there's"): bash corta la cadena y puede intentar ejecutar el resto.
  Para cualquier texto largo, escribe primero el archivo con Write.
- El README repite títulos entre extensiones ("### Esquema de la base de
  datos", "### API"…): las anclas de los scripts deben incluir la línea
  siguiente para ser únicas.
- El scratchpad se borra entre sesiones: los scripts de PGlite por fase de
  Compras hay que rehacerlos (la receta está en `compras.md`).

## 7. Lista final antes de responder

- [ ] Pruebas, tipos y build pasan (y dices cuántas pruebas).
- [ ] Probado en el navegador si cambió algo visible (con lo que se vio).
- [ ] Página temporal borrada; `git status` limpio salvo lo intencional.
- [ ] README actualizado.
- [ ] Subido y desplegado (o explicado por qué no).
- [ ] Avisos al dueño: SQL a re-ejecutar, datos existentes que cambian, límites.
