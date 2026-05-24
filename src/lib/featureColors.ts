import type { ScoutCategory, ScoutRole } from "./geo";

export type FeatureKind =
  | "road-public"
  | "road-private"
  | "off-road-public"
  | "off-road-private"
  | "parking-public"
  | "parking-private"
  | "trail"
  | "bridge"
  | "water"
  | "building"
  | "water-crossing"
  | "woods"
  | "park"
  | "pull-off"
  | "barrier"
  | "industrial"
  | "railway"
  | "weather-station"
  | "restricted-area"
  | "private-parcel"
  | "simple"
  | "context-road"
  | "context-parking"
  | "context-water"
  | "context-building"
  | "context-woods"
  | "context-park"
  | "context-pull-off"
  | "context-trail"
  | "context-industrial";

export interface FeatureKindMeta {
  kind: FeatureKind;
  label: string;
  group: "result" | "context";
}

export const DEFAULT_ORANGE = "#fa7b17";
export const DEFAULT_PRIVATE_ORANGE = "#c2410c";
export const DEFAULT_PUBLIC_BLUE = "#1a73e8";
export const DEFAULT_PRIVATE_RED = "#d93025";

// Access-classified kinds use a fixed public=blue / private=red palette so the
// legend and the map share an unambiguous meaning. These colors stay put even
// when auto-contrast assigns palette colors to the other kinds in a result set.
export const SEMANTIC_ACCESS_KINDS: ReadonlySet<FeatureKind> = new Set<FeatureKind>([
  "road-public",
  "road-private",
  "off-road-public",
  "off-road-private",
  "parking-public",
  "parking-private",
]);

export const FEATURE_KINDS: FeatureKindMeta[] = [
  { kind: "road-public", label: "Roads (public)", group: "result" },
  { kind: "road-private", label: "Roads (private / restricted)", group: "result" },
  { kind: "off-road-public", label: "Off-road (public)", group: "result" },
  { kind: "off-road-private", label: "Off-road (private / restricted)", group: "result" },
  { kind: "parking-public", label: "Parking (public)", group: "result" },
  { kind: "parking-private", label: "Parking (private / restricted)", group: "result" },
  { kind: "trail", label: "Trails / paths", group: "result" },
  { kind: "bridge", label: "Bridges", group: "result" },
  { kind: "water", label: "Water", group: "result" },
  { kind: "water-crossing", label: "Water crossings / fords", group: "result" },
  { kind: "building", label: "Buildings", group: "result" },
  { kind: "woods", label: "Woods", group: "result" },
  { kind: "park", label: "Parks", group: "result" },
  { kind: "pull-off", label: "Pull-offs / rest areas", group: "result" },
  { kind: "barrier", label: "Barriers / gates", group: "result" },
  { kind: "industrial", label: "Industrial", group: "result" },
  { kind: "railway", label: "Railways / train tracks", group: "result" },
  { kind: "weather-station", label: "Weather stations", group: "result" },
  { kind: "restricted-area", label: "Restricted / private areas", group: "result" },
  { kind: "private-parcel", label: "Private parcels", group: "result" },
  { kind: "simple", label: "Other matches", group: "result" },
  { kind: "context-road", label: "Roads (context)", group: "context" },
  { kind: "context-parking", label: "Parking (context)", group: "context" },
  { kind: "context-water", label: "Water (context)", group: "context" },
  { kind: "context-building", label: "Buildings (context)", group: "context" },
  { kind: "context-woods", label: "Woods (context)", group: "context" },
  { kind: "context-park", label: "Parks (context)", group: "context" },
  { kind: "context-pull-off", label: "Pull-offs (context)", group: "context" },
  { kind: "context-trail", label: "Trails (context)", group: "context" },
  { kind: "context-industrial", label: "Industrial (context)", group: "context" },
];

const FEATURE_KIND_LOOKUP: Record<FeatureKind, FeatureKindMeta> = Object.fromEntries(
  FEATURE_KINDS.map((meta) => [meta.kind, meta]),
) as Record<FeatureKind, FeatureKindMeta>;

export function featureKindLabel(kind: FeatureKind): string {
  return FEATURE_KIND_LOOKUP[kind]?.label ?? kind;
}

export function featureKindGroup(kind: FeatureKind): "result" | "context" {
  return FEATURE_KIND_LOOKUP[kind]?.group ?? "result";
}

