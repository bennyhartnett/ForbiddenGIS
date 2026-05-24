import type { BBox, PresetDefinition, PresetId } from "./geo";
import { bboxToOverpass } from "./geo";

export interface PresetQueryOptions {
  includeBuildings: boolean;
  includeWater: boolean;
  bufferScale?: number;
}

export const PRESETS: PresetDefinition[] = [
  preset("preset-featured-off-road", "Public Off Road", "Public tracks, unpaved roads, and rough routes drivable by a 4x4 or high-clearance vehicle.", 14, true, true, false),
  preset("preset-featured-fishing", "Fishing Spots", "Mapped fishing access — fishing-tagged piers, slipways, fish passes, and any feature tagged for angling.", 13, false, false, true),
  preset("preset-featured-camping", "Camping Spots", "Established campsites plus public lands where boondocking is allowed (BLM, National Forests, state forests, WMAs). Each result is annotated with that state's boondocking rules.", 10, false, false, false),
  preset("preset-featured-hunting", "Hunting Spots", "Hunting stands, game reserves, and tagged hunting areas with mapped access.", 12, false, false, false),
  preset("preset-featured-parking", "Public Parking", "Publicly accessible parking lots, laybys, and rest areas.", 14, false, false, false),
  preset("preset-dirt-roads", "Dirt & Gravel Roads", "Tracks with gravel, dirt, sand, grass, or graded unpaved surfaces drivable by a Jeep or similar 4x4.", 14, false, false, false),
  preset("preset-alleys", "Alleys & Service Lanes", "Back-lot alleys and service lanes threading between buildings.", 14, false, false, false),
  preset("preset-01", "Public Off-Road Routes", "Tracks and rough roads with no private or restricted access tags.", 14, true, true, false),
  preset("preset-02", "Private Off-Road Routes", "Tracks and rough roads tagged private, restricted, or destination-only.", 14, true, true, false),
  preset("preset-03", "Golf Cart & LSV Routes", "Roads, paths, and tracks tagged for golf carts or low-speed vehicles.", 14, true, true, false),
  preset("preset-04", "Secluded Public Parking", "Public parking lots set back from mapped buildings.", 14, true, true, false),
  preset("preset-05", "Waterside Roads", "Roads and tracks that hug the edge of rivers, lakes, or streams.", 14, true, false, true),
  preset("preset-06", "Bridges & Spans", "Bridge-tagged roads, rail spans, and mapped bridge structures.", 14, true, false, true),
  preset("preset-07", "Secluded Dead Ends", "Cul-de-sacs and dead ends with no mapped buildings within ~100 ft.", 15, true, true, false),
  preset("preset-08", "Drive-Up Water Access", "Public roads and parking that drop you next to mapped water.", 14, true, false, true),
  preset("preset-09", "Streets with Legal Parking", "Roads tagged with on-street parking lanes.", 14, true, false, false),
  preset("preset-10", "Quiet Streets with Parking", "On-street parking roads set back from mapped buildings (~100 ft).", 14, true, true, false),
  preset("preset-11", "Trail-Linked Dead Ends", "Walking paths that bridge two road dead ends or stub endpoints.", 15, true, true, false),
  preset("preset-12", "25 mph Roads, No Buildings", "25–30 mph roads with no mapped buildings within ~100 ft.", 14, true, true, false),
  preset("preset-13", "25 mph Tree-Lined Roads", "25–30 mph roads with tree-lined tags or nearby tree cover.", 14, true, true, false),
  preset("preset-14", "Shouldered Low-Speed Roads", "Low-speed roads with mapped shoulders and no nearby buildings.", 14, true, true, false),
  preset("preset-15", "Secluded Unpaved Public Roads", "Public unpaved roads and tracks with no buildings within ~100 ft.", 14, true, true, false),
  preset("preset-16", "Rough & High-Clearance Roads", "Roads tagged rough, high-clearance, or with poor smoothness ratings.", 14, true, false, false),
  preset("preset-17", "Public Roads to Water's Edge", "Public road endpoints that meet rivers, lakes, or coastline.", 14, true, false, true),
  preset("preset-18", "Wooded Secluded Dead Ends", "Dead ends bordering woods or forest with no buildings nearby.", 15, true, true, false),
  preset("preset-19", "Tree-Covered Parking & Pull-Offs", "Parking, laybys, and rest areas tucked into tree cover.", 14, true, false, false),
  preset("preset-20", "Roadside Pull-Offs & Laybys", "Laybys, rest areas, services, and tagged roadside parking.", 14, true, false, false),
  preset("preset-21", "Waterside Street Parking", "On-street parking lanes within ~60 m of mapped water.", 14, true, false, true),
  preset("preset-22", "Street Parking near Parks & Woods", "On-street parking within ~100 m of parks, forest, or reserves.", 14, true, false, false),
  preset("preset-23", "Bridges with Pull-Offs", "Bridges within ~100 m of parking, laybys, or rest areas.", 14, true, false, false),
  preset("preset-24", "Fords & Water Crossings", "Ford-tagged roads, paths, and shallow water crossings.", 14, true, false, true),
  preset("preset-25", "Gates & Barriers", "Gates, chains, bollards, blocks, and restricted-access tags.", 14, true, false, false),
  preset("preset-26", "Trailheads with Parking", "Trails or trailheads within ~100 m of public parking.", 14, true, false, false),
  preset("preset-27", "Parking-to-Water Walking Paths", "Pedestrian routes linking parking lots to nearby water.", 15, true, false, true),
  preset("preset-28", "Dead-End Paths to Water", "Foot paths that connect road dead ends to nearby water.", 15, true, true, true),
  preset("preset-29", "Unlit Secluded Roads", "Roads tagged unlit or with limited lighting, away from buildings.", 14, true, true, false),
  preset("preset-30", "Quiet Roads, No Sidewalk", "Low-speed residential roads tagged without sidewalks.", 14, true, true, false),
  preset("preset-31", "Neighborhood Cut-Throughs", "Walking paths whose ends connect to different road segments.", 15, true, false, false),
  preset("preset-32", "Named Trails Crossing Roads", "Named walking or hiking trails that intersect public roads.", 14, true, false, false),
  preset("preset-33", "Industrial Dead Ends", "Service roads and dead ends inside or beside industrial landuse.", 14, true, false, false),
  preset("preset-34", "Tree-Lined Low-Speed Roads", "Low-speed roads with tree-lined tags or nearby trees, no buildings.", 14, true, true, false),
  preset("preset-35", "Unfenced Train Tracks", "Active railway tracks with no mapped fence or wall within ~30 m.", 14, true, false, false),
  preset("preset-weather", "Weather Stations", "OSM-tagged weather stations plus nearby official NWS observation stations (US only).", 8, false, false, false),
  preset("preset-restricted", "Restricted & Private Areas", "Military bases, gated communities, prisons, embassies, and other tagged no-entry zones. Overlay alongside other searches to spot land you can't drive into.", 12, false, false, false),
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
    case "preset-featured-off-road":
      return [...roughRoadClauses(boxes.bbox), ...unpavedRoadClauses(boxes.bbox)];
    case "preset-featured-fishing":
      return fishingClauses(boxes.bbox);
    case "preset-featured-camping":
      return campingClauses(boxes.bbox);
    case "preset-featured-hunting":
      return huntingClauses(boxes.bbox);
    case "preset-featured-parking":
      return [...parkingClauses(boxes.bbox), ...pullOffClauses(boxes.bbox)];
    case "preset-weather":
      return weatherStationClauses(boxes.bbox);
    case "preset-restricted":
      return restrictedAreaClauses(boxes.bbox);
  }
}

