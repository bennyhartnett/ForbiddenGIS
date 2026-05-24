import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  bboxDiagonalKm,
  formatCoordinate,
  googleBoundsToBBox,
  selectedFeatureFromProperties,
  summarizeTags,
  type BBox,
  type GeoJSONFeatureCollection,
  type LatLng,
  type PresetDefinition,
  type PresetId,
  type ScoutCategory,
  type ScoutFeatureProperties,
  type ScoutRole,
  type SelectedFeature,
} from "./lib/geo";
import {
  findNearestStreetView,
  getDataFeatureProperties,
  getGoogleMapsApiKey,
  loadGoogleMaps,
} from "./lib/googleMaps";
import {
  buildSimpleOverpassQuery,
  parseTagFilter,
  runOverpassQuery,
  type ParsedTagFilter,
} from "./lib/overpass";
import { fetchNwsStationsInBBox } from "./lib/nws";
import {
  buildPresetOverpassQuery,
  getPresetById,
  PRESETS,
  type PresetQueryOptions,
} from "./lib/presets";
import {
  applyPresetSpatialFilters,
  prepareSimpleResult,
} from "./lib/spatialFilters";
import { MAP_THEMES, type ThemeId } from "./lib/mapThemes";
import { OVERLAY_SOURCES, type OverlayId } from "./lib/overlays";
import {
  DEFAULT_FEATURE_COLORS,
  FEATURE_KINDS,
  featureKindFor,
  resolveFeatureColors,
  type FeatureKind,
} from "./lib/featureColors";
import {
  exportFeatureCollection,
  type ExportFormat,
} from "./lib/exporters";

type Mode = "preset" | "simple" | "raw";
type MapDisplayType = "roadmap" | "satellite" | "hybrid" | "terrain";
type DifficultyLevel = "blocked" | "low" | "moderate" | "high" | "very-high";

interface DifficultyEstimate {
  level: DifficultyLevel;
  label: string;
  detail: string;
  scope: string;
}

interface PlaceSuggestion {
  description: string;
  placeId: string;
  mainText: string;
  secondaryText: string;
}

interface PanoEntry {
  panoId: string;
  date: Date;
  label: string;
}

type StreetViewState =
  | { status: "idle" }
  | { status: "searching"; sourceName: string; scoutId?: string }
  | {
      status: "open";
      sourceName: string;
      scoutId?: string;
      data: google.maps.StreetViewPanoramaData;
    }
  | { status: "none"; sourceName: string; scoutId?: string; message: string }
  | { status: "error"; sourceName: string; scoutId?: string; message: string };

interface PresetCategory {
  id: string;
  label: string;
  presetIds: ReadonlySet<PresetId>;
}

const PRESET_CATEGORIES: PresetCategory[] = [
  {
    id: "featured",
    label: "Featured",
    presetIds: new Set<PresetId>([
      "preset-featured-off-road",
      "preset-featured-fishing",
      "preset-featured-camping",
      "preset-featured-hunting",
      "preset-featured-parking",
    ]),
  },
];

const SIMPLE_PRESETS = [
  { label: "Restaurants", filter: "amenity=restaurant" },
  { label: "Cafes", filter: "amenity=cafe" },
  { label: "Bars", filter: "amenity=bar" },
  { label: "Hotels", filter: "tourism=hotel" },
  { label: "Gas stations", filter: "amenity=fuel" },
  { label: "Shops", filter: "shop=*" },
];

const RENDER_LIMIT = 5000;
const DEFAULT_CENTER: LatLng = { lat: 38.9072, lng: -77.0369 };
const DEFAULT_ZOOM = 15;
const DEFAULT_LOCATION_QUERY = "Washington, DC";
const LAST_MAP_VIEW_STORAGE_KEY = "forbiddenGIS.lastMapView";

interface CachedMapView {
  center: LatLng;
  zoom: number;
  mapType?: MapDisplayType;
}

function loadCachedMapView(): CachedMapView | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(LAST_MAP_VIEW_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<CachedMapView> | null;
    if (
      !parsed ||
      typeof parsed.zoom !== "number" ||
      !Number.isFinite(parsed.zoom) ||
      !parsed.center ||
      typeof parsed.center.lat !== "number" ||
      typeof parsed.center.lng !== "number" ||
      !Number.isFinite(parsed.center.lat) ||
      !Number.isFinite(parsed.center.lng)
    ) {
      return null;
    }
    const mapType =
      parsed.mapType === "roadmap" ||
      parsed.mapType === "satellite" ||
      parsed.mapType === "hybrid" ||
      parsed.mapType === "terrain"
        ? parsed.mapType
        : undefined;
    return {
      center: { lat: parsed.center.lat, lng: parsed.center.lng },
      zoom: parsed.zoom,
      mapType,
    };
  } catch {
    return null;
  }
}

function saveCachedMapView(view: CachedMapView): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(LAST_MAP_VIEW_STORAGE_KEY, JSON.stringify(view));
  } catch {
    // Storage may be full or disabled; ignore silently.
  }
}
const DEFAULT_RAW_QUERY = `[out:json][timeout:25];
(
  node["amenity"="restaurant"]({{bbox}});
  way["amenity"="restaurant"]({{bbox}});
);
out body;
>;
out skel qt;`;

const GIBS_MIN_DATE = "2000-02-24";

const STREET_VIEW_MIN_WIDTH = 320;
const STREET_VIEW_MAX_WIDTH_VW = 0.85;
const STREET_VIEW_DEFAULT_WIDTH_VW = 1 / 3;
const STREET_VIEW_DEFAULT_WIDTH_CAP = 520;

function computeDefaultStreetViewWidth(): number {
  return Math.min(
    STREET_VIEW_DEFAULT_WIDTH_CAP,
    window.innerWidth * STREET_VIEW_DEFAULT_WIDTH_VW,
  );
}

export default function App() {
  const apiKey = getGoogleMapsApiKey();

  if (!apiKey) {
    return <MissingApiKey />;
  }

  return <ScoutApp apiKey={apiKey} />;
}

