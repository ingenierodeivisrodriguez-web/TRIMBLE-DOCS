import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { pickRegion, RegionInfo } from "./trimbleApi";

// Shape of the real (public) GET /regions response, trimmed.
const regions: RegionInfo[] = [
  {
    isMaster: true,
    location: "northAmerica",
    serviceRegion: "na",
    trnRegion: "us",
    awsRegion: "us-east-1",
    region: "us",
    "tc-api": "https://app.connect.trimble.com/tc/api/2.0/",
    "pset-api": "https://pset-api.us-east-1.connect.trimble.com/v1/",
  },
  {
    isMaster: false,
    location: "europe",
    serviceRegion: "eu",
    trnRegion: "eu",
    awsRegion: "eu-west-1",
    region: "eu",
    "tc-api": "https://app21.connect.trimble.com/tc/api/2.0/",
    "pset-api": "https://pset-api.eu-west-1.connect.trimble.com/v1/",
  },
];

describe("pickRegion", () => {
  it("matches the project's location", () => {
    assert.equal(pickRegion(regions, "europe")?.region, "eu");
  });

  it("matches any name the region goes by, ignoring case", () => {
    assert.equal(pickRegion(regions, "EU")?.region, "eu");
    assert.equal(pickRegion(regions, "eu-west-1")?.region, "eu");
    assert.equal(pickRegion(regions, "NorthAmerica")?.region, "us");
  });

  it("falls back to the master region when the location is missing or unknown", () => {
    assert.equal(pickRegion(regions, undefined)?.region, "us");
    assert.equal(pickRegion(regions, "somewhere")?.region, "us");
  });
});
