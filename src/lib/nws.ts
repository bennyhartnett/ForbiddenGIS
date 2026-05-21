import type { Feature, FeatureCollection, Point } from "geojson";
import type { BBox, GeoJSONFeature, GeoJSONFeatureCollection } from "./geo";
import { bboxCenter } from "./geo";

const NWS_BASE = "https://api.weather.gov";

interface NwsStationFeature {
  type: "Feature";
  geometry: Point;
  properties: {
    "@id"?: string;
    stationIdentifier?: string;
    name?: string;
    elevation?: { unitCode?: string; value?: number };
    timeZone?: string;
  };
}

interface NwsStationCollection {
  type: "FeatureCollection";
  features: NwsStationFeature[];
}

export async function fetchNwsStationsInBBox(
  bbox: BBox,
  signal?: AbortSignal,
): Promise<GeoJSONFeatureCollection> {
  const center = bboxCenter(bbox);
  const url = `${NWS_BASE}/points/${center.lat.toFixed(4)},${center.lng.toFixed(4)}/stations`;

  let response: Response;
  try {
    response = await fetch(url, {
      signal,
      headers: { Accept: "application/geo+json" },
    });
  } catch (error) {
    if ((error as Error).name === "AbortError") throw error;
    return emptyCollection();
  }

  if (!response.ok) {
    return emptyCollection();
  }

  const data = (await response.json()) as NwsStationCollection;
  const features: GeoJSONFeature[] = [];

  for (const station of data.features ?? []) {
    if (!station.geometry || station.geometry.type !== "Point") continue;
    const [lng, lat] = station.geometry.coordinates;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    if (lat < bbox.south || lat > bbox.north || lng < bbox.west || lng > bbox.east) continue;

    const props = station.properties ?? {};
    const stationId = props.stationIdentifier ?? extractIdFromUri(props["@id"]) ?? "";
    const tags: Record<string, string> = {
      man_made: "weather_station",
      operator: "NWS",
      source: "NWS",
      ref: stationId,
      "nws:station": stationId,
    };
    if (props.name) tags.name = props.name;
    if (props.elevation?.value !== undefined) {
      tags.ele = props.elevation.value.toFixed(1);
    }
    if (props.timeZone) tags["time_zone"] = props.timeZone;

    const feature: GeoJSONFeature = {
      type: "Feature",
      geometry: { type: "Point", coordinates: [lng, lat] },
      properties: {
        id: `nws-${stationId}`,
        type: "nws",
        tags,
      },
    };
    features.push(feature);
  }

  return { type: "FeatureCollection", features };
}

function extractIdFromUri(uri: string | undefined): string | null {
  if (!uri) return null;
  const match = uri.match(/\/stations\/([^/?#]+)/);
  return match ? match[1] : null;
}

function emptyCollection(): GeoJSONFeatureCollection {
  return { type: "FeatureCollection", features: [] };
}

export type { Feature, FeatureCollection };