function ScoutApp({ apiKey }: { apiKey: string }) {
  const mapDivRef = useRef<HTMLDivElement | null>(null);
  const mapRegionRef = useRef<HTMLElement | null>(null);
  const streetViewDivRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const mapsRef = useRef<typeof google | null>(null);
  const streetViewServiceRef = useRef<google.maps.StreetViewService | null>(null);
  const streetViewCoverageRef = useRef<google.maps.StreetViewCoverageLayer | null>(null);
  const geocoderRef = useRef<google.maps.Geocoder | null>(null);
  const autocompleteServiceRef = useRef<google.maps.places.AutocompleteService | null>(null);
  const panoramaRef = useRef<google.maps.StreetViewPanorama | null>(null);
  const overlayMapTypeRef = useRef<google.maps.MapType | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const lastRequestKeyRef = useRef<string | null>(null);
  const selectedDataFeatureRef = useRef<google.maps.Data.Feature | null>(null);
  const dataFeatureClickRef = useRef<(feature: google.maps.Data.Feature) => void>(() => undefined);
  const featureColorMapRef = useRef<Record<FeatureKind, string>>({ ...DEFAULT_FEATURE_COLORS });
  const loadedFeaturesRef = useRef<GeoJSONFeatureCollection>({
    type: "FeatureCollection",
    features: [],
  });
  const streetViewLookupIdRef = useRef(0);
  const searchGateRef = useRef({
    mode: "preset" as Mode,
    tagFilter: "amenity=restaurant",
    presetMinZoom: 14,
  });
  const lastSearchCenterRef = useRef<{ lat: number; lng: number; zoom: number } | null>(null);

  // Search state
  const [mode, setMode] = useState<Mode>("preset");
  const [tagFilter, setTagFilter] = useState("amenity=restaurant");
  const [rawQuery, setRawQuery] = useState(DEFAULT_RAW_QUERY);
  const [presetId, setPresetId] = useState<PresetId>("preset-featured-off-road");
  const [presetSearch, setPresetSearch] = useState("");
  const [presetCategory, setPresetCategory] = useState<string>(PRESET_CATEGORIES[0].id);
  const [showBuildings, setShowBuildings] = useState(false);
  const [showWater, setShowWater] = useState(true);
  const [bufferScale, setBufferScale] = useState(1);

  // Location
  const [locationQuery, setLocationQuery] = useState(DEFAULT_LOCATION_QUERY);
  const [placeSuggestions, setPlaceSuggestions] = useState<PlaceSuggestion[]>([]);
  const [suggestionsStatus, setSuggestionsStatus] = useState<string | null>(null);
  const [geolocating, setGeolocating] = useState(false);

  // Map view state
  const cachedMapViewRef = useRef<CachedMapView | null>(loadCachedMapView());
  const [zoom, setZoom] = useState(
    () => cachedMapViewRef.current?.zoom ?? DEFAULT_ZOOM,
  );
  const [mapType, setMapType] = useState<MapDisplayType>(
    () => cachedMapViewRef.current?.mapType ?? "roadmap",
  );
  const [mapTheme, setMapTheme] = useState<ThemeId>("default");
  const [tiltOn, setTiltOn] = useState(false);
  const [overlayId, setOverlayId] = useState<OverlayId>("none");
  const [overlayOpacity, setOverlayOpacity] = useState(0.8);
  const [featureColorOverrides, setFeatureColorOverrides] = useState<
    Partial<Record<FeatureKind, string>>
  >({});
  const [autoContrastColorsOn, setAutoContrastColorsOn] = useState(true);
  const [presentFeatureKinds, setPresentFeatureKinds] = useState<ReadonlySet<FeatureKind>>(
    () => new Set<FeatureKind>(),
  );
  const [gibsDate, setGibsDate] = useState<string>(() => formatGibsDate(new Date()));
  const [visibleDiagonalKm, setVisibleDiagonalKm] = useState<number | null>(null);
  const [showSearchHereChip, setShowSearchHereChip] = useState(false);

  // Panel UI state
  const [presetPanelOpen, setPresetPanelOpen] = useState(true);
  const [layersPanelOpen, setLayersPanelOpen] = useState(false);
  const [loadedFeatureCount, setLoadedFeatureCount] = useState(0);
  const [exportBusy, setExportBusy] = useState(false);

  // Search lifecycle
  const [boundsWarning, setBoundsWarning] = useState<string | null>(null);
  const [searchWarning, setSearchWarning] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [mapStatus, setMapStatus] = useState("Loading map...");
  const [error, setError] = useState<string | null>(null);
  const [resultCount, setResultCount] = useState(0);
  const [rawFeatureCount, setRawFeatureCount] = useState<number | null>(null);
  const [renderedFeatureCount, setRenderedFeatureCount] = useState(0);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [lastSearchDurationMs, setLastSearchDurationMs] = useState<number | null>(null);
  const [searchOutcome, setSearchOutcome] = useState<"idle" | "success" | "error">("idle");
  const searchStartedAtRef = useRef<number | null>(null);
  const [selectedFeature, setSelectedFeature] = useState<SelectedFeature | null>(null);
  const [streetViewState, setStreetViewState] = useState<StreetViewState>({ status: "idle" });
  const [panoHistory, setPanoHistory] = useState<PanoEntry[]>([]);
  const [panoHistoryIndex, setPanoHistoryIndex] = useState(-1);
  const [resolvedAddress, setResolvedAddress] = useState<string | null>(null);
  const [resolvingAddress, setResolvingAddress] = useState(false);
  const addressCacheRef = useRef(new Map<string, string | null>());
  const [resultFeatures, setResultFeatures] = useState<SelectedFeature[]>([]);
  const [streetViewAvailability, setStreetViewAvailability] = useState<Set<string>>(
    new Set(),
  );
  const [matchListOpen, setMatchListOpen] = useState(false);
  const [pegmanMode, setPegmanMode] = useState(false);
  const pegmanMapClickListenerRef = useRef<google.maps.MapsEventListener | null>(null);
  const pegmanProjectionRef = useRef<google.maps.OverlayView | null>(null);
  const [streetViewWidth, setStreetViewWidth] = useState<number | null>(null);
  const streetViewResizeStateRef = useRef<{ startX: number; startWidth: number } | null>(null);

  const selectedPreset = useMemo(() => getPresetById(presetId), [presetId]);
  const activeWarning = searchWarning ?? boundsWarning;
  const overlaySource = useMemo(
    () => OVERLAY_SOURCES.find((source) => source.id === overlayId) ?? OVERLAY_SOURCES[0],
    [overlayId],
  );
  const gibsActive = overlaySource.kind === "gibs";

  const filteredPresets = useMemo(() => {
    const category = PRESET_CATEGORIES.find((c) => c.id === presetCategory) ?? PRESET_CATEGORIES[0];
    const query = presetSearch.trim().toLowerCase();
    return PRESETS.filter((preset) => {
      if (!category.presetIds.has(preset.id)) return false;
      if (!query) return true;
      return (
        preset.name.toLowerCase().includes(query) ||
        preset.description.toLowerCase().includes(query)
      );
    });
  }, [presetCategory, presetSearch]);

  const difficultyEstimate = useMemo(
    () =>
      computeDifficultyEstimate(
        mode,
        zoom,
        tagFilter,
        rawQuery,
        selectedPreset,
        visibleDiagonalKm,
      ),
    [mode, rawQuery, selectedPreset, tagFilter, visibleDiagonalKm, zoom],
  );

  // Swap favicon between idle globe and spinning globe while searching
  useEffect(() => {
    const link = document.getElementById("favicon") as HTMLLinkElement | null;
    if (!link) return;
    link.href = loading ? "/favicon-loading.svg" : "/favicon.svg";
  }, [loading]);

  // Tick the elapsed-time counter while a search is running
  useEffect(() => {
    if (!loading) return;
    const start = searchStartedAtRef.current ?? Date.now();
    setElapsedMs(Date.now() - start);
    const id = window.setInterval(() => {
      setElapsedMs(Date.now() - start);
    }, 100);
    return () => window.clearInterval(id);
  }, [loading]);

  useEffect(() => {
    searchGateRef.current = {
      mode,
      tagFilter,
      presetMinZoom: selectedPreset.minZoom,
    };

    const map = mapRef.current;
    if (map) {
      syncLiveMapState(
        map,
        mode,
        tagFilter,
        selectedPreset.minZoom,
        setZoom,
        setVisibleDiagonalKm,
        setBoundsWarning,
      );
    }
  }, [mode, selectedPreset.minZoom, tagFilter]);

  // Place autocomplete
  useEffect(() => {
    const input = locationQuery.trim();
    const service = autocompleteServiceRef.current;

    if (!service || input.length < 3) {
      setPlaceSuggestions([]);
      return;
    }

    let cancelled = false;
    const timer = window.setTimeout(() => {
      setSuggestionsStatus(null);
      void service
        .getPlacePredictions({ input, componentRestrictions: { country: "us" } })
        .then((response) => {
          if (cancelled) return;
          const suggestions =
            response.predictions?.slice(0, 5).map((prediction) => ({
              description: prediction.description,
              placeId: prediction.place_id,
              mainText: prediction.structured_formatting?.main_text ?? prediction.description,
              secondaryText: prediction.structured_formatting?.secondary_text ?? "",
            })) ?? [];
          setPlaceSuggestions(suggestions);
        })
        .catch(() => {
          if (!cancelled) {
            setPlaceSuggestions([]);
            setSuggestionsStatus("Suggestions unavailable. Type the full place and press search.");
          }
        });
    }, 250);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [locationQuery]);

  // Apply map theme/style
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    map.setOptions({ styles: MAP_THEMES[mapTheme] ?? [] });
  }, [mapTheme]);

  const effectiveFeatureColors = useMemo(
    () =>
      resolveFeatureColors(
        presentFeatureKinds,
        autoContrastColorsOn,
        featureColorOverrides,
      ),
    [autoContrastColorsOn, featureColorOverrides, presentFeatureKinds],
  );

  // Keep the style callback's color source in sync and re-render the data layer.
  useEffect(() => {
    featureColorMapRef.current = effectiveFeatureColors;
    const map = mapRef.current;
    const maps = mapsRef.current;
    if (!map || !maps) return;
    map.data.setStyle((feature) =>
      styleForDataFeature(maps, feature, featureColorMapRef.current),
    );
  }, [effectiveFeatureColors]);

  // Tilt control
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    map.setTilt(tiltOn ? 45 : 0);
  }, [tiltOn, mapType]);

  // Manage overlay tile layer
  useEffect(() => {
    const map = mapRef.current;
    const maps = mapsRef.current;
    if (!map || !maps) return;

    if (overlayMapTypeRef.current) {
      const idx = map.overlayMapTypes.getArray().indexOf(overlayMapTypeRef.current);
      if (idx >= 0) {
        map.overlayMapTypes.removeAt(idx);
      }
      overlayMapTypeRef.current = null;
    }

    if (overlaySource.kind === "none") {
      return;
    }

    const overlayType = buildOverlayMapType(maps, overlaySource, gibsDate, overlayOpacity);
    if (overlayType) {
      map.overlayMapTypes.push(overlayType);
      overlayMapTypeRef.current = overlayType;
    }
  }, [overlaySource, gibsDate, overlayOpacity]);

  const clearDataLayer = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    selectedDataFeatureRef.current = null;
    map.data.forEach((feature) => {
      map.data.remove(feature);
    });
  }, []);

  const closeStreetView = useCallback(() => {
    panoramaRef.current?.setVisible(false);
    panoramaRef.current = null;
    setStreetViewState({ status: "idle" });
  }, []);

  const runStreetViewLookup = useCallback(
    async (coordinate: LatLng, sourceName: string, scoutId?: string) => {
      const maps = mapsRef.current;
      const service = streetViewServiceRef.current;
      const lookupId = streetViewLookupIdRef.current + 1;
      streetViewLookupIdRef.current = lookupId;

      if (!maps || !service) {
        setStreetViewState({
          status: "error",
          sourceName,
          scoutId,
          message: "Street view isn't ready yet.",
        });
        return;
      }

      setStreetViewState({ status: "searching", sourceName, scoutId });

      try {
        const panorama = await findNearestStreetView(maps, service, coordinate);
        if (streetViewLookupIdRef.current !== lookupId) return;
        if (!panorama) {
          setStreetViewState({
            status: "none",
            sourceName,
            scoutId,
            message: "No street view available nearby.",
          });
          return;
        }
        setStreetViewState({ status: "open", sourceName, scoutId, data: panorama });
      } catch (lookupError) {
        if (streetViewLookupIdRef.current !== lookupId) return;
        setStreetViewState({
          status: "error",
          sourceName,
          scoutId,
          message:
            lookupError instanceof Error ? lookupError.message : "Couldn't load street view.",
        });
      }
    },
    [],
  );

  const selectDataFeature = useCallback(
    (feature: google.maps.Data.Feature) => {
      selectedDataFeatureRef.current?.setProperty("scoutSelected", false);
      selectedDataFeatureRef.current = feature;
      feature.setProperty("scoutSelected", true);

      const selected = selectedFeatureFromProperties(
        getDataFeatureProperties(feature) as ScoutFeatureProperties,
      );
      if (!selected) return;
      setSelectedFeature(selected);
      void runStreetViewLookup(
        selected.coordinate,
        pickFeatureDisplayName(selected, null, false),
        selected.scoutId,
      );
    },
    [runStreetViewLookup],
  );

  dataFeatureClickRef.current = selectDataFeature;

  const focusMatch = useCallback(
    (match: SelectedFeature) => {
      const map = mapRef.current;
      if (!map) return;
      map.panTo(match.coordinate);
      const currentZoom = map.getZoom() ?? DEFAULT_ZOOM;
      const FOCUS_MIN_ZOOM = 17;
      if (currentZoom < FOCUS_MIN_ZOOM) {
        map.setZoom(FOCUS_MIN_ZOOM);
      }
      let dataFeature: google.maps.Data.Feature | null = null;
      map.data.forEach((feature) => {
        if (dataFeature) return;
        const id = feature.getProperty("scoutId");
        const role = feature.getProperty("scoutRole");
        if (id === match.scoutId && role === "result") {
          dataFeature = feature;
        }
      });
      if (dataFeature) {
        selectDataFeature(dataFeature);
      } else {
        selectedDataFeatureRef.current?.setProperty("scoutSelected", false);
        selectedDataFeatureRef.current = null;
        setSelectedFeature(match);
        void runStreetViewLookup(
          match.coordinate,
          pickFeatureDisplayName(match, null, false),
          match.scoutId,
        );
      }
    },
    [runStreetViewLookup, selectDataFeature],
  );

  const cycleMatch = useCallback(
    (delta: number) => {
      if (resultFeatures.length === 0) return;
      const currentId = selectedFeature?.scoutId;
      const currentIndex = currentId
        ? resultFeatures.findIndex((match) => match.scoutId === currentId)
        : -1;
      const base = currentIndex >= 0 ? currentIndex : delta > 0 ? -1 : 0;
      const next =
        (base + delta + resultFeatures.length) % resultFeatures.length;
      focusMatch(resultFeatures[next]);
    },
    [focusMatch, resultFeatures, selectedFeature],
  );

  const renderFeatures = useCallback(
    (collection: GeoJSONFeatureCollection) => {
      const map = mapRef.current;
      if (!map) return;
      clearDataLayer();
      map.data.addGeoJson(collection);
      loadedFeaturesRef.current = collection;
      setLoadedFeatureCount(collection.features.length);
      setPresentFeatureKinds(collectFeatureKinds(collection));
      const matches: SelectedFeature[] = [];
      for (const feature of collection.features) {
        const role = (feature.properties?.scoutRole ?? "result") as ScoutRole;
        if (role !== "result") continue;
        const summary = selectedFeatureFromProperties(
          (feature.properties ?? {}) as ScoutFeatureProperties,
        );
        if (summary) matches.push(summary);
      }
      matches.sort((a, b) => {
        const aLen = a.matchReason.lengthMeters;
        const bLen = b.matchReason.lengthMeters;
        if (aLen === undefined && bLen === undefined) return 0;
        if (aLen === undefined) return 1;
        if (bLen === undefined) return -1;
        return bLen - aLen;
      });
      setStreetViewAvailability(new Set());
      setResultFeatures(matches);
    },
    [clearDataLayer],
  );

  useEffect(() => {
    if (resultFeatures.length === 0) return;
    const maps = mapsRef.current;
    const service = streetViewServiceRef.current;
    if (!maps || !service) return;

    let cancelled = false;
    const queue = [...resultFeatures];
    const concurrency = 4;

    const worker = async () => {
      while (!cancelled) {
        const match = queue.shift();
        if (!match) return;
        try {
          const panorama = await findNearestStreetView(
            maps,
            service,
            match.coordinate,
          );
          if (cancelled || !panorama) continue;
          setStreetViewAvailability((prev) => {
            if (prev.has(match.scoutId)) return prev;
            const next = new Set(prev);
            next.add(match.scoutId);
            return next;
          });
        } catch {
          // Ignore lookup errors for availability probing.
        }
      }
    };

    void Promise.all(
      Array.from({ length: Math.min(concurrency, resultFeatures.length) }, () =>
        worker(),
      ),
    );

    return () => {
      cancelled = true;
    };
  }, [resultFeatures]);

  const clearResults = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    lastRequestKeyRef.current = null;
    clearDataLayer();
    closeStreetView();
    setSelectedFeature(null);
    setResultFeatures([]);
    setStreetViewAvailability(new Set());
    setMatchListOpen(false);
    setResultCount(0);
    setRenderedFeatureCount(0);
    setRawFeatureCount(null);
    setError(null);
    setSearchWarning(null);
    setShowSearchHereChip(false);
    setLoading(false);
    setPresentFeatureKinds(new Set<FeatureKind>());
    setElapsedMs(0);
    setLastSearchDurationMs(null);
    setSearchOutcome("idle");
    searchStartedAtRef.current = null;
    loadedFeaturesRef.current = { type: "FeatureCollection", features: [] };
    setLoadedFeatureCount(0);
  }, [clearDataLayer, closeStreetView]);

  const handleSearch = useCallback(async () => {
    const map = mapRef.current;
    if (!map) {
      setError("The map is not ready yet.");
      return;
    }

    const currentZoom = map.getZoom() ?? 0;
    const bbox = getCurrentMapBBox(map);
    if (!bbox) {
      setError("Move or zoom the map slightly so a search area is available, then search again.");
      return;
    }

    const gate = validateSearchGate(mode, currentZoom, tagFilter, selectedPreset.minZoom);
    if (gate) {
      setError(gate);
      return;
    }

    let query = "";
    let requestLabel = "";
    let parsedFilter: ParsedTagFilter | null = null;
    const presetOptions: PresetQueryOptions = {
      includeBuildings: showBuildings,
      includeWater: showWater,
      bufferScale,
    };

    try {
      if (mode === "simple") {
        parsedFilter = parseTagFilter(tagFilter);
        query = buildSimpleOverpassQuery(bbox, parsedFilter);
        requestLabel = parsedFilter.label;
      } else if (mode === "preset") {
        query = buildPresetOverpassQuery(selectedPreset, bbox, presetOptions);
        requestLabel = selectedPreset.name;
      } else {
        query = prepareRawOverpassQuery(rawQuery, bbox);
        requestLabel = "Custom query";
      }
    } catch (parseError) {
      setError(parseError instanceof Error ? parseError.message : "Invalid search input.");
      return;
    }

    const requestKey = [
      mode,
      requestLabel,
      bbox.south.toFixed(5),
      bbox.west.toFixed(5),
      bbox.north.toFixed(5),
      bbox.east.toFixed(5),
      String(showBuildings),
      String(showWater),
      String(bufferScale),
    ].join("|");

    if (loading && lastRequestKeyRef.current === requestKey) {
      setSearchWarning("That exact request is already running.");
      return;
    }

    abortRef.current?.abort();
    const abortController = new AbortController();
    abortRef.current = abortController;
    lastRequestKeyRef.current = requestKey;

    setLoading(true);
    setError(null);
    setSelectedFeature(null);
    setShowSearchHereChip(false);
    setSearchOutcome("idle");
    setLastSearchDurationMs(null);
    setElapsedMs(0);
    searchStartedAtRef.current = Date.now();
    closeStreetView();

    const center = map.getCenter();
    if (center) {
      lastSearchCenterRef.current = {
        lat: center.lat(),
        lng: center.lng(),
        zoom: map.getZoom() ?? DEFAULT_ZOOM,
      };
    }

    const diagonalKm = bboxDiagonalKm(bbox);
    setSearchWarning(
      diagonalKm > (mode === "preset" ? 12 : 20)
        ? "This map area is large; results may be slow or capped. Zoom in for a tighter scan."
        : null,
    );

    try {
      const includeNws = mode === "preset" && selectedPreset.id === "preset-weather";
      const [overpass, nws] = await Promise.all([
        runOverpassQuery(query, abortController.signal),
        includeNws
          ? fetchNwsStationsInBBox(bbox, abortController.signal)
          : Promise.resolve(null),
      ]);
      if (abortController.signal.aborted) return;

      const overpassFeatures = nws
        ? [...overpass.geojson.features, ...nws.features]
        : overpass.geojson.features;

      const result =
        mode === "simple"
          ? prepareSimpleResult(overpassFeatures, {
              includeBuildings: false,
              includeWater: false,
              renderLimit: RENDER_LIMIT,
              simpleMatchLabel: parsedFilter
                ? `Matched ${parsedFilter.label}`
                : "Matched simple tag search",
            })
          : mode === "preset"
            ? applyPresetSpatialFilters(overpassFeatures, selectedPreset, {
                includeBuildings: showBuildings,
                includeWater: showWater,
                renderLimit: RENDER_LIMIT,
              })
            : prepareSimpleResult(overpassFeatures, {
                includeBuildings: false,
                includeWater: false,
                renderLimit: RENDER_LIMIT,
                simpleMatchLabel: "Matched custom query",
              });

      const newCollection: GeoJSONFeatureCollection = {
        type: "FeatureCollection",
        features: result.features,
      };

      renderFeatures(newCollection);
      setRawFeatureCount(overpass.rawFeatureCount);
      setResultCount(newCollection.features.length);
      setRenderedFeatureCount(newCollection.features.length);
      setSearchWarning(result.warnings[0] ?? null);
      const startedAt = searchStartedAtRef.current;
      if (startedAt !== null) {
        setLastSearchDurationMs(Date.now() - startedAt);
      }
      setSearchOutcome("success");
    } catch (searchError) {
      if ((searchError as Error).name === "AbortError") return;
      setError(
        searchError instanceof Error
          ? searchError.message
          : "Search failed. Try a smaller area or a simpler filter.",
      );
      const startedAt = searchStartedAtRef.current;
      if (startedAt !== null) {
        setLastSearchDurationMs(Date.now() - startedAt);
      }
      setSearchOutcome("error");
    } finally {
      if (abortRef.current === abortController) {
        abortRef.current = null;
        setLoading(false);
        searchStartedAtRef.current = null;
      }
    }
  }, [
    bufferScale,
    closeStreetView,
    loading,
    mode,
    renderFeatures,
    rawQuery,
    selectedPreset,
    showBuildings,
    showWater,
    tagFilter,
  ]);

  const handleExport = useCallback(
    async (format: ExportFormat) => {
      const collection = loadedFeaturesRef.current;
      if (!collection.features.length) {
        setError("Load some results before exporting.");
        return;
      }
      setExportBusy(true);
      setError(null);
      try {
        const stamp = new Date()
          .toISOString()
          .replace(/[:T]/g, "-")
          .replace(/\..+$/, "");
        await exportFeatureCollection(collection, format, {
          basename: `overpass-scout-${stamp}`,
          documentName: `Overpass Scout export · ${collection.features.length.toLocaleString()} feature${
            collection.features.length === 1 ? "" : "s"
          }`,
          featureColors: effectiveFeatureColors,
        });
      } catch (exportError) {
        setError(
          exportError instanceof Error
            ? exportError.message
            : "Export failed. Try again or pick a different format.",
        );
      } finally {
        setExportBusy(false);
      }
    },
    [effectiveFeatureColors],
  );

  const deactivatePegmanMode = useCallback(() => {
    pegmanMapClickListenerRef.current?.remove();
    pegmanMapClickListenerRef.current = null;
    streetViewCoverageRef.current?.setMap(null);
    const map = mapRef.current;
    if (map) {
      map.setOptions({ draggableCursor: null });
    }
    setPegmanMode(false);
  }, []);

  const togglePegmanMode = useCallback(() => {
    const map = mapRef.current;
    if (!map) {
      setError("The map is not ready yet.");
      return;
    }
    if (pegmanMode) {
      deactivatePegmanMode();
      return;
    }
    setError(null);
    streetViewCoverageRef.current?.setMap(map);
    map.setOptions({ draggableCursor: "crosshair" });
    pegmanMapClickListenerRef.current?.remove();
    pegmanMapClickListenerRef.current = map.addListener(
      "click",
      (event: google.maps.MapMouseEvent) => {
        if (!event.latLng) return;
        const coordinate = { lat: event.latLng.lat(), lng: event.latLng.lng() };
        deactivatePegmanMode();
        void runStreetViewLookup(coordinate, "Selected point");
      },
    );
    setPegmanMode(true);
  }, [deactivatePegmanMode, pegmanMode, runStreetViewLookup]);

  const handlePegmanDragStart = useCallback(
    (event: React.DragEvent<HTMLButtonElement>) => {
      const map = mapRef.current;
      if (!map) {
        event.preventDefault();
        setError("The map is not ready yet.");
        return;
      }
      setError(null);
      pegmanMapClickListenerRef.current?.remove();
      pegmanMapClickListenerRef.current = null;
      streetViewCoverageRef.current?.setMap(map);
      map.setOptions({ draggableCursor: null });
      event.dataTransfer.effectAllowed = "copy";
      event.dataTransfer.setData("application/x-pegman", "1");
      setPegmanMode(true);
    },
    [],
  );

  const handlePegmanDragEnd = useCallback(() => {
    deactivatePegmanMode();
  }, [deactivatePegmanMode]);

  const handleMapPegmanDragOver = useCallback(
    (event: React.DragEvent<HTMLElement>) => {
      if (!Array.from(event.dataTransfer.types).includes("application/x-pegman")) {
        return;
      }
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
    },
    [],
  );

  const handleMapPegmanDrop = useCallback(
    (event: React.DragEvent<HTMLElement>) => {
      if (!Array.from(event.dataTransfer.types).includes("application/x-pegman")) {
        return;
      }
      event.preventDefault();
      const overlay = pegmanProjectionRef.current;
      const projection = overlay?.getProjection();
      const mapDiv = mapDivRef.current;
      const maps = mapsRef.current;
      if (!projection || !mapDiv || !maps) return;
      const rect = mapDiv.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      const latLng = projection.fromContainerPixelToLatLng(
        new maps.maps.Point(x, y),
      );
      if (!latLng) return;
      const coordinate = { lat: latLng.lat(), lng: latLng.lng() };
      void runStreetViewLookup(coordinate, "Dropped pin");
    },
    [runStreetViewLookup],
  );

  const scopeToLocation = useCallback(
    (queryOverride?: string, placeId?: string) => {
      const map = mapRef.current;
      const geocoder = geocoderRef.current;
      const query = (queryOverride ?? locationQuery).trim();
      if (!map || !geocoder) {
        setError("Location search is not ready yet.");
        return;
      }
      if (!query) {
        setError("Enter a city, address, place, or coordinates to scope the map.");
        return;
      }

      setError(null);
      setPlaceSuggestions([]);

      geocoder.geocode(placeId ? { placeId } : { address: query }, (results, status) => {
        const result = results?.[0];
        if (status !== "OK" || !result) {
          setError("Could not find that location. Try a more specific place name or address.");
          return;
        }
        if (result.geometry.viewport) {
          map.fitBounds(result.geometry.viewport);
        } else {
          map.setCenter(result.geometry.location);
          map.setZoom(Math.max(map.getZoom() ?? DEFAULT_ZOOM, 14));
        }
        window.setTimeout(() => {
          if ((map.getZoom() ?? 0) < 13) {
            map.setZoom(13);
          }
        }, 0);
        const formatted = result.formatted_address ?? query;
        setLocationQuery(formatted);
      });
    },
    [locationQuery],
  );

  const scopeToCurrentLocation = useCallback(() => {
    const map = mapRef.current;
    if (!map) {
      setError("Map is not ready yet.");
      return;
    }
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setError("Your browser does not support geolocation.");
      return;
    }

    setError(null);
    setPlaceSuggestions([]);
    setGeolocating(true);

    navigator.geolocation.getCurrentPosition(
      (position) => {
        setGeolocating(false);
        const { latitude, longitude } = position.coords;
        const latLng = { lat: latitude, lng: longitude };
        map.setCenter(latLng);
        map.setZoom(Math.max(map.getZoom() ?? DEFAULT_ZOOM, 14));

        const geocoder = geocoderRef.current;
        const fallback = `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`;
        if (!geocoder) {
          setLocationQuery(fallback);
          return;
        }
        geocoder.geocode({ location: latLng }, (results, status) => {
          const formatted =
            status === "OK" && results && results.length > 0
              ? results[0].formatted_address
              : null;
          setLocationQuery(formatted ?? fallback);
        });
      },
      (err) => {
        setGeolocating(false);
        const message =
          err.code === err.PERMISSION_DENIED
            ? "Location permission was denied. Allow location access in your browser to use this."
            : err.code === err.POSITION_UNAVAILABLE
              ? "Your location is currently unavailable. Try again in a moment."
              : err.code === err.TIMEOUT
                ? "Timed out while trying to get your location."
                : "Could not get your current location.";
        setError(message);
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
    );
  }, []);

  const zoomMap = useCallback((delta: number) => {
    const map = mapRef.current;
    if (!map) return;
    map.setZoom((map.getZoom() ?? DEFAULT_ZOOM) + delta);
  }, []);

  const setMapTypeId = useCallback((next: MapDisplayType) => {
    const map = mapRef.current;
    if (!map) return;
    map.setMapTypeId(next);
    setMapType(next);
  }, []);

  const resetMapCamera = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    map.setHeading(0);
    map.setTilt(0);
    setTiltOn(false);
  }, []);

  const enterMapFullscreen = useCallback(() => {
    const region = mapRegionRef.current;
    if (!region || document.fullscreenElement) return;
    void region.requestFullscreen().catch(() => {
      setError("Fullscreen is not available in this browser.");
    });
  }, []);

  const handleNudgeDate = useCallback(
    (days: number) => {
      setGibsDate((prev) => {
        const next = new Date(prev + "T00:00:00Z");
        next.setUTCDate(next.getUTCDate() + days);
        const today = new Date();
        if (next.getTime() > today.getTime()) return formatGibsDate(today);
        const min = new Date(GIBS_MIN_DATE + "T00:00:00Z");
        if (next.getTime() < min.getTime()) return GIBS_MIN_DATE;
        return formatGibsDate(next);
      });
    },
    [],
  );

  useEffect(() => {
    let cancelled = false;
    const listeners: google.maps.MapsEventListener[] = [];

    async function setupMap() {
      try {
        const maps = await loadGoogleMaps(apiKey);
        if (cancelled || !mapDivRef.current || mapRef.current) return;

        mapsRef.current = maps;
        const cachedView = cachedMapViewRef.current;
        const map = new maps.maps.Map(mapDivRef.current, {
          center: cachedView?.center ?? DEFAULT_CENTER,
          zoom: cachedView?.zoom ?? DEFAULT_ZOOM,
          mapTypeId: cachedView?.mapType ?? "roadmap",
          disableDefaultUI: true,
          zoomControl: false,
          mapTypeControl: false,
          streetViewControl: false,
          fullscreenControl: false,
          rotateControl: false,
          scaleControl: true,
          clickableIcons: false,
          gestureHandling: "greedy",
          styles: MAP_THEMES.default,
        });

        mapRef.current = map;
        streetViewServiceRef.current = new maps.maps.StreetViewService();
        geocoderRef.current = new maps.maps.Geocoder();
        if (maps.maps.StreetViewCoverageLayer) {
          streetViewCoverageRef.current = new maps.maps.StreetViewCoverageLayer();
        }

        const ProjectionOverlay = class extends maps.maps.OverlayView {
          onAdd() {}
          draw() {}
          onRemove() {}
        };
        const projectionOverlay = new ProjectionOverlay();
        projectionOverlay.setMap(map);
        pegmanProjectionRef.current = projectionOverlay;
        map.data.setStyle((feature) =>
          styleForDataFeature(maps, feature, featureColorMapRef.current),
        );

        void maps.maps
          .importLibrary("places")
          .then((placesLibrary) => {
            if (!cancelled && "AutocompleteService" in placesLibrary) {
              autocompleteServiceRef.current = new placesLibrary.AutocompleteService();
            }
          })
          .catch(() => {
            if (!cancelled) {
              setSuggestionsStatus("Suggestions unavailable. Type the full place and press search.");
            }
          });

        const syncCurrentMapState = () => {
          const gate = searchGateRef.current;
          syncLiveMapState(
            map,
            gate.mode,
            gate.tagFilter,
            gate.presetMinZoom,
            setZoom,
            setVisibleDiagonalKm,
            setBoundsWarning,
          );
        };

        const maybeShowSearchHereChip = () => {
          const last = lastSearchCenterRef.current;
          if (!last) return;
          const center = map.getCenter();
          if (!center) return;
          const movedKm = haversineKm(
            { lat: last.lat, lng: last.lng },
            { lat: center.lat(), lng: center.lng() },
          );
          const zoomedDelta = Math.abs((map.getZoom() ?? DEFAULT_ZOOM) - last.zoom);
          setShowSearchHereChip(movedKm > 0.25 || zoomedDelta >= 1);
        };

        const persistCurrentMapView = () => {
          const center = map.getCenter();
          if (!center) return;
          saveCachedMapView({
            center: { lat: center.lat(), lng: center.lng() },
            zoom: map.getZoom() ?? DEFAULT_ZOOM,
            mapType: normalizeMapTypeId(map.getMapTypeId()),
          });
        };

        listeners.push(
          map.data.addListener("click", (event: google.maps.Data.MouseEvent) => {
            dataFeatureClickRef.current(event.feature);
          }),
          map.addListener("maptypeid_changed", () => {
            setMapType(normalizeMapTypeId(map.getMapTypeId()));
            persistCurrentMapView();
          }),
          map.addListener("idle", () => {
            syncCurrentMapState();
            maybeShowSearchHereChip();
            persistCurrentMapView();
          }),
          map.addListener("bounds_changed", syncCurrentMapState),
        );

        window.setTimeout(syncCurrentMapState, 250);
        window.setTimeout(syncCurrentMapState, 1500);
        setMapStatus("Map ready");
      } catch (mapError) {
        setMapStatus("Map failed to load.");
        setError(mapError instanceof Error ? mapError.message : "Map failed to load.");
      }
    }

    void setupMap();

    return () => {
      cancelled = true;
      listeners.forEach((listener) => listener.remove());
    };
  }, [apiKey]);

  useEffect(() => {
    const maps = mapsRef.current;
    const container = streetViewDivRef.current;
    if (streetViewState.status !== "open" || !maps || !container) return;
    const location = streetViewState.data.location;
    if (!location?.pano || !location.latLng) return;
    panoramaRef.current = new maps.maps.StreetViewPanorama(container, {
      pano: location.pano,
      position: location.latLng,
      pov: { heading: 0, pitch: 0 },
      zoom: 1,
      visible: true,
      addressControl: true,
      fullscreenControl: true,
      motionTracking: false,
      motionTrackingControl: false,
    });
    const entries = extractPanoHistory(streetViewState.data);
    setPanoHistory(entries);
    setPanoHistoryIndex(
      entries.length > 0
        ? Math.max(
            0,
            entries.findIndex((entry) => entry.panoId === location.pano),
          )
        : -1,
    );
  }, [streetViewState]);

  useEffect(() => {
    if (streetViewState.status !== "open") {
      setPanoHistory([]);
      setPanoHistoryIndex(-1);
    }
  }, [streetViewState.status]);

  const handlePanoHistoryChange = useCallback(
    (index: number) => {
      const entry = panoHistory[index];
      if (!entry) return;
      setPanoHistoryIndex(index);
      panoramaRef.current?.setPano(entry.panoId);
    },
    [panoHistory],
  );

  const clampStreetViewWidth = useCallback((width: number) => {
    const maxWidth = Math.max(
      STREET_VIEW_MIN_WIDTH,
      window.innerWidth * STREET_VIEW_MAX_WIDTH_VW,
    );
    return Math.min(maxWidth, Math.max(STREET_VIEW_MIN_WIDTH, width));
  }, []);

  useEffect(() => {
    if (streetViewState.status !== "open") return;
    if (streetViewWidth !== null) return;
    setStreetViewWidth(clampStreetViewWidth(computeDefaultStreetViewWidth()));
  }, [clampStreetViewWidth, streetViewState.status, streetViewWidth]);

  useEffect(() => {
    if (streetViewWidth === null) return;
    const handleWindowResize = () => {
      setStreetViewWidth((current) =>
        current === null ? current : clampStreetViewWidth(current),
      );
    };
    window.addEventListener("resize", handleWindowResize);
    return () => window.removeEventListener("resize", handleWindowResize);
  }, [clampStreetViewWidth, streetViewWidth]);

  const handleStreetViewResizePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (streetViewWidth === null) return;
      event.preventDefault();
      const target = event.currentTarget;
      target.setPointerCapture(event.pointerId);
      streetViewResizeStateRef.current = {
        startX: event.clientX,
        startWidth: streetViewWidth,
      };
      document.body.classList.add("street-view-resizing");
    },
    [streetViewWidth],
  );

  const handleStreetViewResizePointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const state = streetViewResizeStateRef.current;
      if (!state) return;
      const delta = state.startX - event.clientX;
      setStreetViewWidth(clampStreetViewWidth(state.startWidth + delta));
    },
    [clampStreetViewWidth],
  );

  const endStreetViewResize = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!streetViewResizeStateRef.current) return;
      streetViewResizeStateRef.current = null;
      const target = event.currentTarget;
      if (target.hasPointerCapture(event.pointerId)) {
        target.releasePointerCapture(event.pointerId);
      }
      document.body.classList.remove("street-view-resizing");
    },
    [],
  );

  const handleStreetViewResizeDoubleClick = useCallback(() => {
    setStreetViewWidth(clampStreetViewWidth(computeDefaultStreetViewWidth()));
  }, [clampStreetViewWidth]);

  const handleStreetViewResizeKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      event.preventDefault();
      const step = event.shiftKey ? 64 : 16;
      const direction = event.key === "ArrowLeft" ? 1 : -1;
      setStreetViewWidth((current) =>
        current === null
          ? current
          : clampStreetViewWidth(current + step * direction),
      );
    },
    [clampStreetViewWidth],
  );

  useEffect(() => {
    if (streetViewState.status !== "open" && streetViewWidth !== null) {
      setStreetViewWidth(null);
    }
  }, [streetViewState.status, streetViewWidth]);

  useEffect(() => {
    const maps = mapsRef.current;
    const panorama = panoramaRef.current;
    if (!maps || !panorama) return;
    maps.maps.event.trigger(panorama, "resize");
  }, [streetViewWidth]);

  useEffect(() => {
    if (!selectedFeature) {
      setResolvedAddress(null);
      setResolvingAddress(false);
      return;
    }

    const geocoder = geocoderRef.current;
    if (!geocoder) {
      setResolvedAddress(null);
      return;
    }

    const { lat, lng } = selectedFeature.coordinate;
    const cacheKey = `${lat.toFixed(5)},${lng.toFixed(5)}`;
    const cached = addressCacheRef.current.get(cacheKey);
    if (cached !== undefined) {
      setResolvedAddress(cached);
      setResolvingAddress(false);
      return;
    }

    let cancelled = false;
    setResolvingAddress(true);
    setResolvedAddress(null);
    geocoder.geocode({ location: { lat, lng } }, (results, status) => {
      if (cancelled) return;
      const first = results && results.length > 0 ? results[0].formatted_address : null;
      const address = status === "OK" && first ? first : null;
      addressCacheRef.current.set(cacheKey, address);
      setResolvedAddress(address);
      setResolvingAddress(false);
    });

    return () => {
      cancelled = true;
    };
  }, [selectedFeature]);

  useEffect(() => {
    if (!selectedFeature) return;
    const nextName = pickFeatureDisplayName(selectedFeature, resolvedAddress, resolvingAddress);
    setStreetViewState((prev) => {
      if (prev.status === "idle") return prev;
      if (prev.scoutId !== selectedFeature.scoutId) return prev;
      if (prev.sourceName === nextName) return prev;
      return { ...prev, sourceName: nextName };
    });
  }, [selectedFeature, resolvedAddress, resolvingAddress]);

  return (
    <div className="app-shell">
      <main
        ref={mapRegionRef}
        className="map-region"
        aria-label="Map workspace"
        onDragOver={handleMapPegmanDragOver}
        onDrop={handleMapPegmanDrop}
      >
        <div ref={mapDivRef} className="map-canvas" aria-label="Map" />

        <SearchPill
          locationQuery={locationQuery}
          onLocationChange={(value) => {
            setLocationQuery(value);
            setSuggestionsStatus(null);
          }}
          onSubmit={() => scopeToLocation()}
          suggestions={placeSuggestions}
          suggestionsStatus={suggestionsStatus}
          onSelectSuggestion={(suggestion) =>
            scopeToLocation(suggestion.description, suggestion.placeId)
          }
          onClearSuggestions={() => setPlaceSuggestions([])}
          onUseMyLocation={scopeToCurrentLocation}
          geolocating={geolocating}
          loading={loading}
          mapStatus={mapStatus}
          zoom={zoom}
        />

        {showSearchHereChip && !loading ? (
          <button
            type="button"
            className="search-here-chip"
            onClick={() => void handleSearch()}
            aria-label="Search this area"
          >
            <RefreshIcon />
            Search this area
          </button>
        ) : null}

        <PresetPanel
          open={presetPanelOpen}
          onToggle={() => setPresetPanelOpen((v) => !v)}
          presetId={presetId}
          onPresetChange={setPresetId}
          presetSearch={presetSearch}
          onPresetSearchChange={setPresetSearch}
          presetCategory={presetCategory}
          onPresetCategoryChange={setPresetCategory}
          filteredPresets={filteredPresets}
          loading={loading}
          onSearch={() => void handleSearch()}
          onClear={clearResults}
          resultCount={resultCount}
          renderedFeatureCount={renderedFeatureCount}
          elapsedMs={elapsedMs}
          lastSearchDurationMs={lastSearchDurationMs}
          searchOutcome={searchOutcome}
        />

        <FloatingExport
          loadedFeatureCount={loadedFeatureCount}
          exportBusy={exportBusy}
          onExport={(format) => void handleExport(format)}
        />

        <LayersPanel
          open={layersPanelOpen}
          onToggle={() => setLayersPanelOpen((v) => !v)}
          mapType={mapType}
          onMapTypeChange={setMapTypeId}
          theme={mapTheme}
          onThemeChange={setMapTheme}
          tiltOn={tiltOn}
          onTiltChange={setTiltOn}
          overlayId={overlayId}
          onOverlayChange={setOverlayId}
          overlayOpacity={overlayOpacity}
          onOverlayOpacityChange={setOverlayOpacity}
          featureColors={effectiveFeatureColors}
          featureColorOverrides={featureColorOverrides}
          onFeatureColorChange={(kind, color) =>
            setFeatureColorOverrides((prev) => ({ ...prev, [kind]: color }))
          }
          onFeatureColorReset={(kind) =>
            setFeatureColorOverrides((prev) => {
              if (!(kind in prev)) return prev;
              const next = { ...prev };
              delete next[kind];
              return next;
            })
          }
          onFeatureColorResetAll={() => setFeatureColorOverrides({})}
          autoContrast={autoContrastColorsOn}
          onAutoContrastChange={setAutoContrastColorsOn}
          presentFeatureKinds={presentFeatureKinds}
        />

        <MapControls
          tiltOn={tiltOn}
          pegmanActive={pegmanMode}
          onZoomIn={() => zoomMap(1)}
          onZoomOut={() => zoomMap(-1)}
          onToggleTilt={() => setTiltOn((v) => !v)}
          onResetCamera={resetMapCamera}
          onFullscreen={enterMapFullscreen}
          onStreetView={togglePegmanMode}
          onPegmanDragStart={handlePegmanDragStart}
          onPegmanDragEnd={handlePegmanDragEnd}
        />

        <MapLegend
          presentFeatureKinds={presentFeatureKinds}
          featureColors={effectiveFeatureColors}
        />

        {gibsActive ? (
          <TimeDock
            value={gibsDate}
            min={GIBS_MIN_DATE}
            max={formatGibsDate(new Date())}
            sourceLabel={overlaySource.shortLabel}
            onChange={setGibsDate}
            onNudge={handleNudgeDate}
          />
        ) : null}

        <div className="toast-stack" aria-live="polite">
          {activeWarning ? <p className="notice warning">{activeWarning}</p> : null}
          {error ? <p className="notice error">{error}</p> : null}
        </div>

        {resultFeatures.length > 0 && !matchListOpen ? (
          <button
            type="button"
            className="match-browse-chip"
            onClick={() => setMatchListOpen(true)}
            aria-label={`Browse ${resultFeatures.length} matches`}
          >
            <ListIcon />
            Browse {resultFeatures.length.toLocaleString()}{" "}
            {resultFeatures.length === 1 ? "match" : "matches"}
          </button>
        ) : null}

        {matchListOpen && resultFeatures.length > 0 ? (
          <MatchListPanel
            matches={resultFeatures}
            selectedId={selectedFeature?.scoutId ?? null}
            streetViewAvailability={streetViewAvailability}
            onSelect={focusMatch}
            onClose={() => setMatchListOpen(false)}
            onPrev={() => cycleMatch(-1)}
            onNext={() => cycleMatch(1)}
            rightOffset={
              streetViewState.status === "open" && streetViewWidth !== null
                ? streetViewWidth + 16
                : 16
            }
          />
        ) : null}

        {selectedFeature ? (
          <FeatureCard
            selectedFeature={selectedFeature}
            streetViewState={streetViewState}
            resolvedAddress={resolvedAddress}
            resolvingAddress={resolvingAddress}
            totalMatches={resultFeatures.length}
            currentIndex={
              resultFeatures.findIndex(
                (match) => match.scoutId === selectedFeature.scoutId,
              )
            }
            onPrev={() => cycleMatch(-1)}
            onNext={() => cycleMatch(1)}
            onClose={() => {
              setSelectedFeature(null);
              selectedDataFeatureRef.current?.setProperty("scoutSelected", false);
              selectedDataFeatureRef.current = null;
              closeStreetView();
            }}
          />
        ) : null}

        {streetViewState.status === "open"
          ? (() => {
              const panoLatLng = streetViewState.data.location?.latLng;
              const coordinate: LatLng | null = panoLatLng
                ? { lat: panoLatLng.lat(), lng: panoLatLng.lng() }
                : selectedFeature?.coordinate ?? null;
              const tagAddress = selectedFeature
                ? buildAddressFromTags(selectedFeature.tags)
                : null;
              const streetViewAddress = tagAddress ?? resolvedAddress;
              const externalLinks = coordinate
                ? buildExternalLinks(coordinate, streetViewAddress)
                : [];
              return (
                <section
                  className="street-view-panel"
                  aria-label="Street view"
                  style={
                    streetViewWidth !== null
                      ? { width: `${streetViewWidth}px` }
                      : undefined
                  }
                >
                  <div
                    className="street-view-resize-handle"
                    role="separator"
                    aria-orientation="vertical"
                    aria-label="Resize street view panel"
                    tabIndex={0}
                    onPointerDown={handleStreetViewResizePointerDown}
                    onPointerMove={handleStreetViewResizePointerMove}
                    onPointerUp={endStreetViewResize}
                    onPointerCancel={endStreetViewResize}
                    onDoubleClick={handleStreetViewResizeDoubleClick}
                    onKeyDown={handleStreetViewResizeKeyDown}
                    title="Drag to resize · double-click to reset"
                  >
                    <span className="street-view-resize-grip" aria-hidden="true" />
                  </div>
                  <div className="street-view-header">
                    <div className="street-view-header-title">
                      <span className="street-view-badge" aria-hidden="true">
                        <PegmanIcon />
                      </span>
                      <div>
                        <p className="eyebrow">Street view</p>
                        <h2>{streetViewState.sourceName}</h2>
                      </div>
                    </div>
                    <button
                      type="button"
                      className="icon-button street-view-close"
                      onClick={closeStreetView}
                      aria-label="Close street view"
                      title="Close"
                    >
                      <CloseIcon />
                    </button>
                  </div>
                  {externalLinks.length > 0 ? (
                    <div className="street-view-links external-links">
                      {externalLinks.map((link) => (
                        <a
                          key={link.label}
                          href={link.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="external-link"
                        >
                          {link.label}
                        </a>
                      ))}
                    </div>
                  ) : null}
                  <StreetViewTimeSlider
                    entries={panoHistory}
                    activeIndex={panoHistoryIndex}
                    onChange={handlePanoHistoryChange}
                    fallbackDate={streetViewState.data.imageDate}
                  />
                  <div ref={streetViewDivRef} className="street-view-canvas" />
                </section>
              );
            })()
          : null}
      </main>
    </div>
  );
}

