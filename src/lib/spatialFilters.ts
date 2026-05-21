import booleanPointInPolygon from "@turf/boolean-point-in-polygon";
import centroid from "@turf/centroid";
import distance from "@turf/distance";
import { lineString, point } from "@turf/helpers";
import lineIntersect from "@turf/line-intersect";
import pointToLineDistance from "@turf/point-to-line-distance";
import type {
  Feature,
  Geometry,
  LineString,
  MultiPolygon,
  Point,
  Polygon,
  Position,
} from "geojson";
import type {
  GeoJSONFeature,
  LatLng,
  MatchReason,
  PresetDefinition,
  PresetResult,
  ScoutCategory,
  ScoutRole,
  SpatialContext,
} from "./geo";
import {
  attachScoutMetadata,
  firstLineEndpoints,
  getFeatureTags,
  getOsmId,
  representativeCoordinate,
} from "./geo";

export interface SpatialFilterOptions {
  includeBuildings: boolean;
  includeWater: boolean;
  renderLimit: number;
  simpleMatchLabel?: string;
}

export const NO_BUILDINGS_DISTANCE_METERS = 30.48;
export const NO_FENCE_DISTANCE_METERS = 30;
export const NEAR_WATER_DISTANCE_METERS = 30;
export const WATER_ADJACENT_DISTANCE_METERS = 50;
export const NEAR_WOODS_DISTANCE_METERS = 50;
export const NEAR_PARK_DISTANCE_METERS = 75;
export const NEAR_PULL_OFF_DISTANCE_METERS = 100;
export const TRAIL_TO_PARKING_DISTANCE_METERS = 100;
export const TRAIL_TO_WATER_DISTANCE_METERS = 30;
export const DEAD_END_TO_TRAIL_DISTANCE_METERS = 25;
export const LOW_SPEED_MPH_VALUES = [25, 30] as const;
export const TREE_LINED_REQUIRED_METERS = 30.48;
export const TREE_CONTEXT_DISTANCE_METERS = 15;

const PRIVATE_VALUES = new Set(["private", "no", "customers", "permit"]);
const RESTRICTED_VALUES = new Set(["private", "no", "customers", "permit", "destination"]);
const ROAD_TYPES = new Set([
  "motorway",
  "trunk",
  "primary",
  "secondary",
  "tertiary",
  "unclassified",
  "residential",
  "service",
  "living_street",
  "track",
]);
const QUIET_ROAD_TYPES = new Set([
  "residential",
  "living_street",
  "unclassified",
  "service",
  "track",
]);
const TRAIL_TYPES = new Set([
  "path",
  "footway",
  "bridleway",
  "cycleway",
  "track",
  "steps",
  "pedestrian",
]);
const WALKING_PATH_TYPES = new Set(["path", "footway", "pedestrian", "steps", "bridleway"]);
const UNPAVED_SURFACES = new Set([
  "unpaved",
  "gravel",
  "fine_gravel",
  "dirt",
  "earth",
  "ground",
  "sand",
  "compacted",
  "grass",
  "mud",
]);
const TRACK_PAVED_SURFACES = new Set([
  "asphalt",
  "paved",
  "concrete",
  "paving_stones",
  "chipseal",
  "metal",
  "wood",
]);
const ROUGH_SURFACES = new Set(["dirt", "earth", "ground", "mud", "sand", "rock", "grass"]);
const ROUGH_TRACKTYPES = new Set(["grade3", "grade4", "grade5"]);
const ROUGH_SMOOTHNESS = new Set([
  "bad",
  "very_bad",
  "horrible",
  "very_horrible",
  "impassable",
]);
const CAR_DRIVABLE_HIGHWAYS = new Set([
  "motorway",
  "trunk",
  "primary",
  "secondary",
  "tertiary",
  "unclassified",
  "residential",
  "service",
  "living_street",
  "track",
]);
const CAR_UNDRIVABLE_SURFACES = new Set([
  "stepping_stones",
  "snow",
  "ice",
]);
const CAR_UNDRIVABLE_TRACKTYPES = new Set<string>();
const CAR_UNDRIVABLE_SMOOTHNESS = new Set([
  "horrible",
  "very_horrible",
  "impassable",
]);
const CAR_FORBIDDEN_ACCESS = new Set(["no", "private", "customers", "permit", "agricultural", "forestry"]);
const BARRIER_VALUES = new Set([
  "gate",
  "chain",
  "bollard",
  "block",
  "lift_gate",
  "swing_gate",
  "cattle_grid",
]);
const FENCE_BARRIER_VALUES = new Set([
  "fence",
  "wall",
  "hedge",
  "railing",
  "chain_link_fence",
  "guard_rail",
  "retaining_wall",
]);
const RAILWAY_TRACK_VALUES = new Set([
  "rail",
  "light_rail",
  "narrow_gauge",
  "tram",
  "subway",
  "monorail",
  "preserved",
]);
const STREET_PARKING_KEYS = [
  "parking:left",
  "parking:right",
  "parking:both",
  "parking:lane:left",
  "parking:lane:right",
  "parking:lane:both",
];
const PARKING_FORBIDDEN_PATTERN = /^(no|none|no_parking|no_stopping|fire_lane)$/i;

export function prepareSimpleResult(
  features: GeoJSONFeature[],
  options: SpatialFilterOptions,
): PresetResult {
  const prepared = features.map((feature, index) =>
    attachScoutMetadata(feature, index, "result", categoryForFeature(feature), {
      label: options.simpleMatchLabel ?? "Matched simple tag search",
      category: categoryForFeature(feature),
    }),
  );

  return capFeatures(prepared, prepared.length, options.renderLimit);
}

