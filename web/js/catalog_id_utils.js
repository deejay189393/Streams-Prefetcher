/**
 * Catalog ID Utilities
 * Centralized management for catalog ID format and parsing.
 *
 * FORMAT: "addon_url|catalog_id|catalog_type"
 * Example: "http://aiostreams:3000/manifest|movies-top|movie"
 *
 * IMPORTANT: This logic must match the Python implementation in src/catalog_id_utils.py
 */

const CATALOG_ID_SEPARATOR = '|';
const CATALOG_ID_EXPECTED_PARTS = 3;

/**
 * Create a full catalog ID from its component parts.
 *
 * @param {string} addonUrl - Full URL to the addon
 * @param {string} catalogId - Unique identifier for the catalog
 * @param {string} catalogType - Type of catalog (movie, series, mixed)
 * @returns {string} Full catalog ID in format "addon_url|catalog_id|catalog_type"
 *
 * @example
 * createCatalogId("http://example.com", "movies-top", "movie")
 * // Returns: "http://example.com|movies-top|movie"
 */
function createCatalogId(addonUrl, catalogId, catalogType) {
    return `${addonUrl}${CATALOG_ID_SEPARATOR}${catalogId}${CATALOG_ID_SEPARATOR}${catalogType}`;
}

/**
 * Parse a full catalog ID into its component parts.
 *
 * @param {string} fullId - Full catalog ID in format "addon_url|catalog_id|catalog_type"
 * @returns {Object} Object with keys: addonUrl, catalogId, catalogType (null if parsing fails)
 *
 * @example
 * parseCatalogId("http://example.com|movies-top|movie")
 * // Returns: {addonUrl: "http://example.com", catalogId: "movies-top", catalogType: "movie"}
 */
function parseCatalogId(fullId) {
    const parts = fullId.split(CATALOG_ID_SEPARATOR);

    if (parts.length !== CATALOG_ID_EXPECTED_PARTS) {
        return {
            addonUrl: null,
            catalogId: null,
            catalogType: null
        };
    }

    return {
        addonUrl: parts[0],
        catalogId: parts[1],
        catalogType: parts[2]
    };
}

/**
 * Extract just the catalog_id from a full catalog ID.
 *
 * @param {string} fullId - Full catalog ID in format "addon_url|catalog_id|catalog_type"
 * @returns {string} The catalog_id portion (middle part), empty string if parsing fails
 *
 * @example
 * getCatalogIdPart("http://example.com|movies-top|movie")
 * // Returns: "movies-top"
 */
function getCatalogIdPart(fullId) {
    const parts = fullId.split(CATALOG_ID_SEPARATOR);
    if (parts.length !== CATALOG_ID_EXPECTED_PARTS) {
        return '';
    }
    return parts[1];
}

/**
 * Extract just the addon_url from a full catalog ID.
 *
 * @param {string} fullId - Full catalog ID in format "addon_url|catalog_id|catalog_type"
 * @returns {string} The addon_url portion (first part), empty string if parsing fails
 *
 * @example
 * getAddonUrlPart("http://example.com|movies-top|movie")
 * // Returns: "http://example.com"
 */
function getAddonUrlPart(fullId) {
    const parts = fullId.split(CATALOG_ID_SEPARATOR);
    if (parts.length !== CATALOG_ID_EXPECTED_PARTS) {
        return '';
    }
    return parts[0];
}

/**
 * Extract just the catalog_type from a full catalog ID.
 *
 * @param {string} fullId - Full catalog ID in format "addon_url|catalog_id|catalog_type"
 * @returns {string} The catalog_type portion (last part), empty string if parsing fails
 *
 * @example
 * getCatalogTypePart("http://example.com|movies-top|movie")
 * // Returns: "movie"
 */
function getCatalogTypePart(fullId) {
    const parts = fullId.split(CATALOG_ID_SEPARATOR);
    if (parts.length !== CATALOG_ID_EXPECTED_PARTS) {
        return '';
    }
    return parts[2];
}
