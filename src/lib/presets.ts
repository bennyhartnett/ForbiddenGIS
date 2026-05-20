import type { BBox, PresetDefinition, PresetId } from "./geo";
import { bboxToOverpass } from "./geo";

export interface PresetQueryOptions {
  includeBuildings: boolean;
  includeWater: boolean;
  bufferScale?: number;
}

export const PRESETS: PresetDefinition[] = [
  preset("preset-dirt-roads", "Dirt roads", "Roads with explicit dirt, earth, ground, or mud surfaces.", 14, false, false, false),
  preset("preset-alleys", "Alleys", "Service alleys (highway=service, service=alley) and explicit alley ways.", 14, false, false, false),
  preset("preset-01", "Off-Roading Legal", "Public-ish tracks and rough roads without private/no access tags.", 14, true, true, false),
  preset("preset-02", "Off-Roading Private", "Tracks, rough roads, and service ways that are tagged restricted or private.", 14, true, true, false),
  preset("preset-03", "Golf Cart Permitted Public and Private", "Roads, paths, and tracks with golf cart or low-speed vehicle tags.", 14, true, true, false),
  preset("preset-04", "Secluded Parking Public", "Public-ish parking away from mapped buildings.", 14, true, true, false),
  preset("preset-05", "Water Adjacent Roads", "Roads and tracks near mapped water features.", 14, true, false, true),
  preset("preset-06", "Bridges", "Bridge-tagged features and mapped bridge structures.", 14, true, false, true),
  preset("preset-07", "Cul de sacs and dead ends with no buildings within 100 feet", "Explicit or inferred dead-end roads away from mapped buildings.", 15, true, true, false),
  preset("preset-08", "Water accessible by road", "Public-ish roads, parking, and water features that appear close together.", 14, true, false, true),
  preset("preset-09", "roads you can park on", "Roads with explicit OSM street-parking tags.", 14, true, false, false),
  preset("preset-10", "roads you can park on with no buildings within 100 feet", "Street-parking roads away from mapped buildings.", 14, true, true, false),
  preset("preset-11", "Road-to-road dead ends connected by walking trail", "Walking trails that appear to connect dead ends or road endpoints.", 15, true, true, false),
  preset("preset-12", "25 mile an hour roads with no buildings for 100 feet", "25 mph roads away from mapped buildings.", 14, true, true, false),
  preset("preset-13", "25 mile an hour roads lined by trees for 100 feet", "25 mph roads with tree-lined tags or nearby tree context.", 14, true, true, false),
  preset("preset-14", "Low-speed roads with shoulders and no buildings nearby", "Low-speed shouldered roads with no mapped buildings nearby.", 14, true, true, false),
  preset("preset-15", "Unpaved public roads with no buildings nearby", "Public-ish unpaved roads/tracks away from mapped buildings.", 14, true, true, false),
  preset("preset-16", "Rough roads / high-clearance roads", "Rough roads and tracks with high-clearance indicators.", 14, true, false, false),
  preset("preset-17", "Public roads ending at water", "Public-ish road endpoints near mapped water.", 14, true, false, true),
  preset("preset-18", "Dead-end roads near woods with no buildings nearby", "Dead ends near woods/forest and away from mapped buildings.", 15, true, true, false),
  preset("preset-19", "Tree-covered parking or pull-off areas", "Parking lots, laybys, rest areas, or pull-offs near tree cover.", 14, true, false, false),
  preset("preset-20", "Roadside pull-offs / laybys", "Explicit laybys, rest areas, services, and roadside parking tags.", 14, true, false, false),
  preset("preset-21", "Roads with legal street parking near water", "Roads with explicit street parking tags near water.", 14, true, false, true),
  preset("preset-22", "Roads with legal street parking near parks/woods", "Street-parking roads near parks, woods, forests, or protected areas.", 14, true, false, false),
  preset("preset-23", "Bridges with nearby pull-offs", "Bridges within 100 m of parking, laybys, rest areas, or pull-offs.", 14, true, false, false),
  preset("preset-24", "Fords / water crossings", "Ford-tagged roads, paths, and water crossings.", 14, true, false, true),
  preset("preset-25", "Gated roads and barriers", "Gates, chains, bollards, blocks, and restricted road access tags.", 14, true, false, false),
  preset("preset-26", "Public trailheads with parking", "Trailheads or trails within 100 m of public-ish parking.", 14, true, false, false),
  preset("preset-27", "Walking paths from parking to water", "Pedestrian paths that appear to connect parking toward water.", 15, true, false, true),
  preset("preset-28", "Walking paths from dead-end roads to water", "Walking paths near road dead ends and water.", 15, true, true, true),
  preset("preset-29", "Unlit secluded roads", "Roads tagged unlit or limited lighting and away from mapped buildings.", 14, true, true, false),
  preset("preset-30", "No-sidewalk quiet roads", "Low-speed/quiet roads with no sidewalk tags and low building proximity.", 14, true, true, false),
  preset("preset-31", "Pedestrian cut-throughs between neighborhoods", "Walking paths whose ends are near different road segments.", 15, true, false, false),
  preset("preset-32", "Named trails that cross roads", "Named walking/hiking trails that cross or meet roads.", 14, true, false, false),
  preset("preset-33", "Industrial dead ends", "Dead ends and service roads in or near industrial landuse.", 14, true, false, false),
  preset("preset-34", "Roads with low speed + tree-lined + no buildings nearby", "Low-speed tree-lined roads with no mapped buildings nearby.", 14, true, true, false),
  preset("preset-35", "Train tracks without fence", "Railway tracks (rail, light rail, narrow gauge, tram, monorail, subway) with no mapped fence or wall within 30 m.", 14, true, false, false),
];

