import type { LatLng } from "./geo";

export type BoondockLandKind =
  | "established_campsite"
  | "caravan_site"
  | "camp_pitch"
  | "wilderness_hut"
  | "shelter"
  | "dispersed_tag"
  | "blm"
  | "national_forest"
  | "national_park"
  | "state_forest"
  | "state_park"
  | "state_trust"
  | "wma"
  | "nature_reserve"
  | "protected_area";

export interface StateBoondockingRules {
  state: string;
  abbreviation: string;
  blm?: string;
  nationalForest?: string;
  statePublicLand?: string;
  permit?: string;
  notes?: string;
}

const BLM_STANDARD = "14-day stay limit within any 28-day period; relocate at least 25 miles before re-camping.";
const USFS_STANDARD = "14-day stay limit within any 30-day period; verify each forest's local order.";

export const STATE_BOONDOCKING_RULES: Record<string, StateBoondockingRules> = {
  AL: {
    state: "Alabama",
    abbreviation: "AL",
    nationalForest: "Bankhead, Conecuh, Talladega, Tuskegee NFs allow dispersed camping outside developed sites; 14-day limit.",
    statePublicLand: "State parks: no dispersed camping. WMAs: primitive camping by permit only during open seasons.",
    permit: "WMA camping requires an Alabama hunting/fishing license or WMA permit.",
  },
  AK: {
    state: "Alaska",
    abbreviation: "AK",
    blm: "BLM Alaska: dispersed camping allowed; " + BLM_STANDARD + " Bear safety food storage rules apply.",
    nationalForest: "Tongass & Chugach NFs: dispersed camping allowed; some shoreline & cabin-corridor restrictions.",
    statePublicLand: "State land (DNR): generally open to camping up to 14 days per site; state parks vary, most require fees.",
    notes: "Pack out human waste in glacier and high-use areas; bear canisters required in many units.",
  },
  AZ: {
    state: "Arizona",
    abbreviation: "AZ",
    blm: "BLM Arizona: dispersed camping widely allowed; " + BLM_STANDARD + " Some Long-Term Visitor Areas (LTVAs) require a permit Sep 15–Apr 15.",
    nationalForest: "Coconino, Kaibab, Prescott, Tonto, Apache-Sitgreaves, Coronado NFs: dispersed camping allowed except posted closures; " + USFS_STANDARD,
    statePublicLand: "Arizona State Trust Land requires a recreation permit ($15/yr individual); state parks do not allow dispersed camping.",
    permit: "AZ State Trust Land Recreation Permit required for state trust parcels.",
    notes: "Fire restrictions are common May–Sep; verify Coconino & Tonto NF stage restrictions before any fire.",
  },
  AR: {
    state: "Arkansas",
    abbreviation: "AR",
    nationalForest: "Ozark-St. Francis & Ouachita NFs: dispersed camping allowed outside developed sites; 14-day limit.",
    statePublicLand: "State parks: designated sites only. WMAs (AGFC): primitive camping in designated areas, 14-day limit, register at WMA.",
  },
  CA: {
    state: "California",
    abbreviation: "CA",
    blm: "BLM California: dispersed camping allowed; " + BLM_STANDARD + " LTVAs in the desert district require a permit Sep 15–Apr 15.",
    nationalForest: "California NFs require a free California Campfire Permit for any stove/campfire on federal land; " + USFS_STANDARD,
    statePublicLand: "State parks: designated campsites only. State forests (e.g., Jackson, Latour): dispersed camping allowed with a free permit.",
    permit: "California Campfire Permit (free, online) required for any open flame, stove, or lantern outside developed campgrounds.",
    notes: "Fire restrictions and forest order closures change frequently; check the local ranger district daily.",
  },
  CO: {
    state: "Colorado",
    abbreviation: "CO",
    blm: "BLM Colorado: dispersed camping widely allowed; " + BLM_STANDARD + " Some Front Range and high-use units require designated-site only camping.",
    nationalForest: "Arapaho/Roosevelt, Pike/San Isabel, San Juan, White River, etc.: dispersed camping allowed except in posted dispersed-camping management areas; " + USFS_STANDARD,
    statePublicLand: "State parks: designated sites only. State Trust Land is mostly CLOSED to recreation (some leased to Colorado Parks & Wildlife).",
    notes: "Stage 1/2 fire bans common Jun–Sep; many CO units require a portable toilet/WAG bag.",
  },
  CT: {
    state: "Connecticut",
    abbreviation: "CT",
    statePublicLand: "State forests & parks: designated campgrounds only — no dispersed camping in CT.",
    notes: "Backcountry camping limited to a few permitted shelters on the Appalachian Trail and CFPA trails.",
  },
  DE: {
    state: "Delaware",
    abbreviation: "DE",
    statePublicLand: "State parks and forests: designated campgrounds only — no dispersed camping in DE.",
  },
  FL: {
    state: "Florida",
    abbreviation: "FL",
    nationalForest: "Apalachicola, Ocala, Osceola NFs: dispersed camping allowed outside developed recreation areas; 14-day limit.",
    statePublicLand: "State forests (FFS): primitive camping by reservation/permit only. State parks: designated sites only. WMAs: primitive camping during hunt seasons with proper licenses.",
    permit: "Florida Forest Service primitive camping permit required for state forest dispersed sites.",
  },
  GA: {
    state: "Georgia",
    abbreviation: "GA",
    nationalForest: "Chattahoochee-Oconee NFs: dispersed camping allowed outside developed sites; 14-day limit.",
    statePublicLand: "State parks: designated sites only. WMAs: primitive camping in designated areas, hunting license required during hunt seasons.",
  },
  HI: {
    state: "Hawaii",
    abbreviation: "HI",
    statePublicLand: "State parks & forest reserves: permit required for all camping; no dispersed camping. County parks: permits required, varies by island.",
    permit: "Permits via state Division of State Parks or county parks departments.",
    notes: "Boondocking on public land is essentially not legal in Hawaii — all camping is permit-based at designated sites.",
  },
  ID: {
    state: "Idaho",
    abbreviation: "ID",
    blm: "BLM Idaho: dispersed camping allowed; " + BLM_STANDARD,
    nationalForest: "Boise, Payette, Sawtooth, Salmon-Challis, Nez Perce-Clearwater, Caribou-Targhee, Idaho Panhandle NFs: dispersed allowed; " + USFS_STANDARD,
    statePublicLand: "Idaho Dept. of Lands endowment lands: day-use only on most parcels. State parks: designated sites only.",
  },
  IL: {
    state: "Illinois",
    abbreviation: "IL",
    nationalForest: "Shawnee NF: dispersed camping allowed outside developed areas; 14-day limit; no camping within 150 ft of trails/water/roads in some districts.",
    statePublicLand: "State parks & forests: designated campgrounds only.",
  },
  IN: {
    state: "Indiana",
    abbreviation: "IN",
    nationalForest: "Hoosier NF: dispersed camping allowed outside developed sites; 14-day limit.",
    statePublicLand: "State forests: primitive camping in designated backcountry areas with self-registration permit. State parks: designated sites only.",
    permit: "Self-registration permit required for state forest backcountry camping.",
  },
  IA: {
    state: "Iowa",
    abbreviation: "IA",
    statePublicLand: "State parks & forests: designated campgrounds only — no true dispersed camping. Some county parks allow primitive sites.",
  },
  KS: {
    state: "Kansas",
    abbreviation: "KS",
    statePublicLand: "State parks: designated sites. Wildlife areas: primitive camping in designated areas with a Kansas hunting/fishing license or WIHA pass.",
  },
  KY: {
    state: "Kentucky",
    abbreviation: "KY",
    nationalForest: "Daniel Boone NF: dispersed camping allowed outside posted areas; 14-day limit; no camping within 300 ft of developed facilities.",
    statePublicLand: "State forests: primitive camping allowed in some units. WMAs: primitive camping in designated areas during open seasons.",
  },
  LA: {
    state: "Louisiana",
    abbreviation: "LA",
    nationalForest: "Kisatchie NF: dispersed camping allowed; 14-day limit.",
    statePublicLand: "State parks: designated sites. WMAs (LDWF): self-clearing permit required, primitive camping in designated areas.",
    permit: "Free LDWF self-clearing permit required for WMA use.",
  },
  ME: {
    state: "Maine",
    abbreviation: "ME",
    statePublicLand: "Maine Public Reserved & Nonreserved Lands (Bureau of Parks & Lands): dispersed camping allowed in many units, often with a registration card.",
    permit: "Some BPL units require a permit/registration; check unit-specific rules.",
    notes: "Most private timberland (North Maine Woods) requires a permit and fee, even for dispersed camping.",
  },
  MD: {
    state: "Maryland",
    abbreviation: "MD",
    statePublicLand: "State forests (Garrett, Potomac-Garrett, Savage River, Green Ridge): designated dispersed sites with permit. State parks: designated campgrounds only.",
    permit: "Maryland DNR dispersed camping permit required for state forest sites.",
  },
  MA: {
    state: "Massachusetts",
    abbreviation: "MA",
    statePublicLand: "State forests & parks: designated campgrounds only — no dispersed camping in MA.",
  },
  MI: {
    state: "Michigan",
    abbreviation: "MI",
    nationalForest: "Hiawatha, Huron-Manistee, Ottawa NFs: dispersed camping allowed; 16-day limit (USFS local order).",
    statePublicLand: "State forests: dispersed camping allowed with a free Camp Registration Card; must be ≥1 mile from any state forest campground.",
    permit: "Free Michigan State Forest Camp Registration Card required for dispersed camping.",
  },
  MN: {
    state: "Minnesota",
    abbreviation: "MN",
    nationalForest: "Superior & Chippewa NFs: dispersed camping allowed; BWCAW requires advance permit (quota system).",
    statePublicLand: "State forests: dispersed camping allowed at designated dispersed sites (free, first-come). WMAs: camping generally NOT allowed.",
    permit: "BWCAW overnight permit required May–Sep.",
  },
  MS: {
    state: "Mississippi",
    abbreviation: "MS",
    nationalForest: "Bienville, Delta, De Soto, Holly Springs, Homochitto, Tombigbee NFs: dispersed camping allowed; 14-day limit.",
    statePublicLand: "State parks: designated sites. WMAs: primitive camping in designated areas with license.",
  },
  MO: {
    state: "Missouri",
    abbreviation: "MO",
    nationalForest: "Mark Twain NF: dispersed camping allowed outside developed sites; 14-day limit.",
    statePublicLand: "State forests & conservation areas (MDC): primitive camping allowed at designated sites; check each area's regulations.",
  },
  MT: {
    state: "Montana",
    abbreviation: "MT",
    blm: "BLM Montana: dispersed camping widely allowed; " + BLM_STANDARD,
    nationalForest: "Custer-Gallatin, Helena-Lewis & Clark, Beaverhead-Deerlodge, Bitterroot, Flathead, Kootenai, Lolo NFs: dispersed allowed; " + USFS_STANDARD,
    statePublicLand: "Montana DNRC state trust land: general recreation allowed with a State Lands Recreational Use License; camping up to 2 nights in one location.",
    permit: "MT State Lands Recreational Use License required for state trust land recreation.",
    notes: "Grizzly country — IGBC-approved bear-resistant food storage required across most NF/BLM land.",
  },
  NE: {
    state: "Nebraska",
    abbreviation: "NE",
    nationalForest: "Nebraska NF & Oglala NG: dispersed camping allowed; 14-day limit.",
    statePublicLand: "State parks/SRAs: designated sites with park entry permit. WMAs: primitive camping in designated areas only.",
  },
  NV: {
    state: "Nevada",
    abbreviation: "NV",
    blm: "BLM Nevada: dispersed camping widely allowed; " + BLM_STANDARD + " Special restrictions in Red Rock NCA and around Las Vegas.",
    nationalForest: "Humboldt-Toiyabe NF: dispersed allowed; " + USFS_STANDARD,
    statePublicLand: "State parks: designated sites only.",
    notes: "Extreme heat hazard May–Sep; carry far more water than you think.",
  },
  NH: {
    state: "New Hampshire",
    abbreviation: "NH",
    nationalForest: "White Mountain NF: dispersed camping allowed outside Forest Protection Areas (FPAs); 14-day limit; no camping above treeline or within 200 ft of trails/water/roads in FPAs.",
    statePublicLand: "State forests & parks: designated campgrounds only.",
    notes: "Above-treeline camping is prohibited in WMNF except on 2 ft of snow.",
  },
  NJ: {
    state: "New Jersey",
    abbreviation: "NJ",
    statePublicLand: "State parks & forests: designated campgrounds only — no dispersed camping in NJ.",
  },
  NM: {
    state: "New Mexico",
    abbreviation: "NM",
    blm: "BLM New Mexico: dispersed camping widely allowed; " + BLM_STANDARD,
    nationalForest: "Carson, Cibola, Gila, Lincoln, Santa Fe NFs: dispersed allowed; " + USFS_STANDARD,
    statePublicLand: "NM State Trust Land: recreation allowed with a State Land Office recreational access permit; some parcels closed.",
    permit: "NM State Land Office Recreational Access Permit required for state trust land.",
  },
  NY: {
    state: "New York",
    abbreviation: "NY",
    statePublicLand: "Adirondack & Catskill Forest Preserve: dispersed camping allowed at-large for ≤3 nights and parties ≤9; longer stays/larger groups require a DEC permit. Camp ≥150 ft from roads/trails/water unless at a designated site.",
    permit: "DEC permit required for stays >3 nights or groups >9.",
    notes: "Bear canisters REQUIRED in the Eastern High Peaks Wilderness Apr 1–Nov 30.",
  },
  NC: {
    state: "North Carolina",
    abbreviation: "NC",
    nationalForest: "Pisgah, Nantahala, Uwharrie, Croatan NFs: dispersed camping allowed outside posted Forest Protection Areas; 14-day limit.",
    statePublicLand: "State parks: designated sites. State game lands: primitive camping in designated areas during open seasons with a license.",
  },
  ND: {
    state: "North Dakota",
    abbreviation: "ND",
    nationalForest: "Dakota Prairie Grasslands (Little Missouri, Sheyenne NGs): dispersed camping allowed; 14-day limit.",
    statePublicLand: "State parks: designated sites. WMAs (NDGF): camping for hunting/fishing only, 10-day limit in any 21-day period.",
  },
  OH: {
    state: "Ohio",
    abbreviation: "OH",
    nationalForest: "Wayne NF: dispersed camping allowed outside developed sites; 14-day limit.",
    statePublicLand: "State forests: primitive camping in designated backpack/horse camps with self-registration. State parks: designated sites only.",
    permit: "Self-registration required for state forest backpack camps.",
  },
  OK: {
    state: "Oklahoma",
    abbreviation: "OK",
    nationalForest: "Ouachita NF (OK portion): dispersed camping allowed; 14-day limit.",
    statePublicLand: "State parks: designated sites. WMAs (ODWC): primitive camping in designated areas, license required, 14-day limit.",
  },
  OR: {
    state: "Oregon",
    abbreviation: "OR",
    blm: "BLM Oregon: dispersed camping widely allowed; " + BLM_STANDARD,
    nationalForest: "Mt. Hood, Willamette, Deschutes, Umpqua, Rogue River-Siskiyou, Wallowa-Whitman, etc.: dispersed allowed; " + USFS_STANDARD + " Many high-use trailhead corridors require designated dispersed sites only.",
    statePublicLand: "Oregon State Forests: dispersed camping allowed in many districts at designated dispersed sites only; check ODF district map. State parks: designated sites only.",
    notes: "Public Use Restrictions (PURs) during summer often ban open fires forest-wide.",
  },
  PA: {
    state: "Pennsylvania",
    abbreviation: "PA",
    nationalForest: "Allegheny NF: dispersed camping allowed; 14-day limit; no camping within 1500 ft of developed sites without a permit.",
    statePublicLand: "PA State Forests (DCNR): dispersed camping allowed for 1 night without a permit; 2+ nights or groups of 10+ require a free Letter of Authorization. State parks: designated sites only.",
    permit: "DCNR Letter of Authorization (free) required for stays >1 night on state forest land.",
  },
  RI: {
    state: "Rhode Island",
    abbreviation: "RI",
    statePublicLand: "State parks & management areas: designated campgrounds only — no dispersed camping in RI.",
  },
  SC: {
    state: "South Carolina",
    abbreviation: "SC",
    nationalForest: "Francis Marion & Sumter NFs: dispersed camping allowed outside posted closures; 14-day limit.",
    statePublicLand: "State parks: designated sites. WMAs: primitive camping in designated areas only with license.",
  },
  SD: {
    state: "South Dakota",
    abbreviation: "SD",
    blm: "BLM South Dakota (limited parcels): dispersed allowed; " + BLM_STANDARD,
    nationalForest: "Black Hills NF: dispersed camping allowed outside fee areas and posted closures; " + USFS_STANDARD + " Buffalo Gap & Grand River NGs also allow dispersed.",
    statePublicLand: "Custer State Park: designated sites only (no dispersed). State Game Production Areas: camping NOT allowed.",
  },
  TN: {
    state: "Tennessee",
    abbreviation: "TN",
    nationalForest: "Cherokee NF: dispersed camping allowed outside developed sites; 14-day limit; no camping within 100 ft of trails/water in some districts.",
    statePublicLand: "State forests: primitive camping in some units with permit. WMAs (TWRA): primitive camping in designated areas with license.",
  },
  TX: {
    state: "Texas",
    abbreviation: "TX",
    nationalForest: "Angelina, Davy Crockett, Sabine, Sam Houston NFs: dispersed camping allowed; 14-day limit.",
    statePublicLand: "State parks: designated sites only. Public lands (TPWD WMAs): camping requires Annual Public Hunting permit or Limited Public Use permit.",
    permit: "TPWD APH or LPU permit required to camp on most state WMAs.",
    notes: "Texas is mostly private — boondocking options are very limited outside the 4 east-Texas NFs and a few BLM/USACE parcels.",
  },
  UT: {
    state: "Utah",
    abbreviation: "UT",
    blm: "BLM Utah: dispersed camping widely allowed; " + BLM_STANDARD + " Designated-site-only rules around Moab (Sand Flats), San Rafael Swell, and Indian Creek.",
    nationalForest: "Ashley, Dixie, Fishlake, Manti-La Sal, Uinta-Wasatch-Cache NFs: dispersed allowed; " + USFS_STANDARD,
    statePublicLand: "Utah SITLA (state trust) lands: open to dispersed camping unless posted; some require a permit. State parks: designated sites only.",
    notes: "Human waste must be packed out in the canyon country (Cedar Mesa, Indian Creek, much of Moab BLM).",
  },
  VT: {
    state: "Vermont",
    abbreviation: "VT",
    nationalForest: "Green Mountain NF: dispersed camping allowed; 14-day limit; ≥200 ft from trails/water; no camping above 2,500 ft elevation in some areas.",
    statePublicLand: "State forests/parks: primitive backpack camping allowed on most state forests ≥200 ft from trails/roads/water; state parks designated sites only.",
  },
  VA: {
    state: "Virginia",
    abbreviation: "VA",
    nationalForest: "George Washington & Jefferson NFs: dispersed camping allowed outside developed sites; 14-day limit.",
    statePublicLand: "State forests (DOF): primitive camping by permit only. State parks: designated sites. WMAs (DWR): a $4 access permit required if not licensed; camping for hunting/fishing.",
    permit: "DWR Restore the Wild / access permit for WMAs; DOF permit for state forests.",
  },
  WA: {
    state: "Washington",
    abbreviation: "WA",
    blm: "BLM Washington (limited parcels): dispersed allowed; " + BLM_STANDARD,
    nationalForest: "Mt. Baker-Snoqualmie, Okanogan-Wenatchee, Olympic, Gifford Pinchot, Colville NFs: dispersed allowed; " + USFS_STANDARD + " NW Forest Pass required at many trailheads.",
    statePublicLand: "WA DNR state forests: dispersed camping allowed at designated dispersed sites; Discover Pass required. State parks: designated sites only.",
    permit: "WA Discover Pass required to park on DNR/State Parks land.",
  },
  WV: {
    state: "West Virginia",
    abbreviation: "WV",
    nationalForest: "Monongahela NF: dispersed camping allowed; 14-day limit; ≥300 ft from designated wilderness trailheads.",
    statePublicLand: "State forests: primitive camping at designated sites with permit. State parks: designated sites only.",
    permit: "WV state forest dispersed camping permit required.",
  },
  WI: {
    state: "Wisconsin",
    abbreviation: "WI",
    nationalForest: "Chequamegon-Nicolet NF: dispersed camping allowed; 14-day limit.",
    statePublicLand: "State forests (DNR): dispersed camping allowed at designated dispersed sites; permit required. State parks: designated sites only.",
    permit: "Free DNR dispersed camping permit (self-register) on most state forests.",
  },
  WY: {
    state: "Wyoming",
    abbreviation: "WY",
    blm: "BLM Wyoming: dispersed camping widely allowed; " + BLM_STANDARD,
    nationalForest: "Bridger-Teton, Shoshone, Bighorn, Medicine Bow-Routt, Black Hills NFs: dispersed allowed; " + USFS_STANDARD,
    statePublicLand: "WY State Trust Land: day-use only by default; overnight camping prohibited unless specifically authorized.",
    notes: "Grizzly country in NW Wyoming — IGBC-approved bear-resistant food storage required.",
  },
  DC: {
    state: "District of Columbia",
    abbreviation: "DC",
    statePublicLand: "No public boondocking — all camping on DC park land is prohibited.",
  },
};

