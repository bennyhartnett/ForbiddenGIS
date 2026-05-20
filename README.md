# ForbiddenGIS

ForbiddenGIS is a private location-scouting tool. Drop a pin on the map, run a premade query, and inspect what's there up close.

## Local setup

Install dependencies:

```bash
npm install
```

Create `.env.local` with the map provider key:

```bash
VITE_GOOGLE_MAPS_API_KEY=your_key
```

Run locally:

```bash
npm run dev
```

The key is embedded client-side by Vite. Restrict it by HTTP referrer in the provider console before deploying anywhere public.

## Scripts

- `npm run dev` starts Vite.
- `npm run typecheck` runs TypeScript without emitting files.
- `npm run build` typechecks and builds the static app into `dist`.
- `npm run preview` previews the built output.

## GitHub Pages

The workflow at `.github/workflows/deploy.yml` deploys on pushes to `main`.

Add this repository secret before deploying:

```text
GOOGLE_MAPS_API_KEY=your_key
```

In repository settings, configure Pages to use GitHub Actions as the source.

## Usage

1. Pan and zoom the map.
2. Pick a premade query or a simple tag search.
3. Click **Search this area**.
4. Click any result to inspect details and open street view.
5. Use **Clear** to wipe the map.

Simple tag search supports only `key=value` and `key=*`, such as `amenity=restaurant` or `building=*`.

## Cautions

Results are based on community map data and spatial heuristics. Access and legal status may be incomplete or incorrect. Always verify signs, local laws, and property boundaries before acting on anything you find here.
