import osmtogeojson from "osmtogeojson";
import type { Geometry } from "geojson";
import type { BBox, GeoJSONFeatureCollection } from "./geo";
import { bboxToOverpass } from "./geo";

export interface OverpassElement {
  type: "node" | "way" | "relation";
  id: number;
  lat?: number;
  lon?: number;
  nodes?: number[];
  members?: unknown[];
  tags?: Record<string, string>;
  geometry?: Array<{ lat: number; lon: number }>;
  [key: string]: unknown;
}

export interface OverpassResponse {
  version?: number;
  generator?: string;
  osm3s?: Record<string, unknown>;
  elements: OverpassElement[];
}

export interface ParsedTagFilter {
  key: string;
  value: string;
  wildcard: boolean;
  label: string;
}

export interface OverpassQueryResult {
  response: OverpassResponse;
  rawFeatureCount: number;
  geojson: GeoJSONFeatureCollection;
}

const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
];
const RETRYABLE_STATUSES = new Set([429, 502, 503, 504]);
const TAG_KEY_PATTERN = /^[A-Za-z0-9_:-]+$/;
const DISALLOWED_VALUE_PATTERN = /[\[\]\{\}\(\);"'<>\n\r]/;

export function parseTagFilter(input: string): ParsedTagFilter {
  const trimmed = input.trim();

  if (!trimmed) {
    throw new Error("Enter a tag filter such as amenity=restaurant or building=*.");
  }

  if (!trimmed.includes("=")) {
    throw new Error("Use the simple key=value format, for example amenity=restaurant.");
  }

  const [rawKey, ...rawValueParts] = trimmed.split("=");
  const key = rawKey.trim();
  const value = rawValueParts.join("=").trim();

  if (!key || !value) {
    throw new Error("Both the tag key and value are required.");
  }

  if (!TAG_KEY_PATTERN.test(key)) {
    throw new Error("Tag keys may only contain letters, numbers, underscores, colons, and dashes.");
  }

  if (value !== "*" && DISALLOWED_VALUE_PATTERN.test(value)) {
    throw new Error("Raw Overpass QL is not allowed here. Use only key=value or key=*.");
  }

  if (value === "*") {
    return {
      key,
      value,
      wildcard: true,
      label: `${key}=*`,
    };
  }

  return {
    key,
    value,
    wildcard: false,
    label: `${key}=${value}`,
  };
}

export function buildSimpleOverpassQuery(
  bbox: BBox,
  filter: ParsedTagFilter,
): string {
  const selector = filter.wildcard
    ? `["${escapeOverpass(filter.key)}"]`
    : `["${escapeOverpass(filter.key)}"="${escapeOverpass(filter.value)}"]`;
  const bboxText = bboxToOverpass(bbox);

  return `[out:json][timeout:25];
(
  node${selector}(${bboxText});
  way${selector}(${bboxText});
  relation${selector}(${bboxText});
);
out body;
>;
out skel qt;`;
}

export async function runOverpassQuery(
  query: string,
  signal?: AbortSignal,
): Promise<OverpassQueryResult> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < OVERPASS_ENDPOINTS.length; attempt += 1) {
    const endpoint = OVERPASS_ENDPOINTS[attempt];
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
        },
        body: new URLSearchParams({ data: query }),
        signal,
      });

      if (!response.ok) {
        const body = await response.text().catch(() => "");
        if (RETRYABLE_STATUSES.has(response.status) && attempt < OVERPASS_ENDPOINTS.length - 1) {
          lastError = new Error(friendlyOverpassError(response.status, body));
          continue;
        }
        throw new Error(friendlyOverpassError(response.status, body));
      }

      const data = (await response.json()) as OverpassResponse;
      const geojson = overpassToGeoJSON(data);

      return {
        response: data,
        rawFeatureCount: data.elements?.length ?? 0,
        geojson,
      };
    } catch (error) {
      if ((error as Error).name === "AbortError") throw error;
      lastError = error instanceof Error ? error : new Error(String(error));
      if (attempt >= OVERPASS_ENDPOINTS.length - 1) break;
    }
  }

  throw lastError ?? new Error("Overpass request failed.");
}

function friendlyOverpassError(status: number, body: string): string {
  if (status === 504 || status === 502) {
    return "Overpass gateway timed out (504). The public Overpass API is overloaded — try a smaller area, zoom in, or try again in a moment.";
  }
  if (status === 503) {
    return "Overpass server is busy (503). Try again in a moment or zoom in to shrink the query.";
  }
  if (status === 429) {
    return "Overpass rate limit hit (429). Wait a moment before retrying.";
  }
  if (status === 400) {
    const snippet = stripHtml(body).slice(0, 240).trim();
    return snippet
      ? `Overpass rejected the query (400). ${snippet}`
      : "Overpass rejected the query (400). Check your raw Overpass QL for syntax errors.";
  }
  const snippet = stripHtml(body).slice(0, 200).trim();
  return snippet
    ? `Overpass request failed (${status}). ${snippet}`
    : `Overpass request failed (${status}).`;
}

function stripHtml(input: string): string {
  return input
    .replace(/<!DOCTYPE[^>]*>/gi, "")
    .replace(/<\?xml[^?]*\?>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function overpassToGeoJSON(
  response: OverpassResponse,
): GeoJSONFeatureCollection {
  const converted = osmtogeojson(response) as GeoJSON.FeatureCollection<
    Geometry,
    GeoJSON.GeoJsonProperties
  >;

  return {
    type: "FeatureCollection",
    features: converted.features.map((feature) => ({
      ...feature,
      properties: {
        ...(feature.properties ?? {}),
      },
    })),
  } as GeoJSONFeatureCollection;
}

function escapeOverpass(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}
