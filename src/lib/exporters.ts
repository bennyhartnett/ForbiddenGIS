import {
  DEFAULT_FEATURE_COLORS,
  FEATURE_KINDS,
  featureKindFor,
  featureKindLabel,
  type FeatureKind,
} from "./featureColors";
import type {
  GeoJSONFeature,
  GeoJSONFeatureCollection,
  ScoutCategory,
  ScoutRole,
} from "./geo";

export type ExportFormat = "geojson" | "kml" | "kmz";

export interface ExportOptions {
  basename: string;
  documentName?: string;
  featureColors?: Record<FeatureKind, string>;
}

export async function exportFeatureCollection(
  collection: GeoJSONFeatureCollection,
  format: ExportFormat,
  options: ExportOptions,
): Promise<void> {
  const safeBase = sanitizeFilename(options.basename);
  const colors = options.featureColors ?? DEFAULT_FEATURE_COLORS;
  const docName = options.documentName ?? options.basename;

  if (format === "geojson") {
    const blob = new Blob([JSON.stringify(collection, null, 2)], {
      type: "application/geo+json",
    });
    triggerDownload(blob, `${safeBase}.geojson`);
    return;
  }

  const kml = featureCollectionToKml(collection, colors, docName);

  if (format === "kml") {
    const blob = new Blob([kml], { type: "application/vnd.google-earth.kml+xml" });
    triggerDownload(blob, `${safeBase}.kml`);
    return;
  }

  const blob = await kmlStringToKmzBlob(kml);
  triggerDownload(blob, `${safeBase}.kmz`);
}

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = "noopener";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1500);
}

function sanitizeFilename(name: string): string {
  const cleaned = name
    .trim()
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, "-")
    .replace(/^-+|-+$/g, "");
  return cleaned || "overpass-scout-export";
}

/* ---------------- KML conversion ---------------- */

export function featureCollectionToKml(
  collection: GeoJSONFeatureCollection,
  colors: Record<FeatureKind, string>,
  documentName: string,
): string {
  const buckets = new Map<FeatureKind, GeoJSONFeature[]>();
  for (const feature of collection.features) {
    const kind = featureKindForFeature(feature);
    const list = buckets.get(kind) ?? [];
    list.push(feature);
    buckets.set(kind, list);
  }

  const orderedKinds = FEATURE_KINDS.filter((meta) => buckets.has(meta.kind));
  const styles = orderedKinds
    .map((meta) => renderStyle(meta.kind, colors[meta.kind] ?? DEFAULT_FEATURE_COLORS[meta.kind]))
    .join("");

  const folders = orderedKinds
    .map((meta) => {
      const items = buckets.get(meta.kind) ?? [];
      const placemarks = items.map((feature) => renderPlacemark(feature, meta.kind)).join("");
      return `<Folder><name>${xmlEscape(meta.label)}</name>${placemarks}</Folder>`;
    })
    .join("");

  const legendRows = orderedKinds
    .map((meta) => {
      const swatch = (colors[meta.kind] ?? DEFAULT_FEATURE_COLORS[meta.kind]).toUpperCase();
      return `<tr><td style="background:${swatch};width:14px;">&#160;</td><td>${xmlEscape(meta.label)}</td></tr>`;
    })
    .join("");
  const legendHtml = legendRows
    ? `<![CDATA[<h3>Legend</h3><table style="border-collapse:collapse;">${legendRows}</table>]]>`
    : "<![CDATA[<p>No features included.</p>]]>";

  const totalCount = collection.features.length;
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<kml xmlns="http://www.opengis.net/kml/2.2">',
    "<Document>",
    `<name>${xmlEscape(documentName)}</name>`,
    `<description>${legendHtml}</description>`,
    `<atom:author xmlns:atom="http://www.w3.org/2005/Atom"><atom:name>Overpass Scout View</atom:name></atom:author>`,
    `<ExtendedData><Data name="featureCount"><value>${totalCount}</value></Data></ExtendedData>`,
    styles,
    folders,
    "</Document>",
    "</kml>",
  ].join("");
}

function featureKindForFeature(feature: GeoJSONFeature): FeatureKind {
  const props = feature.properties ?? {};
  const role = (props.scoutRole ?? "result") as ScoutRole;
  const category = (props.scoutCategory ?? "simple") as ScoutCategory;
  const tags = props.tags ?? {};
  return featureKindFor(category, role, tags);
}