export const DEFAULT_FEATURE_COLORS: Record<FeatureKind, string> = {
  "road-public": DEFAULT_PUBLIC_BLUE,
  "road-private": DEFAULT_PRIVATE_RED,
  "off-road-public": DEFAULT_PUBLIC_BLUE,
  "off-road-private": DEFAULT_PRIVATE_RED,
  "parking-public": DEFAULT_PUBLIC_BLUE,
  "parking-private": DEFAULT_PRIVATE_RED,
  trail: DEFAULT_ORANGE,
  bridge: DEFAULT_ORANGE,
  water: DEFAULT_ORANGE,
  building: DEFAULT_ORANGE,
  "water-crossing": DEFAULT_ORANGE,
  woods: DEFAULT_ORANGE,
  park: DEFAULT_ORANGE,
  "pull-off": DEFAULT_ORANGE,
  barrier: DEFAULT_ORANGE,
  industrial: DEFAULT_ORANGE,
  railway: DEFAULT_ORANGE,
  "weather-station": "#1a73e8",
  "restricted-area": "#d93025",
  "private-parcel": "#a0522d",
  simple: DEFAULT_ORANGE,
  "context-road": "#5f6368",
  "context-parking": "#8430ce",
  "context-water": "#4285f4",
  "context-building": "#9aa0a6",
  "context-woods": "#137333",
  "context-park": "#0f9d58",
  "context-pull-off": "#a142f4",
  "context-trail": "#34a853",
  "context-industrial": "#9aa0a6",
};

// High-contrast palette for spotting different result kinds side-by-side on a map.
// Ordered to maximize visual separation between neighbors.
export const HIGH_CONTRAST_PALETTE: readonly string[] = [
  "#fa7b17", // orange
  "#1a73e8", // blue
  "#e52592", // magenta
  "#00bcd4", // cyan
  "#aece00", // lime
  "#9c27b0", // purple
  "#fbbc04", // yellow
  "#d93025", // red
  "#34a853", // green
  "#673ab7", // deep purple
  "#795548", // brown
  "#129eaf", // teal
];

const PRIVATE_ACCESS_VALUES = new Set(["private", "no", "customers", "permit", "destination"]);
const ACCESS_FIELDS = ["access", "vehicle", "motor_vehicle", "motorcar", "foot", "bicycle"];

export type AccessClass = "public" | "private";

export function classifyAccess(tags: Record<string, string>): AccessClass {
  for (const field of ACCESS_FIELDS) {
    const value = (tags[field] ?? "").toLowerCase();
    if (PRIVATE_ACCESS_VALUES.has(value)) {
      return "private";
    }
  }
  return "public";
}

export function featureKindFor(
  category: ScoutCategory,
  role: ScoutRole,
  tags: Record<string, string>,
): FeatureKind {
  switch (role) {
    case "context-road":
      return "context-road";
    case "context-parking":
      return "context-parking";
    case "context-water":
      return "context-water";
    case "context-building":
      return "context-building";
    case "context-woods":
      return "context-woods";
    case "context-park":
      return "context-park";
    case "context-pull-off":
      return "context-pull-off";
    case "context-trail":
      return "context-trail";
    case "context-industrial":
      return "context-industrial";
    case "result":
      break;
  }

  const access = classifyAccess(tags);
  switch (category) {
    case "road":
      return access === "private" ? "road-private" : "road-public";
    case "off-road":
      return access === "private" ? "off-road-private" : "off-road-public";
    case "parking":
      return access === "private" ? "parking-private" : "parking-public";
    case "trail":
      return "trail";
    case "bridge":
      return "bridge";
    case "water":
      return "water";
    case "building":
      return "building";
    case "water-crossing":
      return "water-crossing";
    case "woods":
      return "woods";
    case "park":
      return "park";
    case "pull-off":
      return "pull-off";
    case "barrier":
      return "barrier";
    case "industrial":
      return "industrial";
    case "railway":
      return "railway";
    case "weather-station":
      return "weather-station";
    case "restricted":
      return "restricted-area";
    case "private-parcel":
      return "private-parcel";
    case "simple":
    default:
      return "simple";
  }
}

/**
 * Auto-assign distinct high-contrast colors to result kinds present in the
 * current rendering. Context kinds keep their muted defaults. Kinds appear in
 * a fixed order so the assignment is stable across renders that share a kind
 * set.
 */
export function autoContrastColors(
  presentKinds: ReadonlySet<FeatureKind>,
): Partial<Record<FeatureKind, string>> {
  const allResultKinds = FEATURE_KINDS.filter(
    (meta) => meta.group === "result" && presentKinds.has(meta.kind),
  );
  if (allResultKinds.length <= 1) return {};

  // Reserve the semantic blue/red slots so palette colors never overlap with
  // the public/private legend swatches users learn to expect.
  const reservedPalette = HIGH_CONTRAST_PALETTE.filter(
    (color) => color !== DEFAULT_PUBLIC_BLUE && color !== DEFAULT_PRIVATE_RED,
  );

  const colors: Partial<Record<FeatureKind, string>> = {};
  let paletteIndex = 0;
  for (const meta of allResultKinds) {
    if (SEMANTIC_ACCESS_KINDS.has(meta.kind)) continue;
    colors[meta.kind] = reservedPalette[paletteIndex % reservedPalette.length];
    paletteIndex += 1;
  }
  return colors;
}

export function resolveFeatureColors(
  presentKinds: ReadonlySet<FeatureKind>,
  autoContrast: boolean,
  overrides: Partial<Record<FeatureKind, string>>,
): Record<FeatureKind, string> {
  const auto = autoContrast ? autoContrastColors(presentKinds) : {};
  return {
    ...DEFAULT_FEATURE_COLORS,
    ...auto,
    ...overrides,
  };
}
