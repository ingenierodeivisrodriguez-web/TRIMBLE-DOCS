import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildDataset } from "../graficos/modelData";
import { camposMedibles, medidaDeUnidad, sugerirCampo, valorDe } from "./medicion";
import { CONTEO } from "./types";

// Workspace API property types: 0 length (mm), 1 area, 2 volume, 3 mass, 7 double.
const columna = (id: number, volumen: number, area: number) => ({
  id,
  class: "IfcColumn",
  properties: [
    { name: "Dimensions", properties: [{ name: "Volume", value: volumen, type: 2 }, { name: "Area", value: area, type: 1 }, { name: "Length", value: 3000, type: 0 }] },
    { name: "BaseQuantities", properties: [{ name: "NetVolume", value: volumen * 0.98, type: 2 }] },
    { name: "Pset", properties: [{ name: "Mark", value: 7, type: 7 }] },
  ],
});

describe("medición desde el modelo", () => {
  const ds = buildDataset("m", "Estructuras", [columna(1, 0.5, 4), columna(2, 0.25, 2)]);
  const campos = camposMedibles([ds]);

  it("lista las propiedades numéricas con su unidad", () => {
    const vol = campos.find((c) => c.key === "Dimensions · Volume")!;
    assert.equal(vol.unit, "m³");
    assert.equal(vol.count, 2);
    assert.equal(campos.find((c) => c.key === "Dimensions · Length")!.unit, "m");
  });

  it("sugiere la propiedad según la unidad de la partida", () => {
    assert.equal(medidaDeUnidad("M3"), "volumen");
    assert.equal(medidaDeUnidad("m²"), "area");
    assert.equal(medidaDeUnidad("ML"), "longitud");
    assert.equal(medidaDeUnidad("Und."), "conteo");
    assert.equal(medidaDeUnidad("BLS"), null);
    assert.equal(sugerirCampo("M3", campos), "BaseQuantities · NetVolume");
    assert.equal(sugerirCampo("M2", campos), "Dimensions · Area");
    assert.equal(sugerirCampo("ML", campos), "Dimensions · Length");
    assert.equal(sugerirCampo("UND", campos), CONTEO);
    assert.equal(sugerirCampo("GAL", campos), null);
  });

  it("da la cantidad de cada elemento (longitudes en metros)", () => {
    assert.equal(valorDe(ds.records[0], "Dimensions · Volume"), 0.5);
    assert.equal(valorDe(ds.records[0], "Dimensions · Length"), 3);
    assert.equal(valorDe(ds.records[1], CONTEO), 1);
    assert.equal(valorDe(ds.records[1], "Nada · X"), null);
    assert.equal(valorDe(ds.records[1], null), null);
  });
});