function renderStyle(kind: FeatureKind, hex: string): string {
  const lineColor = webHexToKmlColor(hex, 0.95);
  const fillColor = webHexToKmlColor(hex, 0.35);
  const iconColor = webHexToKmlColor(hex, 0.95);
  return [
    `<Style id="${kind}">`,
    `<LineStyle><color>${lineColor}</color><width>3</width></LineStyle>`,
    `<PolyStyle><color>${fillColor}</color><fill>1</fill><outline>1</outline></PolyStyle>`,
    `<IconStyle><color>${iconColor}</color><scale>1.1</scale>`,
    `<Icon><href>https://maps.google.com/mapfiles/kml/shapes/placemark_circle.png</href></Icon>`,
    `</IconStyle>`,
    `<BalloonStyle><text><![CDATA[<h3>$[name]</h3><div>$[description]</div>]]></text></BalloonStyle>`,
    `</Style>`,
  ].join("");
}

function renderPlacemark(feature: GeoJSONFeature, kind: FeatureKind): string {
  const props = feature.properties ?? {};
  const tags = props.tags ?? {};
  const name = tags.name || tags.brand || tags.operator || featureKindLabel(kind);
  const matchReason = typeof props.scoutMatchReason === "string" ? props.scoutMatchReason : "";
  const matchDetail = typeof props.scoutMatchDetail === "string" ? props.scoutMatchDetail : "";
  const osmType = typeof props.type === "string" ? props.type : "";
  const osmId = typeof props.id === "string" || typeof props.id === "number" ? String(props.id) : "";

  const tagRows = Object.entries(tags)
    .map(([key, value]) => `<tr><th>${xmlEscape(key)}</th><td>${xmlEscape(String(value))}</td></tr>`)
    .join("");
  const descriptionHtml = [
    matchReason ? `<p><strong>${xmlEscape(matchReason)}</strong></p>` : "",
    matchDetail ? `<p>${xmlEscape(matchDetail)}</p>` : "",
    osmType && osmId
      ? `<p><small>OSM ${xmlEscape(osmType)} <a href="https://www.openstreetmap.org/${xmlEscape(osmType)}/${xmlEscape(osmId)}">${xmlEscape(osmId)}</a></small></p>`
      : "",
    tagRows ? `<table>${tagRows}</table>` : "",
  ]
    .filter(Boolean)
    .join("");

  const extendedData = Object.entries(tags)
    .map(
      ([key, value]) =>
        `<Data name="${xmlEscape(key)}"><value>${xmlEscape(String(value))}</value></Data>`,
    )
    .join("");

  const geometryXml = geometryToKml(feature.geometry);
  if (!geometryXml) return "";

  return [
    "<Placemark>",
    `<name>${xmlEscape(name)}</name>`,
    `<styleUrl>#${kind}</styleUrl>`,
    descriptionHtml ? `<description><![CDATA[${descriptionHtml}]]></description>` : "",
    extendedData ? `<ExtendedData>${extendedData}</ExtendedData>` : "",
    geometryXml,
    "</Placemark>",
  ].join("");
}

function geometryToKml(geometry: GeoJSONFeature["geometry"]): string {
  if (!geometry) return "";
  switch (geometry.type) {
    case "Point":
      return `<Point><coordinates>${coord(geometry.coordinates)}</coordinates></Point>`;
    case "MultiPoint":
      return `<MultiGeometry>${geometry.coordinates
        .map((position) => `<Point><coordinates>${coord(position)}</coordinates></Point>`)
        .join("")}</MultiGeometry>`;
    case "LineString":
      return `<LineString><tessellate>1</tessellate><coordinates>${coordList(geometry.coordinates)}</coordinates></LineString>`;
    case "MultiLineString":
      return `<MultiGeometry>${geometry.coordinates
        .map(
          (line) =>
            `<LineString><tessellate>1</tessellate><coordinates>${coordList(line)}</coordinates></LineString>`,
        )
        .join("")}</MultiGeometry>`;
    case "Polygon":
      return `<Polygon>${polygonRings(geometry.coordinates)}</Polygon>`;
    case "MultiPolygon":
      return `<MultiGeometry>${geometry.coordinates
        .map((polygon) => `<Polygon>${polygonRings(polygon)}</Polygon>`)
        .join("")}</MultiGeometry>`;
    case "GeometryCollection":
      return `<MultiGeometry>${geometry.geometries.map((child) => geometryToKml(child)).join("")}</MultiGeometry>`;
    default:
      return "";
  }
}

function polygonRings(rings: number[][][]): string {
  if (rings.length === 0) return "";
  const outer = `<outerBoundaryIs><LinearRing><coordinates>${coordList(rings[0])}</coordinates></LinearRing></outerBoundaryIs>`;
  const inner = rings
    .slice(1)
    .map(
      (ring) =>
        `<innerBoundaryIs><LinearRing><coordinates>${coordList(ring)}</coordinates></LinearRing></innerBoundaryIs>`,
    )
    .join("");
  return outer + inner;
}