export function getPresetById(id: PresetId): PresetDefinition {
  const presetDefinition = PRESETS.find((candidate) => candidate.id === id);
  if (!presetDefinition) {
    throw new Error(`Unknown preset: ${id}`);
  }
  return presetDefinition;
}

export function buildPresetOverpassQuery(
  presetDefinition: PresetDefinition,
  bbox: BBox,
  options: PresetQueryOptions,
): string {
  const scale = Math.max(0.25, Math.min(3, options.bufferScale ?? 1));
  const boxes = {
    bbox: bboxToOverpass(bbox),
    bbox100ft: bboxToOverpass(expandBBox(bbox, 30.48 * scale)),
    bbox60m: bboxToOverpass(expandBBox(bbox, 60 * scale)),
    bbox100m: bboxToOverpass(expandBBox(bbox, 100 * scale)),
  };
  const clauses = presetClauses(presetDefinition.id, boxes);

  if (options.includeBuildings && presetDefinition.supportsBuildings) {
    clauses.push(...buildingClauses(boxes.bbox100ft));
  }

  if (options.includeWater && presetDefinition.supportsWater) {
    clauses.push(...waterClauses(boxes.bbox60m));
  }

  return `[out:json][timeout:25];
(
${dedupeClauses(clauses).map((clause) => `  ${clause}`).join("\n")}
);
out body;
>;
out skel qt;`;
}

function preset(
  id: PresetId,
  name: string,
  description: string,
  minZoom: number,
  heavy: boolean,
  supportsBuildings: boolean,
  supportsWater: boolean,
): PresetDefinition {
  return { id, name, description, minZoom, heavy, supportsBuildings, supportsWater };
}