export function applyPresetSpatialFilters(
  features: GeoJSONFeature[],
  preset: PresetDefinition,
  options: SpatialFilterOptions,
): PresetResult {
  const context = createSpatialContext(features);
  const resultFeatures: GeoJSONFeature[] = [];
  const contextFeatures: GeoJSONFeature[] = [];

  const addResult = (
    feature: GeoJSONFeature,
    category: ScoutCategory,
    label: string,
    distanceMeters?: number,
    detail?: string,
  ) => {
    resultFeatures.push(
      attachScoutMetadata(feature, resultFeatures.length, "result", category, {
        label,
        distanceMeters,
        detail,
        category,
      }),
    );
  };

  switch (preset.id) {
    case "preset-dirt-roads":
      for (const feature of features) {
        const tags = getFeatureTags(feature);
        if (!tags.highway || !isDirtRoad(tags)) continue;
        if (!isCarDrivable(tags)) continue;
        addResult(
          feature,
          "off-road",
          isClearlyPrivate(feature) ? "Dirt road, restricted/private tag" : "Dirt road",
          undefined,
          tagDetail(tags, ["highway", "surface", "tracktype", "smoothness", "access"]),
        );
      }
      break;

    case "preset-alleys":
      for (const feature of features) {
        const tags = getFeatureTags(feature);
        if (!isAlley(tags)) continue;
        addResult(
          feature,
          "road",
          isClearlyPrivate(feature) ? "Alley, restricted/private tag" : "Alley",
          undefined,
          tagDetail(tags, ["highway", "service", "name", "access", "surface"]),
        );
      }
      break;

    case "preset-01":
      for (const road of context.roads) {
        const tags = getFeatureTags(road);
        if (!isClearlyPrivate(road) && (isUnpavedRoad(tags) || isRoughOrHighClearanceRoad(tags))) {
          addResult(
            road,
            "off-road",
            "Public-ish off-roading / rough road",
            undefined,
            tagDetail(tags, ["highway", "surface", "tracktype", "smoothness", "access"]),
          );
        }
      }
      break;

    case "preset-02":
      for (const road of context.roads) {
        const tags = getFeatureTags(road);
        if (isClearlyRestricted(road) && (isUnpavedRoad(tags) || isRoughOrHighClearanceRoad(tags))) {
          addResult(
            road,
            "off-road",
            "Restricted/private off-roading or rough road",
            undefined,
            tagDetail(tags, ["highway", "surface", "tracktype", "smoothness", "access", "motor_vehicle"]),
          );
        }
      }
      break;

    case "preset-03":
      for (const feature of features) {
        const tags = getFeatureTags(feature);
        if (hasGolfCartTag(tags)) {
          addResult(
            feature,
            categoryForFeature(feature),
            "Golf cart or low-speed vehicle tag",
            undefined,
            tagDetail(tags, ["golf_cart", "vehicle:golf_cart", "low_speed_vehicle", "access"]),
          );
        }
      }
      break;

    case "preset-04":
      addContexts(contextFeatures, context.buildings, "context-building", "building", "Building context");
      for (const parking of context.parking) {
        if (isClearlyPrivate(parking)) continue;
        const building = nearestFeatureDistance(parking, context.buildings, NO_BUILDINGS_DISTANCE_METERS);
        if (building.distanceMeters > NO_BUILDINGS_DISTANCE_METERS) {
          addResult(
            parking,
            "parking",
            "Secluded public-ish parking with no mapped buildings nearby",
            finiteDistance(building.distanceMeters),
            `Nearest mapped building: ${formatMeters(building.distanceMeters)}. ${tagDetail(getFeatureTags(parking), ["amenity", "parking", "access"])}`,
          );
        }
      }
      break;

    case "preset-05":
      addContexts(contextFeatures, context.water, "context-water", "water", "Water context");
      for (const road of context.roads) {
        if (isClearlyPrivate(road)) continue;
        const clipped = clipRoadToPredicate(road, (sample) =>
          nearestDistanceToFeatures(sample, context.water, WATER_ADJACENT_DISTANCE_METERS)
            .distanceMeters <= WATER_ADJACENT_DISTANCE_METERS,
        );
        if (clipped) {
          addResult(
            clipped.feature,
            "road",
            "Water-adjacent road (localized)",
            0,
            `Water-adjacent run: ${formatMeters(clipped.lengthMeters)} across ${clipped.spans} span(s). ${tagDetail(getFeatureTags(road), ["highway", "name", "access"])}`,
          );
        }
      }
      break;

    case "preset-06":
      for (const bridge of context.bridges) {
        addResult(
          bridge,
          "bridge",
          "Bridge or overpass tag",
          undefined,
          tagDetail(getFeatureTags(bridge), ["bridge", "man_made", "highway", "waterway"]),
        );
      }
      break;

    case "preset-07": {
      addContexts(contextFeatures, context.buildings, "context-building", "building", "Building context");
      const farFromBuildings = farFromAnyPredicate(context.buildings, NO_BUILDINGS_DISTANCE_METERS);
      for (const deadEnd of deadEndCandidates(context)) {
        if (isClearlyPrivate(deadEnd)) continue;
        applyClippedResult(deadEnd, farFromBuildings, (matched, lengthMeters, spans) => {
          addResult(
            matched,
            "road",
            "Cul-de-sac/dead end with no mapped buildings nearby",
            undefined,
            `${describeClip(lengthMeters, spans)}. ${tagDetail(getFeatureTags(deadEnd), ["highway", "junction", "noexit", "access"])}`,
          );
        });
      }
      break;
    }

    case "preset-08":
      addContexts(contextFeatures, context.water, "context-water", "water", "Water context");
      for (const road of context.roads) {
        if (isClearlyPrivate(road)) continue;
        const water = roadEndsNearFeatureDistance(road, context.water, NEAR_WATER_DISTANCE_METERS);
        if (water.distanceMeters <= NEAR_WATER_DISTANCE_METERS) {
          addResult(
            road,
            "road",
            "Road access point near water",
            water.distanceMeters,
            `Road endpoint to water: ${formatMeters(water.distanceMeters)}. ${tagDetail(getFeatureTags(road), ["highway", "name", "access"])}`,
          );
        }
      }
      for (const parking of context.parking) {
        if (isClearlyPrivate(parking)) continue;
        const water = nearestFeatureDistance(parking, context.water, NEAR_WATER_DISTANCE_METERS);
        if (water.distanceMeters <= NEAR_WATER_DISTANCE_METERS) {
          addResult(
            parking,
            "parking",
            "Parking access point near water",
            water.distanceMeters,
            `Parking to water: ${formatMeters(water.distanceMeters)}. ${tagDetail(getFeatureTags(parking), ["amenity", "parking", "access"])}`,
          );
        }
      }
      break;

    case "preset-09":
      for (const road of context.roads) {
        const tags = getFeatureTags(road);
        if (isStreetParkingLegalish(tags)) {
          addResult(
            road,
            "road",
            "Road with explicit legal-ish street parking tags",
            undefined,
            parkingDetail(tags),
          );
        }
      }
      break;

    case "preset-10": {
      addContexts(contextFeatures, context.buildings, "context-building", "building", "Building context");
      const farFromBuildings = farFromAnyPredicate(context.buildings, NO_BUILDINGS_DISTANCE_METERS);
      for (const road of context.roads) {
        const tags = getFeatureTags(road);
        if (!isStreetParkingLegalish(tags)) continue;
        applyClippedResult(road, farFromBuildings, (matched, lengthMeters, spans) => {
          addResult(
            matched,
            "road",
            "Street-parking road with no mapped buildings nearby",
            undefined,
            `${parkingDetail(tags)} ${describeClip(lengthMeters, spans)}.`,
          );
        });
      }
      break;
    }

    case "preset-11": {
      addContexts(contextFeatures, context.roads, "context-road", "road", "Road context");
      addContexts(contextFeatures, context.trails, "context-trail", "trail", "Trail context");
      const deadEnds = deadEndCandidates(context);
      for (const trail of context.trails.filter((feature) => isWalkingPathFeature(feature))) {
        if (isClearlyPrivate(trail) || allowsMotorVehicles(getFeatureTags(trail))) continue;
        const metrics = pathConnectionMetrics(
          trail,
          deadEnds,
          deadEnds,
          DEAD_END_TO_TRAIL_DISTANCE_METERS,
          DEAD_END_TO_TRAIL_DISTANCE_METERS,
        );
        if (metrics.connected) {
          addResult(
            trail,
            "trail",
            "Walking trail connecting two dead ends",
            metrics.distanceMeters,
            `Dead-end endpoint proximity: ${formatMeters(metrics.distanceMeters)}. ${tagDetail(getFeatureTags(trail), ["highway", "foot", "access", "name"])}`,
          );
        }
      }
      break;
    }

    case "preset-12": {
      addContexts(contextFeatures, context.buildings, "context-building", "building", "Building context");
      const farFromBuildings = farFromAnyPredicate(context.buildings, NO_BUILDINGS_DISTANCE_METERS);
      for (const road of context.roads) {
        const tags = getFeatureTags(road);
        if (!isSpecificMph(tags, 25) || isClearlyPrivate(road)) continue;
        applyClippedResult(road, farFromBuildings, (matched, lengthMeters, spans) => {
          addResult(
            matched,
            "road",
            "25 mph road with no mapped buildings nearby",
            undefined,
            `${describeClip(lengthMeters, spans)}. ${tagDetail(tags, ["highway", "maxspeed", "access"])}`,
          );
        });
      }
      break;
    }

    case "preset-13": {
      addContexts(contextFeatures, context.trees, "context-woods", "woods", "Tree context");
      const nearTrees = nearAnyPredicate(
        [...context.trees, ...context.woods],
        TREE_CONTEXT_DISTANCE_METERS,
      );
      for (const road of context.roads) {
        const tags = getFeatureTags(road);
        if (!isSpecificMph(tags, 25) || isClearlyPrivate(road)) continue;

        if (tags.tree_lined && tags.tree_lined !== "no") {
          addResult(
            road,
            "road",
            "25 mph tree-lined road",
            0,
            `Direct tree_lined=${tags.tree_lined}. ${tagDetail(tags, ["highway", "maxspeed", "tree_lined", "access"])}`,
          );
          continue;
        }

        applyClippedResult(road, nearTrees, (matched, lengthMeters, spans) => {
          if (lengthMeters < TREE_LINED_REQUIRED_METERS) return;
          addResult(
            matched,
            "road",
            "25 mph tree-lined road",
            undefined,
            `Tree-lined run: ${describeClip(lengthMeters, spans)} (>= ${formatMeters(TREE_LINED_REQUIRED_METERS)}). ${tagDetail(tags, ["highway", "maxspeed", "tree_lined", "access"])}`,
          );
        });
      }
      break;
    }

    case "preset-14": {
      addContexts(contextFeatures, context.buildings, "context-building", "building", "Building context");
      const farFromBuildings = farFromAnyPredicate(context.buildings, NO_BUILDINGS_DISTANCE_METERS);
      for (const road of context.roads) {
        const tags = getFeatureTags(road);
        if (!isLowSpeedRoad(tags) || !isShoulderedRoad(tags) || isClearlyPrivate(road)) continue;
        applyClippedResult(road, farFromBuildings, (matched, lengthMeters, spans) => {
          addResult(
            matched,
            "road",
            "Low-speed shouldered road with no mapped buildings nearby",
            undefined,
            `${describeClip(lengthMeters, spans)}. ${tagDetail(tags, ["maxspeed", "shoulder", "shoulder:left", "shoulder:right", "shoulder:both", "access"])}`,
          );
        });
      }
      break;
    }

    case "preset-15": {
      addContexts(contextFeatures, context.buildings, "context-building", "building", "Building context");
      const farFromBuildings = farFromAnyPredicate(context.buildings, NO_BUILDINGS_DISTANCE_METERS);
      for (const road of context.roads) {
        const tags = getFeatureTags(road);
        if (!isUnpavedRoad(tags) || isClearlyPrivate(road)) continue;
        applyClippedResult(road, farFromBuildings, (matched, lengthMeters, spans) => {
          addResult(
            matched,
            "off-road",
            "Unpaved public-ish road with no mapped buildings nearby",
            undefined,
            `${describeClip(lengthMeters, spans)}. ${tagDetail(tags, ["surface", "tracktype", "access", "highway"])}`,
          );
        });
      }
      break;
    }

    case "preset-16":
      for (const road of context.roads) {
        const tags = getFeatureTags(road);
        if (!isRoughOrHighClearanceRoad(tags)) continue;
        addResult(
          road,
          "off-road",
          isClearlyPrivate(road) ? "Rough or high-clearance road, restricted/private tag" : "Rough or high-clearance road",
          undefined,
          tagDetail(tags, ["tracktype", "smoothness", "surface", "access", "motor_vehicle", "highway"]),
        );
      }
      break;

    case "preset-17":
      addContexts(contextFeatures, context.water, "context-water", "water", "Water context");
      for (const road of context.roads) {
        if (isClearlyPrivate(road)) continue;
        const water = roadEndsNearFeatureDistance(road, context.water, NEAR_WATER_DISTANCE_METERS);
        if (water.distanceMeters <= NEAR_WATER_DISTANCE_METERS) {
          addResult(
            road,
            "road",
            "Public-ish road ending near water",
            water.distanceMeters,
            `Endpoint-to-water distance: ${formatMeters(water.distanceMeters)}. ${tagDetail(getFeatureTags(road), ["highway", "name", "access"])}`,
          );
        }
      }
      break;

    case "preset-18": {
      addContexts(contextFeatures, context.woods, "context-woods", "woods", "Woods/forest context");
      addContexts(contextFeatures, context.buildings, "context-building", "building", "Building context");
      const predicate = andPredicates(
        nearAnyPredicate(context.woods, NEAR_WOODS_DISTANCE_METERS),
        farFromAnyPredicate(context.buildings, NO_BUILDINGS_DISTANCE_METERS),
      );
      for (const deadEnd of deadEndCandidates(context)) {
        if (isClearlyPrivate(deadEnd)) continue;
        applyClippedResult(deadEnd, predicate, (matched, lengthMeters, spans) => {
          addResult(
            matched,
            "road",
            "Dead end near woods with no mapped buildings nearby",
            undefined,
            `${describeClip(lengthMeters, spans)} near woods and away from buildings. ${tagDetail(getFeatureTags(deadEnd), ["highway", "junction", "noexit", "access"])}`,
          );
        });
      }
      break;
    }

    case "preset-19": {
      const woodsCoverMeters = 25;
      addContexts(contextFeatures, [...context.trees, ...context.woods], "context-woods", "woods", "Tree/woods context");
      for (const parking of [...context.parking, ...context.pullOffs]) {
        if (isClearlyPrivate(parking)) continue;
        const tree = nearestFeatureDistance(parking, context.trees, TREE_CONTEXT_DISTANCE_METERS);
        const woods = nearestFeatureDistance(parking, context.woods, woodsCoverMeters);
        const treeMatch = tree.distanceMeters <= TREE_CONTEXT_DISTANCE_METERS;
        const woodsMatch = woods.distanceMeters <= woodsCoverMeters;
        if (treeMatch || woodsMatch) {
          const distance = Math.min(tree.distanceMeters, woods.distanceMeters);
          const evidence = treeMatch ? "Tree/tree_row evidence" : "Woods/forest evidence";
          addResult(
            parking,
            isPullOffFeature(parking) ? "pull-off" : "parking",
            "Tree-covered parking or pull-off",
            distance,
            `${evidence} within ${formatMeters(distance)}. ${tagDetail(getFeatureTags(parking), ["amenity", "parking", "highway", "access"])}`,
          );
        }
      }
      break;
    }

    case "preset-20":
      for (const pullOff of [...context.pullOffs, ...context.roads.filter((feature) => isStreetParkingLegalish(getFeatureTags(feature)))]) {
        const tags = getFeatureTags(pullOff);
        if (isClearlyPrivate(pullOff) || hasNoParking(tags)) continue;
        addResult(
          pullOff,
          "pull-off",
          "Roadside pull-off or layby",
          undefined,
          tagDetail(tags, ["parking", "parking:left", "parking:right", "parking:both", "highway", "access"]),
        );
      }
      break;

    case "preset-21": {
      addContexts(contextFeatures, context.water, "context-water", "water", "Water context");
      const nearWater = nearAnyPredicate(context.water, WATER_ADJACENT_DISTANCE_METERS);
      for (const road of context.roads) {
        const tags = getFeatureTags(road);
        if (!isStreetParkingLegalish(tags)) continue;
        applyClippedResult(road, nearWater, (matched, lengthMeters, spans) => {
          addResult(
            matched,
            "road",
            "Street-parking road near water",
            undefined,
            `${parkingDetail(tags)} ${describeClip(lengthMeters, spans)} within ${formatMeters(WATER_ADJACENT_DISTANCE_METERS)} of water.`,
          );
        });
      }
      break;
    }

    case "preset-22": {
      addContexts(contextFeatures, [...context.parks, ...context.woods], "context-park", "park", "Park/woods context");
      const nearParkOrWoods = nearAnyPredicate(
        [...context.parks, ...context.woods],
        NEAR_PARK_DISTANCE_METERS,
      );
      for (const road of context.roads) {
        const tags = getFeatureTags(road);
        if (!isStreetParkingLegalish(tags)) continue;
        applyClippedResult(road, nearParkOrWoods, (matched, lengthMeters, spans) => {
          addResult(
            matched,
            "road",
            "Street-parking road near park or woods",
            undefined,
            `${parkingDetail(tags)} ${describeClip(lengthMeters, spans)} within ${formatMeters(NEAR_PARK_DISTANCE_METERS)} of park/woods.`,
          );
        });
      }
      break;
    }

    case "preset-23":
      addContexts(contextFeatures, [...context.parking, ...context.pullOffs], "context-pull-off", "pull-off", "Pull-off/parking context");
      for (const bridge of context.bridges) {
        const pullOff = nearestFeatureDistance(bridge, [...context.parking, ...context.pullOffs], NEAR_PULL_OFF_DISTANCE_METERS);
        if (pullOff.distanceMeters <= NEAR_PULL_OFF_DISTANCE_METERS) {
          addResult(
            bridge,
            "bridge",
            "Bridge with nearby pull-off or parking",
            pullOff.distanceMeters,
            `Nearest pull-off/parking: ${formatMeters(pullOff.distanceMeters)}. ${tagDetail(getFeatureTags(bridge), ["bridge", "man_made", "highway", "name"])}`,
          );
        }
      }
      break;

    case "preset-24":
      for (const ford of features.filter(isFordFeature)) {
        const tags = getFeatureTags(ford);
        addResult(
          ford,
          "water-crossing",
          isClearlyPrivate(ford) ? "Ford or water crossing, restricted/private tag" : "Ford or water crossing",
          undefined,
          tagDetail(tags, ["highway", "ford", "surface", "access", "waterway"]),
        );
      }
      break;

    case "preset-25":
      for (const barrier of features.filter(isBarrierOrGateFeature)) {
        const tags = getFeatureTags(barrier);
        addResult(
          barrier,
          "barrier",
          isRoadFeature(barrier) ? "Gated road or access barrier, restricted road tag" : "Gated road or access barrier",
          undefined,
          tagDetail(tags, ["barrier", "access", "motor_vehicle", "operator", "ownership", "highway"]),
        );
      }
      break;

    case "preset-26":
      addContexts(contextFeatures, context.parking, "context-parking", "parking", "Parking context");
      for (const trailhead of context.trailheads) {
        if (isClearlyPrivate(trailhead)) continue;
        const parking = nearestFeatureDistance(trailhead, context.parking, TRAIL_TO_PARKING_DISTANCE_METERS);
        if (parking.distanceMeters <= TRAIL_TO_PARKING_DISTANCE_METERS) {
          addResult(
            trailhead,
            "trail",
            "Public trailhead near parking",
            parking.distanceMeters,
            `Parking distance: ${formatMeters(parking.distanceMeters)}. ${tagDetail(getFeatureTags(trailhead), ["tourism", "highway", "name", "access"])}`,
          );
        }
      }
      break;

    case "preset-27":
      addContexts(contextFeatures, context.parking, "context-parking", "parking", "Parking context");
      addContexts(contextFeatures, context.water, "context-water", "water", "Water context");
      for (const path of context.trails.filter(isWalkingPathFeature)) {
        if (isClearlyPrivate(path)) continue;
        const parking = nearestFeatureDistance(path, context.parking, TRAIL_TO_PARKING_DISTANCE_METERS);
        const water = nearestFeatureDistance(path, context.water, TRAIL_TO_WATER_DISTANCE_METERS);
        if (parking.distanceMeters <= TRAIL_TO_PARKING_DISTANCE_METERS && water.distanceMeters <= TRAIL_TO_WATER_DISTANCE_METERS) {
          addResult(
            path,
            "trail",
            "Walking path from parking toward water",
            Math.max(parking.distanceMeters, water.distanceMeters),
            `Parking distance: ${formatMeters(parking.distanceMeters)}. Water distance: ${formatMeters(water.distanceMeters)}.`,
          );
        }
      }
      break;

    case "preset-28":
      addContexts(contextFeatures, deadEndCandidates(context), "context-road", "road", "Dead-end context");
      addContexts(contextFeatures, context.water, "context-water", "water", "Water context");
      for (const path of context.trails.filter(isWalkingPathFeature)) {
        if (isClearlyPrivate(path)) continue;
        const deadEnd = nearestFeatureDistance(path, deadEndCandidates(context), DEAD_END_TO_TRAIL_DISTANCE_METERS);
        const water = nearestFeatureDistance(path, context.water, TRAIL_TO_WATER_DISTANCE_METERS);
        if (deadEnd.distanceMeters <= DEAD_END_TO_TRAIL_DISTANCE_METERS && water.distanceMeters <= TRAIL_TO_WATER_DISTANCE_METERS) {
          addResult(
            path,
            "trail",
            "Walking path from dead end to water",
            Math.max(deadEnd.distanceMeters, water.distanceMeters),
            `Dead-end distance: ${formatMeters(deadEnd.distanceMeters)}. Water distance: ${formatMeters(water.distanceMeters)}.`,
          );
        }
      }
      break;

    case "preset-29": {
      addContexts(contextFeatures, context.buildings, "context-building", "building", "Building context");
      const farFromBuildings = farFromAnyPredicate(context.buildings, NO_BUILDINGS_DISTANCE_METERS);
      for (const road of context.roads) {
        const tags = getFeatureTags(road);
        if (!isUnlitRoad(tags) || isClearlyPrivate(road)) continue;
        applyClippedResult(road, farFromBuildings, (matched, lengthMeters, spans) => {
          addResult(
            matched,
            "road",
            "Unlit secluded road",
            undefined,
            `Lit tag: ${tags.lit ?? "n/a"}. ${describeClip(lengthMeters, spans)}.`,
          );
        });
      }
      break;
    }

    case "preset-30": {
      addContexts(contextFeatures, context.buildings, "context-building", "building", "Building context");
      const farFromBuildings = farFromAnyPredicate(context.buildings, NO_BUILDINGS_DISTANCE_METERS);
      for (const road of context.roads) {
        const tags = getFeatureTags(road);
        if (!isLikelyQuietRoad(tags) || !isNoSidewalkRoad(tags) || isClearlyPrivate(road)) continue;
        applyClippedResult(road, farFromBuildings, (matched, lengthMeters, spans) => {
          addResult(
            matched,
            "road",
            "No-sidewalk quiet road",
            undefined,
            `${describeClip(lengthMeters, spans)}. ${tagDetail(tags, ["sidewalk", "sidewalk:left", "sidewalk:right", "maxspeed", "highway"])}`,
          );
        });
      }
      break;
    }

    case "preset-31":
      addContexts(contextFeatures, context.roads, "context-road", "road", "Road context");
      for (const path of context.trails.filter(isWalkingPathFeature)) {
        const tags = getFeatureTags(path);
        if (isClearlyPrivate(path) || allowsMotorVehicles(tags)) continue;
        const metrics = endpointsNearDifferentFeatures(path, context.roads, 45);
        if (metrics.connected) {
          addResult(
            path,
            "trail",
            "Pedestrian cut-through between roads/neighborhoods",
            metrics.distanceMeters,
            `Connected road proximity: ${formatMeters(metrics.distanceMeters)}. ${tagDetail(tags, ["highway", "footway", "name", "access"])}`,
          );
        }
      }
      break;

    case "preset-32":
      addContexts(contextFeatures, context.roads, "context-road", "road", "Road context");
      for (const trail of context.trails.filter(isNamedTrailFeature)) {
        if (isClearlyPrivate(trail)) continue;
        const crossings = countTrailRoadIntersections(trail, context.roads);
        if (crossings > 0) {
          addResult(
            trail,
            "trail",
            "Named trail crossing a road",
            0,
            `Road intersections: ${crossings}. ${tagDetail(getFeatureTags(trail), ["name", "route", "highway", "access"])}`,
          );
        }
      }
      break;

    case "preset-33":
      addContexts(contextFeatures, context.industrial, "context-industrial", "industrial", "Industrial context");
      for (const deadEnd of deadEndCandidates(context)) {
        const industrial = nearestFeatureDistance(deadEnd, context.industrial, NEAR_PULL_OFF_DISTANCE_METERS);
        if (industrial.distanceMeters <= NEAR_PULL_OFF_DISTANCE_METERS) {
          addResult(
            deadEnd,
            "industrial",
            isClearlyPrivate(deadEnd) ? "Industrial-area dead end, restricted/private tag" : "Industrial-area dead end",
            industrial.distanceMeters,
            `Industrial area distance: ${formatMeters(industrial.distanceMeters)}. ${tagDetail(getFeatureTags(deadEnd), ["highway", "junction", "noexit", "access"])}`,
          );
        }
      }
      break;

    case "preset-34": {
      addContexts(contextFeatures, context.trees, "context-woods", "woods", "Tree context");
      addContexts(contextFeatures, context.buildings, "context-building", "building", "Building context");
      const farFromBuildings = farFromAnyPredicate(context.buildings, NO_BUILDINGS_DISTANCE_METERS);
      const nearTrees = nearAnyPredicate(
        [...context.trees, ...context.woods],
        TREE_CONTEXT_DISTANCE_METERS,
      );
      const treeLinedAndAway = andPredicates(nearTrees, farFromBuildings);
      for (const road of context.roads) {
        const tags = getFeatureTags(road);
        if (!isLowSpeedRoad(tags) || isClearlyPrivate(road)) continue;

        if (tags.tree_lined && tags.tree_lined !== "no") {
          applyClippedResult(road, farFromBuildings, (matched, lengthMeters, spans) => {
            addResult(
              matched,
              "road",
              "Low-speed tree-lined road with no mapped buildings nearby",
              undefined,
              `Direct tree_lined=${tags.tree_lined}. ${describeClip(lengthMeters, spans)}. ${tagDetail(tags, ["maxspeed", "tree_lined", "highway", "access"])}`,
            );
          });
          continue;
        }

        applyClippedResult(road, treeLinedAndAway, (matched, lengthMeters, spans) => {
          if (lengthMeters < TREE_LINED_REQUIRED_METERS) return;
          addResult(
            matched,
            "road",
            "Low-speed tree-lined road with no mapped buildings nearby",
            undefined,
            `Tree-lined run: ${describeClip(lengthMeters, spans)} (>= ${formatMeters(TREE_LINED_REQUIRED_METERS)}). ${tagDetail(tags, ["maxspeed", "tree_lined", "highway", "access"])}`,
          );
        });
      }
      break;
    }

    case "preset-35": {
      const fences = features.filter(isFenceFeature);
      const railways = features.filter(isRailwayFeature);
      const farFromFences = farFromAnyPredicate(fences, NO_FENCE_DISTANCE_METERS);
      for (const railway of railways) {
        const tags = getFeatureTags(railway);
        applyClippedResult(railway, farFromFences, (matched, lengthMeters, spans) => {
          addResult(
            matched,
            "railway",
            "Train track with no mapped fence nearby",
            undefined,
            `${describeClip(lengthMeters, spans)} (>= ${formatMeters(NO_FENCE_DISTANCE_METERS)} from any fence/wall). ${tagDetail(tags, ["railway", "name", "operator", "usage", "service", "electrified", "gauge"])}`,
          );
        });
      }
      break;
    }

    case "preset-weather":
      for (const feature of features) {
        const tags = getFeatureTags(feature);
        if (!isWeatherStation(tags)) continue;
        const operator = tags.operator?.toUpperCase() ?? "";
        const isNws = operator === "NWS" || tags.source === "NWS";
        addResult(
          feature,
          "weather-station",
          isNws ? "NWS observation station" : "Weather station",
          undefined,
          tagDetail(tags, ["name", "operator", "ref", "ele", "man_made", "amenity"]),
        );
      }
      break;
  }

  if (options.includeWater) {
    addContexts(contextFeatures, context.water, "context-water", "water", "Water context");
  }

  if (options.includeBuildings) {
    addContexts(contextFeatures, context.buildings, "context-building", "building", "Building context");
  }

  const deduped = dedupeFeatures([...resultFeatures, ...contextFeatures]);
  return capFeatures(deduped, resultFeatures.length, options.renderLimit);
}

