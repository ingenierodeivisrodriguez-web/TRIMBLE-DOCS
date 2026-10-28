import type * as THREE_NS from "three";
import type { ModeloRA } from "../../lib/ra/modelo";

type Three = typeof THREE_NS;

/**
 * A prepared model as three.js meshes: one per colour batch, in the model's
 * own frame (metres, y up, relative to its origin). Pure white from the IFC
 * (no style) is shown light grey so the faces read against each other.
 */
export function construirMallas(THREE: Three, m: ModeloRA): THREE_NS.Group {
  const grupo = new THREE.Group();
  for (const l of m.lotes) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(l.posiciones, 3));
    geo.setAttribute("normal", new THREE.BufferAttribute(l.normales, 3, true));
    geo.setIndex(new THREE.BufferAttribute(l.indices, 1));
    const [r, g, b, a] = l.color;
    const blanco = r > 0.98 && g > 0.98 && b > 0.98;
    const material = new THREE.MeshLambertMaterial({
      color: blanco ? new THREE.Color(0.82, 0.83, 0.85) : new THREE.Color(r, g, b),
      transparent: a < 0.99,
      opacity: a,
      side: THREE.DoubleSide,
      depthWrite: a >= 0.99,
    });
    const malla = new THREE.Mesh(geo, material);
    malla.userData.lote = l;
    grupo.add(malla);
  }
  return grupo;
}
