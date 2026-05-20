import turfBbox from "@turf/bbox";
import centroid from "@turf/centroid";
import distance from "@turf/distance";
import type {
  Feature,
  FeatureCollection,
  GeoJsonProperties,
  Geometry,
  LineString,
  MultiLineString,
  Point,
  Polygon,
} from "geojson";

export interface BBox {
  south: number;
  west: number;
  north: number;
  east: number;
}

export interface LatLng {
  lat: number;
  lng: number;
}

export interface MatchReason {
  label: string;
  detail?: string;
  distanceMeters?: number;
  category?: ScoutCategory;
}

export type ScoutRole =
  | "result"
  | "context-road"
  | "context-parking"
  | "context-water"
  | "context-building";

export type ScoutCategory =
  | "simple"
  | "road"
  | "parking"
  | "trail"
  | "bridge"
  | "water"
  | "building"
  | "water-crossing";

export interface ScoutFeatureProperties {
  [key: string]: unknown;
  id?: number | string;
  type?: string;
  tags?: Record<string, string>;
  scoutId?: string;
  scoutRole?: ScoutRole;
  scoutCategory?: ScoutCategory;
  scoutMatchReason?: string;
  scoutMatchDistanceMeters?: number;
  scoutLat?: number;
  scoutLng?: number;
  scoutSelected?: boolean;
}

export type GeoJSONFeature = Feature<Geometry, ScoutFeatureProperties>;
export type GeoJSONFeatureCollection = FeatureCollection<
  Geometry,
  ScoutFeatureProperties
>;

export interface SelectedFeature {
  scoutId: string;
  name: string;
  osmType?: string;
  osmId?: number | string;
  coordinate: LatLng;
  tags: Record<string, string>;
  matchReason: MatchReason;
  category: ScoutCategory;
  role: ScoutRole;
}

export type PresetId =
  | "road-adjacent-parking"
  | "trail-path-access"
  | "road-to-road-walking-trail"
  | "bridges-overpasses"
  | "water-crossing-context";

export interface PresetDefinition {
  id: PresetId;
  name: string;
  description: string;
  minZoom: number;
  heavy: boolean;
  supportsBuildings: boolean;
  supportsWater: boolean;
}

export interface SpatialContext {
  roads: GeoJSONFeature[];
  parking: GeoJSONFeature[];
  trails: GeoJSONFeature[];
  bridges: GeoJSONFeature[];
  water: GeoJSONFeature[];
  buildings: GeoJSONFeature[];
}

export interface PresetResult {
  features: GeoJSONFeature[];
  resultCount: number;
  contextCount: number;
  capped: boolean;
  warnings: string[];
}

export function googleBoundsToBBox(bounds: google.maps.LatLngBounds): BBox {
  const southWest = bounds.getSouthWest();
  const northEast = bounds.getNorthEast();

  return {
    south: southWest.lat(),
    west: southWest.lng(),
    north: northEast.lat(),
    east: northEast.lng(),
  };
}

export function bboxToOverpass(bbox: BBox): string {
  return [
    bbox.south.toFixed(7),
    bbox.west.toFixed(7),
    bbox.north.toFixed(7),
    bbox.east.toFixed(7),
  ].join(",");
}

export function bboxDiagonalKm(bbox: BBox): number {
  return distance(
    [bbox.west, bbox.south],
    [bbox.east, bbox.north],
    { units: "kilometers" },
  );
}

export function bboxCenter(bbox: BBox): LatLng {
  return {
    lat: (bbox.south + bbox.north) / 2,
    lng: (bbox.west + bbox.east) / 2,
  };
}

export function featureBounds(feature: GeoJSONFeature): BBox | null {
  try {
    const [west, south, east, north] = turfBbox(feature);
    return { south, west, north, east };
  } catch {
    return null;
  }
}

export function representativeCoordinate(feature: GeoJSONFeature): LatLng {
  const props = feature.properties;

  if (typeof props?.scoutLat === "number" && typeof props?.scoutLng === "number") {
    return { lat: props.scoutLat, lng: props.scoutLng };
  }

  try {
    const center = centroid(feature) as Feature<Point, GeoJsonProperties>;
    const [lng, lat] = center.geometry.coordinates;
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      return { lat, lng };
    }
  } catch {
    // Fall through to coordinate traversal.
  }

  const fallback = firstCoordinate(feature.geometry);
  if (fallback) {
    return { lat: fallback[1], lng: fallback[0] };
  }

  return { lat: 0, lng: 0 };
}

export function attachScoutMetadata(
  feature: GeoJSONFeature,
  index: number,
  role: ScoutRole,
  category: ScoutCategory,
  reason: MatchReason,
): GeoJSONFeature {
  const copy = structuredClone(feature) as GeoJSONFeature;
  const coordinate = representativeCoordinate(copy);
  const tags = getFeatureTags(copy);
  const osmType = getOsmType(copy);
  const osmId = getOsmId(copy);
  const scoutId = `${osmType ?? "feature"}-${osmId ?? index}`;

  copy.properties = {
    ...(copy.properties ?? {}),
    tags,
    scoutId,
    scoutRole: role,
    scoutCategory: category,
    scoutMatchReason: reason.label,
    scoutMatchDistanceMeters: reason.distanceMeters,
    scoutLat: coordinate.lat,
    scoutLng: coordinate.lng,
    scoutSelected: false,
  };

  return copy;
}

