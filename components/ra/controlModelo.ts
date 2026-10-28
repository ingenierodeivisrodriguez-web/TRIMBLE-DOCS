import type * as THREE_NS from "three";
import { EstadoHerramientas, opacidad, PALETA, planosActivos, rangosVertices } from "../../lib/ra/herramientas";
import { elementoDeTriangulo, LoteRA, ModeloRA } from "../../lib/ra/modelo";
import { construirMallas } from "./mallas";

type Three = typeof THREE_NS;

export interface ControlModelo {
  /** Put this in the scene; move/turn it to place the model. */
  raiz: THREE_NS.Group;
  /** Cuts and transparency; call again after moving `raiz` (the cuts follow it). */
  aplicar(e: EstadoHerramientas): void;
  /** Colours one element (PALETA index), or gives it back its own colour (null). */
  colorear(elemento: number, color: number | null): void;
  quitarColores(): void;
  /** The element under a ray (world frame), skipping what the cuts hide; -1 if none. */
  tocar(origen: THREE_NS.Vector3, direccion: THREE_NS.Vector3): number;
}

/**
 * The placed model and its tools (phase 4), the same in AR and in a plain 3D
 * view: cuts are clipping planes (the renderer needs localClippingEnabled),
 * transparency lowers every batch's opacity, colours go per vertex and only
 * live in this session (owner's decision).
 */
export function controlModelo(THREE: Three, m: ModeloRA): ControlModelo {
  const raiz = new THREE.Group();
  const mallas = construirMallas(THREE, m);
  raiz.add(mallas);
  const lista = mallas.children as THREE_NS.Mesh[];
  // One array shared by every material: changing its planes changes all of them.
  const planosMundo: THREE_NS.Plane[] = [];
  for (const malla of lista) (malla.material as THREE_NS.Material).clippingPlanes = planosMundo;
  const coloreados = new Set<number>();
  const rayo = new THREE.Raycaster();

  function pintar(elemento: number, rgb: [number, number, number] | null) {
    for (const malla of lista) {
      const lote = malla.userData.lote as LoteRA;
      const rangos = rangosVertices(lote, elemento);
      if (!rangos.length) continue;
      const attr = malla.geometry.getAttribute("color") as THREE_NS.BufferAttribute;
      const c = rgb ?? (malla.userData.base as [number, number, number]);
      for (const [desde, hasta] of rangos) for (let v = desde; v < hasta; v++) attr.setXYZ(v, c[0], c[1], c[2]);
      attr.needsUpdate = true;
    }
  }

  return {
    raiz,
    aplicar(e) {
      raiz.updateMatrixWorld(true);
      planosMundo.length = 0;
      for (const p of planosActivos(e, m.origen)) {
        const plano = new THREE.Plane(new THREE.Vector3(...p.normal), p.constante);
        planosMundo.push(plano.applyMatrix4(raiz.matrixWorld));
      }
      for (const malla of lista) {
        const material = malla.material as THREE_NS.MeshLambertMaterial;
        const base = malla.userData.opacidad as number;
        const o = opacidad(base, e.transparencia);
        const transparente = o < 0.99;
        if (material.transparent !== transparente) material.needsUpdate = true;
        material.opacity = o;
        material.transparent = transparente;
        material.depthWrite = !transparente;
      }
    },
    colorear(elemento, color) {
      if (elemento < 0) return;
      if (color === null) {
        coloreados.delete(elemento);
        pintar(elemento, null);
      } else {
        coloreados.add(elemento);
        pintar(elemento, PALETA[color].rgb);
      }
    },
    quitarColores() {
      for (const el of coloreados) pintar(el, null);
      coloreados.clear();
    },
    tocar(origen, direccion) {
      if (!raiz.visible) return -1;
      rayo.set(origen, direccion.clone().normalize());
      for (const hit of rayo.intersectObjects(lista, false)) {
        if (planosMundo.some((p) => p.distanceToPoint(hit.point) < 0)) continue;
        const lote = (hit.object as THREE_NS.Mesh).userData.lote as LoteRA;
        if (hit.faceIndex === undefined || hit.faceIndex === null) continue;
        return elementoDeTriangulo(lote, hit.faceIndex);
      }
      return -1;
    },
  };
}
