# Overpass Scout View

Overpass Scout View is a static Vite + React + TypeScript app for viewing OpenStreetMap Overpass query results on a Google Maps basemap and opening nearby Google Street View for inspection.

## Local setup

Install dependencies:

```bash
npm install
```

Create `.env.local`:

```bash
VITE_GOOGLE_MAPS_API_KEY=your_google_maps_javascript_api_key
```

Run locally:

```bash
npm run dev
```

The Google Maps API key is embedded client-side by Vite. Restrict it in Google Cloud by HTTP referrer before using it on GitHub Pages or any public host.

## Scripts

- `npm run dev` starts Vite.
- `npm run typecheck` runs TypeScript without emitting files.
- `npm run build` typechecks and builds the static app into `dist`.
- `npm run preview` previews the built output.

## GitHub Pages

The workflow at `.github/workflows/deploy.yml` deploys on pushes to `main` using the official GitHub Pages actions.

Add this repository secret before deploying:

```text
GOOGLE_MAPS_API_KEY=your_google_maps_javascript_api_key
```

In repository settings, configure Pages to use GitHub Actions as the source.

The Vite base path is `/` locally. In CI, it uses `/` for repositories ending in `.github.io`; otherwise it uses `/<repo-name>/`.

## Usage

1. Pan and zoom the map.
2. Choose Simple tag search or a premade scouting query.
3. Click Search this area.
4. Click any rendered feature to inspect its OSM tags and search for nearby Street View.
5. Use Clear results to remove data from the map.

Simple tag search supports only `key=value` and `key=*`, such as `amenity=restaurant` or `building=*`. It does not accept raw Overpass QL.

Raw Overpass QL mode accepts pasted Overpass Turbo-style queries. Use `{{bbox}}` in the pasted query to scope it to the current map view.

Location suggestions use the Google Maps Places library. If suggestions do not appear, enable the relevant Places API for the same Google Cloud key; typed location search still falls back to geocoding.

## Data and legal cautions

Map data/results come from OpenStreetMap via Overpass API. Basemap and Street View come from Google Maps.

Results are based on OpenStreetMap tags and spatial heuristics. Access/legal status may be incomplete or incorrect. Always verify signs, local laws, and property boundaries.

Google Street View should be used only for inspection/viewing, not copying data into OpenStreetMap.