export function createSpatialContext(features: GeoJSONFeature[]): SpatialContext {
  return {
    roads: features.filter(isRoadFeature),
    parking: features.filter(isParking),
    trails: features.filter(isTrailOrPath),
    bridges: features.filter(isBridgeOrCulvert),
    water: features.filter(isWater),
    buildings: features.filter(isBuilding),
    woods: features.filter(isWoodsFeature),
    parks: features.filter((feature) => isParkOrWoodsFeature(feature) && !isWoodsFeature(feature)),
    pullOffs: features.filter(isPullOffFeature),
    barriers: features.filter(isBarrierOrGateFeature),
    trailheads: features.filter(isTrailheadFeature),
    industrial: features.filter(isIndustrialFeature),
    trees: features.filter(isTreeFeature),
  };
}

export function isLowSpeedRoad(tags: Record<string, string>): boolean {
  const speed = normalizedMph(tags.maxspeed);
  return speed !== null && LOW_SPEED_MPH_VALUES.includes(speed as 25 | 30);
}

export function isShoulderedRoad(tags: Record<string, string>): boolean {
  return ["shoulder", "shoulder:left", "shoulder:right", "shoulder:both"].some((key) => {
    const value = tags[key]?.toLowerCase();
    return Boolean(value) && !["no", "none", "false", "0"].includes(value);
  });
}