/* ---------------- SearchPill ---------------- */

function SearchPill({
  locationQuery,
  onLocationChange,
  onSubmit,
  suggestions,
  suggestionsStatus,
  onSelectSuggestion,
  onClearSuggestions,
  onUseMyLocation,
  geolocating,
  loading,
  mapStatus,
  zoom,
}: {
  locationQuery: string;
  onLocationChange: (value: string) => void;
  onSubmit: () => void;
  suggestions: PlaceSuggestion[];
  suggestionsStatus: string | null;
  onSelectSuggestion: (suggestion: PlaceSuggestion) => void;
  onClearSuggestions: () => void;
  onUseMyLocation: () => void;
  geolocating: boolean;
  loading: boolean;
  mapStatus: string;
  zoom: number;
}) {
  const containerRef = useRef<HTMLFormElement>(null);
  const [dropdownOpen, setDropdownOpen] = useState(false);

  useEffect(() => {
    if (!dropdownOpen) return;
    const handlePointerDown = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [dropdownOpen]);

  const showDropdown = dropdownOpen && (suggestions.length > 0 || Boolean(suggestionsStatus));

  return (
    <form
      ref={containerRef}
      className="search-pill"
      onSubmit={(event) => {
        event.preventDefault();
        setDropdownOpen(false);
        onSubmit();
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape" && dropdownOpen) {
          event.stopPropagation();
          setDropdownOpen(false);
        }
      }}
      role="search"
      aria-label="Search location"
    >
      <div className="search-pill-row">
        <span className="icon-button" aria-hidden="true">
          <SearchIcon />
        </span>
        <input
          value={locationQuery}
          onChange={(event) => {
            setDropdownOpen(true);
            onLocationChange(event.target.value);
          }}
          onFocus={() => setDropdownOpen(true)}
          placeholder="Search a place or address"
          autoComplete="off"
          spellCheck={false}
          aria-label="Location"
        />
        {locationQuery ? (
          <button
            type="button"
            className="icon-button"
            onClick={() => {
              onLocationChange("");
              onClearSuggestions();
              setDropdownOpen(false);
            }}
            aria-label="Clear"
          >
            <CloseIcon />
          </button>
        ) : null}
        <button
          type="button"
          className={`icon-button locate-button${geolocating ? " is-active" : ""}`}
          onClick={() => {
            setDropdownOpen(false);
            onUseMyLocation();
          }}
          aria-label="Use my current location"
          title="Use my current location"
          disabled={geolocating}
        >
          {geolocating ? <SpinnerIcon /> : <LocateIcon />}
        </button>
        <div className="pill-divider" aria-hidden="true" />
        <button
          type="submit"
          className="icon-button"
          aria-label="Search"
          title={`${mapStatus} · zoom ${zoom}`}
          disabled={loading}
        >
          {loading ? <SpinnerIcon /> : <ArrowRightIcon />}
        </button>
      </div>
      {showDropdown ? (
        suggestions.length > 0 ? (
          <div className="search-suggestions" role="listbox" aria-label="Location suggestions">
            {suggestions.map((suggestion) => (
              <button
                key={suggestion.placeId}
                type="button"
                className="search-suggestion"
                onClick={() => {
                  setDropdownOpen(false);
                  onSelectSuggestion(suggestion);
                }}
              >
                <span className="pin-icon" aria-hidden="true">
                  <PinIcon />
                </span>
                <span className="search-suggestion-main">
                  <strong>{suggestion.mainText}</strong>
                  {suggestion.secondaryText ? <small>{suggestion.secondaryText}</small> : null}
                </span>
              </button>
            ))}
          </div>
        ) : suggestionsStatus ? (
          <div className="search-suggestion-status">{suggestionsStatus}</div>
        ) : null
      ) : null}
    </form>
  );
}