interface StateBBox {
  abbreviation: string;
  south: number;
  west: number;
  north: number;
  east: number;
}

const STATE_BBOXES: StateBBox[] = [
  { abbreviation: "AL", south: 30.137, west: -88.473, north: 35.008, east: -84.889 },
  { abbreviation: "AK", south: 51.214, west: -179.148, north: 71.538, east: -129.974 },
  { abbreviation: "AZ", south: 31.332, west: -114.819, north: 37.004, east: -109.045 },
  { abbreviation: "AR", south: 33.004, west: -94.617, north: 36.499, east: -89.644 },
  { abbreviation: "CA", south: 32.534, west: -124.482, north: 42.009, east: -114.131 },
  { abbreviation: "CO", south: 36.992, west: -109.060, north: 41.003, east: -102.041 },
  { abbreviation: "CT", south: 40.985, west: -73.727, north: 42.050, east: -71.787 },
  { abbreviation: "DE", south: 38.451, west: -75.789, north: 39.839, east: -75.048 },
  { abbreviation: "DC", south: 38.791, west: -77.119, north: 38.996, east: -76.909 },
  { abbreviation: "FL", south: 24.523, west: -87.634, north: 31.001, east: -80.031 },
  { abbreviation: "GA", south: 30.357, west: -85.605, north: 35.000, east: -80.840 },
  { abbreviation: "HI", south: 18.917, west: -160.250, north: 22.236, east: -154.806 },
  { abbreviation: "ID", south: 41.988, west: -117.243, north: 49.001, east: -111.044 },
  { abbreviation: "IL", south: 36.971, west: -91.513, north: 42.508, east: -87.495 },
  { abbreviation: "IN", south: 37.772, west: -88.098, north: 41.761, east: -84.785 },
  { abbreviation: "IA", south: 40.375, west: -96.640, north: 43.501, east: -90.140 },
  { abbreviation: "KS", south: 36.993, west: -102.052, north: 40.003, east: -94.589 },
  { abbreviation: "KY", south: 36.497, west: -89.572, north: 39.147, east: -81.964 },
  { abbreviation: "LA", south: 28.929, west: -94.043, north: 33.020, east: -88.817 },
  { abbreviation: "ME", south: 43.064, west: -71.084, north: 47.460, east: -66.949 },
  { abbreviation: "MD", south: 37.886, west: -79.487, north: 39.723, east: -75.048 },
  { abbreviation: "MA", south: 41.187, west: -73.508, north: 42.886, east: -69.928 },
  { abbreviation: "MI", south: 41.696, west: -90.418, north: 48.306, east: -82.122 },
  { abbreviation: "MN", south: 43.499, west: -97.239, north: 49.384, east: -89.491 },
  { abbreviation: "MS", south: 30.174, west: -91.655, north: 34.996, east: -88.097 },
  { abbreviation: "MO", south: 35.995, west: -95.774, north: 40.613, east: -89.099 },
  { abbreviation: "MT", south: 44.358, west: -116.050, north: 49.001, east: -104.039 },
  { abbreviation: "NE", south: 39.999, west: -104.053, north: 43.001, east: -95.308 },
  { abbreviation: "NV", south: 35.001, west: -120.006, north: 42.000, east: -114.040 },
  { abbreviation: "NH", south: 42.696, west: -72.557, north: 45.305, east: -70.610 },
  { abbreviation: "NJ", south: 38.928, west: -75.560, north: 41.357, east: -73.894 },
  { abbreviation: "NM", south: 31.332, west: -109.050, north: 37.000, east: -103.002 },
  { abbreviation: "NY", south: 40.496, west: -79.762, north: 45.015, east: -71.856 },
  { abbreviation: "NC", south: 33.842, west: -84.322, north: 36.588, east: -75.460 },
  { abbreviation: "ND", south: 45.935, west: -104.049, north: 49.001, east: -96.554 },
  { abbreviation: "OH", south: 38.403, west: -84.820, north: 41.978, east: -80.518 },
  { abbreviation: "OK", south: 33.616, west: -103.002, north: 37.002, east: -94.430 },
  { abbreviation: "OR", south: 41.992, west: -124.703, north: 46.292, east: -116.463 },
  { abbreviation: "PA", south: 39.720, west: -80.519, north: 42.514, east: -74.690 },
  { abbreviation: "RI", south: 41.146, west: -71.862, north: 42.019, east: -71.120 },
  { abbreviation: "SC", south: 32.034, west: -83.354, north: 35.215, east: -78.541 },
  { abbreviation: "SD", south: 42.482, west: -104.058, north: 45.945, east: -96.439 },
  { abbreviation: "TN", south: 34.983, west: -90.310, north: 36.679, east: -81.647 },
  { abbreviation: "TX", south: 25.837, west: -106.646, north: 36.501, east: -93.508 },
  { abbreviation: "UT", south: 36.998, west: -114.053, north: 42.002, east: -109.041 },
  { abbreviation: "VT", south: 42.726, west: -73.438, north: 45.017, east: -71.466 },
  { abbreviation: "VA", south: 36.541, west: -83.675, north: 39.466, east: -75.243 },
  { abbreviation: "WA", south: 45.544, west: -124.848, north: 49.002, east: -116.916 },
  { abbreviation: "WV", south: 37.202, west: -82.644, north: 40.638, east: -77.719 },
  { abbreviation: "WI", south: 42.491, west: -92.889, north: 47.080, east: -86.249 },
  { abbreviation: "WY", south: 40.995, west: -111.056, north: 45.006, east: -104.052 },
];