export function isDirtRoad(tags: Record<string, string>): boolean {
  const surface = tags.surface?.toLowerCase();
  if (surface !== undefined && UNPAVED_SURFACES.has(surface)) return true;
  if (tags.highway === "track") {
    if (tags.tracktype) return true;
    return surface === undefined || !TRACK_PAVED_SURFACES.has(surface);
  }
  return false;
}

export function isWeatherStation(tags: Record<string, string>): boolean {
  if (tags.man_made === "weather_station") return true;
  if (tags.amenity === "weather_station") return true;
  if (tags.man_made === "monitoring_station" && tags["monitoring:weather"]) return true;
  return false;
}

export function isCarDrivable(tags: Record<string, string>): boolean {
  const highway = tags.highway?.toLowerCase();
  if (!highway || !CAR_DRIVABLE_HIGHWAYS.has(highway)) return false;

  for (const key of ["motor_vehicle", "vehicle"]) {
    const value = tags[key]?.toLowerCase();
    if (value && CAR_FORBIDDEN_ACCESS.has(value)) return false;
  }

  const tracktype = tags.tracktype?.toLowerCase();
  if (tracktype && CAR_UNDRIVABLE_TRACKTYPES.has(tracktype)) return false;

  const smoothness = tags.smoothness?.toLowerCase();
  if (smoothness && CAR_UNDRIVABLE_SMOOTHNESS.has(smoothness)) return false;

  const surface = tags.surface?.toLowerCase();
  if (surface && CAR_UNDRIVABLE_SURFACES.has(surface)) return false;

  return true;
}

