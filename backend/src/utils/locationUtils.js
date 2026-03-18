/**
 * Location utility functions for distance calculations and radius verification
 */

/**
 * Calculate the distance between two coordinates using the Haversine formula
 * @param {Array} coords1 - First coordinates [longitude, latitude]
 * @param {Array} coords2 - Second coordinates [longitude, latitude]
 * @returns {number} Distance in meters
 */
function calculateDistance(coords1, coords2) {
  const [lon1, lat1] = coords1;
  const [lon2, lat2] = coords2;

  const R = 6371e3; // Earth's radius in meters
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lon2 - lon1) * Math.PI) / 180;

  const a =
    Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c; // Distance in meters
}

/**
 * Check if a point is within a specified radius of another point
 * @param {Array} coords1 - First coordinates [longitude, latitude]
 * @param {Array} coords2 - Second coordinates [longitude, latitude]
 * @param {number} radiusMeters - Radius in meters (default: 500)
 * @returns {boolean} True if within radius
 */
function isWithinRadius(coords1, coords2, radiusMeters = 500) {
  const distance = calculateDistance(coords1, coords2);
  return distance <= radiusMeters;
}

/**
 * Convert degrees to radians
 * @param {number} degrees - Angle in degrees
 * @returns {number} Angle in radians
 */
function toRadians(degrees) {
  return (degrees * Math.PI) / 180;
}

/**
 * Convert radians to degrees
 * @param {number} radians - Angle in radians
 * @returns {number} Angle in degrees
 */
function toDegrees(radians) {
  return (radians * 180) / Math.PI;
}

/**
 * Get a bounding box for a location and radius (useful for initial filtering)
 * @param {Array} coords - Center coordinates [longitude, latitude]
 * @param {number} radiusMeters - Radius in meters
 * @returns {Object} Bounding box with minLat, maxLat, minLon, maxLon
 */
function getBoundingBox(coords, radiusMeters) {
  const [lon, lat] = coords;
  const R = 6371e3; // Earth's radius in meters

  // Angular distance in radians
  const angularDistance = radiusMeters / R;

  const latRad = toRadians(lat);
  const lonRad = toRadians(lon);

  const minLat = toDegrees(latRad - angularDistance);
  const maxLat = toDegrees(latRad + angularDistance);

  // Calculate longitude bounds (accounting for latitude)
  const deltaLon = Math.asin(Math.sin(angularDistance) / Math.cos(latRad));
  const minLon = toDegrees(lonRad - deltaLon);
  const maxLon = toDegrees(lonRad + deltaLon);

  return {
    minLat,
    maxLat,
    minLon,
    maxLon
  };
}

/**
 * Format distance for display
 * @param {number} meters - Distance in meters
 * @returns {string} Formatted distance string
 */
function formatDistance(meters) {
  if (meters < 1000) {
    return `${Math.round(meters)} m`;
  }
  return `${(meters / 1000).toFixed(2)} km`;
}

/**
 * Validate coordinates
 * @param {number} latitude - Latitude value
 * @param {number} longitude - Longitude value
 * @returns {boolean} True if valid coordinates
 */
function isValidCoordinates(latitude, longitude) {
  return (
    typeof latitude === 'number' &&
    typeof longitude === 'number' &&
    latitude >= -90 &&
    latitude <= 90 &&
    longitude >= -180 &&
    longitude <= 180
  );
}

/**
 * Parse coordinates from various formats
 * @param {*} input - Coordinates input (can be array, object, or string)
 * @returns {Array|null} Coordinates as [longitude, latitude] or null if invalid
 */
function parseCoordinates(input) {
  if (Array.isArray(input) && input.length === 2) {
    const [lon, lat] = input.map(Number);
    if (isValidCoordinates(lat, lon)) {
      return [lon, lat];
    }
  }

  if (input && typeof input === 'object') {
    if (input.coordinates && Array.isArray(input.coordinates)) {
      return parseCoordinates(input.coordinates);
    }
    if (input.longitude !== undefined && input.latitude !== undefined) {
      const lon = Number(input.longitude);
      const lat = Number(input.latitude);
      if (isValidCoordinates(lat, lon)) {
        return [lon, lat];
      }
    }
    if (input.lng !== undefined && input.lat !== undefined) {
      const lon = Number(input.lng);
      const lat = Number(input.lat);
      if (isValidCoordinates(lat, lon)) {
        return [lon, lat];
      }
    }
  }

  return null;
}

module.exports = {
  calculateDistance,
  isWithinRadius,
  toRadians,
  toDegrees,
  getBoundingBox,
  formatDistance,
  isValidCoordinates,
  parseCoordinates
};
