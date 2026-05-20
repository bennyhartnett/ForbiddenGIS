import booleanPointInPolygon from "@turf/boolean-point-in-polygon";
import centroid from "@turf/centroid";
import distance from "@turf/distance";
import { lineString, point } from "@turf/helpers";
import nearestPointOnLine from "@turf/nearest-point-on-line";
import pointToLineDistance from "@turf/point-to-line-distance";
import type { Feature, LineString, Point, Polygon } from "geojson";
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

const PRIVATE_VALUES = new Set(["private", "no", "customers", "permit"]);
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
const TRAIL_TYPES = new Set([
  "path",
  "footway",
  "bridleway",
  "cycleway",
  "track",
  "steps",
  "pedestrian",
]);

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

  switch (preset.id) {
    case "road-adjacent-parking":
      contextFeatures.push(
        ...context.roads.map((feature, index) =>
          tagContext(feature, index, "context-road", "road", "Road context"),
        ),
      );
      for (const [index, parking] of context.parking.entries()) {
        const nearest = nearestDistanceToFeatures(
          representativeCoordinate(parking),
          context.roads,
          80,
        );
        if (nearest.distanceMeters <= 80) {
          resultFeatures.push(
            attachScoutMetadata(parking, index, "result", "parking", {
              label: "Parking within 80 m of a drivable road",
              distanceMeters: nearest.distanceMeters,
              category: "parking",
            }),
          );
        }
      }
      break;
    case "trail-path-access":
      contextFeatures.push(
        ...context.roads.map((feature, index) =>
          tagContext(feature, index, "context-road", "road", "Road context"),
        ),
        ...context.parking.map((feature, index) =>
          tagContext(feature, index, "context-parking", "parking", "Parking context"),
        ),
      );
      for (const [index, trail] of context.trails.entries()) {
        if (isClearlyPrivate(trail)) {
          continue;
        }
        const coordinate = representativeCoordinate(trail);
        const roadDistance = nearestDistanceToFeatures(coordinate, context.roads, 75);
        const parkingDistance = nearestDistanceToFeatures(coordinate, context.parking, 75);
        const bestDistance = Math.min(
          roadDistance.distanceMeters,
          parkingDistance.distanceMeters,
        );
        if (bestDistance <= 75) {
          resultFeatures.push(
            attachScoutMetadata(trail, index, "result", "trail", {
              label: "Trail/path within 75 m of a road or parking feature",
              distanceMeters: bestDistance,
              category: "trail",
            }),
          );
        }
      }
      break;
    case "road-to-road-walking-trail":
      contextFeatures.push(
        ...context.roads.map((feature, index) =>
          tagContext(feature, index, "context-road", "road", "Road context"),
        ),
      );
      for (const [index, trail] of context.trails.entries()) {
        if (isClearlyPrivate(trail)) {
          continue;
        }

        const endpoints = firstLineEndpoints(trail);
        if (!endpoints) {
          continue;
        }

        const firstRoad = nearestRoadForPoint(endpoints[0], context.roads, 55);
        const secondRoad = nearestRoadForPoint(endpoints[1], context.roads, 55);

        if (
          firstRoad.distanceMeters <= 55 &&
          secondRoad.distanceMeters <= 55 &&
          firstRoad.osmId !== secondRoad.osmId
        ) {
          resultFeatures.push(
            attachScoutMetadata(trail, index, "result", "trail", {
              label: "Walking route endpoints approach two different roads",
              distanceMeters: Math.max(firstRoad.distanceMeters, secondRoad.distanceMeters),
              category: "trail",
            }),
          );
        }
      }
      break;
    case "bridges-overpasses":
      for (const [index, bridge] of context.bridges.entries()) {
        resultFeatures.push(
          attachScoutMetadata(bridge, index, "result", "bridge", {
            label: "Bridge or overpass tag",
            category: "bridge",
          }),
        );
      }
      break;
    case "water-crossing-context":
      contextFeatures.push(
        ...context.water.map((feature, index) =>
          tagContext(feature, index, "context-water", "water", "Water context"),
        ),
      );
      for (const [index, crossing] of context.bridges.entries()) {
        const nearest = nearestDistanceToFeatures(
          representativeCoordinate(crossing),
          context.water,
          90,
        );
        const hasWaterNearby = nearest.distanceMeters <= 90 || context.water.length === 0;
        if (hasWaterNearby) {
          resultFeatures.push(
            attachScoutMetadata(crossing, index, "result", "water-crossing", {
              label:
                context.water.length > 0
                  ? "Bridge/culvert candidate near mapped water"
                  : "Bridge/culvert candidate",
              distanceMeters:
                Number.isFinite(nearest.distanceMeters) ? nearest.distanceMeters : undefined,
              category: "water-crossing",
            }),
          );
        }
      }
      break;
  }

  if (options.includeWater) {
    contextFeatures.push(
      ...context.water.map((feature, index) =>
        tagContext(feature, index, "context-water", "water", "Water context"),
      ),
    );
  }

  if (options.includeBuildings) {
    contextFeatures.push(
      ...context.buildings.map((feature, index) =>
        tagContext(feature, index, "context-building", "building", "Building context"),
      ),
    );
  }

  const deduped = dedupeFeatures([...resultFeatures, ...contextFeatures]);
  return capFeatures(deduped, resultFeatures.length, options.renderLimit);
}