export function findStateAbbreviationForCoordinate(coord: LatLng): string | null {
  const candidates: StateBBox[] = [];
  for (const bbox of STATE_BBOXES) {
    if (
      coord.lat >= bbox.south &&
      coord.lat <= bbox.north &&
      coord.lng >= bbox.west &&
      coord.lng <= bbox.east
    ) {
      candidates.push(bbox);
    }
  }
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0].abbreviation;

  let bestAbbr = candidates[0].abbreviation;
  let bestDistanceSq = Infinity;
  for (const bbox of candidates) {
    const centerLat = (bbox.south + bbox.north) / 2;
    const centerLng = (bbox.west + bbox.east) / 2;
    const dLat = coord.lat - centerLat;
    const dLng = coord.lng - centerLng;
    const distanceSq = dLat * dLat + dLng * dLng;
    if (distanceSq < bestDistanceSq) {
      bestDistanceSq = distanceSq;
      bestAbbr = bbox.abbreviation;
    }
  }
  return bestAbbr;
}

export function getStateBoondockingRules(coord: LatLng): StateBoondockingRules | null {
  const abbreviation = findStateAbbreviationForCoordinate(coord);
  if (!abbreviation) return null;
  return STATE_BOONDOCKING_RULES[abbreviation] ?? null;
}

