// ========================================================
// UrbanSync - Municipal Zone Configuration for Bokaro Steel City
// Location: Bokaro Steel City, Jharkhand, India
// Center Reference: [23.6693° N, 86.1511° E]
// ========================================================

export const ZONE_CONFIG = {
  'Zone 1 - North Bokaro': {
    areas: ['Sector 1', 'Sector 2', 'Bokaro Mall', 'Ram Mandir', 'Aerodrome', 'Sector 1 Market'],
    keywords: ['sector 1', 'sector 2', 'bokaro mall', 'ram mandir', 'aerodrome', 'sec 1', 'sec 2', 'north']
  },
  'Zone 2 - South Bokaro': {
    areas: ['Sector 11', 'Sector 12', 'Camp 2', 'Balidih Industrial Area', 'Bokaro Railway Station'],
    keywords: ['sector 11', 'sector 12', 'camp 2', 'balidih', 'station', 'sec 11', 'sec 12', 'south']
  },
  'Zone 3 - East Bokaro': {
    areas: ['Sector 8', 'Sector 9', 'Harla', 'Noori Masjid', 'Sector 9 Market', 'Sector 9 Hospital'],
    keywords: ['sector 8', 'sector 9', 'harla', 'noori masjid', 'sec 8', 'sec 9', 'east']
  },
  'Zone 4 - West Bokaro': {
    areas: ['Sector 5', 'Sector 6', 'Steel Plant Township Gates', 'Maa Vaishno Devi Temple'],
    keywords: ['sector 5', 'sector 6', 'steel plant', 'vaishno devi', 'sec 5', 'sec 6', 'west']
  },
  'Zone 5 - Central Bokaro': {
    areas: ['City Centre', 'Sector 4', 'Sector 3', 'City Park', 'Jagannath Temple', 'Jawaharlal Nehru Biological Park'],
    keywords: ['city centre', 'city center', 'sector 4', 'sector 3', 'city park', 'jagannath', 'nehru park', 'zoo', 'sec 4', 'sec 3', 'central']
  }
};

// Auto-detect zone from address string
export function detectZone(address) {
  if (!address) return 'Zone 5 - Central Bokaro';

  const addressLower = address.toLowerCase();

  for (const [zoneName, config] of Object.entries(ZONE_CONFIG)) {
    for (const keyword of config.keywords) {
      if (addressLower.includes(keyword)) {
        return zoneName;
      }
    }
  }

  return 'Zone 5 - Central Bokaro'; // Default fallback
}

// --------------------------------------------
// STRICT GEOFENCING SETTINGS FOR BOKARO STEEL CITY
// --------------------------------------------
export const DEV_MODE = true; // Set to false for strict production geofencing

export const BOKARO_BOUNDS = {
  minLat: 23.6200,
  maxLat: 23.7200,
  minLng: 86.0800,
  maxLng: 86.2200
};

// Backwards-compatible alias if referenced elsewhere
export const GONDA_BOUNDS = BOKARO_BOUNDS;

// Auto-detect zone from GPS coordinates
export function detectZoneFromCoordinates(lat, lng) {
  if (!lat || !lng) return null;

  const numLat = parseFloat(lat);
  const numLng = parseFloat(lng);

  // 1. Check Strict Bounds (Ignore in Dev Mode)
  if (!DEV_MODE) {
    if (numLat < BOKARO_BOUNDS.minLat || numLat > BOKARO_BOUNDS.maxLat ||
        numLng < BOKARO_BOUNDS.minLng || numLng > BOKARO_BOUNDS.maxLng) {
      console.log(`📍 Rejected: ${numLat}, ${numLng} is outside Bokaro Steel City jurisdiction.`);
      return null; // OUTSIDE SERVICE AREA
    }
  } else {
    console.log('🚧 DEV_MODE: Ignoring GPS bounds check.');
  }

  // 2. Assign Internal Bokaro Operational Zones
  if (numLat > 23.6800) return 'Zone 1 - North Bokaro';
  if (numLat < 23.6550) return 'Zone 2 - South Bokaro';
  if (numLng > 86.1750) return 'Zone 3 - East Bokaro';
  if (numLng < 86.1300) return 'Zone 4 - West Bokaro';

  return 'Zone 5 - Central Bokaro';
}
