// js/utils/confidence.js - Centralized confidence normalization utility
// Provides consistent confidence handling across all API modules

const ConfidenceUtil = {

  /**
   * Normalize any confidence value to "Low", "Medium", or "High"
   * Handles: null, undefined, strings, numbers 0-1, numbers 0-100, nested objects
   * 
   * @param {*} value - Raw confidence value from API
   * @returns {string|null} - "Low", "Medium", "High", or null if invalid
   */
  normalizeLevel(value) {
    if (value === null || value === undefined) {
      return null;
    }

    // Handle string values
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (!trimmed) return null;
      
      const normalized = trimmed.toLowerCase();
      const mapping = {
        'low': 'Low',
        'medium': 'Medium',
        'mid': 'Medium',
        'med': 'Medium',
        'moderate': 'Medium',
        'high': 'High',
        'very low': 'Low',
        'very high': 'High'
      };

      if (mapping[normalized]) {
        return mapping[normalized];
      }
      
      // If string doesn't match known values, return as-is with capitalization
      return trimmed.charAt(0).toUpperCase() + trimmed.slice(1).toLowerCase();
    }

    // Handle numeric values (0-1 or 0-100 scale)
    if (typeof value === 'number' && !isNaN(value)) {
      // Normalize to 0-1 scale if value appears to be percentage
      const normalized = value > 1 ? value / 100 : value;
      const clamped = Math.max(0, Math.min(1, normalized));
      
      if (clamped >= 0.66) return 'High';
      if (clamped >= 0.33) return 'Medium';
      return 'Low';
    }

    // Handle nested objects that might contain confidence
    if (typeof value === 'object') {
      return this.normalizeLevel(
        value.level || value.value || value.label || value.text || value.confidence
      );
    }

    return null;
  },

  /**
   * Extract confidence justification from various possible locations
   * Takes an array of potential sources and returns the first valid string
   * 
   * @param {...*} sources - Potential justification values to check
   * @returns {string} - Justification text or empty string
   */
  extractJustification(...sources) {
    for (const source of sources) {
      if (typeof source === 'string') {
        const trimmed = source.trim();
        if (trimmed) return trimmed;
      }
    }
    return '';
  },

  /**
   * Extract confidence from multiple possible API response locations
   * Checks common paths where confidence might be stored
   * 
   * @param {Object} primary - Primary data object (e.g., analysis)
   * @param {Object} secondary - Secondary data object (e.g., assessment/scoring)
   * @returns {string|null} - Normalized confidence level
   */
  extractFromResponse(primary, secondary) {
    const candidates = [
      primary?.data_confidence,
      primary?.data_quality?.overall_confidence,
      primary?.data_quality?.confidence,
      primary?.data_quality?.confidence_level,
      secondary?.data_confidence,
      secondary?.confidence_level,
      secondary?.confidence
    ];

    for (const candidate of candidates) {
      const normalized = this.normalizeLevel(candidate);
      if (normalized) return normalized;
    }

    return null;
  },

  /**
   * Extract confidence justification from multiple possible API response locations
   * 
   * @param {Object} primary - Primary data object
   * @param {Object} secondary - Secondary data object
   * @returns {string} - Justification text or empty string
   */
  extractJustificationFromResponse(primary, secondary) {
    return this.extractJustification(
      primary?.confidence_justification,
      primary?.data_quality?.confidence_justification,
      secondary?.confidence_justification,
      secondary?.justification?.confidence_context
    );
  },

  /**
   * Format confidence for display
   * 
   * @param {string|null} level - Normalized confidence level
   * @param {string} justification - Confidence justification text
   * @returns {Object} - { level, justification, hasConfidence }
   */
  format(level, justification = '') {
    return {
      level: level || null,
      justification: justification || '',
      hasConfidence: level !== null
    };
  }
};

// Make available globally
window.ConfidenceUtil = ConfidenceUtil;