export function isAlley(tags: Record<string, string>): boolean {
  return (
    (tags.highway === "service" && tags.service === "alley") ||
    tags.highway === "alley"
  );
}

export function isUnpavedRoad(tags: Record<string, string>): boolean {
  const surface = tags.surface?.toLowerCase();
  return (
    (surface !== undefined && UNPAVED_SURFACES.has(surface)) ||
    tags.highway === "track" ||
    Boolean(tags.tracktype)
  );
}

export function isRoughOrHighClearanceRoad(tags: Record<string, string>): boolean {
  return (
    ROUGH_TRACKTYPES.has(tags.tracktype?.toLowerCase() ?? "") ||
    ROUGH_SMOOTHNESS.has(tags.smoothness?.toLowerCase() ?? "") ||
    ROUGH_SURFACES.has(tags.surface?.toLowerCase() ?? "")
  );
}

export function isDeadEndFeature(feature: GeoJSONFeature): boolean {
  const tags = getFeatureTags(feature);
  return (
    tags.noexit === "yes" ||
    tags.junction === "cul_de_sac" ||
    tags.highway === "turning_circle" ||
    tags.highway === "turning_loop"
  );
}

export function isWoodsFeature(feature: GeoJSONFeature): boolean {
  const tags = getFeatureTags(feature);
  return tags.natural === "wood" || tags.landuse === "forest";
}

export function isParkOrWoodsFeature(feature: GeoJSONFeature): boolean {
  const tags = getFeatureTags(feature);
  return (
    isWoodsFeature(feature) ||
    tags.leisure === "park" ||
    tags.leisure === "nature_reserve" ||
    tags.boundary === "protected_area"
  );
}

export function isPullOffFeature(feature: GeoJSONFeature): boolean {
  const tags = getFeatureTags(feature);
  return (
    tags.parking === "layby" ||
    tags.parking === "street_side" ||
    tags.highway === "rest_area" ||
    tags.highway === "services" ||
    isStreetParkingTagged(tags)
  );
}

export function isParkingOrPullOffFeature(feature: GeoJSONFeature): boolean {
  return isParking(feature) || isPullOffFeature(feature);
}

export function isFordFeature(feature: GeoJSONFeature): boolean {
  const tags = getFeatureTags(feature);
  return Boolean(tags.ford) || tags.highway === "ford";
}

export function isBarrierOrGateFeature(feature: GeoJSONFeature): boolean {
  const tags = getFeatureTags(feature);
  return BARRIER_VALUES.has(tags.barrier ?? "") || (isRoadFeature(feature) && hasAccessValue(tags, RESTRICTED_VALUES));
}