function coord(position: number[]): string {
  const lng = Number(position[0] ?? 0);
  const lat = Number(position[1] ?? 0);
  const alt = position.length > 2 ? Number(position[2] ?? 0) : 0;
  return `${lng},${lat},${alt}`;
}

function coordList(positions: number[][]): string {
  return positions.map((p) => coord(p)).join(" ");
}

function xmlEscape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function webHexToKmlColor(hex: string, opacity: number): string {
  const cleaned = hex.replace("#", "").toLowerCase();
  const expanded =
    cleaned.length === 3
      ? cleaned
          .split("")
          .map((c) => c + c)
          .join("")
      : cleaned.padEnd(6, "0").slice(0, 6);
  const r = expanded.slice(0, 2);
  const g = expanded.slice(2, 4);
  const b = expanded.slice(4, 6);
  const alpha = Math.max(0, Math.min(255, Math.round(opacity * 255)))
    .toString(16)
    .padStart(2, "0");
  return `${alpha}${b}${g}${r}`;
}

/* ---------------- KMZ packaging (minimal STORE-method ZIP) ---------------- */

async function kmlStringToKmzBlob(kml: string): Promise<Blob> {
  const encoder = new TextEncoder();
  const filename = "doc.kml";
  const filenameBytes = encoder.encode(filename);
  const data = encoder.encode(kml);
  const crc = crc32(data);
  const size = data.length;

  const localHeader = new Uint8Array(30 + filenameBytes.length);
  const lhv = new DataView(localHeader.buffer);
  lhv.setUint32(0, 0x04034b50, true);
  lhv.setUint16(4, 20, true);
  lhv.setUint16(6, 0, true);
  lhv.setUint16(8, 0, true);
  lhv.setUint16(10, 0, true);
  lhv.setUint16(12, 0, true);
  lhv.setUint32(14, crc, true);
  lhv.setUint32(18, size, true);
  lhv.setUint32(22, size, true);
  lhv.setUint16(26, filenameBytes.length, true);
  lhv.setUint16(28, 0, true);
  localHeader.set(filenameBytes, 30);

  const localHeaderTotal = localHeader.length + size;

  const centralRecord = new Uint8Array(46 + filenameBytes.length);
  const cdv = new DataView(centralRecord.buffer);
  cdv.setUint32(0, 0x02014b50, true);
  cdv.setUint16(4, 20, true);
  cdv.setUint16(6, 20, true);
  cdv.setUint16(8, 0, true);
  cdv.setUint16(10, 0, true);
  cdv.setUint16(12, 0, true);
  cdv.setUint16(14, 0, true);
  cdv.setUint32(16, crc, true);
  cdv.setUint32(20, size, true);
  cdv.setUint32(24, size, true);
  cdv.setUint16(28, filenameBytes.length, true);
  cdv.setUint16(30, 0, true);
  cdv.setUint16(32, 0, true);
  cdv.setUint16(34, 0, true);
  cdv.setUint16(36, 0, true);
  cdv.setUint32(38, 0, true);
  cdv.setUint32(42, 0, true);
  centralRecord.set(filenameBytes, 46);

  const eocd = new Uint8Array(22);
  const edv = new DataView(eocd.buffer);
  edv.setUint32(0, 0x06054b50, true);
  edv.setUint16(4, 0, true);
  edv.setUint16(6, 0, true);
  edv.setUint16(8, 1, true);
  edv.setUint16(10, 1, true);
  edv.setUint32(12, centralRecord.length, true);
  edv.setUint32(16, localHeaderTotal, true);
  edv.setUint16(20, 0, true);

  return new Blob([localHeader, data, centralRecord, eocd], {
    type: "application/vnd.google-earth.kmz",
  });
}

const CRC_TABLE: Uint32Array = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let value = i;
    for (let j = 0; j < 8; j += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[i] = value >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) {
    crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ bytes[i]) & 0xff];
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/* ---------------- Feature collection merge ---------------- */

export function mergeFeatureCollections(
  base: GeoJSONFeatureCollection,
  addition: GeoJSONFeatureCollection,
): GeoJSONFeatureCollection {
  const seen = new Set<string>();
  const features: GeoJSONFeature[] = [];
  for (const source of [base, addition]) {
    for (const feature of source.features) {
      const scoutId = feature.properties?.scoutId;
      if (typeof scoutId === "string") {
        if (seen.has(scoutId)) continue;
        seen.add(scoutId);
      }
      features.push(feature);
    }
  }
  return { type: "FeatureCollection", features };
}