export function getFeatureTags(feature: GeoJSONFeature): Record<string, string> {
  const props = feature.properties ?? {};
  const nestedTags = props.tags;

  if (nestedTags && typeof nestedTags === "object" && !Array.isArray(nestedTags)) {
    return Object.fromEntries(
      Object.entries(nestedTags).map(([key, value]) => [key, String(value)]),
    );
  }

  const excluded = new Set([
    "id",
    "type",
    "relations",
    "meta",
    "tainted",
    "scoutId",
    "scoutRole",
    "scoutCategory",
    "scoutMatchReason",
    "scoutMatchDistanceMeters",
    "scoutLat",
    "scoutLng",
    "scoutSelected",
  ]);

  return Object.fromEntries(
    Object.entries(props)
      .filter(([key, value]) => !excluded.has(key) && typeof value !== "object")
      .map(([key, value]) => [key, String(value)]),
  );
}

export function getFeatureName(feature: GeoJSONFeature): string {
  const tags = getFeatureTags(feature);
  return tags.name || tags.brand || tags.operator || "Unnamed OSM feature";
}

export function getOsmType(feature: GeoJSONFeature): string | undefined {
  const type = feature.properties?.type;
  return typeof type === "string" ? type : undefined;
}

export function getOsmId(feature: GeoJSONFeature): string | number | undefined {
  const id = feature.properties?.id;
  return typeof id === "string" || typeof id === "number" ? id : undefined;
}

export function summarizeTags(tags: Record<string, string>, max = 8): string[] {
  const priority = [
    "name",
    "amenity",
    "shop",
    "tourism",
    "building",
    "highway",
    "access",
    "foot",
    "bridge",
    "tunnel",
    "waterway",
    "natural",
  ];

  const sorted = Object.entries(tags).sort(([a], [b]) => {
    const ai = priority.indexOf(a);
    const bi = priority.indexOf(b);
    if (ai >= 0 && bi >= 0) return ai - bi;
    if (ai >= 0) return -1;
    if (bi >= 0) return 1;
    return a.localeCompare(b);
  });

  return sorted.slice(0, max).map(([key, value]) => `${key}=${value}`);
}

export function formatCoordinate(coordinate: LatLng): string {
  return `${coordinate.lat.toFixed(6)}, ${coordinate.lng.toFixed(6)}`;
}

export function selectedFeatureFromProperties(
  properties: ScoutFeatureProperties,
): SelectedFeature | null {
  const scoutId = typeof properties.scoutId === "string" ? properties.scoutId : null;
  const lat = typeof properties.scoutLat === "number" ? properties.scoutLat : null;
  const lng = typeof properties.scoutLng === "number" ? properties.scoutLng : null;

  if (!scoutId || lat === null || lng === null) {
    return null;
  }

  const tags = properties.tags ?? {};
  const category =
    typeof properties.scoutCategory === "string"
      ? (properties.scoutCategory as ScoutCategory)
      : "simple";
  const role =
    typeof properties.scoutRole === "string"
      ? (properties.scoutRole as ScoutRole)
      : "result";

  return {
    scoutId,
    name: tags.name || tags.brand || tags.operator || "Unnamed OSM feature",
    osmType: typeof properties.type === "string" ? properties.type : undefined,
    osmId:
      typeof properties.id === "string" || typeof properties.id === "number"
        ? properties.id
        : undefined,
    coordinate: { lat, lng },
    tags,
    category,
    role,
    matchReason: {
      label:
        typeof properties.scoutMatchReason === "string"
          ? properties.scoutMatchReason
          : "Matched query",
      distanceMeters:
        typeof properties.scoutMatchDistanceMeters === "number"
          ? properties.scoutMatchDistanceMeters
          : undefined,
      category,
    },
  };
}

export function firstLineEndpoints(feature: GeoJSONFeature): [LatLng, LatLng] | null {
  const geometry = feature.geometry;

  if (geometry.type === "LineString") {
    return endpointsForCoordinates(geometry.coordinates);
  }

  if (geometry.type === "MultiLineString") {
    const firstLine = geometry.coordinates.find((line) => line.length >= 2);
    return firstLine ? endpointsForCoordinates(firstLine) : null;
  }

  if (geometry.type === "Polygon") {
    return endpointsForCoordinates(geometry.coordinates[0] ?? []);
  }

  return null;
}

export function isLineGeometry(
  geometry: Geometry,
): geometry is LineString | MultiLineString {
  return geometry.type === "LineString" || geometry.type === "MultiLineString";
}

export function isPolygonGeometry(geometry: Geometry): geometry is Polygon {
  return geometry.type === "Polygon";
}

function endpointsForCoordinates(
  coordinates: number[][],
): [LatLng, LatLng] | null {
  if (coordinates.length < 2) {
    return null;
  }

  const first = coordinates[0];
  const last = coordinates[coordinates.length - 1];

  return [
    { lat: first[1], lng: first[0] },
    { lat: last[1], lng: last[0] },
  ];
}

function firstCoordinate(geometry: Geometry): number[] | null {
  if (geometry.type === "Point") {
    return geometry.coordinates;
  }

  if (geometry.type === "MultiPoint" || geometry.type === "LineString") {
    return geometry.coordinates[0] ?? null;
  }

  if (geometry.type === "MultiLineString" || geometry.type === "Polygon") {
    return geometry.coordinates[0]?.[0] ?? null;
  }

  if (geometry.type === "MultiPolygon") {
    return geometry.coordinates[0]?.[0]?.[0] ?? null;
  }

  if (geometry.type === "GeometryCollection") {
    for (const child of geometry.geometries) {
      const coordinate = firstCoordinate(child);
      if (coordinate) {
        return coordinate;
      }
    }
  }

  return null;
}