export function isTrailheadFeature(feature: GeoJSONFeature): boolean {
  const tags = getFeatureTags(feature);
  return tags.tourism === "trailhead";
}

export function isUnlitRoad(tags: Record<string, string>): boolean {
  return (tags.lit === "no" || tags.lit === "limited") && isRoadTags(tags);
}

export function isNoSidewalkRoad(tags: Record<string, string>): boolean {
  return (
    ["no", "none", "separate"].includes(tags.sidewalk?.toLowerCase() ?? "") ||
    (["no", "none"].includes(tags["sidewalk:left"]?.toLowerCase() ?? "") &&
      ["no", "none"].includes(tags["sidewalk:right"]?.toLowerCase() ?? ""))
  );
}

export function isIndustrialFeature(feature: GeoJSONFeature): boolean {
  const tags = getFeatureTags(feature);
  return tags.landuse === "industrial" || Boolean(tags.industrial);
}

export function isRailwayFeature(feature: GeoJSONFeature): boolean {
  const tags = getFeatureTags(feature);
  return RAILWAY_TRACK_VALUES.has(tags.railway ?? "");
}

export function isFenceFeature(feature: GeoJSONFeature): boolean {
  const tags = getFeatureTags(feature);
  return FENCE_BARRIER_VALUES.has(tags.barrier ?? "") || Boolean(tags.fence_type);
}

export function isNamedTrailFeature(feature: GeoJSONFeature): boolean {
  const tags = getFeatureTags(feature);
  return Boolean(tags.name) && (isTrailOrPath(feature) || tags.route === "hiking" || tags.route === "foot");
}

export function isStreetParkingLegalish(tags: Record<string, string>): boolean {
  return isRoadTags(tags) && isStreetParkingTagged(tags) && !hasNoParking(tags) && !hasAccessValue(tags, PRIVATE_VALUES);
}

export function isLikelyQuietRoad(tags: Record<string, string>): boolean {
  return QUIET_ROAD_TYPES.has(tags.highway ?? "") && !hasAccessValue(tags, PRIVATE_VALUES);
}

export function roadEndsNearFeature(
  roadFeature: GeoJSONFeature,
  contextFeatures: GeoJSONFeature[],
  maxMeters: number,
): boolean {
  return roadEndsNearFeatureDistance(roadFeature, contextFeatures, maxMeters).distanceMeters <= maxMeters;
}

export function featureNearAny(
  feature: GeoJSONFeature,
  contextFeatures: GeoJSONFeature[],
  maxMeters: number,
): boolean {
  return nearestFeatureDistance(feature, contextFeatures, maxMeters).distanceMeters <= maxMeters;
}

export function pathConnectsFeatureGroups(
  pathFeature: GeoJSONFeature,
  groupA: GeoJSONFeature[],
  groupB: GeoJSONFeature[],
  maxMeters: number,
): boolean {
  return pathConnectionMetrics(pathFeature, groupA, groupB, maxMeters, maxMeters).connected;
}

function capFeatures(
  features: GeoJSONFeature[],
  resultCount: number,
  renderLimit: number,
): PresetResult {
  const capped = features.length > renderLimit;
  const rendered = capped ? features.slice(0, renderLimit) : features;
  const renderedResults = rendered.filter(
    (feature) => feature.properties?.scoutRole === "result",
  ).length;

  return {
    features: rendered,
    resultCount: Math.min(resultCount, renderedResults || resultCount),
    contextCount: rendered.length - renderedResults,
    capped,
    warnings: capped
      ? [`Rendering capped at ${renderLimit.toLocaleString()} features. Zoom in for more detail.`]
      : [],
  };
}

function addContexts(
  target: GeoJSONFeature[],
  features: GeoJSONFeature[],
  role: ScoutRole,
  category: ScoutCategory,
  label: string,
): void {
  for (const [index, feature] of features.entries()) {
    target.push(tagContext(feature, index, role, category, label));
  }
}

function tagContext(
  feature: GeoJSONFeature,
  index: number,
  role: ScoutRole,
  category: ScoutCategory,
  label: string,
): GeoJSONFeature {
  return attachScoutMetadata(feature, index, role, category, { label, category });
}