/* ---------------- PresetPanel ---------------- */

function PresetPanel(props: {
  open: boolean;
  onToggle: () => void;
  presetId: PresetId;
  onPresetChange: (id: PresetId) => void;
  presetSearch: string;
  onPresetSearchChange: (value: string) => void;
  presetCategory: string;
  onPresetCategoryChange: (id: string) => void;
  filteredPresets: PresetDefinition[];
  loading: boolean;
  onSearch: () => void;
  onClear: () => void;
  resultCount: number;
  renderedFeatureCount: number;
  elapsedMs: number;
  lastSearchDurationMs: number | null;
  searchOutcome: "idle" | "success" | "error";
}) {
  return (
    <aside className={`panel preset-panel ${props.open ? "" : "collapsed"}`} aria-label="I'm Looking For">
      <div className="panel-header">
        <span className="panel-icon" aria-hidden="true">
          <CompassIcon />
        </span>
        <h2>I'm Looking For</h2>
        <button
          type="button"
          className="panel-toggle"
          onClick={props.onToggle}
          aria-label={props.open ? "Collapse panel" : "Expand panel"}
          aria-expanded={props.open}
        >
          <ChevronUpIcon />
        </button>
      </div>

      <div className="panel-body">
        <div className="panel-section">
          <div className="preset-search">
            <span className="preset-search-icon" aria-hidden="true">
              <SearchIcon />
            </span>
            <input
              value={props.presetSearch}
              onChange={(event) => props.onPresetSearchChange(event.target.value)}
              placeholder={`Search ${PRESETS.length} premade queries`}
              spellCheck={false}
            />
          </div>
          <div className="category-chips" role="tablist" aria-label="Preset categories">
            {PRESET_CATEGORIES.map((category) => (
              <button
                key={category.id}
                type="button"
                role="tab"
                className="chip"
                aria-pressed={category.id === props.presetCategory}
                onClick={() => props.onPresetCategoryChange(category.id)}
              >
                {category.label}
              </button>
            ))}
          </div>
          <div className="preset-list" role="listbox" aria-label="Premade scouting queries">
            {props.filteredPresets.length === 0 ? (
              <p className="search-suggestion-status">No presets match your search.</p>
            ) : (
              props.filteredPresets.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  className="preset-card"
                  aria-pressed={preset.id === props.presetId}
                  onClick={() => {
                    props.onPresetChange(preset.id);
                  }}
                >
                  <span className="preset-card-icon" aria-hidden="true">
                    <PresetGlyph presetId={preset.id} />
                  </span>
                  <span className="preset-card-body">
                    <span className="preset-card-title">{preset.name}</span>
                    <span className="preset-card-desc">{preset.description}</span>
                  </span>
                </button>
              ))
            )}
          </div>
        </div>

      </div>

      <div className="panel-footer">
        <SearchStatusBanner
          loading={props.loading}
          elapsedMs={props.elapsedMs}
          lastSearchDurationMs={props.lastSearchDurationMs}
          searchOutcome={props.searchOutcome}
          resultCount={props.resultCount}
        />
        <dl className="stats-strip">
          <div>
            <dt>Results</dt>
            <dd>{props.resultCount.toLocaleString()}</dd>
          </div>
          <div>
            <dt>Shown</dt>
            <dd>{props.renderedFeatureCount.toLocaleString()}</dd>
          </div>
        </dl>
      </div>
      <div className="panel-actions">
        <button
          type="button"
          className="primary-button"
          onClick={props.onSearch}
          disabled={props.loading}
        >
          {props.loading ? <SpinnerIcon /> : <SearchIcon />}
          {props.loading
            ? `Searching... ${formatSeconds(props.elapsedMs)}`
            : "Search this area"}
        </button>
        <button type="button" className="ghost-button" onClick={props.onClear}>
          Clear
        </button>
      </div>
    </aside>
  );
}

