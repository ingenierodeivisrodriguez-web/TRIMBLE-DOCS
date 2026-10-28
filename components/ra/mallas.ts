import type * as THREE_NS from "three";
import { colorBase } from "../../lib/ra/herramientas";
import type { ModeloRA } from "../../lib/ra/modelo";

type Three = typeof THREE_NS;

/**
 * A prepared model as three.js meshes: one per colour batch, in the model's
 * own frame (metres, y up, relative to its origin). The colour goes per vertex
 * so single elements can be coloured by hand (phase 4); pure white from the
 * IFC (no style) is shown light grey so the faces read against each other.
 */
export function construirMallas(THREE: Three, m: ModeloRA): THREE_NS.Group {
  const grupo = new THREE.Group();
  for (const l of m.lotes) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(l.posiciones, 3));
    geo.setAttribute("normal", new THREE.BufferAttribute(l.normales, 3, true));
    geo.setIndex(new THREE.BufferAttribute(l.indices, 1));
    const base = colorBase(l.color);
    const colores = new Float32Array(l.posiciones.length);
    for (let i = 0; i < colores.length; i += 3) colores.set(base, i);
    geo.setAttribute("color", new THREE.BufferAttribute(colores, 3));
    const a = l.color[3];
    const material = new THREE.MeshLambertMaterial({
      vertexColors: true,
      transparent: a < 0.99,
      opacity: a,
      side: THREE.DoubleSide,
      depthWrite: a >= 0.99,
    });
    const malla = new THREE.Mesh(geo, material);
    malla.userData.lote = l;
    malla.userData.base = base;
    malla.userData.opacidad = a;
    grupo.add(malla);
  }
  return grupo;
}
