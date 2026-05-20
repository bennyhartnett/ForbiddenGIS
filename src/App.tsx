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

type Mode = "simple" | "preset" | "raw";
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

const SIMPLE_PRESETS = [
  { label: "Restaurants", filter: "amenity=restaurant" },
  { label: "Cafes", filter: "amenity=cafe" },
  { label: "Bars", filter: "amenity=bar" },
  { label: "Hotels", filter: "tourism=hotel" },
  { label: "Gas stations", filter: "amenity=fuel" },
  { label: "Shops", filter: "shop=*" },
  { label: "Buildings", filter: "building=*" },
];

const RENDER_LIMIT = 5000;
const DEFAULT_CENTER: LatLng = { lat: 38.9072, lng: -77.0369 };
const DEFAULT_ZOOM = 15;
const DEFAULT_LOCATION_QUERY = "Washington, DC";
const DEFAULT_RAW_QUERY = `[out:json][timeout:25];
(
  node["amenity"="restaurant"]({{bbox}});
  way["amenity"="restaurant"]({{bbox}});
  relation["amenity"="restaurant"]({{bbox}});
);
out body;
>;
out skel qt;`;

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
  const abortRef = useRef<AbortController | null>(null);
  const lastRequestKeyRef = useRef<string | null>(null);
  const selectedDataFeatureRef = useRef<google.maps.Data.Feature | null>(null);
  const dataFeatureClickRef = useRef<(feature: google.maps.Data.Feature) => void>(() => undefined);
  const streetViewLookupIdRef = useRef(0);
  const searchGateRef = useRef({
    mode: "simple" as Mode,
    tagFilter: "amenity=restaurant",
    presetMinZoom: 14,
  });

  const [mode, setMode] = useState<Mode>("simple");
  const [tagFilter, setTagFilter] = useState("amenity=restaurant");
  const [rawQuery, setRawQuery] = useState(DEFAULT_RAW_QUERY);
  const [locationQuery, setLocationQuery] = useState(DEFAULT_LOCATION_QUERY);
  const [locationStatus, setLocationStatus] = useState("Scoped to Washington, DC.");
  const [placeSuggestions, setPlaceSuggestions] = useState<PlaceSuggestion[]>([]);
  const [suggestionsStatus, setSuggestionsStatus] = useState<string | null>(null);
  const [presetId, setPresetId] = useState<PresetId>("road-adjacent-parking");
  const [showBuildings, setShowBuildings] = useState(false);
  const [showWater, setShowWater] = useState(true);
  const [zoom, setZoom] = useState(DEFAULT_ZOOM);
  const [mapType, setMapType] = useState<MapDisplayType>("roadmap");
  const [visibleDiagonalKm, setVisibleDiagonalKm] = useState<number | null>(null);
  const [boundsWarning, setBoundsWarning] = useState<string | null>(null);
  const [searchWarning, setSearchWarning] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [mapStatus, setMapStatus] = useState("Loading Google Maps...");
  const [error, setError] = useState<string | null>(null);
  const [resultCount, setResultCount] = useState(0);
  const [rawFeatureCount, setRawFeatureCount] = useState<number | null>(null);
  const [renderedFeatureCount, setRenderedFeatureCount] = useState(0);
  const [selectedFeature, setSelectedFeature] = useState<SelectedFeature | null>(null);
  const [streetViewState, setStreetViewState] = useState<StreetViewState>({ status: "idle" });

  const selectedPreset = useMemo(() => getPresetById(presetId), [presetId]);
  const activeWarning = searchWarning ?? boundsWarning;
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

  useEffect(() => {
    searchGateRef.current = {
      mode,
      tagFilter,
      presetMinZoom: selectedPreset.minZoom,
    };

    const map = mapRef.current;
    if (map) {
      syncLiveMapState(map, mode, tagFilter, selectedPreset.minZoom, setZoom, setVisibleDiagonalKm, setBoundsWarning);
    }
  }, [mode, selectedPreset.minZoom, tagFilter]);

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
        .getPlacePredictions({
          input,
          componentRestrictions: { country: "us" },
        })
        .then((response) => {
          if (cancelled) {
            return;
          }

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

  const clearDataLayer = useCallback(() => {
    const map = mapRef.current;
    if (!map) {
      return;
    }

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
        if (streetViewLookupIdRef.current !== lookupId) {
          return;
        }

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
        if (streetViewLookupIdRef.current !== lookupId) {
          return;
        }
        setStreetViewState({
          status: "error",
          sourceName,
          message:
            lookupError instanceof Error
              ? lookupError.message
              : "Street View lookup failed.",
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

      if (!selected) {
        return;
      }

      setSelectedFeature(selected);
      void runStreetViewLookup(selected.coordinate, selected.name);
    },
    [runStreetViewLookup],
  );

  dataFeatureClickRef.current = selectDataFeature;

  const renderFeatures = useCallback(
    (collection: GeoJSONFeatureCollection) => {
      const map = mapRef.current;
      if (!map) {
        return;
      }

      clearDataLayer();
      map.data.addGeoJson(collection);
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
    setLoading(false);
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
    closeStreetView();

    const diagonalKm = bboxDiagonalKm(bbox);
    setSearchWarning(
      diagonalKm > (mode === "preset" ? 4 : 8)
        ? "This map area is large; results may be slow or capped. Zoom in for a tighter scan."
        : null,
    );

    try {
      const overpass = await runOverpassQuery(query, abortController.signal);
      if (abortController.signal.aborted) {
        return;
      }

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

      renderFeatures({
        type: "FeatureCollection",
        features: result.features,
      });
      setRawFeatureCount(overpass.rawFeatureCount);
      setResultCount(result.resultCount);
      setRenderedFeatureCount(result.features.length);
      setSearchWarning(result.warnings[0] ?? null);
    } catch (searchError) {
      if ((searchError as Error).name === "AbortError") {
        return;
      }

      setError(
        searchError instanceof Error
          ? searchError.message
          : "Search failed. Try a smaller area or a simpler filter.",
      );
    } finally {
      if (abortRef.current === abortController) {
        abortRef.current = null;
        setLoading(false);
      }
    }
  }, [
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
    void runStreetViewLookup(
      { lat: center.lat(), lng: center.lng() },
      "Map center",
    );
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
      setLocationStatus(`Finding ${query}...`);

      geocoder.geocode(placeId ? { placeId } : { address: query }, (results, status) => {
        const result = results?.[0];

        if (status !== "OK" || !result) {
          setLocationStatus("Location not found.");
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
        setLocationStatus(`Scoped to ${formatted}.`);
      });
    },
    [locationQuery],
  );

  const scopeToWashingtonDc = useCallback(() => {
    setLocationQuery(DEFAULT_LOCATION_QUERY);
    const map = mapRef.current;

    if (map) {
      map.setCenter(DEFAULT_CENTER);
      map.setZoom(DEFAULT_ZOOM);
    }

    setLocationStatus("Scoped to Washington, DC.");
    setError(null);
  }, []);

  const zoomMap = useCallback((delta: number) => {
    const map = mapRef.current;
    if (!map) {
      return;
    }

    map.setZoom((map.getZoom() ?? DEFAULT_ZOOM) + delta);
  }, []);

  const toggleMapType = useCallback(() => {
    const map = mapRef.current;
    if (!map) {
      return;
    }

    const currentType = normalizeMapTypeId(map.getMapTypeId());
    const nextType =
      currentType === "satellite" || currentType === "hybrid" ? "roadmap" : "satellite";
    map.setMapTypeId(nextType);
    setMapType(nextType);
  }, []);

  const resetMapCamera = useCallback(() => {
    const map = mapRef.current;
    if (!map) {
      return;
    }

    map.setHeading(0);
    map.setTilt(0);
  }, []);

  const enterMapFullscreen = useCallback(() => {
    const region = mapRegionRef.current;
    if (!region || document.fullscreenElement) {
      return;
    }

    void region.requestFullscreen().catch(() => {
      setError("Fullscreen is not available in this browser.");
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    const listeners: google.maps.MapsEventListener[] = [];

    async function setupMap() {
      try {
        const maps = await loadGoogleMaps(apiKey);
        if (cancelled || !mapDivRef.current || mapRef.current) {
          return;
        }

        mapsRef.current = maps;
        const map = new maps.maps.Map(mapDivRef.current, {
          center: DEFAULT_CENTER,
          zoom: DEFAULT_ZOOM,
          mapTypeId: "roadmap",
          zoomControl: true,
          mapTypeControl: true,
          mapTypeControlOptions: {
            position: maps.maps.ControlPosition.TOP_RIGHT,
            style: maps.maps.MapTypeControlStyle.HORIZONTAL_BAR,
          },
          streetViewControl: true,
          streetViewControlOptions: {
            position: maps.maps.ControlPosition.RIGHT_BOTTOM,
          },
          fullscreenControl: true,
          fullscreenControlOptions: {
            position: maps.maps.ControlPosition.RIGHT_TOP,
          },
          rotateControl: true,
          scaleControl: true,
          clickableIcons: false,
        });

        mapRef.current = map;
        streetViewServiceRef.current = new maps.maps.StreetViewService();
        geocoderRef.current = new maps.maps.Geocoder();
        map.data.setStyle((feature) => styleForDataFeature(maps, feature));
        void maps.maps.importLibrary("places").then((placesLibrary) => {
          if (!cancelled && "AutocompleteService" in placesLibrary) {
            autocompleteServiceRef.current = new placesLibrary.AutocompleteService();
          }
        }).catch(() => {
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

        listeners.push(
          map.data.addListener("click", (event: google.maps.Data.MouseEvent) => {
            dataFeatureClickRef.current(event.feature);
          }),
          map.addListener("maptypeid_changed", () => {
            setMapType(normalizeMapTypeId(map.getMapTypeId()));
          }),
          map.addListener("idle", syncCurrentMapState),
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

    if (streetViewState.status !== "open" || !maps || !container) {
      return;
    }

    const location = streetViewState.data.location;
    if (!location?.pano || !location.latLng) {
      return;
    }

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
      <aside className="sidebar" aria-label="Overpass Scout View controls">
        <header className="sidebar-header">
          <p className="eyebrow">OpenStreetMap + Google Street View</p>
          <h1>Overpass Scout View</h1>
          <p className="status-line">
            {mapStatus} <span aria-label={`Current zoom ${zoom}`}>Zoom {zoom}</span>
          </p>
        </header>

        <section className="control-section">
          <form
            className="location-form"
            onSubmit={(event) => {
              event.preventDefault();
              scopeToLocation();
            }}
          >
            <label htmlFor="location-search">Search and scope to location</label>
            <input
              id="location-search"
              value={locationQuery}
              onChange={(event) => {
                setLocationQuery(event.target.value);
                setSuggestionsStatus(null);
              }}
              placeholder="Washington, DC"
              autoComplete="off"
              spellCheck={false}
            />
            {placeSuggestions.length > 0 ? (
              <div className="suggestion-list" role="listbox" aria-label="Location suggestions">
                {placeSuggestions.map((suggestion) => (
                  <button
                    key={suggestion.placeId}
                    type="button"
                    className="suggestion-option"
                    onClick={() => scopeToLocation(suggestion.description, suggestion.placeId)}
                  >
                    <span>{suggestion.mainText}</span>
                    {suggestion.secondaryText ? <small>{suggestion.secondaryText}</small> : null}
                  </button>
                ))}
              </div>
            ) : null}
            <div className="inline-actions">
              <button type="submit">Go to location</button>
              <button type="button" onClick={scopeToWashingtonDc}>
                Washington DC
              </button>
            </div>
          </form>
          <p className="query-summary">{locationStatus}</p>
          {suggestionsStatus ? <p className="muted">{suggestionsStatus}</p> : null}
        </section>

        <section className="control-section">
          <label htmlFor="mode">Mode</label>
          <select
            id="mode"
            value={mode}
            onChange={(event) => {
              setMode(event.target.value as Mode);
              setError(null);
              setSearchWarning(null);
            }}
          >
            <option value="simple">Simple tag search</option>
            <option value="preset">Premade queries</option>
            <option value="raw">Raw Overpass QL</option>
          </select>
          <p className="query-summary">
            Current: {mode === "simple" ? tagFilter : mode === "preset" ? selectedPreset.name : "Raw Overpass QL"}
          </p>
        </section>

        {mode === "simple" ? (
          <section className="control-section">
            <label htmlFor="tag-filter">Overpass tag filter</label>
            <input
              id="tag-filter"
              value={tagFilter}
              onChange={(event) => setTagFilter(event.target.value)}
              placeholder="amenity=restaurant"
              spellCheck={false}
            />
            <div className="preset-grid" aria-label="Simple tag presets">
              {SIMPLE_PRESETS.map((preset) => (
                <button
                  key={preset.filter}
                  type="button"
                  className="small-button"
                  onClick={() => setTagFilter(preset.filter)}
                >
                  {preset.label}
                </button>
              ))}
            </div>
          </section>
        ) : mode === "preset" ? (
          <section className="control-section">
            <label htmlFor="premade-query">Premade query</label>
            <select
              id="premade-query"
              value={presetId}
              onChange={(event) => setPresetId(event.target.value as PresetId)}
            >
              {PRESETS.map((preset) => (
                <option key={preset.id} value={preset.id}>
                  {preset.name}
                </option>
              ))}
            </select>
            <p className="muted">{selectedPreset.description}</p>
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={showBuildings}
                disabled={!selectedPreset.supportsBuildings}
                onChange={(event) => setShowBuildings(event.target.checked)}
              />
              <span>Show context buildings</span>
            </label>
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={showWater}
                disabled={!selectedPreset.supportsWater}
                onChange={(event) => setShowWater(event.target.checked)}
              />
              <span>Show context water</span>
            </label>
          </section>
        ) : (
          <section className="control-section">
            <label htmlFor="raw-query">Raw Overpass QL</label>
            <textarea
              id="raw-query"
              className="raw-query-input"
              value={rawQuery}
              onChange={(event) => setRawQuery(event.target.value)}
              spellCheck={false}
              rows={12}
            />
            <p className="muted">
              Paste Overpass Turbo-style QL. Use <code>{"{{bbox}}"}</code> to scope the query to
              the current map view.
            </p>
          </section>
        )}

        <section className="difficulty-panel" aria-live="polite">
          <div className="difficulty-heading">
            <span>Compute difficulty</span>
            <strong className={`difficulty-badge difficulty-${difficultyEstimate.level}`}>
              {difficultyEstimate.label}
            </strong>
          </div>
          <p>{difficultyEstimate.detail}</p>
          <p className="muted">{difficultyEstimate.scope}</p>
        </section>

        <section className="button-stack">
          <button type="button" className="primary-button" onClick={() => void handleSearch()}>
            {loading ? "Searching..." : "Search this area"}
          </button>
          <button type="button" onClick={clearResults}>
            Clear results
          </button>
          <button type="button" onClick={openMapCenterStreetView}>
            Use map center for Street View
          </button>
        </section>

        <section className="stats-panel" aria-live="polite">
          <dl>
            <div>
              <dt>Results</dt>
              <dd>{resultCount.toLocaleString()}</dd>
            </div>
            <div>
              <dt>Rendered</dt>
              <dd>{renderedFeatureCount.toLocaleString()}</dd>
            </div>
            <div>
              <dt>Raw Overpass</dt>
              <dd>{rawFeatureCount === null ? "n/a" : rawFeatureCount.toLocaleString()}</dd>
            </div>
          </dl>
        </section>

        {activeWarning ? <p className="notice warning">{activeWarning}</p> : null}
        {error ? <p className="notice error">{error}</p> : null}

        {selectedFeature ? (
          <FeaturePanel selectedFeature={selectedFeature} streetViewState={streetViewState} />
        ) : null}

        <section className="instructions">
          <h2>Basics</h2>
          <p>
            Pan and zoom the map, then search this area. Click a rendered feature to inspect its
            tags and look for nearby Street View.
          </p>
          <p>
            Map data/results from OpenStreetMap via Overpass API. Basemap and Street View from
            Google Maps.
          </p>
          <p>
            Results are based on OpenStreetMap tags and spatial heuristics. Access/legal status may
            be incomplete or incorrect. Always verify signs, local laws, and property boundaries.
          </p>
          <p>
            Google Street View should be used only for inspection/viewing, not copying data into
            OpenStreetMap.
          </p>
        </section>
      </aside>

      <main ref={mapRegionRef} className="map-region">
        <div ref={mapDivRef} className="map-canvas" aria-label="Google map" />
        <MapToolbox
          mapType={mapType}
          onStreetView={openMapCenterStreetView}
          onZoomIn={() => zoomMap(1)}
          onZoomOut={() => zoomMap(-1)}
          onToggleMapType={toggleMapType}
          onResetCamera={resetMapCamera}
          onFullscreen={enterMapFullscreen}
        />
        {streetViewState.status === "open" ? (
          <section className="street-view-panel" aria-label="Google Street View inspection">
            <div className="street-view-header">
              <div>
                <p className="eyebrow">Street View</p>
                <h2>{streetViewState.sourceName}</h2>
              </div>
              <button type="button" onClick={closeStreetView}>
                Close Street View
              </button>
            </div>
            <div ref={streetViewDivRef} className="street-view-canvas" />
          </section>
        ) : null}
      </main>
    </div>
  );
}

function MapToolbox({
  mapType,
  onStreetView,
  onZoomIn,
  onZoomOut,
  onToggleMapType,
  onResetCamera,
  onFullscreen,
}: {
  mapType: string;
  onStreetView: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onToggleMapType: () => void;
  onResetCamera: () => void;
  onFullscreen: () => void;
}) {
  const nextMapType =
    mapType === "satellite" || mapType === "hybrid" ? "road map" : "satellite";

  return (
    <nav className="map-toolbox" aria-label="Google Maps tools">
      <button type="button" onClick={onStreetView} aria-label="Open Street View at map center">
        <StreetViewIcon />
      </button>
      <button type="button" onClick={onZoomIn} aria-label="Zoom in">
        <PlusIcon />
      </button>
      <button type="button" onClick={onZoomOut} aria-label="Zoom out">
        <MinusIcon />
      </button>
      <button
        type="button"
        onClick={onToggleMapType}
        aria-label={`Switch to ${nextMapType}`}
      >
        <LayersIcon />
      </button>
      <button type="button" onClick={onResetCamera} aria-label="Reset map tilt and heading">
        <CompassIcon />
      </button>
      <button type="button" onClick={onFullscreen} aria-label="Open map fullscreen">
        <FullscreenIcon />
      </button>
    </nav>
  );
}

function StreetViewIcon() {
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

function LayersIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="m12 4 8 4-8 4-8-4z" />
      <path d="m4 12 8 4 8-4" />
      <path d="m4 16 8 4 8-4" />
    </svg>
  );
}

function CompassIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="8" />
      <path d="m14.6 7.6-1.8 5.2-5.2 1.8 1.8-5.2z" />
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

function FeaturePanel({
  selectedFeature,
  streetViewState,
}: {
  selectedFeature: SelectedFeature;
  streetViewState: StreetViewState;
}) {
  const tagRows = summarizeTags(selectedFeature.tags, 10);

  return (
    <section className="feature-panel">
      <p className="eyebrow">Selected feature</p>
      <h2>{selectedFeature.name}</h2>
      <dl className="feature-details">
        <div>
          <dt>OSM</dt>
          <dd>
            {selectedFeature.osmType ?? "feature"} {selectedFeature.osmId ?? ""}
          </dd>
        </div>
        <div>
          <dt>Coordinate</dt>
          <dd>{formatCoordinate(selectedFeature.coordinate)}</dd>
        </div>
        <div>
          <dt>Match</dt>
          <dd>{selectedFeature.matchReason.label}</dd>
        </div>
      </dl>
      {tagRows.length > 0 ? (
        <ul className="tag-list">
          {tagRows.map((tag) => (
            <li key={tag}>{tag}</li>
          ))}
        </ul>
      ) : null}
      <StreetViewStatus state={streetViewState} />
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
    if (zoom < 13) {
      return "Zoom in to at least 13 before running a raw Overpass query.";
    }
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
      ? "Scope: waiting for map bounds."
      : `Scope: about ${formatDistanceKm(visibleDiagonalKm)} across at zoom ${zoom}.`;

  const gate = validateSearchGate(mode, zoom, tagFilter, preset.minZoom);
  if (gate) {
    return {
      level: "blocked",
      label: "Zoom in",
      detail: gate,
      scope,
    };
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
        ? "Wildcard tag searches ask Overpass for every feature with that key, so zoom and map scope matter a lot."
        : "Direct key=value searches are usually manageable when the visible area is tight.",
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
        ? "Raw QL will run exactly as pasted, with {{bbox}} replaced by the current map bounds."
        : "Raw QL has no {{bbox}} macro, so it may ignore the current map scope and run broad.",
      scope,
    };
  }

  const level = estimatePresetLevel(preset.id, visibleDiagonalKm);
  return {
    level,
    label: labelForDifficulty(level),
    detail:
      preset.id === "road-to-road-walking-trail"
        ? "This preset is the heaviest option because it scans pedestrian ways, roads, and endpoint proximity."
        : "Premade scouting queries scan multiple OSM tags and may run spatial filters after Overpass returns data.",
    scope,
  };
}

function prepareRawOverpassQuery(rawQuery: string, bbox: BBox): string {
  const trimmed = rawQuery.trim();

  if (!trimmed) {
    throw new Error("Paste an Overpass QL query before searching.");
  }

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
    .replace(/\{\{\s*center\s*\}\}/gi, `${((bbox.south + bbox.north) / 2).toFixed(7)},${((bbox.west + bbox.east) / 2).toFixed(7)}`)
    .replace(/\{\{\s*style:[\s\S]*?\}\}/gi, "")
    .replace(/\{\{\s*style\s*\}\}/gi, "");
}

function estimateSimpleLevel(
  wildcard: boolean,
  visibleDiagonalKm: number | null,
): DifficultyLevel {
  if (visibleDiagonalKm === null) {
    return wildcard ? "high" : "moderate";
  }

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
  if (visibleDiagonalKm === null) {
    return "high";
  }

  if (presetId === "road-to-road-walking-trail") {
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
  if (!hasBboxMacro) {
    return "very-high";
  }

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
  if (distanceKm < 1) {
    return `${Math.round(distanceKm * 1000)} m`;
  }

  return `${distanceKm.toFixed(distanceKm < 10 ? 1 : 0)} km`;
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
  if (bounds) {
    return googleBoundsToBBox(bounds);
  }

  const center = map.getCenter();
  if (!center) {
    return null;
  }

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

  if (!bbox) {
    return null;
  }

  const gate = validateSearchGate(mode, zoom, tagFilter, presetMinZoom);
  if (gate) {
    return gate;
  }

  const diagonalKm = bboxDiagonalKm(bbox);
  if (diagonalKm > (mode === "preset" ? 4 : 8)) {
    return "Large visible area. Searches may be slow; zoom in for cleaner results.";
  }

  return null;
}

function styleForDataFeature(
  maps: typeof google,
  feature: google.maps.Data.Feature,
): google.maps.Data.StyleOptions {
  const role = readDataString(feature, "scoutRole", "result") as ScoutRole;
  const category = readDataString(feature, "scoutCategory", "simple") as ScoutCategory;
  const selected = Boolean(feature.getProperty("scoutSelected"));
  const color = selected ? "#e03131" : colorForCategory(category, role);
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
        strokeColor: selected ? "#ffffff" : "#172033",
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

function colorForCategory(category: ScoutCategory, role: ScoutRole): string {
  if (role === "context-building") return "#7a7f87";
  if (role === "context-water") return "#228be6";
  if (role === "context-road") return "#4c6ef5";
  if (role === "context-parking") return "#845ef7";

  switch (category) {
    case "road":
      return "#4c6ef5";
    case "parking":
      return "#845ef7";
    case "trail":
      return "#2f9e44";
    case "bridge":
      return "#f08c00";
    case "water":
      return "#228be6";
    case "building":
      return "#7a7f87";
    case "water-crossing":
      return "#0ca678";
    case "simple":
    default:
      return "#d6336c";
  }
}

function readDataString(
  feature: google.maps.Data.Feature,
  key: string,
  fallback: string,
): string {
  const value = feature.getProperty(key);
  return typeof value === "string" ? value : fallback;
}