function fishingClauses(bbox: string): string[] {
  return [
    `nwr["leisure"="fishing"](${bbox});`,
    `nwr["sport"="fishing"](${bbox});`,
    `nwr["amenity"="fishing"](${bbox});`,
    `nwr["tourism"="fishing"](${bbox});`,
    `nwr["fishing"~"^(yes|designated|sport|coarse|fly|sea)$"](${bbox});`,
    `nwr["man_made"="pier"]["fishing"~"^(yes|designated)$"](${bbox});`,
    `nwr["man_made"="pier"]["sport"="fishing"](${bbox});`,
    `nwr["man_made"="pier"]["leisure"="fishing"](${bbox});`,
    `nwr["leisure"="slipway"](${bbox});`,
    `way["waterway"="fish_pass"](${bbox});`,
    `way["waterway"="fishpass"](${bbox});`,
    `node["seamark:type"="fishing_facility"](${bbox});`,
  ];
}

function campingClauses(bbox: string): string[] {
  return [
    `nwr["tourism"="camp_site"](${bbox});`,
    `nwr["tourism"="caravan_site"](${bbox});`,
    `nwr["tourism"="camp_pitch"](${bbox});`,
    `nwr["tourism"="wilderness_hut"](${bbox});`,
    `nwr["amenity"="shelter"]["shelter_type"~"^(basic_hut|lean_to|weather_shelter)$"](${bbox});`,
    `nwr["leisure"="dispersed_camping"](${bbox});`,
    `way["boundary"="protected_area"]["operator"~"Bureau of Land Management|BLM",i](${bbox});`,
    `relation["boundary"="protected_area"]["operator"~"Bureau of Land Management|BLM",i](${bbox});`,
    `way["boundary"="protected_area"]["operator"~"Forest Service|USFS",i](${bbox});`,
    `relation["boundary"="protected_area"]["operator"~"Forest Service|USFS",i](${bbox});`,
    `way["boundary"="protected_area"]["protect_class"="6"](${bbox});`,
    `relation["boundary"="protected_area"]["protect_class"="6"](${bbox});`,
    `way["boundary"="protected_area"]["protect_class"~"^(4|14)$"](${bbox});`,
    `relation["boundary"="protected_area"]["protect_class"~"^(4|14)$"](${bbox});`,
    `way["boundary"="national_park"](${bbox});`,
    `relation["boundary"="national_park"](${bbox});`,
    `way["name"~"National Forest|National Grassland",i](${bbox});`,
    `relation["name"~"National Forest|National Grassland",i](${bbox});`,
    `way["name"~"State Forest",i](${bbox});`,
    `relation["name"~"State Forest",i](${bbox});`,
    `way["name"~"Wildlife Management Area",i](${bbox});`,
    `relation["name"~"Wildlife Management Area",i](${bbox});`,
  ];
}