function FloatingExport(props: {
  loadedFeatureCount: number;
  exportBusy: boolean;
  onExport: (format: ExportFormat) => void;
}) {
  if (props.loadedFeatureCount === 0) return null;
  const formats: { id: ExportFormat; label: string; title: string }[] = [
    { id: "geojson", label: "GeoJSON", title: "Download as GeoJSON (.geojson)" },
    { id: "kml", label: "KML", title: "Download as KML (.kml) for Google Earth, QGIS, etc." },
    { id: "kmz", label: "KMZ", title: "Download as compressed KMZ (.kmz)" },
  ];
  return (
    <div className="floating-export" role="group" aria-label="Export loaded features">
      <span className="floating-export-count">
        {props.loadedFeatureCount.toLocaleString()} loaded
      </span>
      <span className="floating-export-divider" aria-hidden="true" />
      {formats.map((format) => (
        <button
          key={format.id}
          type="button"
          className="floating-export-button"
          onClick={() => props.onExport(format.id)}
          disabled={props.exportBusy}
          title={format.title}
          aria-label={format.title}
        >
          {props.exportBusy ? <SpinnerIcon /> : <DownloadIcon />}
          {format.label}
        </button>
      ))}
    </div>
  );
}

function formatSeconds(ms: number) {
  return `${(ms / 1000).toFixed(1)}s`;
}

function SearchStatusBanner(props: {
  loading: boolean;
  elapsedMs: number;
  lastSearchDurationMs: number | null;
  searchOutcome: "idle" | "success" | "error";
  resultCount: number;
}) {
  if (props.loading) {
    return (
      <div className="search-status search-status-running" role="status" aria-live="polite">
        <span className="search-status-spinner" aria-hidden="true">
          <SpinnerIcon />
        </span>
        <span className="search-status-text">
          <strong>Searching…</strong>
          <small>Elapsed {formatSeconds(props.elapsedMs)}</small>
        </span>
      </div>
    );
  }

  if (props.searchOutcome === "success" && props.lastSearchDurationMs !== null) {
    return (
      <div className="search-status search-status-success" role="status" aria-live="polite">
        <span className="search-status-icon" aria-hidden="true">
          <CheckIcon />
        </span>
        <span className="search-status-text">
          <strong>Done in {formatSeconds(props.lastSearchDurationMs)}</strong>
          <small>
            {props.resultCount.toLocaleString()}{" "}
            {props.resultCount === 1 ? "result" : "results"}
          </small>
        </span>
      </div>
    );
  }

  if (props.searchOutcome === "error" && props.lastSearchDurationMs !== null) {
    return (
      <div className="search-status search-status-error" role="status" aria-live="polite">
        <span className="search-status-icon" aria-hidden="true">
          <CloseIcon />
        </span>
        <span className="search-status-text">
          <strong>Search failed</strong>
          <small>Stopped after {formatSeconds(props.lastSearchDurationMs)}</small>
        </span>
      </div>
    );
  }

  return null;
}

/* ---------------- LayersPanel ---------------- */

function LayersPanel(props: {
  open: boolean;
  onToggle: () => void;
  mapType: MapDisplayType;
  onMapTypeChange: (next: MapDisplayType) => void;
  theme: ThemeId;
  onThemeChange: (next: ThemeId) => void;
  tiltOn: boolean;
  onTiltChange: (value: boolean) => void;
  overlayId: OverlayId;
  onOverlayChange: (next: OverlayId) => void;
  overlayOpacity: number;
  onOverlayOpacityChange: (value: number) => void;
  featureColors: Record<FeatureKind, string>;
  featureColorOverrides: Partial<Record<FeatureKind, string>>;
  onFeatureColorChange: (kind: FeatureKind, color: string) => void;
  onFeatureColorReset: (kind: FeatureKind) => void;
  onFeatureColorResetAll: () => void;
  autoContrast: boolean;
  onAutoContrastChange: (value: boolean) => void;
  presentFeatureKinds: ReadonlySet<FeatureKind>;
}) {
  const presentKinds = useMemo(() => {
    const inResults = FEATURE_KINDS.filter((meta) => props.presentFeatureKinds.has(meta.kind));
    if (inResults.length > 0) return inResults;
    return FEATURE_KINDS.filter((meta) => meta.group === "result");
  }, [props.presentFeatureKinds]);

  const showingPresent = props.presentFeatureKinds.size > 0;
  const resultKindsPresent = presentKinds.filter((meta) => meta.group === "result").length;
  const overrideCount = Object.keys(props.featureColorOverrides).length;
  return (
    <aside className={`panel layers-panel ${props.open ? "" : "collapsed"}`} aria-label="Layers">
      <div className="panel-header">
        <span className="panel-icon" aria-hidden="true">
          <LayersIcon />
        </span>
        <h2>Layers</h2>
        <button
          type="button"
          className="panel-toggle"
          onClick={props.onToggle}
          aria-label={props.open ? "Collapse layers panel" : "Expand layers panel"}
          aria-expanded={props.open}
        >
          <ChevronUpIcon />
        </button>
      </div>

      <div className="panel-body">
        <div className="panel-section">
          <p className="panel-section-title">Base map</p>
          <div className="segmented" role="tablist" aria-label="Map type">
            {(["roadmap", "satellite", "hybrid", "terrain"] as const).map((mt) => (
              <button
                key={mt}
                type="button"
                role="tab"
                aria-pressed={props.mapType === mt}
                onClick={() => props.onMapTypeChange(mt)}
              >
                {mt === "roadmap" ? "Road" : mt[0].toUpperCase() + mt.slice(1)}
              </button>
            ))}
          </div>
        </div>

        <div className="panel-section">
          <p className="panel-section-title">Color theme</p>
          <div className="swatch-row">
            {(Object.keys(MAP_THEMES) as ThemeId[]).map((themeId) => (
              <button
                key={themeId}
                type="button"
                className={`swatch theme-${themeId}`}
                aria-pressed={props.theme === themeId}
                onClick={() => props.onThemeChange(themeId)}
                title={themeLabel(themeId)}
              >
                {themeLabel(themeId)[0]}
              </button>
            ))}
          </div>
          <p className="search-suggestion-status" style={{ padding: 0 }}>
            Themes apply to road and terrain maps.
          </p>
        </div>

        <div className="panel-section">
          <p className="panel-section-title">3D view</p>
          <label className="toggle-row">
            <span>
              45° tilt
              <small>Aerial 45° imagery in satellite or hybrid mode</small>
            </span>
            <span className="toggle-switch">
              <input
                type="checkbox"
                checked={props.tiltOn}
                onChange={(event) => props.onTiltChange(event.target.checked)}
              />
              <span className="slider" />
            </span>
          </label>
        </div>

        <div className="panel-section">
          <p className="panel-section-title">Overlay imagery</p>
          <div className="radio-list" role="radiogroup" aria-label="Overlay tiles">
            {OVERLAY_SOURCES.map((source) => (
              <label key={source.id} className="radio-row">
                <input
                  type="radio"
                  name="overlay"
                  checked={props.overlayId === source.id}
                  onChange={() => props.onOverlayChange(source.id)}
                />
                <span>
                  {source.label}
                  <small>{source.attribution}</small>
                </span>
                <span />
              </label>
            ))}
          </div>
          {props.overlayId !== "none" ? (
            <div className="tuner-row">
              <label>
                Opacity
                <strong>{Math.round(props.overlayOpacity * 100)}%</strong>
              </label>
              <input
                type="range"
                min={0.1}
                max={1}
                step={0.05}
                value={props.overlayOpacity}
                onChange={(event) => props.onOverlayOpacityChange(Number(event.target.value))}
                aria-label="Overlay opacity"
              />
            </div>
          ) : null}
        </div>

        <div className="panel-section">
          <p className="panel-section-title">Feature colors</p>
          <label className="toggle-row">
            <span>
              High-contrast multi-type
              <small>
                Assigns distinct palette colors to non-road kinds when multiple types appear.
                Public roads stay blue and private roads stay red.
              </small>
            </span>
            <span className="toggle-switch">
              <input
                type="checkbox"
                checked={props.autoContrast}
                onChange={(event) => props.onAutoContrastChange(event.target.checked)}
              />
              <span className="slider" />
            </span>
          </label>

          <p className="search-suggestion-status" style={{ padding: 0 }}>
            {showingPresent
              ? `${resultKindsPresent} type${resultKindsPresent === 1 ? "" : "s"} in current results.`
              : "Run a search to see the types appearing on the map. Defaults are orange."}
          </p>

          <div className="feature-color-list">
            {presentKinds.map((meta) => {
              const isOverridden = meta.kind in props.featureColorOverrides;
              const color = props.featureColors[meta.kind];
              return (
                <div key={meta.kind} className="feature-color-row">
                  <input
                    type="color"
                    value={color}
                    onChange={(event) => props.onFeatureColorChange(meta.kind, event.target.value)}
                    aria-label={`Color for ${meta.label}`}
                  />
                  <span className="feature-color-label">
                    {meta.label}
                    <small>
                      {meta.group === "context"
                        ? "Context layer"
                        : isOverridden
                          ? "Custom color"
                          : props.autoContrast &&
                              props.presentFeatureKinds.has(meta.kind) &&
                              resultKindsPresent > 1
                            ? "Auto high-contrast"
                            : "Default"}
                    </small>
                  </span>
                  {isOverridden ? (
                    <button
                      type="button"
                      className="feature-color-reset"
                      onClick={() => props.onFeatureColorReset(meta.kind)}
                      aria-label={`Reset color for ${meta.label}`}
                      title="Reset to default"
                    >
                      Reset
                    </button>
                  ) : (
                    <span aria-hidden="true" />
                  )}
                </div>
              );
            })}
          </div>

          {overrideCount > 0 ? (
            <button
              type="button"
              className="feature-color-reset-all"
              onClick={props.onFeatureColorResetAll}
            >
              Reset all colors
            </button>
          ) : null}
        </div>
      </div>
    </aside>
  );
}

/* ---------------- MapControls ---------------- */

function MapControls(props: {
  tiltOn: boolean;
  pegmanActive: boolean;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onToggleTilt: () => void;
  onResetCamera: () => void;
  onFullscreen: () => void;
  onStreetView: () => void;
  onPegmanDragStart: (event: React.DragEvent<HTMLButtonElement>) => void;
  onPegmanDragEnd: (event: React.DragEvent<HTMLButtonElement>) => void;
}) {
  return (
    <nav className="map-controls" aria-label="Map controls">
      <div className="icon-stack">
        <button
          type="button"
          className={`pegman-button${props.pegmanActive ? " is-active" : ""}`}
          onClick={props.onStreetView}
          draggable
          onDragStart={props.onPegmanDragStart}
          onDragEnd={props.onPegmanDragEnd}
          aria-label={
            props.pegmanActive
              ? "Cancel street view selection"
              : "Click to drop pegman, or drag pegman onto the map for street view"
          }
          aria-pressed={props.pegmanActive}
          title={
            props.pegmanActive
              ? "Click on the map or press again to cancel"
              : "Street view — click then tap the map, or drag onto the map"
          }
        >
          <PegmanIcon />
        </button>
      </div>
      <div className="icon-stack">
        <button type="button" onClick={props.onZoomIn} aria-label="Zoom in" title="Zoom in">
          <PlusIcon />
        </button>
        <button type="button" onClick={props.onZoomOut} aria-label="Zoom out" title="Zoom out">
          <MinusIcon />
        </button>
      </div>
      <div className="icon-stack">
        <button
          type="button"
          onClick={props.onToggleTilt}
          aria-label="Toggle 45 degree tilt"
          aria-pressed={props.tiltOn}
          title="3D tilt"
        >
          <CubeIcon />
        </button>
        <button type="button" onClick={props.onResetCamera} aria-label="Reset map view" title="Reset view">
          <NorthIcon />
        </button>
        <button type="button" onClick={props.onFullscreen} aria-label="Fullscreen" title="Fullscreen">
          <FullscreenIcon />
        </button>
      </div>
    </nav>
  );
}

