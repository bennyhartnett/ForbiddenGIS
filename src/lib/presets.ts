import type { BBox, PresetDefinition, PresetId } from "./geo";
import { bboxToOverpass } from "./geo";

export interface PresetQueryOptions {
  includeBuildings: boolean;
  includeWater: boolean;
}

export const PRESETS: PresetDefinition[] = [
  {
    id: "road-adjacent-parking",
    name: "Road-adjacent parking",
    description: "Parking features within 80 m of drivable roads.",
    minZoom: 14,
    heavy: true,
    supportsBuildings: true,
    supportsWater: false,
  },
  {
    id: "trail-path-access",
    name: "Trail/path access",
    description: "Paths, tracks, and footways near roads or parking.",
    minZoom: 14,
    heavy: true,
    supportsBuildings: true,
    supportsWater: true,
  },
  {
    id: "road-to-road-walking-trail",
    name: "Road-to-road walking trail",
    description: "Pedestrian ways whose endpoints approach roads.",
    minZoom: 15,
    heavy: true,
    supportsBuildings: true,
    supportsWater: true,
  },
  {
    id: "bridges-overpasses",
    name: "Bridges/overpasses",
    description: "Bridge-tagged features and mapped bridge structures.",
    minZoom: 14,
    heavy: true,
    supportsBuildings: false,
    supportsWater: true,
  },
  {
    id: "water-crossing-context",
    name: "Water crossing context",
    description: "Bridge and culvert candidates with nearby water features.",
    minZoom: 14,
    heavy: true,
    supportsBuildings: false,
    supportsWater: true,
  },
];

export function getPresetById(id: PresetId): PresetDefinition {
  const preset = PRESETS.find((candidate) => candidate.id === id);
  if (!preset) {
    throw new Error(`Unknown preset: ${id}`);
  }
  return preset;
}

export function buildPresetOverpassQuery(
  preset: PresetDefinition,
  bbox: BBox,
  options: PresetQueryOptions,
): string {
  const bboxText = bboxToOverpass(bbox);
  const clauses = presetClauses(preset.id, bboxText);

  if (options.includeBuildings && preset.supportsBuildings) {
    clauses.push(...buildingClauses(bboxText));
  }

  if (options.includeWater && preset.supportsWater) {
    clauses.push(...waterClauses(bboxText));
  }

  return `[out:json][timeout:25];
(
${clauses.map((clause) => `  ${clause}`).join("\n")}
);
out body;
>;
out skel qt;`;
}

function presetClauses(presetId: PresetId, bbox: string): string[] {
  switch (presetId) {
    case "road-adjacent-parking":
      return [
        `node["amenity"="parking"](${bbox});`,
        `way["amenity"="parking"](${bbox});`,
        `relation["amenity"="parking"](${bbox});`,
        `node["parking"](${bbox});`,
        `way["parking"](${bbox});`,
        `relation["parking"](${bbox});`,
        ...roadClauses(bbox),
      ];
    case "trail-path-access":
      return [
        ...trailClauses(bbox),
        `node["amenity"="parking"](${bbox});`,
        `way["amenity"="parking"](${bbox});`,
        `relation["amenity"="parking"](${bbox});`,
        ...roadClauses(bbox),
      ];
    case "road-to-road-walking-trail":
      return [...trailClauses(bbox), ...roadClauses(bbox)];
    case "bridges-overpasses":
      return [
        `way["bridge"](${bbox});`,
        `relation["bridge"](${bbox});`,
        `node["man_made"="bridge"](${bbox});`,
        `way["man_made"="bridge"](${bbox});`,
        `relation["man_made"="bridge"](${bbox});`,
      ];
    case "water-crossing-context":
      return [
        `way["bridge"](${bbox});`,
        `relation["bridge"](${bbox});`,
        `way["tunnel"="culvert"](${bbox});`,
        `relation["tunnel"="culvert"](${bbox});`,
        `way["man_made"="bridge"](${bbox});`,
        `relation["man_made"="bridge"](${bbox});`,
        ...waterClauses(bbox),
      ];
  }
}

function roadClauses(bbox: string): string[] {
  return [
    `way["highway"~"^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|service|living_street|track)$"](${bbox});`,
  ];
}

function trailClauses(bbox: string): string[] {
  return [
    `way["highway"~"^(path|footway|bridleway|cycleway|track|steps|pedestrian)$"](${bbox});`,
    `relation["route"="hiking"](${bbox});`,
  ];
}

function buildingClauses(bbox: string): string[] {
  return [
    `way["building"](${bbox});`,
    `relation["building"](${bbox});`,
  ];
}

function waterClauses(bbox: string): string[] {
  return [
    `way["waterway"](${bbox});`,
    `relation["waterway"](${bbox});`,
    `way["natural"="water"](${bbox});`,
    `relation["natural"="water"](${bbox});`,
    `way["water"](${bbox});`,
    `relation["water"](${bbox});`,
  ];
}
