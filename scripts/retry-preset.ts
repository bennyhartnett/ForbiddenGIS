import { setDefaultResultOrder } from "node:dns/promises";
import { Agent, setGlobalDispatcher, fetch } from "undici";
import { PRESETS, buildPresetOverpassQuery } from "../src/lib/presets.ts";

setDefaultResultOrder("ipv4first");
setGlobalDispatcher(new Agent({ connect: { family: 4, timeout: 30_000 } }));

const presetId = process.argv[2] ?? "preset-20";
const preset = PRESETS.find((candidate) => candidate.id === presetId);
if (!preset) {
  throw new Error(`Unknown preset: ${presetId}`);
}

const bbox = { south: 38.99, west: -77.25, north: 39.002, east: -77.235 };
const query = buildPresetOverpassQuery(preset, bbox, {
  includeBuildings: false,
  includeWater: false,
});

const start = Date.now();
const response = await fetch("https://overpass-api.de/api/interpreter", {
  method: "POST",
  headers: {
    "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
    "User-Agent": "overpass-scout-view-tests/0.1",
    Accept: "application/json",
  },
  body: new URLSearchParams({ data: query }),
});

console.log(`${preset.id} ${preset.name}: status ${response.status} in ${Date.now() - start} ms`);
const text = await response.text();
if (response.ok) {
  const json = JSON.parse(text) as { elements?: unknown[] };
  console.log(`Overpass elements: ${json.elements?.length ?? 0}`);
} else {
  console.log(text.slice(0, 200).replace(/\s+/g, " "));
}