/* ---------------- MapLegend ---------------- */

function MapLegend(props: {
  presentFeatureKinds: ReadonlySet<FeatureKind>;
  featureColors: Record<FeatureKind, string>;
}) {
  const [expanded, setExpanded] = useState(true);
  const items = useMemo(
    () => FEATURE_KINDS.filter((meta) => props.presentFeatureKinds.has(meta.kind)),
    [props.presentFeatureKinds],
  );

  if (items.length === 0) return null;

  return (
    <div
      className={`map-legend ${expanded ? "expanded" : "collapsed"}`}
      role="group"
      aria-label="Map legend"
    >
      <button
        type="button"
        className="map-legend-header"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        title={expanded ? "Collapse legend" : "Expand legend"}
      >
        <span className="map-legend-title">Legend</span>
        <span className="map-legend-count">{items.length}</span>
      </button>
      {expanded ? (
        <ul className="map-legend-list">
          {items.map((meta) => (
            <li
              key={meta.kind}
              className={`map-legend-item ${meta.group === "context" ? "is-context" : ""}`}
              title={meta.label}
            >
              <span
                className="map-legend-swatch"
                style={{ background: props.featureColors[meta.kind] }}
                aria-hidden="true"
              />
              <span className="map-legend-label">{meta.label}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/* ---------------- StreetViewTimeSlider ---------------- */

function StreetViewTimeSlider({
  entries,
  activeIndex,
  onChange,
  fallbackDate,
}: {
  entries: PanoEntry[];
  activeIndex: number;
  onChange: (index: number) => void;
  fallbackDate?: string;
}) {
  if (entries.length === 0) {
    if (!fallbackDate) return null;
    return (
      <div className="street-view-time-slider single">
        <span className="time-label">
          <strong>Captured {fallbackDate}</strong>
          <small>Only one capture available at this location</small>
        </span>
      </div>
    );
  }

  const clampedIndex = Math.min(Math.max(activeIndex, 0), entries.length - 1);
  const active = entries[clampedIndex];

  return (
    <div className="street-view-time-slider" aria-label="Street view capture date">
      <div className="time-label">
        <strong>{active.label}</strong>
        <small>
          Capture {clampedIndex + 1} of {entries.length}
        </small>
      </div>
      <button
        type="button"
        className="nudge"
        onClick={() => onChange(Math.max(0, clampedIndex - 1))}
        disabled={clampedIndex <= 0}
        aria-label="Older capture"
      >
        <ChevronLeftIcon />
      </button>
      <input
        type="range"
        min={0}
        max={entries.length - 1}
        step={1}
        value={clampedIndex}
        onChange={(event) => onChange(Number(event.target.value))}
        aria-label="Street view capture date"
      />
      <button
        type="button"
        className="nudge"
        onClick={() => onChange(Math.min(entries.length - 1, clampedIndex + 1))}
        disabled={clampedIndex >= entries.length - 1}
        aria-label="Newer capture"
      >
        <ChevronRightIcon />
      </button>
    </div>
  );
}

/* ---------------- TimeDock ---------------- */

function TimeDock({
  value,
  min,
  max,
  sourceLabel,
  onChange,
  onNudge,
}: {
  value: string;
  min: string;
  max: string;
  sourceLabel: string;
  onChange: (value: string) => void;
  onNudge: (days: number) => void;
}) {
  const minTime = new Date(min + "T00:00:00Z").getTime();
  const maxTime = new Date(max + "T00:00:00Z").getTime();
  const valueTime = new Date(value + "T00:00:00Z").getTime();
  return (
    <section className="time-dock" aria-label="Imagery date">
      <div className="time-label">
        <strong>{formatHumanDate(value)}</strong>
        <small>{sourceLabel}</small>
      </div>
      <input
        type="range"
        min={minTime}
        max={maxTime}
        step={86_400_000}
        value={valueTime}
        onChange={(event) => {
          const next = new Date(Number(event.target.value));
          onChange(formatGibsDate(next));
        }}
        aria-label="Imagery date slider"
      />
      <button type="button" className="nudge" onClick={() => onNudge(-1)} aria-label="Previous day">
        <ChevronLeftIcon />
      </button>
      <button type="button" className="nudge" onClick={() => onNudge(1)} aria-label="Next day">
        <ChevronRightIcon />
      </button>
    </section>
  );
}

/* ---------------- FeatureCard ---------------- */

function FeatureCard({
  selectedFeature,
  streetViewState,
  resolvedAddress,
  resolvingAddress,
  totalMatches,
  currentIndex,
  onPrev,
  onNext,
  onClose,
}: {
  selectedFeature: SelectedFeature;
  streetViewState: StreetViewState;
  resolvedAddress: string | null;
  resolvingAddress: boolean;
  totalMatches: number;
  currentIndex: number;
  onPrev: () => void;
  onNext: () => void;
  onClose: () => void;
}) {
  const tagRows = summarizeTags(selectedFeature.tags, 10);
  const tagAddress = buildAddressFromTags(selectedFeature.tags);
  const address = tagAddress ?? resolvedAddress;
  const displayName = pickFeatureDisplayName(selectedFeature, resolvedAddress, resolvingAddress);
  const showCycle = totalMatches > 1;
  const positionLabel =
    showCycle && currentIndex >= 0
      ? `${currentIndex + 1} of ${totalMatches.toLocaleString()}`
      : null;

  return (
    <section className="feature-card" aria-label="Selected feature">
      <div className="feature-card-header">
        <div>
          <p className="eyebrow">
            Selected location
            {positionLabel ? <span className="match-position"> · {positionLabel}</span> : null}
          </p>
          <h2>{displayName}</h2>
          <small>{formatCoordinate(selectedFeature.coordinate)}</small>
        </div>
        <div className="feature-card-actions">
          {showCycle ? (
            <div className="feature-card-cycle" role="group" aria-label="Cycle matches">
              <button
                type="button"
                className="icon-button"
                onClick={onPrev}
                aria-label="Previous match"
              >
                <ChevronLeftIcon />
              </button>
              <button
                type="button"
                className="icon-button"
                onClick={onNext}
                aria-label="Next match"
              >
                <ChevronRightIcon />
              </button>
            </div>
          ) : null}
          <button type="button" className="panel-toggle" onClick={onClose} aria-label="Close">
            <CloseIcon />
          </button>
        </div>
      </div>
      <div className="feature-card-body">
        {address ? (
          <dl className="feature-card-row">
            <dt>Address</dt>
            <dd>{address}</dd>
          </dl>
        ) : resolvingAddress ? (
          <dl className="feature-card-row">
            <dt>Address</dt>
            <dd className="muted">Looking up…</dd>
          </dl>
        ) : null}
        <dl className="feature-card-row">
          <dt>Match</dt>
          <dd>
            {selectedFeature.matchReason.label}
            {selectedFeature.matchReason.distanceMeters !== undefined
              ? ` · ${formatMetersForUi(selectedFeature.matchReason.distanceMeters)}`
              : ""}
          </dd>
        </dl>
        {selectedFeature.matchReason.lengthMeters !== undefined ? (
          <dl className="feature-card-row">
            <dt>Length</dt>
            <dd>{formatLengthImperial(selectedFeature.matchReason.lengthMeters)}</dd>
          </dl>
        ) : null}
        {selectedFeature.matchReason.detail ? (
          <p style={{ color: "var(--muted)", fontSize: "0.78rem", margin: 0 }}>
            {selectedFeature.matchReason.detail}
          </p>
        ) : null}
        {tagRows.length > 0 ? (
          <ul className="tag-list">
            {tagRows.map((tag) => (
              <li key={tag}>{tag}</li>
            ))}
          </ul>
        ) : null}
        <StreetViewStatus state={streetViewState} />
      </div>
    </section>
  );
}

/* ---------------- MatchListPanel ---------------- */

function MatchListPanel({
  matches,
  selectedId,
  streetViewAvailability,
  onSelect,
  onClose,
  onPrev,
  onNext,
  rightOffset,
}: {
  matches: SelectedFeature[];
  selectedId: string | null;
  streetViewAvailability: Set<string>;
  onSelect: (match: SelectedFeature) => void;
  onClose: () => void;
  onPrev: () => void;
  onNext: () => void;
  rightOffset: number;
}) {
  const selectedRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    selectedRef.current?.scrollIntoView({ block: "nearest" });
  }, [selectedId]);

  return (
    <aside
      className="match-list-panel"
      aria-label="Match list"
      style={{ "--match-list-right": `${rightOffset}px` } as React.CSSProperties}
    >
      <div className="match-list-header">
        <div>
          <p className="eyebrow">Matches</p>
          <h2>
            {matches.length.toLocaleString()}{" "}
            {matches.length === 1 ? "result" : "results"}
          </h2>
        </div>
        <div className="match-list-actions">
          <button
            type="button"
            className="icon-button"
            onClick={onPrev}
            aria-label="Previous match"
            disabled={matches.length < 2}
          >
            <ChevronLeftIcon />
          </button>
          <button
            type="button"
            className="icon-button"
            onClick={onNext}
            aria-label="Next match"
            disabled={matches.length < 2}
          >
            <ChevronRightIcon />
          </button>
          <button
            type="button"
            className="panel-toggle"
            onClick={onClose}
            aria-label="Close match list"
          >
            <CloseIcon />
          </button>
        </div>
      </div>
      <ol className="match-list">
        {matches.map((match, index) => {
          const isSelected = match.scoutId === selectedId;
          const hasStreetView = streetViewAvailability.has(match.scoutId);
          return (
            <li key={match.scoutId}>
              <button
                ref={isSelected ? selectedRef : null}
                type="button"
                className={`match-list-item${isSelected ? " is-selected" : ""}`}
                aria-pressed={isSelected}
                onClick={() => onSelect(match)}
              >
                <span className="match-list-index">{index + 1}</span>
                <span className="match-list-body">
                  <span className="match-list-name">
                    <span className="match-list-name-text">{match.name}</span>
                    {hasStreetView ? (
                      <span
                        className="match-list-streetview-badge"
                        aria-label="Street view available"
                        title="Street view available"
                      >
                        <PegmanIcon />
                      </span>
                    ) : null}
                  </span>
                  <span className="match-list-meta">
                    {match.matchReason.label}
                    {match.matchReason.distanceMeters !== undefined
                      ? ` · ${formatMetersForUi(match.matchReason.distanceMeters)}`
                      : ""}
                    {match.matchReason.lengthMeters !== undefined
                      ? ` · ${formatLengthImperial(match.matchReason.lengthMeters)}`
                      : ""}
                  </span>
                  <span className="match-list-coord">
                    {formatCoordinate(match.coordinate)}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </aside>
  );
}

function StreetViewStatus({ state }: { state: StreetViewState }) {
  if (state.status === "searching") {
    return <p className="notice">Looking for a nearby street view…</p>;
  }
  if (state.status === "none" || state.status === "error") {
    return <p className="notice warning">{state.message}</p>;
  }
  if (state.status === "open") {
    return <p className="notice success">Street view ready.</p>;
  }
  return null;
}

/* ---------------- Icon set ---------------- */

function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}

function ArrowRightIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 12h14M13 5l7 7-7 7" />
    </svg>
  );
}

function SpinnerIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 4a8 8 0 1 1-8 8" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="m4 12 5 5L20 6" />
    </svg>
  );
}

function ChevronUpIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="m6 15 6-6 6 6" />
    </svg>
  );
}

function DownloadIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 4v11" />
      <path d="m7 11 5 5 5-5" />
      <path d="M5 20h14" />
    </svg>
  );
}

function ChevronRightIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="m9 6 6 6-6 6" />
    </svg>
  );
}

function ChevronLeftIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="m15 6-6 6 6 6" />
    </svg>
  );
}

function ListIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M8 6h13M8 12h13M8 18h13" />
      <circle cx="4" cy="6" r="1" />
      <circle cx="4" cy="12" r="1" />
      <circle cx="4" cy="18" r="1" />
    </svg>
  );
}

function PinIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 22s7-7 7-12a7 7 0 1 0-14 0c0 5 7 12 7 12z" />
      <circle cx="12" cy="10" r="2.5" />
    </svg>
  );
}

function CompassIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="m14.6 7.6-1.8 5.2-5.2 1.8 1.8-5.2z" />
    </svg>
  );
}

function LocateIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
    </svg>
  );
}

function LayersIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="m12 4 8 4-8 4-8-4z" />
      <path d="m4 12 8 4 8-4" />
      <path d="m4 16 8 4 8-4" />
    </svg>
  );
}

function PegmanIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="pegman-icon">
      <circle cx="12" cy="4.8" r="2.6" className="pegman-head" />
      <path
        className="pegman-body"
        d="M12 8.2c-2.9 0-5.6.95-7.05 1.85-.5.31-.66.95-.35 1.45.3.5.94.66 1.44.36.8-.49 2-1.05 3.36-1.4l-.5 8.6A1.4 1.4 0 0 0 10.3 20.5h.95l.25-7.1h1l.25 7.1h.95a1.4 1.4 0 0 0 1.4-1.44l-.5-8.6c1.36.35 2.56.91 3.36 1.4.5.3 1.14.14 1.44-.36.31-.5.15-1.14-.35-1.45C17.6 9.15 14.9 8.2 12 8.2z"
      />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

function MinusIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 12h14" />
    </svg>
  );
}

function CubeIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 3 3 8l9 5 9-5z" />
      <path d="M3 8v8l9 5 9-5V8" />
      <path d="M12 13v8" />
    </svg>
  );
}

function NorthIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 3 8 12h3v8h2v-8h3z" />
    </svg>
  );
}

function FullscreenIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M8 4H4v4M16 4h4v4M8 20H4v-4M16 20h4v-4" />
    </svg>
  );
}

function RefreshIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M3 12a9 9 0 1 1 3 6.7" />
      <path d="M3 19v-5h5" />
    </svg>
  );
}