export function createSpatialContext(features: GeoJSONFeature[]): SpatialContext {
  return {
    roads: features.filter(isDrivableRoad),
    parking: features.filter(isParking),
    trails: features.filter(isTrailOrPath),
    bridges: features.filter(isBridgeOrCulvert),
    water: features.filter(isWater),
    buildings: features.filter(isBuilding),
  };
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
    }`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    output.push(feature);
  }

  return output;
}

function categoryForFeature(feature: GeoJSONFeature): ScoutCategory {
  if (isBridgeOrCulvert(feature)) return "bridge";
  if (isWater(feature)) return "water";
  if (isBuilding(feature)) return "building";
  if (isParking(feature)) return "parking";
  if (isTrailOrPath(feature)) return "trail";
  if (isDrivableRoad(feature)) return "road";
  return "simple";
}

function isParking(feature: GeoJSONFeature): boolean {
  const tags = getFeatureTags(feature);
  return tags.amenity === "parking" || Boolean(tags.parking);
}

function isDrivableRoad(feature: GeoJSONFeature): boolean {
  const tags = getFeatureTags(feature);
  return ROAD_TYPES.has(tags.highway ?? "") && !isClearlyPrivate(feature);
}

function isTrailOrPath(feature: GeoJSONFeature): boolean {
  const tags = getFeatureTags(feature);
  return TRAIL_TYPES.has(tags.highway ?? "") || tags.route === "hiking";
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

function isClearlyPrivate(feature: GeoJSONFeature): boolean {
  const tags = getFeatureTags(feature);
  return (
    PRIVATE_VALUES.has(tags.access ?? "") ||
    PRIVATE_VALUES.has(tags.foot ?? "") ||
    PRIVATE_VALUES.has(tags.vehicle ?? "")
  );
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

function nearestRoadForPoint(
  coordinate: LatLng,
  roads: GeoJSONFeature[],
  stopAtMeters: number,
): { distanceMeters: number; osmId?: string | number } {
  let best = Number.POSITIVE_INFINITY;
  let osmId: string | number | undefined;
  const pointFeature = point([coordinate.lng, coordinate.lat]);

  for (const road of roads) {
    const roadDistance = distanceToLineishFeatureMeters(pointFeature, road);
    if (roadDistance < best) {
      best = roadDistance;
      osmId = getOsmId(road);
    }
    if (best <= stopAtMeters) {
      break;
    }
  }

  return { distanceMeters: best, osmId };
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

  if (geometry.type === "Polygon") {
    const polygon = feature as Feature<Polygon>;
    if (booleanPointInPolygon(pointFeature, polygon)) {
      return 0;
    }
  }

  if (geometry.type === "LineString" || geometry.type === "MultiLineString") {
    return distanceToLineishFeatureMeters(pointFeature, feature);
  }

  const center = centroid(feature) as Feature<Point>;
  return distance(pointFeature, center, { units: "kilometers" }) * 1000;
}

function distanceToLineishFeatureMeters(
  pointFeature: Feature<Point>,
  feature: GeoJSONFeature,
): number {
  const geometry = feature.geometry;

  if (geometry.type === "LineString") {
    const line = feature as Feature<LineString>;
    nearestPointOnLine(line, pointFeature, { units: "kilometers" });
    return pointToLineDistance(pointFeature, line, { units: "kilometers" }) * 1000;
  }

  if (geometry.type === "MultiLineString") {
    return Math.min(
      ...geometry.coordinates.map((coordinates) =>
        pointToLineDistance(pointFeature, lineString(coordinates), {
          units: "kilometers",
        }) * 1000,
      ),
    );
  }

  const center = representativeCoordinate(feature);
  return distance(pointFeature, [center.lng, center.lat], { units: "kilometers" }) * 1000;
}