function dedupeFeatures(features: GeoJSONFeature[]): GeoJSONFeature[] {
  const seen = new Set<string>();
  const output: GeoJSONFeature[] = [];

  for (const feature of features) {
    const key = `${feature.properties?.type ?? "feature"}-${feature.properties?.id ?? output.length}-${
      feature.properties?.scoutRole ?? "result"
    }-${feature.properties?.scoutCategory ?? "simple"}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    output.push(feature);
  }

  return output;
}

function categoryForFeature(feature: GeoJSONFeature): ScoutCategory {
  if (isRailwayFeature(feature)) return "railway";
  if (isBarrierOrGateFeature(feature)) return "barrier";
  if (isFordFeature(feature)) return "water-crossing";
  if (isBridgeOrCulvert(feature)) return "bridge";
  if (isWater(feature)) return "water";
  if (isBuilding(feature)) return "building";
  if (isPullOffFeature(feature)) return "pull-off";
  if (isParking(feature)) return "parking";
  if (isIndustrialFeature(feature)) return "industrial";
  if (isWoodsFeature(feature)) return "woods";
  if (isParkOrWoodsFeature(feature)) return "park";
  if (isTrailOrPath(feature)) return "trail";
  if (isRoadFeature(feature)) return "road";
  return "simple";
}

function isParking(feature: GeoJSONFeature): boolean {
  const tags = getFeatureTags(feature);
  return tags.amenity === "parking" || tags.parking === "surface" || tags.parking === "street_side";
}

function isRoadFeature(feature: GeoJSONFeature): boolean {
  return isRoadTags(getFeatureTags(feature));
}

function isRoadTags(tags: Record<string, string>): boolean {
  return ROAD_TYPES.has(tags.highway ?? "");
}

function isTrailOrPath(feature: GeoJSONFeature): boolean {
  const tags = getFeatureTags(feature);
  return TRAIL_TYPES.has(tags.highway ?? "") || tags.route === "hiking" || tags.route === "foot";
}

function isWalkingPathFeature(feature: GeoJSONFeature): boolean {
  const tags = getFeatureTags(feature);
  return WALKING_PATH_TYPES.has(tags.highway ?? "") || tags.route === "foot" || tags.route === "hiking";
}

function isBridgeOrCulvert(feature: GeoJSONFeature): boolean {
  const tags = getFeatureTags(feature);
  return (
    (Boolean(tags.bridge) && tags.bridge !== "no") ||
    tags.man_made === "bridge" ||
    tags.tunnel === "culvert"
  );
}

function isWater(feature: GeoJSONFeature): boolean {
  const tags = getFeatureTags(feature);
  return Boolean(tags.waterway) || tags.natural === "water" || Boolean(tags.water);
}

function isBuilding(feature: GeoJSONFeature): boolean {
  const tags = getFeatureTags(feature);
  return Boolean(tags.building) && tags.building !== "no";
}

function isTreeFeature(feature: GeoJSONFeature): boolean {
  const tags = getFeatureTags(feature);
  return tags.natural === "tree" || tags.natural === "tree_row";
}

function isClearlyPrivate(feature: GeoJSONFeature): boolean {
  return hasAccessValue(getFeatureTags(feature), PRIVATE_VALUES);
}

function isClearlyRestricted(feature: GeoJSONFeature): boolean {
  return hasAccessValue(getFeatureTags(feature), RESTRICTED_VALUES);
}

function hasAccessValue(tags: Record<string, string>, values: Set<string>): boolean {
  return [
    "access",
    "foot",
    "vehicle",
    "motor_vehicle",
    "motorcar",
    "bicycle",
    "private",
  ].some((key) => values.has(tags[key]?.toLowerCase() ?? ""));
}

function hasGolfCartTag(tags: Record<string, string>): boolean {
  return Boolean(tags.golf_cart || tags["vehicle:golf_cart"] || tags.low_speed_vehicle);
}

function allowsMotorVehicles(tags: Record<string, string>): boolean {
  return ["yes", "designated", "permissive"].some(
    (value) => tags.motor_vehicle === value || tags.vehicle === value || tags.motorcar === value,
  );
}

function hasNoParking(tags: Record<string, string>): boolean {
  return STREET_PARKING_KEYS.some((key) => PARKING_FORBIDDEN_PATTERN.test(tags[key] ?? ""));
}

function isStreetParkingTagged(tags: Record<string, string>): boolean {
  return STREET_PARKING_KEYS.some((key) => {
    const value = tags[key];
    return Boolean(value) && !PARKING_FORBIDDEN_PATTERN.test(value);
  });
}

function normalizedMph(value: string | undefined): number | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  const match = normalized.match(/^(\d+)\s*(mph|mp\/h)?$/);
  if (!match) return null;
  return Number(match[1]);
}

function isSpecificMph(tags: Record<string, string>, mph: number): boolean {
  return normalizedMph(tags.maxspeed) === mph;
}

function deadEndCandidates(context: SpatialContext): GeoJSONFeature[] {
  return dedupeFeatures([
    ...context.roads.filter(isDeadEndFeature),
    ...context.roads.filter((feature) => getFeatureTags(feature).noexit === "yes"),
    ...context.trails.filter(isDeadEndFeature),
  ]);
}

function nearestFeatureDistance(
  feature: GeoJSONFeature,
  features: GeoJSONFeature[],
  stopAtMeters: number,
): { distanceMeters: number; feature?: GeoJSONFeature } {
  let best = Number.POSITIVE_INFINITY;
  let bestFeature: GeoJSONFeature | undefined;
  const featureId = getOsmId(feature);

  for (const candidate of features) {
    if (candidate === feature) continue;
    if (featureId !== undefined && getOsmId(candidate) === featureId) continue;
    const currentDistance = distanceBetweenFeaturesMeters(feature, candidate);
    if (currentDistance < best) {
      best = currentDistance;
      bestFeature = candidate;
    }
    if (best <= stopAtMeters) {
      break;
    }
  }

  return { distanceMeters: best, feature: bestFeature };
}

function nearestDistanceToFeatures(
  coordinate: LatLng,
  features: GeoJSONFeature[],
  stopAtMeters: number,
): { distanceMeters: number; feature?: GeoJSONFeature } {
  let best = Number.POSITIVE_INFINITY;
  let bestFeature: GeoJSONFeature | undefined;

  for (const feature of features) {
    const currentDistance = distanceFromCoordinateToFeatureMeters(coordinate, feature);
    if (currentDistance < best) {
      best = currentDistance;
      bestFeature = feature;
    }
    if (best <= stopAtMeters) {
      break;
    }
  }

  return { distanceMeters: best, feature: bestFeature };
}

function roadEndsNearFeatureDistance(
  roadFeature: GeoJSONFeature,
  contextFeatures: GeoJSONFeature[],
  maxMeters: number,
): { distanceMeters: number; feature?: GeoJSONFeature } {
  const endpoints = firstLineEndpoints(roadFeature);
  if (!endpoints) {
    return nearestFeatureDistance(roadFeature, contextFeatures, maxMeters);
  }

  const first = nearestDistanceToFeatures(endpoints[0], contextFeatures, maxMeters);
  const last = nearestDistanceToFeatures(endpoints[1], contextFeatures, maxMeters);
  return first.distanceMeters <= last.distanceMeters ? first : last;
}

function pathConnectionMetrics(
  pathFeature: GeoJSONFeature,
  groupA: GeoJSONFeature[],
  groupB: GeoJSONFeature[],
  groupAMeters: number,
  groupBMeters: number,
): { connected: boolean; distanceMeters: number } {
  const endpoints = firstLineEndpoints(pathFeature);
  if (!endpoints) return { connected: false, distanceMeters: Number.POSITIVE_INFINITY };

  const firstA = nearestDistanceToFeatures(endpoints[0], groupA, groupAMeters);
  const lastB = nearestDistanceToFeatures(endpoints[1], groupB, groupBMeters);
  const firstB = nearestDistanceToFeatures(endpoints[0], groupB, groupBMeters);
  const lastA = nearestDistanceToFeatures(endpoints[1], groupA, groupAMeters);

  const forward =
    firstA.distanceMeters <= groupAMeters &&
    lastB.distanceMeters <= groupBMeters &&
    differentFeature(firstA.feature, lastB.feature);
  const reverse =
    firstB.distanceMeters <= groupBMeters &&
    lastA.distanceMeters <= groupAMeters &&
    differentFeature(firstB.feature, lastA.feature);

  if (forward) {
    return { connected: true, distanceMeters: Math.max(firstA.distanceMeters, lastB.distanceMeters) };
  }
  if (reverse) {
    return { connected: true, distanceMeters: Math.max(firstB.distanceMeters, lastA.distanceMeters) };
  }
  return { connected: false, distanceMeters: Number.POSITIVE_INFINITY };
}

function endpointsNearDifferentFeatures(
  pathFeature: GeoJSONFeature,
  candidates: GeoJSONFeature[],
  maxMeters: number,
): { connected: boolean; distanceMeters: number } {
  const endpoints = firstLineEndpoints(pathFeature);
  if (!endpoints) return { connected: false, distanceMeters: Number.POSITIVE_INFINITY };

  const first = nearestDistanceToFeatures(endpoints[0], candidates, maxMeters);
  const last = nearestDistanceToFeatures(endpoints[1], candidates, maxMeters);
  return {
    connected:
      first.distanceMeters <= maxMeters &&
      last.distanceMeters <= maxMeters &&
      differentFeature(first.feature, last.feature),
    distanceMeters: Math.max(first.distanceMeters, last.distanceMeters),
  };
}

function differentFeature(a?: GeoJSONFeature, b?: GeoJSONFeature): boolean {
  if (!a || !b) return false;
  const aId = getOsmId(a);
  const bId = getOsmId(b);
  return aId === undefined || bId === undefined ? a !== b : aId !== bId;
}

function distanceBetweenFeaturesMeters(a: GeoJSONFeature, b: GeoJSONFeature): number {
  let best = Number.POSITIVE_INFINITY;
  for (const coordinate of sampleFeatureCoordinates(a, 8)) {
    best = Math.min(best, distanceFromCoordinateToFeatureMeters(coordinate, b));
    if (best === 0) return 0;
  }
  for (const coordinate of sampleFeatureCoordinates(b, 8)) {
    best = Math.min(best, distanceFromCoordinateToFeatureMeters(coordinate, a));
    if (best === 0) return 0;
  }
  return best;
}

function distanceFromCoordinateToFeatureMeters(
  coordinate: LatLng,
  feature: GeoJSONFeature,
): number {
  const pointFeature = point([coordinate.lng, coordinate.lat]);
  const geometry = feature.geometry;

  if (geometry.type === "Point") {
    return distance(pointFeature, geometry.coordinates, { units: "kilometers" }) * 1000;
  }

  if (geometry.type === "MultiPoint") {
    return Math.min(
      ...geometry.coordinates.map(
        (featureCoordinate) =>
          distance(pointFeature, featureCoordinate, { units: "kilometers" }) * 1000,
      ),
    );
  }

  if (geometry.type === "Polygon" || geometry.type === "MultiPolygon") {
    const polygon = feature as Feature<Polygon | MultiPolygon>;
    if (booleanPointInPolygon(pointFeature, polygon)) {
      return 0;
    }
    return distanceToPolygonBoundaryMeters(pointFeature, geometry);
  }

  if (geometry.type === "LineString" || geometry.type === "MultiLineString") {
    return distanceToLineishFeatureMeters(pointFeature, feature);
  }

  const center = centroid(feature) as Feature<Point>;
  return distance(pointFeature, center, { units: "kilometers" }) * 1000;
}

function distanceToPolygonBoundaryMeters(
  pointFeature: Feature<Point>,
  geometry: Polygon | MultiPolygon,
): number {
  const rings =
    geometry.type === "Polygon"
      ? geometry.coordinates
      : geometry.coordinates.flatMap((polygonCoordinates) => polygonCoordinates);

  if (rings.length === 0) {
    return Number.POSITIVE_INFINITY;
  }

  return Math.min(
    ...rings
      .filter((ring) => ring.length >= 2)
      .map(
        (ring) =>
          pointToLineDistance(pointFeature, lineString(ring), {
            units: "kilometers",
          }) * 1000,
      ),
  );
}

function distanceToLineishFeatureMeters(
  pointFeature: Feature<Point>,
  feature: GeoJSONFeature,
): number {
  const geometry = feature.geometry;

  if (geometry.type === "LineString") {
    const line = feature as Feature<LineString>;
    return pointToLineDistance(pointFeature, line, { units: "kilometers" }) * 1000;
  }

  if (geometry.type === "MultiLineString") {
    if (geometry.coordinates.length === 0) return Number.POSITIVE_INFINITY;
    return Math.min(
      ...geometry.coordinates.map(
        (coordinates) =>
          pointToLineDistance(pointFeature, lineString(coordinates), {
            units: "kilometers",
          }) * 1000,
      ),
    );
  }

  const center = representativeCoordinate(feature);
  return distance(pointFeature, [center.lng, center.lat], { units: "kilometers" }) * 1000;
}

function sampleFeatureCoordinates(feature: GeoJSONFeature, maxSamples: number): LatLng[] {
  const positions = flattenPositions(feature.geometry).filter(
    (position) => Number.isFinite(position[0]) && Number.isFinite(position[1]),
  );
  const samples: LatLng[] = [representativeCoordinate(feature)];

  if (positions.length === 0) {
    return samples;
  }

  const step = Math.max(1, Math.floor(positions.length / Math.max(1, maxSamples - 1)));
  for (let index = 0; index < positions.length && samples.length < maxSamples; index += step) {
    const position = positions[index];
    samples.push({ lat: position[1], lng: position[0] });
  }

  const last = positions[positions.length - 1];
  if (samples.length < maxSamples) {
    samples.push({ lat: last[1], lng: last[0] });
  }

  return samples;
}

function flattenPositions(geometry: Geometry): Position[] {
  switch (geometry.type) {
    case "Point":
      return [geometry.coordinates];
    case "MultiPoint":
    case "LineString":
      return geometry.coordinates;
    case "MultiLineString":
    case "Polygon":
      return geometry.coordinates.flat();
    case "MultiPolygon":
      return geometry.coordinates.flat(2);
    case "GeometryCollection":
      return geometry.geometries.flatMap(flattenPositions);
  }
}

function extractLineStrings(geometry: Geometry): Position[][] {
  if (geometry.type === "LineString") return [geometry.coordinates];
  if (geometry.type === "MultiLineString") return geometry.coordinates;
  return [];
}

function countTrailRoadIntersections(
  trail: GeoJSONFeature,
  roads: GeoJSONFeature[],
): number {
  const trailLines = extractLineStrings(trail.geometry);
  if (trailLines.length === 0) return 0;

  const trailId = getOsmId(trail);
  let total = 0;
  for (const road of roads) {
    if (trailId !== undefined && getOsmId(road) === trailId) continue;
    const roadLines = extractLineStrings(road.geometry);
    for (const trailLine of trailLines) {
      if (trailLine.length < 2) continue;
      for (const roadLine of roadLines) {
        if (roadLine.length < 2) continue;
        const intersections = lineIntersect(lineString(trailLine), lineString(roadLine));
        total += intersections.features.length;
      }
    }
  }
  return total;
}

function sampleLineAtInterval(line: Position[], stepMeters: number): LatLng[] {
  const samples: LatLng[] = [];
  if (line.length === 0) return samples;
  samples.push({ lat: line[0][1], lng: line[0][0] });
  if (line.length < 2) return samples;

  let nextSampleAt = stepMeters;
  let cumulative = 0;
  for (let i = 0; i < line.length - 1; i++) {
    const a = line[i];
    const b = line[i + 1];
    const segMeters = distance(a, b, { units: "kilometers" }) * 1000;
    if (segMeters === 0) continue;
    while (nextSampleAt <= cumulative + segMeters) {
      const t = (nextSampleAt - cumulative) / segMeters;
      samples.push({ lat: a[1] + (b[1] - a[1]) * t, lng: a[0] + (b[0] - a[0]) * t });
      nextSampleAt += stepMeters;
    }
    cumulative += segMeters;
  }
  return samples;
}

export interface ClippedRoad {
  feature: GeoJSONFeature;
  spans: number;
  lengthMeters: number;
}

function farFromAnyPredicate(
  features: GeoJSONFeature[],
  minMeters: number,
): (sample: LatLng) => boolean {
  if (features.length === 0) return () => true;
  return (sample) =>
    nearestDistanceToFeatures(sample, features, minMeters).distanceMeters > minMeters;
}

function applyClippedResult(
  feature: GeoJSONFeature,
  predicate: (sample: LatLng) => boolean,
  onMatch: (matched: GeoJSONFeature, lengthMeters: number, spans: number) => void,
): void {
  const geometry = feature.geometry;
  if (geometry.type === "LineString" || geometry.type === "MultiLineString") {
    const clipped = clipRoadToPredicate(feature, predicate);
    if (clipped) {
      onMatch(clipped.feature, clipped.lengthMeters, clipped.spans);
    }
    return;
  }
  const coord = representativeCoordinate(feature);
  if (predicate(coord)) {
    onMatch(feature, 0, 1);
  }
}

function nearAnyPredicate(
  features: GeoJSONFeature[],
  maxMeters: number,
): (sample: LatLng) => boolean {
  if (features.length === 0) return () => false;
  return (sample) =>
    nearestDistanceToFeatures(sample, features, maxMeters).distanceMeters <= maxMeters;
}

function andPredicates(
  ...predicates: Array<(sample: LatLng) => boolean>
): (sample: LatLng) => boolean {
  return (sample) => predicates.every((predicate) => predicate(sample));
}

function describeClip(lengthMeters: number, spans: number): string {
  if (lengthMeters <= 0) return "Matched at single point";
  return `Matching run: ${formatMeters(lengthMeters)} across ${spans} span(s)`;
}

export function clipRoadToPredicate(
  road: GeoJSONFeature,
  predicate: (sample: LatLng) => boolean,
  stepMeters: number = 10,
): ClippedRoad | null {
  const lines = extractLineStrings(road.geometry);
  if (lines.length === 0) return null;

  const passingLines: Position[][] = [];
  for (const line of lines) {
    const samples = sampleLineAtInterval(line, stepMeters);
    let currentRun: Position[] = [];
    for (const sample of samples) {
      if (predicate(sample)) {
        currentRun.push([sample.lng, sample.lat]);
      } else {
        if (currentRun.length >= 2) passingLines.push(currentRun);
        currentRun = [];
      }
    }
    if (currentRun.length >= 2) passingLines.push(currentRun);
  }

  if (passingLines.length === 0) return null;

  const totalMeters = passingLines.reduce((sum, line) => sum + lineLengthMeters(line), 0);
  const geometry: Geometry =
    passingLines.length === 1
      ? { type: "LineString", coordinates: passingLines[0] }
      : { type: "MultiLineString", coordinates: passingLines };

  return {
    feature: {
      ...road,
      geometry,
    },
    spans: passingLines.length,
    lengthMeters: totalMeters,
  };
}

function lineLengthMeters(positions: Position[]): number {
  let total = 0;
  for (let i = 0; i < positions.length - 1; i++) {
    total += distance(positions[i], positions[i + 1], { units: "kilometers" }) * 1000;
  }
  return total;
}

function finiteDistance(distanceMeters: number): number | undefined {
  return Number.isFinite(distanceMeters) ? distanceMeters : undefined;
}

function formatMeters(distanceMeters: number): string {
  if (!Number.isFinite(distanceMeters)) {
    return `none within ${NO_BUILDINGS_DISTANCE_METERS.toFixed(1)} m`;
  }
  return distanceMeters < 10 ? `${distanceMeters.toFixed(1)} m` : `${Math.round(distanceMeters)} m`;
}

function tagDetail(tags: Record<string, string>, keys: string[]): string {
  const parts = keys
    .filter((key) => tags[key] !== undefined)
    .map((key) => `${key}=${tags[key]}`);
  return parts.length > 0 ? parts.join("; ") : "No priority tags present.";
}

function parkingDetail(tags: Record<string, string>): string {
  return tagDetail(tags, [...STREET_PARKING_KEYS, "access"]);
}