function presetClauses(
  presetId: PresetId,
  boxes: { bbox: string; bbox100ft: string; bbox60m: string; bbox100m: string },
): string[] {
  switch (presetId) {
    case "preset-dirt-roads":
      return dirtRoadClauses(boxes.bbox);
    case "preset-alleys":
      return alleyClauses(boxes.bbox);
    case "preset-01":
      return [...roughRoadClauses(boxes.bbox), ...unpavedRoadClauses(boxes.bbox), ...buildingClauses(boxes.bbox100ft)];
    case "preset-02":
      return [...roughRoadClauses(boxes.bbox), ...restrictedRoadClauses(boxes.bbox), ...buildingClauses(boxes.bbox100ft)];
    case "preset-03":
      return [
        `way["golf_cart"](${boxes.bbox});`,
        `way["vehicle:golf_cart"](${boxes.bbox});`,
        `way["low_speed_vehicle"](${boxes.bbox});`,
        `way["highway"]["golf_cart"](${boxes.bbox});`,
      ];
    case "preset-04":
      return [...parkingClauses(boxes.bbox), ...buildingClauses(boxes.bbox100ft)];
    case "preset-05":
      return [...roadClauses(boxes.bbox), ...waterClauses(boxes.bbox60m)];
    case "preset-06":
      return bridgeClauses(boxes.bbox);
    case "preset-07":
      return [...deadEndClauses(boxes.bbox), ...roadClauses(boxes.bbox), ...buildingClauses(boxes.bbox100ft)];
    case "preset-08":
      return [...roadClauses(boxes.bbox), ...parkingClauses(boxes.bbox), ...waterClauses(boxes.bbox60m)];
    case "preset-09":
      return streetParkingClauses(boxes.bbox);
    case "preset-10":
      return [...streetParkingClauses(boxes.bbox), ...buildingClauses(boxes.bbox100ft)];
    case "preset-11":
      return [...deadEndClauses(boxes.bbox), ...trailClauses(boxes.bbox100m), ...roadClauses(boxes.bbox60m)];
    case "preset-12":
      return [...lowSpeedClauses(boxes.bbox), ...buildingClauses(boxes.bbox100ft)];
    case "preset-13":
      return [...lowSpeedClauses(boxes.bbox), ...treeClauses(boxes.bbox60m), ...buildingClauses(boxes.bbox100ft)];
    case "preset-14":
      return [...lowSpeedClauses(boxes.bbox), ...shoulderClauses(boxes.bbox), ...buildingClauses(boxes.bbox100ft)];
    case "preset-15":
      return [...unpavedRoadClauses(boxes.bbox), ...buildingClauses(boxes.bbox100ft)];
    case "preset-16":
      return roughRoadClauses(boxes.bbox);
    case "preset-17":
      return [...publicRoadClauses(boxes.bbox), ...waterClauses(boxes.bbox60m)];
    case "preset-18":
      return [...deadEndClauses(boxes.bbox), ...roadClauses(boxes.bbox), ...buildingClauses(boxes.bbox100ft), ...woodsClauses(boxes.bbox60m)];
    case "preset-19":
      return [...parkingClauses(boxes.bbox), ...pullOffClauses(boxes.bbox), ...treeClauses(boxes.bbox60m), ...woodsClauses(boxes.bbox60m)];
    case "preset-20":
      return [...pullOffClauses(boxes.bbox), ...streetParkingClauses(boxes.bbox)];
    case "preset-21":
      return [...streetParkingClauses(boxes.bbox), ...waterClauses(boxes.bbox60m)];
    case "preset-22":
      return [...streetParkingClauses(boxes.bbox), ...parkClauses(boxes.bbox100m), ...woodsClauses(boxes.bbox100m)];
    case "preset-23":
      return [...bridgeClauses(boxes.bbox), ...parkingClauses(boxes.bbox100m), ...pullOffClauses(boxes.bbox100m)];
    case "preset-24":
      return [
        `node["ford"](${boxes.bbox});`,
        `way["ford"](${boxes.bbox});`,
        `relation["ford"](${boxes.bbox});`,
        `node["highway"="ford"](${boxes.bbox});`,
        `way["highway"]["ford"](${boxes.bbox});`,
      ];
    case "preset-25":
      return [...barrierClauses(boxes.bbox), ...restrictedRoadClauses(boxes.bbox)];
    case "preset-26":
      return [...trailClauses(boxes.bbox), ...trailheadClauses(boxes.bbox), ...parkingClauses(boxes.bbox100m)];
    case "preset-27":
      return [...walkingPathClauses(boxes.bbox), ...parkingClauses(boxes.bbox100m), ...waterClauses(boxes.bbox100m)];
    case "preset-28":
      return [...deadEndClauses(boxes.bbox), ...roadClauses(boxes.bbox), ...walkingPathClauses(boxes.bbox100m), ...waterClauses(boxes.bbox100m)];
    case "preset-29":
      return [...unlitRoadClauses(boxes.bbox), ...buildingClauses(boxes.bbox100ft)];
    case "preset-30":
      return [...noSidewalkRoadClauses(boxes.bbox), ...lowSpeedClauses(boxes.bbox), ...buildingClauses(boxes.bbox100ft)];
    case "preset-31":
      return [...walkingPathClauses(boxes.bbox), ...quietRoadClauses(boxes.bbox60m)];
    case "preset-32":
      return [...namedTrailClauses(boxes.bbox), ...roadClauses(boxes.bbox60m)];
    case "preset-33":
      return [...deadEndClauses(boxes.bbox), ...quietRoadClauses(boxes.bbox), ...industrialClauses(boxes.bbox100m)];
    case "preset-34":
      return [...lowSpeedClauses(boxes.bbox), `way["highway"]["tree_lined"](${boxes.bbox});`, ...treeClauses(boxes.bbox60m), ...woodsClauses(boxes.bbox60m), ...buildingClauses(boxes.bbox100ft)];
    case "preset-35":
      return [...railwayClauses(boxes.bbox), ...fenceClauses(boxes.bbox60m)];
  }
}

