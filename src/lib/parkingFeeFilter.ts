import type {
  GeoJSONFeature,
  GeoJSONFeatureCollection,
  ScoutCategory,
} from "./geo";
import { getFeatureTags } from "./geo";

export type ParkingFeeFilterId = "any" | "free" | "paid" | "unknown";

/** Classified fee status for a parking-related result feature. */
export type ParkingFeeClass = "free" | "paid" | "unknown";

const PAID_FEE_VALUES = new Set(["yes", "interval", "hour", "day", "month", "year"]);
const FREE_FEE_VALUES = new Set(["no", "free"]);
const PAID_TAG_KEYS = [
  "charge",
  "parking:charge",
  "parking:fee",
  "payment:coins",
  "payment:notes",
  "payment:app",
  "payment:credit_cards",
  "payment:debit_cards",
] as const;

function tagValue(tags: Record<string, string>, key: string): string {
  return (tags[key] ?? "").trim().toLowerCase();
}

/** Laybys and rest areas rarely carry fee tags; treat as non-lot unless fee is explicit. */
export function isParkingPullOff(tags: Record<string, string>, category: ScoutCategory): boolean {
  if (category === "pull-off") return true;
  const highway = tagValue(tags, "highway");
  if (highway === "rest_area" || highway === "services") return true;
  if (tagValue(tags, "parking") === "layby") return true;
  return false;
}

function hasExplicitPaidSignal(tags: Record<string, string>): boolean {
  const fee = tagValue(tags, "fee");
  if (fee && PAID_FEE_VALUES.has(fee)) return true;

  for (const key of PAID_TAG_KEYS) {
    const value = tagValue(tags, key);
    if (!value || value === "no" || value === "none") continue;
    if (value === "yes" || value === "designated" || /^\d/.test(value)) return true;
  }
  return false;
}

function hasExplicitFreeSignal(tags: Record<string, string>): boolean {
  const fee = tagValue(tags, "fee");
  return Boolean(fee && FREE_FEE_VALUES.has(fee));
}

export function classifyParkingFee(
  tags: Record<string, string>,
  category: ScoutCategory,
): ParkingFeeClass {
  if (hasExplicitPaidSignal(tags)) return "paid";
  if (hasExplicitFreeSignal(tags)) return "free";

  if (isParkingPullOff(tags, category)) {
    return "unknown";
  }

  if (tagValue(tags, "amenity") === "parking" || category === "parking") {
    return "unknown";
  }

  return "unknown";
}

export function parkingFeeFilterLabel(feeClass: ParkingFeeClass): string {
  switch (feeClass) {
    case "free":
      return "Free";
    case "paid":
      return "Paid";
    default:
      return "Fee unknown";
  }
}

export function featureMatchesParkingFeeFilter(
  feature: GeoJSONFeature,
  filter: ParkingFeeFilterId,
): boolean {
  if (filter === "any") return true;

  const props = feature.properties ?? {};
  const role = props.scoutRole ?? "result";
  if (role !== "result") return true;

  const tags = getFeatureTags(feature);
  const category = (props.scoutCategory ?? "parking") as ScoutCategory;
  const feeClass = classifyParkingFee(tags, category);
  const pullOff = isParkingPullOff(tags, category);

  if (filter === "unknown") {
    if (pullOff && !hasExplicitPaidSignal(tags) && !hasExplicitFreeSignal(tags)) {
      return true;
    }
    return feeClass === "unknown";
  }

  if (pullOff && !hasExplicitPaidSignal(tags) && !hasExplicitFreeSignal(tags)) {
    return false;
  }

  return feeClass === filter;
}

export function filterCollectionByParkingFee(
  collection: GeoJSONFeatureCollection,
  filter: ParkingFeeFilterId,
): GeoJSONFeatureCollection {
  if (filter === "any") return collection;
  return {
    type: "FeatureCollection",
    features: collection.features.filter((feature) =>
      featureMatchesParkingFeeFilter(feature, filter),
    ),
  };
}

export function countParkingFeeFilter(
  collection: GeoJSONFeatureCollection,
): Record<ParkingFeeFilterId, number> {
  const counts: Record<ParkingFeeFilterId, number> = {
    any: 0,
    free: 0,
    paid: 0,
    unknown: 0,
  };

  for (const feature of collection.features) {
    const role = feature.properties?.scoutRole ?? "result";
    if (role !== "result") continue;
    counts.any += 1;
    if (featureMatchesParkingFeeFilter(feature, "free")) counts.free += 1;
    if (featureMatchesParkingFeeFilter(feature, "paid")) counts.paid += 1;
    if (featureMatchesParkingFeeFilter(feature, "unknown")) counts.unknown += 1;
  }

  return counts;
}
