import type { LatLng } from "./geo";

/** Re-export Google Maps types so app code does not depend on the global `google` namespace. */
export type GoogleMapsApi = typeof google;
export type GoogleMap = google.maps.Map;
export type GoogleMapsDataFeature = google.maps.Data.Feature;
export type GoogleMapType = google.maps.MapType;
export type GoogleOverlayView = google.maps.OverlayView;
export type GoogleMapsEventListener = google.maps.MapsEventListener;
export type GoogleStreetViewService = google.maps.StreetViewService;
export type GoogleStreetViewPanoramaData = google.maps.StreetViewPanoramaData;
export type GoogleGeocoder = google.maps.Geocoder;
export type GoogleGeocoderResult = google.maps.GeocoderResult;
export type GoogleAutocompleteService = google.maps.places.AutocompleteService;
export type GoogleAutocompletePrediction = google.maps.places.AutocompletePrediction;
export type GoogleAutocompleteResponse = google.maps.places.AutocompleteResponse;
export type GooglePlacesLibrary = google.maps.PlacesLibrary;
export type GooglePoint = google.maps.Point;
export type GoogleDataStyleOptions = google.maps.Data.StyleOptions;

let googleMapsPromise: Promise<typeof google> | null = null;

export function getGoogleMapsApiKey(): string {
  return (import.meta.env.VITE_GOOGLE_MAPS_API_KEY ?? "").trim();
}

export function loadGoogleMaps(apiKey: string): Promise<typeof google> {
  if (window.google?.maps) {
    return Promise.resolve(window.google);
  }

  if (googleMapsPromise) {
    return googleMapsPromise;
  }

  googleMapsPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(
      'script[data-google-maps-loader="true"]',
    );

    if (existing) {
      existing.addEventListener("load", () => resolve(window.google));
      existing.addEventListener("error", () => reject(new Error("Map failed to load.")));
      return;
    }

    const script = document.createElement("script");
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(
      apiKey,
    )}&v=weekly`;
    script.async = true;
    script.defer = true;
    script.dataset.googleMapsLoader = "true";
    script.addEventListener("load", () => resolve(window.google));
    script.addEventListener("error", () => reject(new Error("Map failed to load.")));
    document.head.append(script);
  });

  return googleMapsPromise;
}

export function getDataFeatureProperties(
  feature: google.maps.Data.Feature,
): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  feature.forEachProperty((value: unknown, key: string) => {
    properties[key] = value;
  });
  return properties;
}

export function findNearestStreetView(
  maps: typeof google,
  service: google.maps.StreetViewService,
  location: LatLng,
): Promise<google.maps.StreetViewPanoramaData | null> {
  return panoramaAtRadius(maps, service, location, 50).then((firstAttempt) => {
    if (firstAttempt) {
      return firstAttempt;
    }
    return panoramaAtRadius(maps, service, location, 100);
  });
}

function panoramaAtRadius(
  maps: typeof google,
  service: google.maps.StreetViewService,
  location: LatLng,
  radius: number,
): Promise<google.maps.StreetViewPanoramaData | null> {
  return new Promise((resolve, reject) => {
    service.getPanorama(
      {
        location,
        preference: maps.maps.StreetViewPreference.NEAREST,
        radius,
      },
      (data, status) => {
        if (status === maps.maps.StreetViewStatus.OK && data?.location?.latLng) {
          resolve(data);
          return;
        }

        if (status === maps.maps.StreetViewStatus.ZERO_RESULTS) {
          resolve(null);
          return;
        }

        reject(new Error("Couldn't load street view."));
      },
    );
  });
}