function roadClauses(bbox: string): string[] {
  return [`way["highway"~"^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|service|living_street|track)$"](${bbox});`];
}

function dirtRoadClauses(bbox: string): string[] {
  return [
    `way["highway"~"^(unclassified|residential|service|living_street|tertiary|secondary|primary|track)$"]["surface"~"^(dirt|earth|ground|mud)$"](${bbox});`,
    `way["highway"="track"]["surface"!~"^(asphalt|paved|concrete|paving_stones|chipseal|metal|wood)$"](${bbox});`,
  ];
}

function alleyClauses(bbox: string): string[] {
  return [
    `way["highway"="service"]["service"="alley"](${bbox});`,
    `way["highway"="alley"](${bbox});`,
  ];
}

function publicRoadClauses(bbox: string): string[] {
  return [`way["highway"~"^(service|track|unclassified|residential|living_street|tertiary)$"]["access"!~"^(private|no)$"](${bbox});`];
}

function quietRoadClauses(bbox: string): string[] {
  return [`way["highway"~"^(residential|living_street|unclassified|service)$"]["access"!~"^(private|no)$"](${bbox});`];
}

function lowSpeedClauses(bbox: string): string[] {
  return [`way["highway"]["maxspeed"~"^(25 mph|25mph|30 mph|30mph|25 mp/h|30 mp/h)$"](${bbox});`];
}

function shoulderClauses(bbox: string): string[] {
  return [
    `way["highway"]["shoulder"](${bbox});`,
    `way["highway"]["shoulder:left"](${bbox});`,
    `way["highway"]["shoulder:right"](${bbox});`,
    `way["highway"]["shoulder:both"](${bbox});`,
  ];
}

function trailClauses(bbox: string): string[] {
  return [
    `way["highway"~"^(path|footway|bridleway|cycleway|track|steps|pedestrian)$"](${bbox});`,
    `relation["route"~"^(hiking|foot|bicycle|mtb)$"](${bbox});`,
  ];
}

function walkingPathClauses(bbox: string): string[] {
  return [`way["highway"~"^(footway|path|pedestrian|steps|bridleway)$"]["access"!~"^(private|no)$"](${bbox});`];
}

function namedTrailClauses(bbox: string): string[] {
  return [
    `way["highway"~"^(path|footway|bridleway|steps)$"]["name"](${bbox});`,
    `relation["route"~"^(hiking|foot|bicycle|mtb)$"]["name"](${bbox});`,
  ];
}

function unpavedRoadClauses(bbox: string): string[] {
  return [
    `way["highway"~"^(track|unclassified|service|residential|living_street)$"]["surface"~"^(unpaved|gravel|fine_gravel|dirt|earth|ground|sand|compacted|grass|mud)$"]["access"!~"^(private|no)$"](${bbox});`,
    `way["highway"="track"]["access"!~"^(private|no)$"](${bbox});`,
  ];
}

function roughRoadClauses(bbox: string): string[] {
  return [
    `way["highway"~"^(track|service|unclassified|path)$"]["tracktype"~"^(grade3|grade4|grade5)$"](${bbox});`,
    `way["highway"~"^(track|service|unclassified|path)$"]["smoothness"~"^(bad|very_bad|horrible|very_horrible|impassable)$"](${bbox});`,
    `way["highway"~"^(track|service|unclassified|path)$"]["surface"~"^(dirt|earth|ground|mud|sand|rock|grass)$"](${bbox});`,
  ];
}

function restrictedRoadClauses(bbox: string): string[] {
  return [`way["highway"~"^(track|service|unclassified|residential|path)$"]["access"~"^(private|no|destination|customers)$"](${bbox});`];
}

function deadEndClauses(bbox: string): string[] {
  return [
    `node["highway"~"^(turning_circle|turning_loop)$"](${bbox});`,
    `way["highway"]["noexit"="yes"](${bbox});`,
    `way["highway"]["junction"="cul_de_sac"](${bbox});`,
  ];
}

function parkingClauses(bbox: string): string[] {
  return [
    `nwr["amenity"="parking"]["access"!~"^(private|no)$"](${bbox});`,
    `nwr["parking"~"^(layby|street_side|surface)$"]["access"!~"^(private|no)$"](${bbox});`,
  ];
}

function streetParkingClauses(bbox: string): string[] {
  return [
    `way["highway"]["parking:left"](${bbox});`,
    `way["highway"]["parking:right"](${bbox});`,
    `way["highway"]["parking:both"](${bbox});`,
    `way["highway"]["parking:lane:left"](${bbox});`,
    `way["highway"]["parking:lane:right"](${bbox});`,
    `way["highway"]["parking:lane:both"](${bbox});`,
  ];
}