function huntingClauses(bbox: string): string[] {
  return [
    `nwr["amenity"="hunting_stand"](${bbox});`,
    `nwr["leisure"="hunting_stand"](${bbox});`,
    `nwr["landuse"="hunting_ground"](${bbox});`,
    `nwr["boundary"="hunting_area"](${bbox});`,
    `nwr["club"="hunting"](${bbox});`,
    `nwr["leisure"="game_reserve"](${bbox});`,
  ];
}

function restrictedAreaClauses(bbox: string): string[] {
  return [
    `way["landuse"="military"](${bbox});`,
    `relation["landuse"="military"](${bbox});`,
    `way["military"](${bbox});`,
    `relation["military"](${bbox});`,
    `node["military"](${bbox});`,
    `way["boundary"="aboriginal_lands"](${bbox});`,
    `relation["boundary"="aboriginal_lands"](${bbox});`,
    `way["boundary"="protected_area"]["access"~"^(no|private|customers|permit)$"](${bbox});`,
    `relation["boundary"="protected_area"]["access"~"^(no|private|customers|permit)$"](${bbox});`,
    `way["amenity"="prison"](${bbox});`,
    `relation["amenity"="prison"](${bbox});`,
    `way["landuse"="residential"]["gated"="yes"](${bbox});`,
    `relation["landuse"="residential"]["gated"="yes"](${bbox});`,
    `way["residential"="gated"](${bbox});`,
    `relation["residential"="gated"](${bbox});`,
    `way["landuse"~"^(industrial|government|institutional|commercial)$"]["access"~"^(no|private|customers|permit)$"](${bbox});`,
    `relation["landuse"~"^(industrial|government|institutional|commercial)$"]["access"~"^(no|private|customers|permit)$"](${bbox});`,
  ];
}

function weatherStationClauses(bbox: string): string[] {
  return [
    `node["man_made"="weather_station"](${bbox});`,
    `way["man_made"="weather_station"](${bbox});`,
    `node["amenity"="weather_station"](${bbox});`,
    `node["man_made"="monitoring_station"]["monitoring:weather"="yes"](${bbox});`,
    `node["man_made"="monitoring_station"]["monitoring:weather"](${bbox});`,
  ];
}

function roadClauses(bbox: string): string[] {
  return [`way["highway"~"^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|service|living_street|track)$"](${bbox});`];
}

function dirtRoadClauses(bbox: string): string[] {
  const drivableHighway = `^(unclassified|residential|service|living_street|tertiary|secondary|track)$`;
  const unpavedSurfaces = `^(gravel|fine_gravel|dirt|earth|ground|unpaved|compacted|sand|mud|grass)$`;
  const undrivableSmoothness = `^(horrible|very_horrible|impassable)$`;
  const forbiddenAccess = `^(no|private)$`;
  return [
    `way["highway"~"${drivableHighway}"]["surface"~"${unpavedSurfaces}"]["smoothness"!~"${undrivableSmoothness}"]["motor_vehicle"!~"${forbiddenAccess}"]["vehicle"!~"${forbiddenAccess}"](${bbox});`,
    `way["highway"="track"]["tracktype"~"^(grade1|grade2|grade3|grade4|grade5)$"]["smoothness"!~"${undrivableSmoothness}"]["motor_vehicle"!~"${forbiddenAccess}"]["vehicle"!~"${forbiddenAccess}"](${bbox});`,
    `way["highway"="track"]["surface"!~"^(asphalt|paved|concrete|paving_stones|chipseal|metal|wood)$"]["smoothness"!~"${undrivableSmoothness}"]["motor_vehicle"!~"${forbiddenAccess}"]["vehicle"!~"${forbiddenAccess}"](${bbox});`,
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