export function summarizeStateRules(
  rules: StateBoondockingRules,
  kind: BoondockLandKind,
): string {
  const lines: string[] = [`${rules.state} boondocking rules:`];

  switch (kind) {
    case "blm":
      if (rules.blm) lines.push(`• BLM — ${rules.blm}`);
      break;
    case "national_forest":
      if (rules.nationalForest) lines.push(`• National Forest — ${rules.nationalForest}`);
      break;
    case "state_forest":
    case "state_park":
    case "state_trust":
    case "wma":
      if (rules.statePublicLand) lines.push(`• State land — ${rules.statePublicLand}`);
      break;
    case "national_park":
      lines.push("• National Park — backcountry permits required; no off-trail boondocking outside permitted zones.");
      break;
    case "protected_area":
    case "nature_reserve":
      if (rules.statePublicLand) lines.push(`• Public land — ${rules.statePublicLand}`);
      if (rules.nationalForest) lines.push(`• Adjacent NF rule of thumb — ${rules.nationalForest}`);
      break;
    case "established_campsite":
    case "caravan_site":
    case "camp_pitch":
    case "wilderness_hut":
    case "shelter":
    case "dispersed_tag":
      if (rules.statePublicLand) lines.push(`• State context — ${rules.statePublicLand}`);
      break;
  }

  if (rules.permit) lines.push(`• Permits — ${rules.permit}`);
  if (rules.notes) lines.push(`• Note — ${rules.notes}`);

  return lines.join(" ");
}

