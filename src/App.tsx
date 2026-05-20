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

type StreetViewState =
  | { status: "idle" }
  | { status: "searching"; sourceName: string }
  | { status: "open"; sourceName: string; data: google.maps.StreetViewPanoramaData }
  | { status: "none"; sourceName: string; message: string }
  | { status: "error"; sourceName: string; message: string };

interface PresetCategory {
  id: string;
  label: string;
  match: (preset: PresetDefinition) => boolean;
}

const PRESET_CATEGORIES: PresetCategory[] = [
  { id: "all", label: "All", match: () => true },
  {
    id: "off-road",
    label: "Off-road",
    match: (preset) =>
      /off-road|rough|unpaved|high-clearance|dirt/i.test(preset.name) ||
      preset.id === "preset-15" ||
      preset.id === "preset-16" ||
      preset.id === "preset-dirt-roads",
  },
  {
    id: "parking",
    label: "Parking",
    match: (preset) => /parking|pull-off|layby/i.test(preset.name),
  },
  {
    id: "water",
    label: "Water",
    match: (preset) => /water|ford|bridge/i.test(preset.name),
  },
  {
    id: "dead-end",
    label: "Dead ends",
    match: (preset) => /dead end|cul de sac|cut-through|industrial dead/i.test(preset.name),
  },
  {
    id: "quiet",
    label: "Quiet roads",
    match: (preset) => /25 mile|low-speed|unlit|no-sidewalk|tree-lined/i.test(preset.name),
  },
  {
    id: "trails",
    label: "Trails",
    match: (preset) => /trail|walking|pedestrian|cut-through/i.test(preset.name),
  },
  {
    id: "barriers",
    label: "Barriers",
    match: (preset) => /barrier|gated|fence|train track/i.test(preset.name),
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
const DEFAULT_RAW_QUERY = `[out:json][timeout:25];
(
  node["amenity"="restaurant"]({{bbox}});
  way["amenity"="restaurant"]({{bbox}});
);
out body;
>;
out skel qt;`;

const GIBS_MIN_DATE = "2000-02-24";

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
  const geocoderRef = useRef<google.maps.Geocoder | null>(null);
  const autocompleteServiceRef = useRef<google.maps.places.AutocompleteService | null>(null);
  const panoramaRef = useRef<google.maps.StreetViewPanorama | null>(null);
  const overlayMapTypeRef = useRef<google.maps.MapType | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const lastRequestKeyRef = useRef<string | null>(null);
  const selectedDataFeatureRef = useRef<google.maps.Data.Feature | null>(null);
  const dataFeatureClickRef = useRef<(feature: google.maps.Data.Feature) => void>(() => undefined);
  const featureColorMapRef = useRef<Record<FeatureKind, string>>({ ...DEFAULT_FEATURE_COLORS });
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
  const [presetId, setPresetId] = useState<PresetId>("preset-dirt-roads");
  const [presetSearch, setPresetSearch] = useState("");
  const [presetCategory, setPresetCategory] = useState<string>("all");
  const [showBuildings, setShowBuildings] = useState(false);
  const [showWater, setShowWater] = useState(true);
  const [bufferScale, setBufferScale] = useState(1);

  // Location
  const [locationQuery, setLocationQuery] = useState(DEFAULT_LOCATION_QUERY);
  const [placeSuggestions, setPlaceSuggestions] = useState<PlaceSuggestion[]>([]);
  const [suggestionsStatus, setSuggestionsStatus] = useState<string | null>(null);

  // Map view state
  const [zoom, setZoom] = useState(DEFAULT_ZOOM);
  const [mapType, setMapType] = useState<MapDisplayType>("roadmap");
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

  // Search lifecycle
  const [boundsWarning, setBoundsWarning] = useState<string | null>(null);
  const [searchWarning, setSearchWarning] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [mapStatus, setMapStatus] = useState("Loading Google Maps...");
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
      if (!category.match(preset)) return false;
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
            setSuggestionsStatus("Place suggestions unavailable; location search still works.");
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
    async (coordinate: LatLng, sourceName: string) => {
      const maps = mapsRef.current;
      const service = streetViewServiceRef.current;
      const lookupId = streetViewLookupIdRef.current + 1;
      streetViewLookupIdRef.current = lookupId;

      if (!maps || !service) {
        setStreetViewState({
          status: "error",
          sourceName,
          message: "Google Street View is not ready yet.",
        });
        return;
      }

      setStreetViewState({ status: "searching", sourceName });

      try {
        const panorama = await findNearestStreetView(maps, service, coordinate);
        if (streetViewLookupIdRef.current !== lookupId) return;
        if (!panorama) {
          setStreetViewState({
            status: "none",
            sourceName,
            message: "No Street View found nearby.",
          });
          return;
        }
        setStreetViewState({ status: "open", sourceName, data: panorama });
      } catch (lookupError) {
        if (streetViewLookupIdRef.current !== lookupId) return;
        setStreetViewState({
          status: "error",
          sourceName,
          message:
            lookupError instanceof Error ? lookupError.message : "Street View lookup failed.",
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
      void runStreetViewLookup(selected.coordinate, selected.name);
    },
    [runStreetViewLookup],
  );

  dataFeatureClickRef.current = selectDataFeature;

  const renderFeatures = useCallback(
    (collection: GeoJSONFeatureCollection) => {
      const map = mapRef.current;
      if (!map) return;
      clearDataLayer();
      map.data.addGeoJson(collection);
      setPresentFeatureKinds(collectFeatureKinds(collection));
    },
    [clearDataLayer],
  );

  const clearResults = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    lastRequestKeyRef.current = null;
    clearDataLayer();
    closeStreetView();
    setSelectedFeature(null);
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
        requestLabel = "Raw Overpass QL";
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
      const overpass = await runOverpassQuery(query, abortController.signal);
      if (abortController.signal.aborted) return;

      const result =
        mode === "simple"
          ? prepareSimpleResult(overpass.geojson.features, {
              includeBuildings: false,
              includeWater: false,
              renderLimit: RENDER_LIMIT,
              simpleMatchLabel: parsedFilter
                ? `Matched ${parsedFilter.label}`
                : "Matched simple tag search",
            })
          : mode === "preset"
            ? applyPresetSpatialFilters(overpass.geojson.features, selectedPreset, {
                includeBuildings: showBuildings,
                includeWater: showWater,
                renderLimit: RENDER_LIMIT,
              })
            : prepareSimpleResult(overpass.geojson.features, {
                includeBuildings: false,
                includeWater: false,
                renderLimit: RENDER_LIMIT,
                simpleMatchLabel: "Matched raw Overpass QL",
              });

      renderFeatures({ type: "FeatureCollection", features: result.features });
      setRawFeatureCount(overpass.rawFeatureCount);
      setResultCount(result.resultCount);
      setRenderedFeatureCount(result.features.length);
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

  const openMapCenterStreetView = useCallback(() => {
    const map = mapRef.current;
    const center = map?.getCenter();
    if (!center) {
      setError("The map center is not available yet.");
      return;
    }
    setError(null);
    void runStreetViewLookup({ lat: center.lat(), lng: center.lng() }, "Map center");
  }, [runStreetViewLookup]);

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
        const map = new maps.maps.Map(mapDivRef.current, {
          center: DEFAULT_CENTER,
          zoom: DEFAULT_ZOOM,
          mapTypeId: "roadmap",
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
              setSuggestionsStatus("Place suggestions unavailable; location search still works.");
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

        listeners.push(
          map.data.addListener("click", (event: google.maps.Data.MouseEvent) => {
            dataFeatureClickRef.current(event.feature);
          }),
          map.addListener("maptypeid_changed", () => {
            setMapType(normalizeMapTypeId(map.getMapTypeId()));
          }),
          map.addListener("idle", () => {
            syncCurrentMapState();
            maybeShowSearchHereChip();
          }),
          map.addListener("bounds_changed", syncCurrentMapState),
        );

        window.setTimeout(syncCurrentMapState, 250);
        window.setTimeout(syncCurrentMapState, 1500);
        setMapStatus("Map ready");
      } catch (mapError) {
        setMapStatus("Google Maps failed to load.");
        setError(mapError instanceof Error ? mapError.message : "Google Maps failed to load.");
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
  }, [streetViewState]);

  return (
    <div className="app-shell">
      <main ref={mapRegionRef} className="map-region" aria-label="Map workspace">
        <div ref={mapDivRef} className="map-canvas" aria-label="Google map" />

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
          mode={mode}
          onModeChange={setMode}
          presetId={presetId}
          onPresetChange={setPresetId}
          presetSearch={presetSearch}
          onPresetSearchChange={setPresetSearch}
          presetCategory={presetCategory}
          onPresetCategoryChange={setPresetCategory}
          filteredPresets={filteredPresets}
          selectedPreset={selectedPreset}
          showBuildings={showBuildings}
          onShowBuildingsChange={setShowBuildings}
          showWater={showWater}
          onShowWaterChange={setShowWater}
          bufferScale={bufferScale}
          onBufferScaleChange={setBufferScale}
          tagFilter={tagFilter}
          onTagFilterChange={setTagFilter}
          rawQuery={rawQuery}
          onRawQueryChange={setRawQuery}
          loading={loading}
          difficulty={difficultyEstimate}
          onSearch={() => void handleSearch()}
          onClear={clearResults}
          resultCount={resultCount}
          renderedFeatureCount={renderedFeatureCount}
          rawFeatureCount={rawFeatureCount}
          elapsedMs={elapsedMs}
          lastSearchDurationMs={lastSearchDurationMs}
          searchOutcome={searchOutcome}
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
          onZoomIn={() => zoomMap(1)}
          onZoomOut={() => zoomMap(-1)}
          onToggleTilt={() => setTiltOn((v) => !v)}
          onResetCamera={resetMapCamera}
          onFullscreen={enterMapFullscreen}
          onStreetView={openMapCenterStreetView}
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

        {selectedFeature ? (
          <FeatureCard
            selectedFeature={selectedFeature}
            streetViewState={streetViewState}
            onClose={() => {
              setSelectedFeature(null);
              selectedDataFeatureRef.current?.setProperty("scoutSelected", false);
              selectedDataFeatureRef.current = null;
              closeStreetView();
            }}
          />
        ) : null}

        {streetViewState.status === "open" ? (
          <section className="street-view-panel" aria-label="Google Street View inspection">
            <div className="street-view-header">
              <div>
                <p className="eyebrow">Street View</p>
                <h2>{streetViewState.sourceName}</h2>
              </div>
              <button type="button" className="ghost-button" onClick={closeStreetView}>
                Close
              </button>
            </div>
            <div ref={streetViewDivRef} className="street-view-canvas" />
          </section>
        ) : null}
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
  loading: boolean;
  mapStatus: string;
  zoom: number;
}) {
  return (
    <form
      className="search-pill"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
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
          onChange={(event) => onLocationChange(event.target.value)}
          placeholder="Search Google Maps"
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
            }}
            aria-label="Clear"
          >
            <CloseIcon />
          </button>
        ) : null}
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
      {suggestions.length > 0 ? (
        <div className="search-suggestions" role="listbox" aria-label="Location suggestions">
          {suggestions.map((suggestion) => (
            <button
              key={suggestion.placeId}
              type="button"
              className="search-suggestion"
              onClick={() => onSelectSuggestion(suggestion)}
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
      ) : null}
    </form>
  );
}

/* ---------------- PresetPanel ---------------- */

function PresetPanel(props: {
  open: boolean;
  onToggle: () => void;
  mode: Mode;
  onModeChange: (mode: Mode) => void;
  presetId: PresetId;
  onPresetChange: (id: PresetId) => void;
  presetSearch: string;
  onPresetSearchChange: (value: string) => void;
  presetCategory: string;
  onPresetCategoryChange: (id: string) => void;
  filteredPresets: PresetDefinition[];
  selectedPreset: PresetDefinition;
  showBuildings: boolean;
  onShowBuildingsChange: (value: boolean) => void;
  showWater: boolean;
  onShowWaterChange: (value: boolean) => void;
  bufferScale: number;
  onBufferScaleChange: (value: number) => void;
  tagFilter: string;
  onTagFilterChange: (value: string) => void;
  rawQuery: string;
  onRawQueryChange: (value: string) => void;
  loading: boolean;
  difficulty: DifficultyEstimate;
  onSearch: () => void;
  onClear: () => void;
  resultCount: number;
  renderedFeatureCount: number;
  rawFeatureCount: number | null;
  elapsedMs: number;
  lastSearchDurationMs: number | null;
  searchOutcome: "idle" | "success" | "error";
}) {
  return (
    <aside className={`panel preset-panel ${props.open ? "" : "collapsed"}`} aria-label="Scout queries">
      <div className="panel-header">
        <span className="panel-icon" aria-hidden="true">
          <CompassIcon />
        </span>
        <h2>Scout queries</h2>
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
              placeholder="Search 34 premade queries"
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
                    props.onModeChange("preset");
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

        {props.mode === "preset" ? (
          <div className="panel-section">
            <p className="panel-section-title">Parameters · {props.selectedPreset.name}</p>
            <div className="preset-tuner">
              <div className="tuner-row">
                <label>
                  Buffer radius
                  <strong>{props.bufferScale.toFixed(2)}×</strong>
                </label>
                <input
                  type="range"
                  min={0.5}
                  max={2}
                  step={0.25}
                  value={props.bufferScale}
                  onChange={(event) =>
                    props.onBufferScaleChange(Number(event.target.value))
                  }
                  aria-label="Buffer radius multiplier"
                />
              </div>
              <label className="toggle-row">
                <span>
                  Context buildings
                  <small>Render mapped buildings within the buffer</small>
                </span>
                <span className="toggle-switch">
                  <input
                    type="checkbox"
                    checked={props.showBuildings}
                    disabled={!props.selectedPreset.supportsBuildings}
                    onChange={(event) => props.onShowBuildingsChange(event.target.checked)}
                  />
                  <span className="slider" />
                </span>
              </label>
              <label className="toggle-row">
                <span>
                  Context water
                  <small>Show nearby water features</small>
                </span>
                <span className="toggle-switch">
                  <input
                    type="checkbox"
                    checked={props.showWater}
                    disabled={!props.selectedPreset.supportsWater}
                    onChange={(event) => props.onShowWaterChange(event.target.checked)}
                  />
                  <span className="slider" />
                </span>
              </label>
            </div>
          </div>
        ) : null}

        <details className="advanced-disclosure" open={props.mode !== "preset"}>
          <summary>
            <ChevronRightIcon />
            Advanced search
          </summary>
          <div className="advanced-body">
            <div className="segmented" role="tablist" aria-label="Search mode">
              <button
                type="button"
                role="tab"
                aria-pressed={props.mode === "preset"}
                onClick={() => props.onModeChange("preset")}
              >
                Premade
              </button>
              <button
                type="button"
                role="tab"
                aria-pressed={props.mode === "simple"}
                onClick={() => props.onModeChange("simple")}
              >
                Simple tag
              </button>
              <button
                type="button"
                role="tab"
                aria-pressed={props.mode === "raw"}
                onClick={() => props.onModeChange("raw")}
              >
                Raw QL
              </button>
              <button
                type="button"
                role="tab"
                aria-pressed={false}
                onClick={() => props.onClear()}
                title="Clear results"
              >
                Reset
              </button>
            </div>

            {props.mode === "simple" ? (
              <div className="tuner-row">
                <label htmlFor="tag-filter">Tag filter</label>
                <input
                  id="tag-filter"
                  value={props.tagFilter}
                  onChange={(event) => props.onTagFilterChange(event.target.value)}
                  placeholder="amenity=restaurant"
                  spellCheck={false}
                />
                <div className="simple-preset-grid">
                  {SIMPLE_PRESETS.map((preset) => (
                    <button
                      key={preset.filter}
                      type="button"
                      onClick={() => props.onTagFilterChange(preset.filter)}
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            {props.mode === "raw" ? (
              <div className="tuner-row">
                <label htmlFor="raw-query">Overpass QL</label>
                <textarea
                  id="raw-query"
                  className="raw-query-input"
                  value={props.rawQuery}
                  onChange={(event) => props.onRawQueryChange(event.target.value)}
                  spellCheck={false}
                  rows={10}
                />
              </div>
            ) : null}
          </div>
        </details>
      </div>

      <div className="panel-footer">
        <SearchStatusBanner
          loading={props.loading}
          elapsedMs={props.elapsedMs}
          lastSearchDurationMs={props.lastSearchDurationMs}
          searchOutcome={props.searchOutcome}
          resultCount={props.resultCount}
        />
        <div className="difficulty-line">
          <span>{props.difficulty.scope}</span>
          <span className={`difficulty-badge difficulty-${props.difficulty.level}`}>
            {props.difficulty.label}
          </span>
        </div>
        <div className="action-row">
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
        <dl className="stats-strip">
          <div>
            <dt>Results</dt>
            <dd>{props.resultCount.toLocaleString()}</dd>
          </div>
          <div>
            <dt>Rendered</dt>
            <dd>{props.renderedFeatureCount.toLocaleString()}</dd>
          </div>
          <div>
            <dt>Raw OSM</dt>
            <dd>
              {props.rawFeatureCount === null ? "—" : props.rawFeatureCount.toLocaleString()}
            </dd>
          </div>
        </dl>
      </div>
    </aside>
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
          <strong>Searching the Overpass API…</strong>
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
                When results include more than one type (e.g., public vs private roads), give each
                a distinct color.
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
  onZoomIn: () => void;
  onZoomOut: () => void;
  onToggleTilt: () => void;
  onResetCamera: () => void;
  onFullscreen: () => void;
  onStreetView: () => void;
}) {
  return (
    <nav className="map-controls" aria-label="Map controls">
      <div className="icon-stack">
        <button type="button" onClick={props.onStreetView} aria-label="Open Street View at map center" title="Street View">
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
  onClose,
}: {
  selectedFeature: SelectedFeature;
  streetViewState: StreetViewState;
  onClose: () => void;
}) {
  const tagRows = summarizeTags(selectedFeature.tags, 10);
  const address = buildAddressFromTags(selectedFeature.tags);
  const externalLinks = buildExternalLinks(selectedFeature.coordinate, address);

  return (
    <section className="feature-card" aria-label="Selected feature">
      <div className="feature-card-header">
        <div>
          <p className="eyebrow">Selected feature</p>
          <h2>{selectedFeature.name}</h2>
          <small>
            {selectedFeature.osmType ?? "feature"} {selectedFeature.osmId ?? ""} ·{" "}
            {formatCoordinate(selectedFeature.coordinate)}
          </small>
        </div>
        <button type="button" className="panel-toggle" onClick={onClose} aria-label="Close">
          <CloseIcon />
        </button>
      </div>
      <div className="feature-card-body">
        {address ? (
          <dl className="feature-card-row">
            <dt>Address</dt>
            <dd>{address}</dd>
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
        {selectedFeature.matchReason.detail ? (
          <p style={{ color: "var(--muted)", fontSize: "0.78rem", margin: 0 }}>
            {selectedFeature.matchReason.detail}
          </p>
        ) : null}
        <div className="external-links">
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

function StreetViewStatus({ state }: { state: StreetViewState }) {
  if (state.status === "searching") {
    return <p className="notice">Looking for nearby Street View...</p>;
  }
  if (state.status === "none" || state.status === "error") {
    return <p className="notice warning">{state.message}</p>;
  }
  if (state.status === "open") {
    return <p className="notice success">Street View found.</p>;
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
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="5" r="2.3" />
      <path d="M9.4 10.1h5.2l.9 8.5a1.5 1.5 0 0 1-1.5 1.7h-4a1.5 1.5 0 0 1-1.5-1.7z" />
      <path d="M7 11.2c1.4-.9 3.1-1.4 5-1.4s3.6.5 5 1.4" />
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
  switch (true) {
    case /^preset-(01|02|15|16)$/.test(presetId):
    case presetId === "preset-dirt-roads":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M4 18c2-4 6-4 8 0s6 4 8 0" />
        </svg>
      );
    case presetId === "preset-alleys":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M6 4v16M18 4v16M6 12h12" />
        </svg>
      );
    case /^preset-(05|08|17|24|21)$/.test(presetId):
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M3 14c3-3 5-3 8 0s5 3 8 0" />
          <path d="M3 18c3-3 5-3 8 0s5 3 8 0" />
        </svg>
      );
    case /^preset-(06|23)$/.test(presetId):
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M3 12h18M5 12V8m14 4V8M9 16v4m6-4v4" />
        </svg>
      );
    case /^preset-(04|09|10|19|20|22)$/.test(presetId):
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <rect x="6" y="4" width="12" height="16" rx="2" />
          <path d="M9 9h4a2 2 0 1 1 0 4H9z" />
        </svg>
      );
    case /^preset-(07|11|18|28|33)$/.test(presetId):
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 4v9" />
          <circle cx="12" cy="17" r="3" />
        </svg>
      );
    case /^preset-(26|27|31|32)$/.test(presetId):
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M5 20s3-3 4-6 4-4 5-8" />
          <circle cx="14" cy="6" r="1.5" />
        </svg>
      );
    case /^preset-25$/.test(presetId):
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M4 20V8m16 12V8M4 8h16M8 12h8M8 16h8" />
        </svg>
      );
    case /^preset-03$/.test(presetId):
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <rect x="3" y="9" width="14" height="7" rx="2" />
          <circle cx="7" cy="18" r="2" />
          <circle cx="14" cy="18" r="2" />
          <path d="M17 12h4l-2 4" />
        </svg>
      );
    default:
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="12" cy="12" r="3" />
          <path d="M12 3v3M12 18v3M3 12h3M18 12h3" />
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
        <h1>Overpass Scout View</h1>
        <p>
          Add a Google Maps JavaScript API key as <code>VITE_GOOGLE_MAPS_API_KEY</code> before
          running or building the app.
        </p>
        <pre>VITE_GOOGLE_MAPS_API_KEY=your_key_here</pre>
        <p>
          This key is embedded in the client bundle. Restrict it by HTTP referrer in Google Cloud
          before publishing to GitHub Pages.
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

function buildExternalLinks(
  coordinate: LatLng,
  address: string | null,
): { label: string; url: string }[] {
  const lat = coordinate.lat.toFixed(6);
  const lng = coordinate.lng.toFixed(6);
  const coordQuery = `${lat},${lng}`;
  const fallbackQuery = address ?? coordQuery;
  const encodedFallback = encodeURIComponent(fallbackQuery);

  const zipMatch = address?.match(/\b(\d{5})(?:-\d{4})?\b/);
  const zipcode = zipMatch?.[1];

  // Zillow/LoopNet expect dash-separated path segments without URI-encoded
  // spaces or commas; otherwise they 404 to the homepage.
  const dashSlug = address
    ? address
        .replace(/,/g, "")
        .replace(/\s+/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "")
    : null;

  // Realtor.com joins location parts with underscores and words with dashes.
  const realtorSlug = address
    ? address
        .split(",")
        .map((part) => part.trim().replace(/\s+/g, "-"))
        .filter(Boolean)
        .join("_")
    : null;

  return [
    {
      label: "Google Maps",
      url: `https://www.google.com/maps/search/?api=1&query=${encodedFallback}`,
    },
    {
      label: "Zillow",
      url: dashSlug
        ? `https://www.zillow.com/homes/${encodeURIComponent(dashSlug)}_rb/`
        : `https://www.zillow.com/homes/${lat},${lng}_ll/`,
    },
    {
      label: "Redfin",
      url: zipcode
        ? `https://www.redfin.com/zipcode/${zipcode}`
        : `https://www.redfin.com/?location=${encodedFallback}`,
    },
    {
      label: "Realtor",
      url: realtorSlug
        ? `https://www.realtor.com/realestateandhomes-search/${encodeURIComponent(realtorSlug)}`
        : `https://www.realtor.com/realestateandhomes-search/${lat},${lng}`,
    },
    {
      label: "LoopNet",
      url: dashSlug
        ? `https://www.loopnet.com/search/commercial-real-estate/${encodeURIComponent(dashSlug.toLowerCase())}/for-sale/`
        : `https://www.loopnet.com/search/commercial-real-estate/${lat},${lng}/for-sale/`,
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
    if (zoom < 13) return "Zoom in to at least 13 before running a raw Overpass query.";
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
        ? "Raw QL with {{bbox}} scoped to current map."
        : "No {{bbox}} macro — query may ignore current view.",
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
  if (!trimmed) throw new Error("Paste an Overpass QL query before searching.");
  if (!trimmed.includes("[out:json")) {
    throw new Error("Raw queries must request JSON output, for example [out:json][timeout:25];");
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
    category === "parking";

  return {
    clickable: true,
    strokeColor: color,
    strokeOpacity: selected ? 1 : isContext ? 0.68 : 0.9,
    strokeWeight: selected ? 5 : category === "trail" ? 3 : 2,
    fillColor: color,
    fillOpacity: isPolygon ? (selected ? 0.32 : isContext ? 0.12 : 0.2) : 0,
    zIndex: selected ? 1000 : isContext ? 10 : 100,
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
