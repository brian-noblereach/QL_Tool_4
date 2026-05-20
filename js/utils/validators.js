// js/utils/validators.js - Schema validation utilities (V02)
// Added validateIpRisk for completeness

const Validators = {
  validateCompany(data) {
    if (!data || typeof data !== 'object') {
      return { valid: false, error: 'Invalid company data structure' };
    }

    // Log what we received for debugging
    Debug.log('[Validators] Company data keys:', Object.keys(data).length);

    // Check for company_overview section (required by schema)
    const overview = data.company_overview || {};
    
    if (overview && Object.keys(overview).length > 0) {
      Debug.log('[Validators] Has company overview');
    }

    // Get company name from various possible locations
    const companyName = overview.name || 
                        overview.company_name ||
                        data.company_profile?.basic_information?.company_name ||
                        data.company_profile?.name ||
                        data.company_name ||
                        data.name;
    
    // Get website from various possible locations
    const website = overview.website ||
                    data.company_profile?.basic_information?.website ||
                    data.company_profile?.website ||
                    data.website;

    // Get description from various possible locations (v3 + legacy)
    const description = overview.one_liner ||
                        overview.detailed_description ||
                        overview.downstream_summary ||
                        overview.company_description ||
                        overview.mission_statement ||
                        data.technology?.core_technology ||
                        data.company_profile?.core_technology?.technology_description;

    // Only require that we have SOME identifying info
    if (!companyName && !website && !description) {
      return { valid: false, error: 'Company data missing identifying information (name, website, or description)' };
    }

    // Website validation is optional - only validate format if present
    if (website && typeof website === 'string') {
      try {
        const urlToTest = website.startsWith('http') ? website : 'https://' + website;
        new URL(urlToTest);
      } catch {
        Debug.warn('[Validators] Website URL may be invalid');
      }
    }

    return { valid: true };
  },

  validateCompetitive(data) {
    if (!data || typeof data !== 'object') {
      return { valid: false, error: 'Invalid competitive data structure' };
    }

    if (!data.analysis || !data.assessment) {
      return { valid: false, error: 'Missing competitive analysis or assessment' };
    }

    const analysis = data.analysis;
    const assessment = data.assessment;

    // v3: flat top-level fields (no market_overview/competitive_analysis wrappers required)
    if (!Array.isArray(analysis.competitors)) {
      return { valid: false, error: 'Missing competitors array in competitive analysis' };
    }

    if (!Number.isInteger(assessment.score) || assessment.score < 1 || assessment.score > 9) {
      return { valid: false, error: `Invalid competitive score: ${assessment.score}` };
    }

    return { valid: true };
  },

  validateMarket(data) {
    if (!data || typeof data !== 'object') {
      return { valid: false, error: 'Invalid market data structure' };
    }

    if (!data.analysis || !data.scoring) {
      return { valid: false, error: 'Missing market analysis or scoring' };
    }

    const analysis = data.analysis;
    const scoring = data.scoring;

    if (!analysis.markets || !analysis.primary_market) {
      return { valid: false, error: 'Invalid market analysis structure' };
    }

    if (analysis.primary_market.tam_usd === undefined || analysis.primary_market.cagr_percent === undefined) {
      return { valid: false, error: 'Primary market missing TAM or CAGR' };
    }

    if (!Number.isInteger(scoring.score) || scoring.score < 1 || scoring.score > 9) {
      return { valid: false, error: `Invalid market score: ${scoring.score}` };
    }

    // v3: confidence is a string enum at analysis level, not a 0-1 number on scoring
    // No longer validate numeric confidence

    return { valid: true };
  },

  validateTeam(data) {
    if (!data || typeof data !== 'object') {
      return { valid: false, error: 'Invalid team data structure' };
    }

    if (!data.team || !Array.isArray(data.team.team_members)) {
      return { valid: false, error: 'Missing team roster' };
    }

    if (!data.scoring || typeof data.scoring !== 'object') {
      return { valid: false, error: 'Missing team scoring details' };
    }

    if (!Number.isInteger(data.score) || data.score < 1 || data.score > 9) {
      return { valid: false, error: `Invalid team score: ${data.score}` };
    }

    return { valid: true };
  },

  validateFunding(data) {
    if (!data || typeof data !== 'object') {
      return { valid: false, error: 'Invalid funding data structure' };
    }

    if (!data.analysis || typeof data.analysis !== 'object') {
      return { valid: false, error: 'Missing funding analysis payload' };
    }

    if (!data.assessment || typeof data.assessment !== 'object') {
      return { valid: false, error: 'Missing funding assessment payload' };
    }

    if (!Number.isInteger(data.score) || data.score < 1 || data.score > 9) {
      return { valid: false, error: `Invalid funding score: ${data.score}` };
    }

    // v3: Sector Funding schema — verify key structures
    const analysis = data.analysis;

    if (!analysis.sector_activity_summary || typeof analysis.sector_activity_summary !== 'object') {
      return { valid: false, error: 'Funding analysis missing sector_activity_summary' };
    }

    if (!Array.isArray(analysis.verified_deals)) {
      return { valid: false, error: 'Verified deals must be an array' };
    }

    return { valid: true };
  },

  // V02: Added IP Risk validation
  validateIpRisk(data) {
    if (!data || typeof data !== 'object') {
      return { valid: false, error: 'Invalid IP risk data structure' };
    }

    if (!Number.isInteger(data.score) || data.score < 1 || data.score > 9) {
      return { valid: false, error: `Invalid IP risk score: ${data.score}` };
    }

    if (!data.formatted || typeof data.formatted !== 'object') {
      return { valid: false, error: 'Missing formatted IP risk data' };
    }

    return { valid: true };
  },

  validateUrl(url) {
    if (!url || typeof url !== 'string') {
      return { valid: false, error: 'URL is required' };
    }

    const trimmed = url.trim();
    
    if (!trimmed) {
      return { valid: false, error: 'URL cannot be empty' };
    }

    let validUrl = trimmed;
    if (!validUrl.match(/^https?:\/\//i)) {
      validUrl = 'https://' + validUrl;
    }

    try {
      const urlObj = new URL(validUrl);
      
      if (!urlObj.hostname || urlObj.hostname.indexOf('.') === -1) {
        return { valid: false, error: 'Invalid domain name' };
      }

      return { valid: true, url: validUrl };
    } catch {
      return { valid: false, error: 'Invalid URL format' };
    }
  },

  validateAssessment(score, justification) {
    const errors = [];

    if (!Number.isInteger(score) || score < 1 || score > 9) {
      errors.push('Score must be between 1 and 9');
    }

    if (!justification || typeof justification !== 'string') {
      errors.push('Justification is required');
    } else {
      const trimmed = justification.trim();
      if (trimmed.length < 20) {
        errors.push('Justification must be at least 20 characters');
      }
      if (trimmed.length > 2000) {
        errors.push('Justification must be less than 2000 characters');
      }
    }

    return { valid: errors.length === 0, errors };
  },

  sanitizeText(text) {
    if (!text) return '';
    
    return String(text)
      .replace(/[<>]/g, '')
      .replace(/javascript:/gi, '')
      .replace(/on\w+\s*=/gi, '')
      .trim();
  },

  validateApiResponse(response, expectedOutputs = []) {
    if (!response || typeof response !== 'object') {
      return { valid: false, error: 'Invalid API response structure' };
    }

    if (!response.outputs || typeof response.outputs !== 'object') {
      return { valid: false, error: 'Missing outputs in API response' };
    }

    for (const key of expectedOutputs) {
      if (!(key in response.outputs)) {
        return { valid: false, error: `Missing expected output: ${key}` };
      }
    }

    return { valid: true };
  },

  checkScoreDeviation(aiScore, userScore) {
    if (aiScore === null || userScore === null) {
      return { hasDeviation: false };
    }

    const deviation = Math.abs(aiScore - userScore);
    
    return {
      hasDeviation: deviation > 2,
      deviation,
      message: deviation > 2 
        ? `Your score differs by ${deviation} points from the AI assessment (${aiScore}).`
        : null
    };
  },

  validateExportData(state) {
    const errors = [];

    if (!state.company) errors.push('Company data is missing');
    if (!state.team || state.team.score === undefined) errors.push('Team assessment is incomplete');
    if (!state.competitive || !state.competitive.assessment) errors.push('Competitive assessment is incomplete');
    if (!state.market || !state.market.scoring) errors.push('Market assessment is incomplete');
    if (!state.iprisk || state.iprisk.score === undefined) errors.push('IP risk assessment is incomplete');

    return { valid: errors.length === 0, errors };
  },

  parseNumber(value, defaultValue = 0) {
    if (value === null || value === undefined) return defaultValue;
    const num = parseFloat(value);
    return isNaN(num) ? defaultValue : num;
  },

  validateStringArray(arr, fieldName) {
    if (!Array.isArray(arr)) {
      return { valid: false, error: `${fieldName} must be an array` };
    }

    const invalidItems = arr.filter(item => typeof item !== 'string');
    if (invalidItems.length > 0) {
      return { valid: false, error: `${fieldName} contains non-string items` };
    }

    return { valid: true, data: arr.filter(item => item.trim()) };
  },

  /**
   * Generic API response validation
   * Validates response structure before processing to prevent crashes
   * @param {Object} response - The API response to validate
   * @param {string} responseType - Type of response: 'team', 'funding', 'competitive', 'market', 'iprisk'
   * @returns {Object} { valid: boolean, error?: string }
   */
  validateApiResponse(response, responseType) {
    if (!response || typeof response !== 'object') {
      return { valid: false, error: `Invalid ${responseType} response: not an object` };
    }

    // Schema definitions for each response type
    const schemas = {
      team: {
        required: [],
        optional: ['score', 'formatted', 'team', 'scoring', 'assessment'],
        scoreField: 'score'
      },
      funding: {
        required: [],
        optional: ['score', 'formatted', 'rounds', 'peer_deals', 'funding_analysis'],
        scoreField: 'score'
      },
      competitive: {
        required: ['assessment'],
        optional: ['analysis', 'market_overview', 'competitors'],
        scoreField: 'assessment.score'
      },
      market: {
        required: ['scoring'],
        optional: ['analysis', 'formatted', 'markets'],
        scoreField: 'scoring.score'
      },
      iprisk: {
        required: [],
        optional: ['score', 'formatted', 'ip_analysis', 'patent_analysis'],
        scoreField: 'score'
      }
    };

    const schema = schemas[responseType];
    if (!schema) {
      return { valid: true }; // Unknown type, allow through
    }

    // Check required fields
    for (const field of schema.required) {
      if (!(field in response)) {
        return { valid: false, error: `Missing required field '${field}' in ${responseType} response` };
      }
    }

    // Validate score is in valid range if present
    const scoreValue = this.getNestedValue(response, schema.scoreField);
    if (scoreValue !== undefined && scoreValue !== null) {
      const numScore = typeof scoreValue === 'number' ? scoreValue : parseInt(scoreValue, 10);
      if (isNaN(numScore) || numScore < 1 || numScore > 9) {
        Debug.warn(`${responseType} response has invalid score: ${scoreValue}`);
        // Don't fail validation, just warn - score can be normalized later
      }
    }

    return { valid: true };
  },

  /**
   * Get nested value from object using dot notation
   * @param {Object} obj - Object to search
   * @param {string} path - Dot-notated path (e.g., 'assessment.score')
   * @returns {*} The value or undefined
   */
  getNestedValue(obj, path) {
    if (!path) return undefined;
    return path.split('.').reduce((current, key) => {
      return current && current[key] !== undefined ? current[key] : undefined;
    }, obj);
  }
};

window.Validators = Validators;