function pullOffClauses(bbox: string): string[] {
  return [
    `nwr["parking"="layby"](${bbox});`,
    `nwr["highway"="rest_area"](${bbox});`,
    `nwr["highway"="services"](${bbox});`,
  ];
}

function bridgeClauses(bbox: string): string[] {
  return [
    `way["bridge"]["bridge"!~"^(no)$"](${bbox});`,
    `relation["bridge"]["bridge"!~"^(no)$"](${bbox});`,
    `nwr["man_made"="bridge"](${bbox});`,
  ];
}

function waterClauses(bbox: string): string[] {
  return [
    `nwr["natural"="water"](${bbox});`,
    `nwr["water"](${bbox});`,
    `way["waterway"~"^(river|stream|canal|ditch|drain)$"](${bbox});`,
    `way["natural"="coastline"](${bbox});`,
  ];
}

function buildingClauses(bbox: string): string[] {
  return [`nwr["building"](${bbox});`];
}

function woodsClauses(bbox: string): string[] {
  return [
    `nwr["natural"="wood"](${bbox});`,
    `nwr["landuse"="forest"](${bbox});`,
  ];
}

function parkClauses(bbox: string): string[] {
  return [
    `nwr["leisure"="park"](${bbox});`,
    `nwr["leisure"="nature_reserve"](${bbox});`,
    `nwr["boundary"="protected_area"](${bbox});`,
  ];
}

function treeClauses(bbox: string): string[] {
  return [
    `node["natural"="tree"](${bbox});`,
    `way["natural"="tree_row"](${bbox});`,
    `relation["natural"="tree_row"](${bbox});`,
  ];
}

function barrierClauses(bbox: string): string[] {
  return [
    `node["barrier"~"^(gate|chain|bollard|block|lift_gate|swing_gate|cattle_grid)$"](${bbox});`,
    `way["barrier"~"^(gate|chain|bollard|block|lift_gate|swing_gate|cattle_grid)$"](${bbox});`,
  ];
}

function trailheadClauses(bbox: string): string[] {
  return [`nwr["tourism"="trailhead"](${bbox});`];
}

function unlitRoadClauses(bbox: string): string[] {
  return [
    `way["highway"~"^(residential|unclassified|service|track|living_street)$"]["lit"="no"]["access"!~"^(private|no)$"](${bbox});`,
    `way["highway"~"^(residential|unclassified|service|track|living_street)$"]["lit"="limited"]["access"!~"^(private|no)$"](${bbox});`,
  ];
}

function noSidewalkRoadClauses(bbox: string): string[] {
  return [
    `way["highway"~"^(residential|living_street|unclassified)$"]["sidewalk"~"^(no|none|separate)$"]["access"!~"^(private|no)$"](${bbox});`,
    `way["highway"~"^(residential|living_street|unclassified)$"]["sidewalk:left"~"^(no|none)$"]["sidewalk:right"~"^(no|none)$"]["access"!~"^(private|no)$"](${bbox});`,
  ];
}

function industrialClauses(bbox: string): string[] {
  return [`nwr["landuse"="industrial"](${bbox});`];
}

function railwayClauses(bbox: string): string[] {
  return [
    `way["railway"~"^(rail|light_rail|narrow_gauge|tram|subway|monorail|preserved)$"](${bbox});`,
    `relation["railway"~"^(rail|light_rail|narrow_gauge|tram|subway|monorail|preserved)$"](${bbox});`,
  ];
}

function fenceClauses(bbox: string): string[] {
  return [
    `way["barrier"~"^(fence|wall|hedge|railing|chain_link_fence|guard_rail|retaining_wall)$"](${bbox});`,
    `node["barrier"~"^(fence|wall|hedge|railing|chain_link_fence|guard_rail|retaining_wall)$"](${bbox});`,
  ];
}

function dedupeClauses(clauses: string[]): string[] {
  return Array.from(new Set(clauses));
}

function expandBBox(bbox: BBox, meters: number): BBox {
  const centerLat = (bbox.south + bbox.north) / 2;
  const latDelta = meters / 111_320;
  const lngDelta = meters / (111_320 * Math.max(Math.cos((centerLat * Math.PI) / 180), 0.01));
  return {
    south: bbox.south - latDelta,
    west: bbox.west - lngDelta,
    north: bbox.north + latDelta,
    east: bbox.east + lngDelta,
  };
}
