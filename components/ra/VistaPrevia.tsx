"use client";

import { useEffect, useRef } from "react";
import type { ModeloRA } from "../../lib/ra/modelo";
import { liberar } from "./escena";
import { construirMallas } from "./mallas";

/**
 * A look at the prepared model before saving it: isometric view that turns
 * when dragged sideways. Only to check that the right things are in.
 */
export default function VistaPrevia({ modelo, alto = 260 }: { modelo: ModeloRA; alto?: number }) {
  const caja = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelado = false;
    let limpiar = () => {};
    (async () => {
      const THREE = await import("three");
      const el = caja.current;
      if (cancelado || !el) return;
      const ancho = el.clientWidth || 320;
      const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
      renderer.setPixelRatio(window.devicePixelRatio);
      renderer.setSize(ancho, alto);
      el.appendChild(renderer.domElement);
      const escena = new THREE.Scene();
      escena.background = new THREE.Color(0xeef1f5);
      escena.add(new THREE.AmbientLight(0xffffff, 1.6));
      const sol = new THREE.DirectionalLight(0xffffff, 1.6);
      sol.position.set(1, 2, 1.5);
      escena.add(sol);
      const mallas = construirMallas(THREE, modelo);
      escena.add(mallas);

      const centro = new THREE.Vector3((modelo.min[0] + modelo.max[0]) / 2, (modelo.min[1] + modelo.max[1]) / 2, (modelo.min[2] + modelo.max[2]) / 2);
      const radio = Math.max(1, new THREE.Vector3(...modelo.max).sub(new THREE.Vector3(...modelo.min)).length() / 2);
      const camara = new THREE.PerspectiveCamera(40, ancho / alto, radio / 100, radio * 20);
      let angulo = Math.PI / 4;
      const pintar = () => {
        const d = radio * 2.6;
        camara.position.set(centro.x + d * Math.cos(angulo), centro.y + d * 0.7, centro.z + d * Math.sin(angulo));
        camara.lookAt(centro);
        renderer.render(escena, camara);
      };
      pintar();

      let arrastre: number | null = null;
      const abajo = (e: PointerEvent) => (arrastre = e.clientX);
      const mover = (e: PointerEvent) => {
        if (arrastre === null) return;
        angulo += (e.clientX - arrastre) * 0.01;
        arrastre = e.clientX;
        pintar();
      };
      const arriba = () => (arrastre = null);
      renderer.domElement.addEventListener("pointerdown", abajo);
      window.addEventListener("pointermove", mover);
      window.addEventListener("pointerup", arriba);
      limpiar = () => {
        window.removeEventListener("pointermove", mover);
        window.removeEventListener("pointerup", arriba);
        liberar(escena);
        renderer.dispose();
        renderer.domElement.remove();
      };
    })();
    return () => {
      cancelado = true;
      limpiar();
    };
  }, [modelo, alto]);

  return <div ref={caja} title="Arrastre a los lados para girar" style={{ width: "100%", height: alto, borderRadius: 6, overflow: "hidden", cursor: "grab", background: "#eef1f5" }} />;
}
