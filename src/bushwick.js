/**
 * Bushwick Feature - Zooms Leaflet map to Bushwick, Brooklyn, NY
 * @module bushwick
 */

/**
 * Bushwick neighborhood coordinates and boundaries
 * @constant {Object}
 */
const BUSHWICK_CONFIG = {
  center: {
    lat: 40.6942,
    lng: -73.9196
  },
  bounds: {
    north: 40.7120,
    south: 40.6764,
    east: -73.9040,
    west: -73.9352
  },
  defaultZoom: 14,
  minZoom: 12,
  maxZoom: 18
};

/**
 * Validates if coordinates are within valid ranges
 * @param {number} lat - Latitude
 * @param {number} lng - Longitude
 * @returns {boolean} True if coordinates are valid
 */
function isValidCoordinate(lat, lng) {
  return (
    typeof lat === 'number' &&
    typeof lng === 'number' &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180
  );
}

/**
 * Validates if a Leaflet map instance is valid
 * @param {Object} map - Leaflet map instance
 * @returns {boolean} True if map is valid
 */
function isValidLeafletMap(map) {
  return (
    map &&
    typeof map === 'object' &&
    typeof map.setView === 'function' &&
    typeof map.fitBounds === 'function'
  );
}

/**
 * Zooms the Leaflet map to Bushwick neighborhood center
 * @param {Object} map - Leaflet map instance
 * @param {Object} [options={}] - Zoom options
 * @param {number} [options.zoom] - Zoom level (defaults to 14)
 * @param {boolean} [options.animate=true] - Whether to animate the zoom
 * @param {number} [options.duration=1] - Animation duration in seconds
 * @returns {Object|null} Map instance for chaining, or null if invalid
 */
function zoomToBushwick(map, options = {}) {
  if (!isValidLeafletMap(map)) {
    console.error('Invalid Leaflet map instance provided');
    return null;
  }

  const {
    zoom = BUSHWICK_CONFIG.defaultZoom,
    animate = true,
    duration = 1
  } = options;

  const zoomLevel = Math.max(
    BUSHWICK_CONFIG.minZoom,
    Math.min(BUSHWICK_CONFIG.maxZoom, zoom)
  );

  try {
    map.setView(
      [BUSHWICK_CONFIG.center.lat, BUSHWICK_CONFIG.center.lng],
      zoomLevel,
      {
        animate,
        duration
      }
    );
    return map;
  } catch (error) {
    console.error('Error zooming to Bushwick:', error);
    return null;
  }
}

/**
 * Fits the Leaflet map to Bushwick neighborhood bounds
 * @param {Object} map - Leaflet map instance
 * @param {Object} [options={}] - Fit bounds options
 * @param {number} [options.padding=[50, 50]] - Padding in pixels [top/bottom, left/right]
 * @param {boolean} [options.animate=true] - Whether to animate the fit
 * @param {number} [options.maxZoom] - Maximum zoom level when fitting
 * @returns {Object|null} Map instance for chaining, or null if invalid
 */
function fitToBushwickBounds(map, options = {}) {
  if (!isValidLeafletMap(map)) {
    console.error('Invalid Leaflet map instance provided');
    return null;
  }

  const {
    padding = [50, 50],
    animate = true,
    maxZoom = BUSHWICK_CONFIG.maxZoom
  } = options;

  const bounds = [
    [BUSHWICK_CONFIG.bounds.south, BUSHWICK_CONFIG.bounds.west],
    [BUSHWICK_CONFIG.bounds.north, BUSHWICK_CONFIG.bounds.east]
  ];

  try {
    map.fitBounds(bounds, {
      padding,
      animate,
      maxZoom
    });
    return map;
  } catch (error) {
    console.error('Error fitting to Bushwick bounds:', error);
    return null;
  }
}

/**
 * Gets the Bushwick neighborhood configuration
 * @returns {Object} Bushwick configuration object
 */
function getBushwickConfig() {
  return JSON.parse(JSON.stringify(BUSHWICK_CONFIG));
}

/**
 * Checks if given coordinates are within Bushwick bounds
 * @param {number} lat - Latitude
 * @param {number} lng - Longitude
 * @returns {boolean} True if coordinates are within Bushwick
 */
function isInBushwick(lat, lng) {
  if (!isValidCoordinate(lat, lng)) {
    return false;
  }

  return (
    lat >= BUSHWICK_CONFIG.bounds.south &&
    lat <= BUSHWICK_CONFIG.bounds.north &&
    lng >= BUSHWICK_CONFIG.bounds.west &&
    lng <= BUSHWICK_CONFIG.bounds.east
  );
}

/**
 * Main Bushwick feature object
 * @namespace
 */
const Bushwick = {
  zoomToBushwick,
  fitToBushwickBounds,
  getBushwickConfig,
  isInBushwick,
  config: BUSHWICK_CONFIG
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = Bushwick;
}

if (typeof window !== 'undefined') {
  window.Bushwick = Bushwick;
}