import { setDefaultResultOrder } from "node:dns/promises";
import { Agent, setGlobalDispatcher } from "undici";
import osmtogeojson from "osmtogeojson";
import type { Geometry } from "geojson";
import type { BBox, GeoJSONFeatureCollection } from "../src/lib/geo.ts";
import { PRESETS, buildPresetOverpassQuery } from "../src/lib/presets.ts";
import { applyPresetSpatialFilters } from "../src/lib/spatialFilters.ts";

setDefaultResultOrder("ipv4first");
setGlobalDispatcher(new Agent({ connect: { family: 4, timeout: 30_000 } }));

const TEST_AREAS: { name: string; bbox: BBox }[] = [
  {
    name: "Great Falls VA (suburban + parkland)",
    bbox: { south: 38.990, west: -77.250, north: 39.002, east: -77.235 },
  },
];

const OVERPASS_ENDPOINT = "https://overpass-api.de/api/interpreter";
const USER_AGENT =
  "forbiddengis-tests/0.1 (testing; contact: https://github.com/bennyhartnett/forbiddengis/issues)";
const DELAY_BETWEEN_QUERIES_MS = 2000;
const RENDER_LIMIT = 5000;

interface RunOutcome {
  presetId: string;
  presetName: string;
  status: "ok" | "empty" | "error";
  httpMs: number;
  rawElements: number;
  rawFeatures: number;
  resultCount: number;
  contextCount: number;
  capped: boolean;
  warnings: string[];
  errorMessage?: string;
}

async function main(): Promise<void> {
  for (const area of TEST_AREAS) {
    console.log(`\n=== Test area: ${area.name} ===`);
    console.log(
      `bbox: south=${area.bbox.south} west=${area.bbox.west} north=${area.bbox.north} east=${area.bbox.east}`,
    );
    console.log("");
    const outcomes: RunOutcome[] = [];

    for (const preset of PRESETS) {
      const outcome = await runOnePreset(preset.id, preset.name, area.bbox);
      outcomes.push(outcome);
      printRow(outcome);
      await sleep(DELAY_BETWEEN_QUERIES_MS);
    }

    console.log("\n--- Summary ---");
    const okCount = outcomes.filter((o) => o.status === "ok").length;
    const emptyCount = outcomes.filter((o) => o.status === "empty").length;
    const errorCount = outcomes.filter((o) => o.status === "error").length;
    console.log(`OK with raw matches: ${okCount}/${outcomes.length}`);
    console.log(`Empty (query ran cleanly, no Overpass matches): ${emptyCount}/${outcomes.length}`);
    console.log(`Errors: ${errorCount}/${outcomes.length}`);

    if (errorCount > 0) {
      console.log("\nErrors:");
      for (const o of outcomes.filter((x) => x.status === "error")) {
        console.log(`  ${o.presetId} ${o.presetName}: ${o.errorMessage}`);
      }
    }

    const rawButFiltered = outcomes.filter(
      (o) => o.status === "ok" && o.resultCount === 0,
    );
    if (rawButFiltered.length > 0) {
      console.log(
        `\nRaw Overpass matches but spatial-filter dropped them all (over-strict filter or no data):`,
      );
      for (const o of rawButFiltered) {
        console.log(`  ${o.presetId} ${o.presetName}: raw=${o.rawFeatures} result=0`);
      }
    }
  }
}

async function runOnePreset(
  presetId: string,
  presetName: string,
  bbox: BBox,
): Promise<RunOutcome> {
  const preset = PRESETS.find((candidate) => candidate.id === presetId)!;
  const query = buildPresetOverpassQuery(preset, bbox, {
    includeBuildings: false,
    includeWater: false,
  });

  const httpStart = Date.now();
  try {
    const result = await runOverpassQuery(query);
    const httpMs = Date.now() - httpStart;

    const filtered = applyPresetSpatialFilters(result.features, preset, {
      includeBuildings: false,
      includeWater: false,
      renderLimit: RENDER_LIMIT,
    });

    return {
      presetId,
      presetName,
      status: result.features.length > 0 ? "ok" : "empty",
      httpMs,
      rawElements: result.elements,
      rawFeatures: result.features.length,
      resultCount: filtered.resultCount,
      contextCount: filtered.contextCount,
      capped: filtered.capped,
      warnings: filtered.warnings,
    };
  } catch (error) {
    const httpMs = Date.now() - httpStart;
    return {
      presetId,
      presetName,
      status: "error",
      httpMs,
      rawElements: 0,
      rawFeatures: 0,
      resultCount: 0,
      contextCount: 0,
      capped: false,
      warnings: [],
      errorMessage: error instanceof Error ? error.message : String(error),
    };
  }
}

interface OverpassResult {
  elements: number;
  features: GeoJSONFeatureCollection["features"];
}

async function runOverpassQuery(query: string): Promise<OverpassResult> {
  const response = await fetch(OVERPASS_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
      "User-Agent": USER_AGENT,
      Accept: "application/json",
    },
    body: new URLSearchParams({ data: query }),
  });

  if (!response.ok) {
    const message = await response.text().catch(() => "");
    throw new Error(
      `Overpass ${response.status} ${response.statusText}: ${message.slice(0, 160).replace(/\s+/g, " ").trim()}`,
    );
  }

  const data = (await response.json()) as { elements?: unknown[] };
  const converted = osmtogeojson(data) as GeoJSON.FeatureCollection<
    Geometry,
    GeoJSON.GeoJsonProperties
  >;

  return {
    elements: data.elements?.length ?? 0,
    features: converted.features as GeoJSONFeatureCollection["features"],
  };
}

function printRow(outcome: RunOutcome): void {
  const id = outcome.presetId.padEnd(11);
  const name = truncate(outcome.presetName, 56).padEnd(57);
  const status = outcome.status.padEnd(6);
  const time = `${outcome.httpMs}ms`.padStart(7);
  const raw = `raw=${outcome.rawFeatures}`.padStart(10);
  const res = `result=${outcome.resultCount}`.padStart(13);
  const ctx = `ctx=${outcome.contextCount}`.padStart(8);
  const tail = outcome.errorMessage ? `  ERR: ${truncate(outcome.errorMessage, 80)}` : "";

  console.log(`${id} ${name} ${status} ${time} ${raw} ${res} ${ctx}${tail}`);
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((error) => {
  console.error("Fatal:", error);
  process.exit(1);
});