function PresetGlyph({ presetId }: { presetId: PresetId }) {
  switch (presetId) {
    case "preset-dirt-roads":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M3 16c2-4 6-4 8 0s6 4 8 0" />
          <circle cx="6" cy="9" r="0.6" />
          <circle cx="11" cy="6" r="0.6" />
          <circle cx="16" cy="8" r="0.6" />
          <circle cx="20" cy="11" r="0.6" />
        </svg>
      );
    case "preset-alleys":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M3 4v16M9 4v16M15 4v16M21 4v16" />
          <path d="M9 12h6" />
        </svg>
      );
    case "preset-01":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M3 17c1.5-2 3-2 4.5 0s3 2 4.5 0 3-2 4.5 0" />
          <path d="M15 7l3 3 5-5" />
        </svg>
      );
    case "preset-02":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M3 18c1.5-2 3-2 4.5 0s3 2 4.5 0 3-2 4.5 0" />
          <rect x="14" y="6" width="7" height="6" rx="1" />
          <path d="M16 6V4a1.5 1.5 0 0 1 3 0v2" />
        </svg>
      );
    case "preset-03":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <rect x="3" y="9" width="14" height="7" rx="2" />
          <path d="M5 9V6h10v3" />
          <circle cx="7" cy="18" r="2" />
          <circle cx="14" cy="18" r="2" />
          <path d="M17 12h4l-2 4" />
        </svg>
      );
    case "preset-04":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <rect x="4" y="3" width="16" height="18" rx="2" />
          <path d="M9 7v10" />
          <path d="M9 7h4a3 3 0 0 1 0 6h-4" />
        </svg>
      );
    case "preset-05":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M3 8h18" />
          <path d="M3 14c3-2 5-2 8 0s5 2 8 0" />
          <path d="M3 19c3-2 5-2 8 0s5 2 8 0" />
        </svg>
      );
    case "preset-06":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M3 9c5-3 13-3 18 0" />
          <path d="M3 9v11M21 9v11" />
          <path d="M9 20v-7M15 20v-7" />
          <path d="M3 20h18" />
        </svg>
      );
    case "preset-07":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 4v9" />
          <circle cx="12" cy="17" r="3" />
          <path d="M3 5l2 2M5 5l-2 2" />
          <path d="M19 5l2 2M21 5l-2 2" />
        </svg>
      );
    case "preset-08":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M3 12h11" />
          <path d="M11 9l3 3-3 3" />
          <path d="M17 8c2 0 2 4 4 4" />
          <path d="M17 14c2 0 2 4 4 4" />
        </svg>
      );
    case "preset-09":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M3 18h18" />
          <rect x="8" y="3" width="9" height="10" rx="1" />
          <path d="M11 5v6" />
          <path d="M11 5h2.5a1.5 1.5 0 0 1 0 3H11" />
        </svg>
      );
    case "preset-10":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <rect x="8" y="3" width="9" height="10" rx="1" />
          <path d="M11 5v6" />
          <path d="M11 5h2.5a1.5 1.5 0 0 1 0 3H11" />
          <path d="M3 18l2 2M5 18l-2 2" />
          <path d="M19 18l2 2M21 18l-2 2" />
        </svg>
      );
    case "preset-11":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="4" cy="11" r="2" />
          <path d="M4 13v7" />
          <circle cx="20" cy="11" r="2" />
          <path d="M20 13v7" />
          <path d="M7 11h1M10 11h1M13 11h1M16 11h1" />
        </svg>
      );
    case "preset-12":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <rect x="6" y="3" width="12" height="14" rx="1" />
          <path d="M9 7h6" />
          <path d="M9 11h6" />
          <path d="M3 19l2 2M5 19l-2 2" />
          <path d="M19 19l2 2M21 19l-2 2" />
        </svg>
      );
    case "preset-13":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <rect x="3" y="3" width="11" height="13" rx="1" />
          <path d="M5 7h7" />
          <path d="M5 11h7" />
          <path d="M19 4l-2 5h4z" />
          <path d="M19 9v12" />
        </svg>
      );
    case "preset-14":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M4 4v16M20 4v16" />
          <path d="M9 4v16M15 4v16" />
          <path d="M12 5v3M12 11v3M12 17v3" />
        </svg>
      );
    case "preset-15":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M3 12h3M9 12h3M15 12h3M21 12h.1" />
          <path d="M4 5l2 2M6 5l-2 2" />
          <path d="M18 5l2 2M20 5l-2 2" />
          <path d="M4 19l2 2M6 19l-2 2" />
          <path d="M18 19l2 2M20 19l-2 2" />
        </svg>
      );
    case "preset-16":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M3 18l4-7 4 4 5-9 5 6 2-3" />
        </svg>
      );
    case "preset-17":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M3 12h12" />
          <path d="M15 6c2-1 4-1 6 0" />
          <path d="M15 12c2-1 4-1 6 0" />
          <path d="M15 18c2-1 4-1 6 0" />
        </svg>
      );
    case "preset-18":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M3 6l-1 4h2zM3 10v3" />
          <path d="M21 6l-1 4h2zM21 10v3" />
          <path d="M12 4v9" />
          <circle cx="12" cy="17" r="3" />
        </svg>
      );
    case "preset-19":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M5 12l-2 5h4z" />
          <path d="M5 17v4" />
          <rect x="11" y="8" width="10" height="13" rx="1" />
          <path d="M14 11v8" />
          <path d="M14 11h3a2 2 0 0 1 0 4h-3" />
        </svg>
      );
    case "preset-20":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M3 9h18" />
          <path d="M3 18h7" />
          <path d="M10 18v-3h4v3" />
          <path d="M14 18h7" />
        </svg>
      );
    case "preset-21":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <rect x="3" y="3" width="11" height="11" rx="1" />
          <path d="M6 6v6" />
          <path d="M6 6h3.5a2 2 0 0 1 0 4H6" />
          <path d="M3 18c3-2 5-2 8 0s5 2 8 0" />
          <path d="M3 22c3-2 5-2 8 0s5 2 8 0" />
        </svg>
      );
    case "preset-22":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <rect x="3" y="6" width="10" height="13" rx="1" />
          <path d="M6 9v8" />
          <path d="M6 9h3a2 2 0 0 1 0 4H6" />
          <path d="M18 4l-2 5h4zM18 9v3" />
          <path d="M18 13l-2 5h4zM18 18v3" />
        </svg>
      );
    case "preset-23":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M3 10h18M5 10V6M19 10V6" />
          <path d="M9 14v4M15 14v4" />
          <path d="M3 18h4" />
          <path d="M7 18v-2h4v2" />
          <path d="M11 18h10" />
        </svg>
      );
    case "preset-24":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M3 12h18" />
          <path d="M8 3c1.5 2 1.5 4 0 6s-1.5 4 0 6 1.5 4 0 6" />
          <path d="M16 3c1.5 2 1.5 4 0 6s-1.5 4 0 6 1.5 4 0 6" />
        </svg>
      );
    case "preset-25":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M4 4v16M12 4v16M20 4v16" />
          <path d="M4 9h16M4 14h16" />
          <path d="M4 9l8 5M12 9l8 5" />
        </svg>
      );
    case "preset-26":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M6 3v18" />
          <path d="M6 3h6l-2 3 2 3H6" />
          <rect x="14" y="10" width="7" height="11" rx="1" />
          <path d="M16 12v7" />
          <path d="M16 12h2.5a1.5 1.5 0 0 1 0 3H16" />
        </svg>
      );
    case "preset-27":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <rect x="2" y="4" width="7" height="10" rx="1" />
          <path d="M4 7v4" />
          <path d="M4 7h2a1.5 1.5 0 0 1 0 3H4" />
          <path d="M11 16l1 1M14 18l1 1" />
          <path d="M18 19c1-1 2-1 3 0" />
          <path d="M18 22c1-1 2-1 3 0" />
        </svg>
      );
    case "preset-28":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M3 4v6" />
          <circle cx="3" cy="13" r="2" />
          <path d="M8 14l1 1M12 16l1 1" />
          <path d="M17 18c1-1 2-1 3 0" />
          <path d="M17 21c1-1 2-1 3 0" />
        </svg>
      );
    case "preset-29":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M9 14c-2-1-3-3-3-5a6 6 0 0 1 12 0c0 2-1 4-3 5" />
          <path d="M10 17h4" />
          <path d="M11 20h2" />
          <path d="M3 3l18 18" />
        </svg>
      );
    case "preset-30":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M9 3v18M15 3v18" />
          <path d="M12 4v3M12 11v3M12 18v3" />
          <path d="M3 9l3 3M3 12l3-3" />
          <path d="M21 9l-3 3M21 12l-3-3" />
        </svg>
      );
    case "preset-31":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <rect x="3" y="6" width="7" height="12" />
          <rect x="14" y="6" width="7" height="12" />
          <path d="M10 12h1M12 12h1M14 12h.1" />
        </svg>
      );
    case "preset-32":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M3 14h18" />
          <path d="M9 3l6 18" />
          <path d="M9 3l4 1-1 3-3-1" />
        </svg>
      );
    case "preset-33":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M3 20V11h6V7l6 4v9z" />
          <path d="M5 15v2M11 15v2" />
          <path d="M19 8v8" />
          <circle cx="19" cy="19" r="2" />
        </svg>
      );
    case "preset-34":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M9 3v18M15 3v18" />
          <path d="M4 4l-1 3h2zM4 7v3" />
          <path d="M4 13l-1 3h2zM4 16v3" />
          <path d="M20 4l-1 3h2zM20 7v3" />
          <path d="M20 13l-1 3h2zM20 16v3" />
        </svg>
      );
    case "preset-35":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M8 3v18M16 3v18" />
          <path d="M6 6h12M6 10h12M6 14h12M6 18h12" />
        </svg>
      );
    case "preset-featured-off-road":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M3 17c1.5-2 3-2 4.5 0s3 2 4.5 0 3-2 4.5 0" />
          <circle cx="6" cy="9" r="0.6" />
          <circle cx="12" cy="6" r="0.6" />
          <circle cx="18" cy="8" r="0.6" />
        </svg>
      );
    case "preset-featured-fishing":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M3 12c4-5 9-5 13 0-4 5-9 5-13 0z" />
          <circle cx="7" cy="12" r="0.8" />
          <path d="M16 12l5-3M16 12l5 3" />
        </svg>
      );
    case "preset-featured-camping":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 4l9 16H3z" />
          <path d="M12 4v16" />
        </svg>
      );
    case "preset-featured-hunting":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="12" cy="12" r="9" />
          <circle cx="12" cy="12" r="5" />
          <circle cx="12" cy="12" r="1.5" />
        </svg>
      );
    case "preset-featured-parking":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <rect x="4" y="3" width="16" height="18" rx="2" />
          <path d="M9 7v10" />
          <path d="M9 7h4a3 3 0 0 1 0 6h-4" />
        </svg>
      );
    case "preset-weather":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="9" cy="11" r="3" />
          <path d="M16 9a3 3 0 0 1 0 6h-1" />
          <path d="M6 18l-1 2M10 18l-1 2M14 18l-1 2M18 18l-1 2" />
        </svg>
      );
    case "preset-restricted":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="12" cy="12" r="9" />
          <path d="M5 5l14 14" />
        </svg>
      );
  }
}

/* ---------------- Helpers ---------------- */

function buildOverlayMapType(
  maps: typeof google,
  overlay: (typeof OVERLAY_SOURCES)[number],
  date: string,
  opacity: number,
): google.maps.MapType | null {
  if (overlay.kind === "none") return null;

  const tileSize = new maps.maps.Size(256, 256);
  const maxZoom = overlay.maxZoom;
  const name = overlay.label;

  return new maps.maps.ImageMapType({
    name,
    tileSize,
    minZoom: 0,
    maxZoom,
    opacity,
    getTileUrl: (coord, zoom) => {
      if (zoom > maxZoom) return null;
      const n = 1 << zoom;
      if (coord.x < 0 || coord.x >= n) return null;
      if (coord.y < 0 || coord.y >= n) return null;
      return overlay.url
        .replace("{z}", String(zoom))
        .replace("{x}", String(coord.x))
        .replace("{y}", String(coord.y))
        .replace("{date}", date);
    },
  });
}

