import type * as THREE_NS from "three";
import { aristasCaja, cuadriculaPiso, Medidas, Punto } from "../../lib/ra/volumen";

type Three = typeof THREE_NS;

/** Edges and floor lines in yellow (seen well against concrete), faces in translucent blue. */
const COLOR_ARISTAS = 0xffd400;
const COLOR_CARAS = 0x2f55b0;
const COLOR_FRENTE = 0xff5a1f;

function lineas(THREE: Three, pares: [Punto, Punto][], color: number): THREE_NS.LineSegments {
  const pos = new Float32Array(pares.length * 6);
  pares.forEach(([a, b], i) => pos.set([a.x, a.y, a.z, b.x, b.y, b.z], i * 6));
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  return new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color }));
}

/**
 * The test volume as a three.js group, local frame of lib/ra/volumen.ts: origin at
 * the centre of the base, front to +z, marked by an arrow on the floor.
 */
export function construirVolumen(THREE: Three, m: Medidas): THREE_NS.Group {
  const grupo = new THREE.Group();

  const caja = new THREE.BoxGeometry(m.ancho, m.alto, m.largo);
  caja.translate(0, m.alto / 2, 0);
  const caras = new THREE.Mesh(
    caja,
    new THREE.MeshBasicMaterial({ color: COLOR_CARAS, transparent: true, opacity: 0.18, side: THREE.DoubleSide, depthWrite: false })
  );
  grupo.add(caras);
  grupo.add(lineas(THREE, aristasCaja(m), COLOR_ARISTAS));
  grupo.add(lineas(THREE, cuadriculaPiso(m), COLOR_ARISTAS));

  // Arrow just outside the front face, 1 cm above the floor so it does not flicker.
  const flecha = new THREE.Shape();
  flecha.moveTo(-0.25, 0);
  flecha.lineTo(0.25, 0);
  flecha.lineTo(0, 0.4);
  flecha.lineTo(-0.25, 0);
  const geoFlecha = new THREE.ShapeGeometry(flecha);
  geoFlecha.rotateX(Math.PI / 2);
  geoFlecha.translate(0, 0.01, m.largo / 2 + 0.15);
  grupo.add(new THREE.Mesh(geoFlecha, new THREE.MeshBasicMaterial({ color: COLOR_FRENTE, side: THREE.DoubleSide })));

  // Small cross at the anchor point (centre of the base).
  grupo.add(
    lineas(
      THREE,
      [
        [{ x: -0.2, y: 0.01, z: 0 }, { x: 0.2, y: 0.01, z: 0 }],
        [{ x: 0, y: 0.01, z: -0.2 }, { x: 0, y: 0.01, z: 0.2 }],
      ],
      COLOR_FRENTE
    )
  );
  return grupo;
}

/** Ring that follows the floor where the phone points, before placing the volume. */
export function construirMira(THREE: Three): THREE_NS.Mesh {
  const geo = new THREE.RingGeometry(0.12, 0.16, 40);
  geo.rotateX(-Math.PI / 2);
  const mira = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: COLOR_ARISTAS }));
  mira.matrixAutoUpdate = false;
  mira.visible = false;
  return mira;
}

/** Frees the GPU memory of everything under `raiz`. */
export function liberar(raiz: THREE_NS.Object3D): void {
  raiz.traverse((o) => {
    const malla = o as THREE_NS.Mesh;
    malla.geometry?.dispose();
    const mat = malla.material as THREE_NS.Material | THREE_NS.Material[] | undefined;
    if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
    else mat?.dispose();
  });
}