export function classifyBoondockLand(tags: Record<string, string>): BoondockLandKind | null {
  const tourism = tags.tourism;
  if (tourism === "camp_site") return "established_campsite";
  if (tourism === "caravan_site") return "caravan_site";
  if (tourism === "camp_pitch") return "camp_pitch";
  if (tourism === "wilderness_hut") return "wilderness_hut";

  if (tags.leisure === "dispersed_camping") return "dispersed_tag";

  if (tags.amenity === "shelter") {
    const type = tags.shelter_type;
    if (type === "basic_hut" || type === "lean_to" || type === "weather_shelter") {
      return "shelter";
    }
  }

  const operator = (tags.operator ?? "").toLowerCase();
  const name = (tags.name ?? "").toLowerCase();
  const ownership = (tags.ownership ?? "").toLowerCase();
  const boundary = tags.boundary;
  const protectClass = tags.protect_class;

  const isBlmOperator = /bureau of land management|\bblm\b/.test(operator);
  const isUsfsOperator = /forest service|\busfs\b/.test(operator);
  const isNpsOperator = /national park service|\bnps\b/.test(operator);

  if (isBlmOperator) return "blm";
  if (isUsfsOperator) return "national_forest";
  if (isNpsOperator) return "national_park";

  if (/\bnational forest\b/.test(name)) return "national_forest";
  if (/\bnational grassland\b/.test(name)) return "national_forest";
  if (/\bnational park\b/.test(name)) return "national_park";
  if (/\bwildlife management area\b|\bwma\b/.test(name)) return "wma";
  if (/\bstate forest\b/.test(name)) return "state_forest";
  if (/\bstate park\b/.test(name)) return "state_park";
  if (/\bstate trust\b|\btrust land\b|\bschool trust\b/.test(name)) return "state_trust";

  if (boundary === "national_park") return "national_park";

  if (boundary === "protected_area") {
    if (protectClass === "6") return "national_forest";
    if (protectClass === "4" || protectClass === "14") return "wma";
    if (ownership === "national") return "national_forest";
    if (ownership === "state") return "state_forest";
    return "protected_area";
  }

  if (tags.leisure === "nature_reserve") return "nature_reserve";

  return null;
}

export function labelForBoondockLand(kind: BoondockLandKind): string {
  switch (kind) {
    case "established_campsite":
      return "Established campsite";
    case "caravan_site":
      return "Caravan / RV site";
    case "camp_pitch":
      return "Camp pitch";
    case "wilderness_hut":
      return "Wilderness hut";
    case "shelter":
      return "Backcountry shelter";
    case "dispersed_tag":
      return "Dispersed-camping area";
    case "blm":
      return "BLM land (boondocking)";
    case "national_forest":
      return "National Forest (dispersed camping)";
    case "national_park":
      return "National Park (permit required)";
    case "state_forest":
      return "State forest";
    case "state_park":
      return "State park";
    case "state_trust":
      return "State trust land";
    case "wma":
      return "Wildlife Management Area";
    case "nature_reserve":
      return "Nature reserve";
    case "protected_area":
      return "Protected area";
  }
}