function formatGibsDate(date: Date): string {
  const yyyy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(date.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function extractPanoHistory(data: google.maps.StreetViewPanoramaData): PanoEntry[] {
  const raw = (data as unknown as { time?: unknown }).time;
  if (!Array.isArray(raw)) return [];

  const entries: PanoEntry[] = [];
  for (const item of raw as Array<Record<string, unknown>>) {
    const panoId =
      typeof item.pano === "string"
        ? item.pano
        : typeof item.panoId === "string"
          ? item.panoId
          : null;
    if (!panoId) continue;

    const rawDate = item.date ?? item.d ?? item.imageDate;
    const date =
      rawDate instanceof Date
        ? rawDate
        : typeof rawDate === "string" || typeof rawDate === "number"
          ? new Date(rawDate as string | number)
          : null;
    if (!date || Number.isNaN(date.getTime())) continue;

    entries.push({
      panoId,
      date,
      label: date.toLocaleDateString(undefined, { year: "numeric", month: "short" }),
    });
  }

  entries.sort((a, b) => a.date.getTime() - b.date.getTime());
  return entries;
}

function formatHumanDate(value: string): string {
  const date = new Date(value + "T00:00:00Z");
  return date.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

function themeLabel(themeId: ThemeId): string {
  switch (themeId) {
    case "default":
      return "Default";
    case "silver":
      return "Silver";
    case "retro":
      return "Retro";
    case "dark":
      return "Dark";
    case "aubergine":
      return "Aubergine";
    case "night":
      return "Night";
  }
}

function haversineKm(a: LatLng, b: LatLng): number {
  const R = 6371;
  const toRad = (n: number) => (n * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function MissingApiKey() {
  return (
    <main className="setup-screen">
      <section className="setup-panel">
        <p className="eyebrow">Setup required</p>
        <h1>ForbiddenGIS</h1>
        <p>
          A map provider key hasn't been configured. Set{" "}
          <code>VITE_GOOGLE_MAPS_API_KEY</code> in <code>.env.local</code> before running or
          building.
        </p>
        <pre>VITE_GOOGLE_MAPS_API_KEY=your_key</pre>
        <p>
          The key is embedded in the client bundle. Restrict it by HTTP referrer in the provider
          console before deploying anywhere public.
        </p>
      </section>
    </main>
  );
}

function buildAddressFromTags(tags: Record<string, string>): string | null {
  const housenumber = tags["addr:housenumber"]?.trim();
  const street = tags["addr:street"]?.trim();
  const city = tags["addr:city"]?.trim();
  const state = tags["addr:state"]?.trim();
  const postcode = tags["addr:postcode"]?.trim();
  const fullAddress = tags["addr:full"]?.trim();

  if (fullAddress) return fullAddress;

  const streetLine = [housenumber, street].filter(Boolean).join(" ");
  const cityLine = [city, state].filter(Boolean).join(", ");
  const lines = [streetLine, cityLine, postcode].filter(Boolean);
  return lines.length > 0 ? lines.join(", ") : null;
}

function pickFeatureDisplayName(
  feature: SelectedFeature,
  resolvedAddress: string | null,
  resolvingAddress: boolean,
): string {
  if (feature.name && feature.name !== "Unnamed location") return feature.name;
  const tagAddress = buildAddressFromTags(feature.tags);
  const addressTitle = pickAddressTitle(tagAddress ?? resolvedAddress);
  if (addressTitle) return addressTitle;
  const placeType = describePlaceType(feature.tags);
  if (placeType) return placeType;
  if (resolvingAddress) return "Locating nearest address…";
  return `Near ${formatCoordinate(feature.coordinate)}`;
}

function pickAddressTitle(address: string | null): string | null {
  if (!address) return null;
  const parts = address
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length === 0) return null;

  const first = parts[0];
  const hasStreetNumber = /^\d/.test(first);
  if (hasStreetNumber && parts.length > 1) {
    return `${first}, ${parts[1]}`;
  }
  if (first.length < 4 && parts.length > 1) {
    return `${first}, ${parts[1]}`;
  }
  return first;
}

const PLACE_TYPE_TAGS = [
  "amenity",
  "shop",
  "tourism",
  "leisure",
  "office",
  "craft",
  "historic",
  "natural",
  "landuse",
  "building",
  "highway",
  "railway",
  "waterway",
  "aeroway",
  "man_made",
  "power",
];

function describePlaceType(tags: Record<string, string>): string | null {
  for (const key of PLACE_TYPE_TAGS) {
    const value = tags[key];
    if (!value || value === "yes" || value === "no") continue;
    return humanizeTagValue(value);
  }
  return null;
}

function humanizeTagValue(value: string): string {
  const cleaned = value.replace(/[_;]+/g, " ").trim();
  if (!cleaned) return value;
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

function buildExternalLinks(
  coordinate: LatLng,
  address: string | null,
): { label: string; url: string }[] {
  const lat = coordinate.lat.toFixed(6);
  const lng = coordinate.lng.toFixed(6);
  const fallbackQuery = address ?? `${lat},${lng}`;
  const encodedFallback = encodeURIComponent(fallbackQuery);

  return [
    {
      label: "Google Maps",
      url: `https://www.google.com/maps/search/?api=1&query=${encodedFallback}`,
    },
  ];
}

function validateSearchGate(
  mode: Mode,
  zoom: number,
  tagFilter: string,
  presetMinZoom: number,
): string | null {
  if (mode === "simple") {
    try {
      const parsed = parseTagFilter(tagFilter);
      const minZoom = parsed.wildcard ? 13 : 12;
      if (zoom < minZoom) {
        return `Zoom in to at least ${minZoom} before running this simple search.`;
      }
    } catch {
      return null;
    }
    return null;
  }
  if (mode === "raw") {
    if (zoom < 13) return "Zoom in to at least 13 before running a custom query.";
    return null;
  }
  if (zoom < presetMinZoom) {
    return `Zoom in to at least ${presetMinZoom} before running this premade query.`;
  }
  return null;
}

function syncLiveMapState(
  map: google.maps.Map,
  mode: Mode,
  tagFilter: string,
  presetMinZoom: number,
  setZoomState: (zoom: number) => void,
  setVisibleDiagonalKmState: (diagonalKm: number | null) => void,
  setBoundsWarningState: (warning: string | null) => void,
): void {
  const bbox = getCurrentMapBBox(map);
  setZoomState(map.getZoom() ?? DEFAULT_ZOOM);

  if (!bbox) {
    setVisibleDiagonalKmState(null);
    setBoundsWarningState(null);
    return;
  }

  const diagonalKm = bboxDiagonalKm(bbox);
  setVisibleDiagonalKmState(diagonalKm);
  setBoundsWarningState(mapBoundsWarning(map, mode, tagFilter, presetMinZoom));
}

function computeDifficultyEstimate(
  mode: Mode,
  zoom: number,
  tagFilter: string,
  rawQuery: string,
  preset: PresetDefinition,
  visibleDiagonalKm: number | null,
): DifficultyEstimate {
  const scope =
    visibleDiagonalKm === null
      ? "Waiting for bounds"
      : `${formatDistanceKm(visibleDiagonalKm)} across · zoom ${zoom}`;

  const gate = validateSearchGate(mode, zoom, tagFilter, preset.minZoom);
  if (gate) {
    return { level: "blocked", label: "Zoom in", detail: gate, scope };
  }

  if (mode === "simple") {
    let parsed: ParsedTagFilter;
    try {
      parsed = parseTagFilter(tagFilter);
    } catch (error) {
      return {
        level: "blocked",
        label: "Invalid",
        detail: error instanceof Error ? error.message : "Enter a valid key=value filter.",
        scope,
      };
    }
    const level = estimateSimpleLevel(parsed.wildcard, visibleDiagonalKm);
    return {
      level,
      label: labelForDifficulty(level),
      detail: parsed.wildcard
        ? "Wildcard tag searches scan every feature with that key."
        : "Direct key=value searches are usually manageable.",
      scope,
    };
  }

  if (mode === "raw") {
    const hasBboxMacro = rawQuery.includes("{{bbox}}");
    const level = estimateRawLevel(hasBboxMacro, visibleDiagonalKm);
    return {
      level,
      label: labelForDifficulty(level),
      detail: hasBboxMacro
        ? "Custom query scoped to the current map area."
        : "Custom query may ignore the current map area.",
      scope,
    };
  }

  const level = estimatePresetLevel(preset.id, visibleDiagonalKm);
  return {
    level,
    label: labelForDifficulty(level),
    detail:
      preset.id === "preset-11"
        ? "Heavy preset — endpoints + trails."
        : "Premade scouting query.",
    scope,
  };
}

function prepareRawOverpassQuery(rawQuery: string, bbox: BBox): string {
  const trimmed = rawQuery.trim();
  if (!trimmed) throw new Error("Enter a query before searching.");
  if (!trimmed.includes("[out:json")) {
    throw new Error("Custom queries must request JSON output, e.g. [out:json][timeout:25];");
  }
  const bboxText = [
    bbox.south.toFixed(7),
    bbox.west.toFixed(7),
    bbox.north.toFixed(7),
    bbox.east.toFixed(7),
  ].join(",");
  return trimmed
    .replace(/\{\{\s*bbox\s*\}\}/gi, bboxText)
    .replace(
      /\{\{\s*center\s*\}\}/gi,
      `${((bbox.south + bbox.north) / 2).toFixed(7)},${((bbox.west + bbox.east) / 2).toFixed(7)}`,
    )
    .replace(/\{\{\s*style:[\s\S]*?\}\}/gi, "")
    .replace(/\{\{\s*style\s*\}\}/gi, "");
}

function estimateSimpleLevel(
  wildcard: boolean,
  visibleDiagonalKm: number | null,
): DifficultyLevel {
  if (visibleDiagonalKm === null) return wildcard ? "high" : "moderate";
  if (wildcard) {
    if (visibleDiagonalKm > 6) return "very-high";
    if (visibleDiagonalKm > 3) return "high";
    if (visibleDiagonalKm > 1.5) return "moderate";
    return "low";
  }
  if (visibleDiagonalKm > 10) return "high";
  if (visibleDiagonalKm > 5) return "moderate";
  return "low";
}

function estimatePresetLevel(
  presetId: PresetId,
  visibleDiagonalKm: number | null,
): DifficultyLevel {
  if (visibleDiagonalKm === null) return "high";
  if (
    presetId === "preset-11" ||
    presetId === "preset-27" ||
    presetId === "preset-28" ||
    presetId === "preset-31"
  ) {
    if (visibleDiagonalKm > 2.5) return "very-high";
    if (visibleDiagonalKm > 1.2) return "high";
    return "moderate";
  }
  if (visibleDiagonalKm > 5) return "very-high";
  if (visibleDiagonalKm > 2.5) return "high";
  if (visibleDiagonalKm > 1.2) return "moderate";
  return "low";
}

function estimateRawLevel(
  hasBboxMacro: boolean,
  visibleDiagonalKm: number | null,
): DifficultyLevel {
  if (!hasBboxMacro) return "very-high";
  if (visibleDiagonalKm === null) return "high";
  if (visibleDiagonalKm > 8) return "very-high";
  if (visibleDiagonalKm > 4) return "high";
  if (visibleDiagonalKm > 2) return "moderate";
  return "low";
}

function labelForDifficulty(level: DifficultyLevel): string {
  switch (level) {
    case "blocked":
      return "Blocked";
    case "low":
      return "Low";
    case "moderate":
      return "Moderate";
    case "high":
      return "High";
    case "very-high":
      return "Very high";
  }
}

function formatDistanceKm(distanceKm: number): string {
  if (distanceKm < 1) return `${Math.round(distanceKm * 1000)} m`;
  return `${distanceKm.toFixed(distanceKm < 10 ? 1 : 0)} km`;
}

function formatMetersForUi(distanceMeters: number): string {
  return distanceMeters < 10
    ? `${distanceMeters.toFixed(1)} m`
    : `${Math.round(distanceMeters)} m`;
}

function formatLengthImperial(meters: number): string {
  if (!Number.isFinite(meters) || meters <= 0) return "0 ft";
  const feet = meters * 3.28084;
  if (feet < 1000) return `${Math.round(feet)} ft`;
  const miles = feet / 5280;
  return miles < 10 ? `${miles.toFixed(2)} mi` : `${miles.toFixed(1)} mi`;
}

function normalizeMapTypeId(mapTypeId: string | undefined): MapDisplayType {
  if (
    mapTypeId === "satellite" ||
    mapTypeId === "hybrid" ||
    mapTypeId === "terrain" ||
    mapTypeId === "roadmap"
  ) {
    return mapTypeId;
  }
  return "roadmap";
}

function getCurrentMapBBox(map: google.maps.Map): BBox | null {
  const bounds = map.getBounds();
  if (bounds) return googleBoundsToBBox(bounds);
  const center = map.getCenter();
  if (!center) return null;
  const mapDiv = map.getDiv();
  return approximateBBoxFromCenter(
    { lat: center.lat(), lng: center.lng() },
    map.getZoom() ?? DEFAULT_ZOOM,
    Math.max(mapDiv.clientWidth, 320),
    Math.max(mapDiv.clientHeight, 240),
  );
}

function approximateBBoxFromCenter(
  center: LatLng,
  zoom: number,
  widthPx: number,
  heightPx: number,
): BBox {
  const latitudeRadians = (center.lat * Math.PI) / 180;
  const metersPerPixel =
    (156543.03392 * Math.max(Math.cos(latitudeRadians), 0.01)) / 2 ** zoom;
  const halfWidthKm = (metersPerPixel * widthPx) / 2000;
  const halfHeightKm = (metersPerPixel * heightPx) / 2000;
  const latDelta = halfHeightKm / 110.574;
  const lngDelta = halfWidthKm / (111.32 * Math.max(Math.cos(latitudeRadians), 0.01));

  return {
    south: clampLatitude(center.lat - latDelta),
    west: clampLongitude(center.lng - lngDelta),
    north: clampLatitude(center.lat + latDelta),
    east: clampLongitude(center.lng + lngDelta),
  };
}

function clampLatitude(latitude: number): number {
  return Math.max(-85, Math.min(85, latitude));
}

function clampLongitude(longitude: number): number {
  if (longitude < -180) return -180;
  if (longitude > 180) return 180;
  return longitude;
}

function mapBoundsWarning(
  map: google.maps.Map,
  mode: Mode,
  tagFilter: string,
  presetMinZoom: number,
): string | null {
  const bbox = getCurrentMapBBox(map);
  const zoom = map.getZoom() ?? 0;
  if (!bbox) return null;
  const gate = validateSearchGate(mode, zoom, tagFilter, presetMinZoom);
  if (gate) return gate;
  const diagonalKm = bboxDiagonalKm(bbox);
  if (diagonalKm > (mode === "preset" ? 12 : 20)) {
    return "Large visible area. Searches may be slow; zoom in for cleaner results.";
  }
  return null;
}

function styleForDataFeature(
  maps: typeof google,
  feature: google.maps.Data.Feature,
  colorMap: Record<FeatureKind, string>,
): google.maps.Data.StyleOptions {
  const role = readDataString(feature, "scoutRole", "result") as ScoutRole;
  const category = readDataString(feature, "scoutCategory", "simple") as ScoutCategory;
  const tags = readDataTags(feature);
  const kind = featureKindFor(category, role, tags);
  const selected = Boolean(feature.getProperty("scoutSelected"));
  const color = selected ? "#1a73e8" : colorMap[kind] ?? DEFAULT_FEATURE_COLORS[kind];
  const isContext = role.startsWith("context");
  const geometryType = feature.getGeometry()?.getType();

  if (geometryType === "Point" || geometryType === "MultiPoint") {
    return {
      clickable: true,
      icon: {
        path: maps.maps.SymbolPath.CIRCLE,
        scale: selected ? 8 : isContext ? 4 : 6,
        fillColor: color,
        fillOpacity: isContext ? 0.72 : 0.96,
        strokeColor: selected ? "#ffffff" : "#202124",
        strokeWeight: selected ? 3 : 1,
      },
      zIndex: selected ? 1000 : isContext ? 10 : 100,
    };
  }

  const isPolygon =
    geometryType === "Polygon" ||
    geometryType === "MultiPolygon" ||
    category === "building" ||
    category === "water" ||
    category === "parking" ||
    category === "restricted";

  const isRestricted = category === "restricted";

  return {
    clickable: true,
    strokeColor: color,
    strokeOpacity: selected ? 1 : isContext ? 0.68 : isRestricted ? 1 : 0.9,
    strokeWeight: selected ? 5 : isRestricted ? 3 : category === "trail" ? 3 : 2,
    fillColor: color,
    fillOpacity: isPolygon
      ? selected
        ? 0.32
        : isContext
          ? 0.12
          : isRestricted
            ? 0.35
            : 0.2
      : 0,
    zIndex: selected ? 1000 : isContext ? 10 : isRestricted ? 200 : 100,
  };
}

function readDataTags(feature: google.maps.Data.Feature): Record<string, string> {
  const raw = feature.getProperty("tags");
  if (!raw || typeof raw !== "object") return {};
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value === "string") out[key] = value;
    else if (typeof value === "number" || typeof value === "boolean") out[key] = String(value);
  }
  return out;
}

function collectFeatureKinds(
  collection: GeoJSONFeatureCollection,
): ReadonlySet<FeatureKind> {
  const kinds = new Set<FeatureKind>();
  for (const feature of collection.features) {
    const props = feature.properties ?? {};
    const role = (props.scoutRole ?? "result") as ScoutRole;
    const category = (props.scoutCategory ?? "simple") as ScoutCategory;
    const tags = props.tags ?? {};
    kinds.add(featureKindFor(category, role, tags));
  }
  return kinds;
}

function readDataString(
  feature: google.maps.Data.Feature,
  key: string,
  fallback: string,
): string {
  const value = feature.getProperty(key);
  return typeof value === "string" ? value : fallback;
}
