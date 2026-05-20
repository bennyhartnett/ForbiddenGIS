export type OverlayId =
  | "none"
  | "osm"
  | "usgs-topo"
  | "esri-imagery"
  | "gibs-modis-terra"
  | "gibs-modis-aqua"
  | "gibs-viirs-snpp";

export type OverlayKind = "none" | "tile" | "gibs";

export interface OverlaySource {
  id: OverlayId;
  label: string;
  shortLabel: string;
  attribution: string;
  kind: OverlayKind;
  url: string;
  maxZoom: number;
}

export const OVERLAY_SOURCES: OverlaySource[] = [
  {
    id: "none",
    label: "None",
    shortLabel: "No overlay",
    attribution: "Default basemap only",
    kind: "none",
    url: "",
    maxZoom: 22,
  },
  {
    id: "osm",
    label: "Community street map",
    shortLabel: "Streets",
    attribution: "© OpenStreetMap contributors",
    kind: "tile",
    url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
    maxZoom: 19,
  },
  {
    id: "usgs-topo",
    label: "Topographic",
    shortLabel: "Topo",
    attribution: "USGS National Map",
    kind: "tile",
    url: "https://basemap.nationalmap.gov/arcgis/rest/services/USGSTopo/MapServer/tile/{z}/{y}/{x}",
    maxZoom: 16,
  },
  {
    id: "esri-imagery",
    label: "Satellite (high detail)",
    shortLabel: "Satellite",
    attribution: "Source: Esri, Maxar, Earthstar Geographics",
    kind: "tile",
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    maxZoom: 19,
  },
  {
    id: "gibs-modis-terra",
    label: "Daily satellite — morning",
    shortLabel: "Daily morning",
    attribution: "NASA EOSDIS · time-aware imagery",
    kind: "gibs",
    url:
      "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/MODIS_Terra_CorrectedReflectance_TrueColor/default/{date}/GoogleMapsCompatible_Level9/{z}/{y}/{x}.jpg",
    maxZoom: 9,
  },
  {
    id: "gibs-modis-aqua",
    label: "Daily satellite — afternoon",
    shortLabel: "Daily afternoon",
    attribution: "NASA EOSDIS · time-aware imagery",
    kind: "gibs",
    url:
      "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/MODIS_Aqua_CorrectedReflectance_TrueColor/default/{date}/GoogleMapsCompatible_Level9/{z}/{y}/{x}.jpg",
    maxZoom: 9,
  },
  {
    id: "gibs-viirs-snpp",
    label: "Daily satellite — evening",
    shortLabel: "Daily evening",
    attribution: "NASA EOSDIS · time-aware imagery",
    kind: "gibs",
    url:
      "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_SNPP_CorrectedReflectance_TrueColor/default/{date}/GoogleMapsCompatible_Level9/{z}/{y}/{x}.jpg",
    maxZoom: 9,
  },
];
