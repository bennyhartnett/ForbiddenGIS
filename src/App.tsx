import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  bboxDiagonalKm,
  formatCoordinate,
  googleBoundsToBBox,
  selectedFeatureFromProperties,
  summarizeTags,
  type GeoJSONFeatureCollection,
  type LatLng,
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

type Mode = "simple" | "preset";

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
const DEFAULT_CENTER: LatLng = { lat: 40.7128, lng: -74.006 };
const DEFAULT_ZOOM = 13;

export default function App() {
  const apiKey = getGoogleMapsApiKey();

  if (!apiKey) {
    return <MissingApiKey />;
  }

  return <ScoutApp apiKey={apiKey} />;
}

function ScoutApp({ apiKey }: { apiKey: string }) {
  const mapDivRef = useRef<HTMLDivElement | null>(null);
  const streetViewDivRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const mapsRef = useRef<typeof google | null>(null);
  const streetViewServiceRef = useRef<google.maps.StreetViewService | null>(null);
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
  const [presetId, setPresetId] = useState<PresetId>("road-adjacent-parking");
  const [showBuildings, setShowBuildings] = useState(false);
  const [showWater, setShowWater] = useState(true);
  const [zoom, setZoom] = useState(DEFAULT_ZOOM);
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

  useEffect(() => {
    searchGateRef.current = {
      mode,
      tagFilter,
      presetMinZoom: selectedPreset.minZoom,
    };

    const map = mapRef.current;
    if (map) {
      setBoundsWarning(mapBoundsWarning(map, mode, tagFilter, selectedPreset.minZoom));
    }
  }, [mode, selectedPreset.minZoom, tagFilter]);

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

    const bounds = map.getBounds();
    const currentZoom = map.getZoom() ?? 0;

    if (!bounds) {
      setError("Move the map slightly so bounds are available, then search again.");
      return;
    }

    const bbox = googleBoundsToBBox(bounds);
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
      } else {
        query = buildPresetOverpassQuery(selectedPreset, bbox, presetOptions);
        requestLabel = selectedPreset.name;
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
          : applyPresetSpatialFilters(overpass.geojson.features, selectedPreset, {
              includeBuildings: showBuildings,
              includeWater: showWater,
              renderLimit: RENDER_LIMIT,
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
          mapTypeControl: true,
          streetViewControl: false,
          fullscreenControl: true,
          clickableIcons: false,
        });

        mapRef.current = map;
        streetViewServiceRef.current = new maps.maps.StreetViewService();
        map.data.setStyle((feature) => styleForDataFeature(maps, feature));
        listeners.push(
          map.data.addListener("click", (event: google.maps.Data.MouseEvent) => {
            dataFeatureClickRef.current(event.feature);
          }),
          map.addListener("idle", () => {
            const nextZoom = map.getZoom() ?? DEFAULT_ZOOM;
            const gate = searchGateRef.current;
            setZoom(nextZoom);
            setBoundsWarning(
              mapBoundsWarning(map, gate.mode, gate.tagFilter, gate.presetMinZoom),
            );
          }),
        );
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
          </select>
          <p className="query-summary">
            Current: {mode === "simple" ? tagFilter : selectedPreset.name}
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
        ) : (
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
        )}

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

      <main className="map-region">
        <div ref={mapDivRef} className="map-canvas" aria-label="Google map" />
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

  if (zoom < presetMinZoom) {
    return `Zoom in to at least ${presetMinZoom} before running this premade query.`;
  }

  return null;
}

function mapBoundsWarning(
  map: google.maps.Map,
  mode: Mode,
  tagFilter: string,
  presetMinZoom: number,
): string | null {
  const bounds = map.getBounds();
  const zoom = map.getZoom() ?? 0;

  if (!bounds) {
    return null;
  }

  const gate = validateSearchGate(mode, zoom, tagFilter, presetMinZoom);
  if (gate) {
    return gate;
  }

  const diagonalKm = bboxDiagonalKm(googleBoundsToBBox(bounds));
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
