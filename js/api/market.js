// js/api/market.js - Market opportunity analysis API (Proxied)

const MarketAPI = {
  config: {
    timeout: 700000 // ~11 minutes
  },

  /**
   * Analyze market opportunity
   * v3: Takes only company description (no longer depends on competitive analysis)
   *
   * @param {string} companyDescription - Short company description from CompanyAPI (downstream_summary)
   * @param {AbortSignal} abortSignal - Optional abort signal
   */
  async analyze(companyDescription, abortSignal = null) {
    if (!companyDescription || typeof companyDescription !== 'string') {
      throw new Error('Company description is required');
    }

    const payload = {
      'user_id': StackProxy.buildUserId('market'),
      'in-0': companyDescription.trim()
    };

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.config.timeout);
    
    if (abortSignal) {
      abortSignal.addEventListener('abort', () => controller.abort());
    }

    try {
      // Use proxy instead of direct API call
      const data = await window.StackProxy.call('market', payload, controller.signal);
      
      clearTimeout(timeoutId);
      return this.processResponse(data);

    } catch (error) {
      clearTimeout(timeoutId);
      
      if (error.name === 'AbortError') {
        throw new Error('Market analysis timeout or cancelled');
      }
      
      throw error;
    }
  },

  /**
   * Process API response (v3: out-0 = analysis, out-1 = score; legacy: out-2/out-3)
   */
  processResponse(data) {
    const outputs = data?.outputs || {};

    // Try v3 keys first, then legacy
    const analysisRaw = outputs['out-0'] || outputs['out-2'];
    const scoringRaw = outputs['out-1'] || outputs['out-3'];

    if (!analysisRaw || !scoringRaw) {
      throw new Error('Market API did not return expected outputs');
    }

    // Parse market analysis
    const analysis = this.parseOutput(analysisRaw, 'market analysis');
    if (!analysis || typeof analysis !== 'object') {
      throw new Error('Invalid market analysis format');
    }

    // Parse market scoring
    const scoring = this.parseOutput(scoringRaw, 'market scoring');
    if (!scoring || typeof scoring !== 'object') {
      throw new Error('Invalid market scoring format');
    }

    // Validate score
    scoring.score = this.normalizeScore(scoring.score);
    if (scoring.score === null) {
      throw new Error(`Invalid market score: ${scoring.score}`);
    }

    // Ensure required fields
    this.ensureRequiredFields(analysis, scoring);

    // Return structured response
    return {
      analysis,
      scoring,
      formatted: this.formatForDisplay(analysis, scoring)
    };
  },

  /**
   * Parse Stack output that may contain extra text or envelope
   */
  parseOutput(rawOutput, label = 'output') {
    if (!rawOutput) return null;

    if (typeof rawOutput === 'object') {
      if (rawOutput.text && typeof rawOutput.text === 'string') {
        return this.parseOutput(rawOutput.text, label);
      }
      return rawOutput;
    }

    if (typeof rawOutput !== 'string') {
      return null;
    }

    let trimmed = rawOutput.trim();
    if (!trimmed) return null;

    // Remove common code fences or YAML markers
    if (trimmed.startsWith('```json')) {
      trimmed = trimmed.slice(7);
    }
    if (trimmed.startsWith('```')) {
      trimmed = trimmed.slice(3);
    }
    if (trimmed.endsWith('```')) {
      trimmed = trimmed.slice(0, -3);
    }
    trimmed = trimmed.replace(/^---\s*$/, '').trim();

    const attemptParse = (text) => {
      try {
        return JSON.parse(text);
      } catch (error) {
        return null;
      }
    };

    let parsed = attemptParse(trimmed);
    if (parsed) return parsed;

    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start !== -1 && end !== -1 && end > start) {
      parsed = attemptParse(trimmed.slice(start, end + 1));
      if (parsed) return parsed;
    }

    // Attempt to repair truncated JSON by balancing brackets/braces
    const repaired = this.repairJsonString(trimmed);
    if (repaired) {
      parsed = attemptParse(repaired);
      if (parsed) return parsed;
    }

    // Try progressively trimming trailing characters in case of appended commentary
    if (start !== -1) {
      for (let cursor = trimmed.length - 1; cursor > start + 1; cursor -= 1) {
        const candidate = trimmed.slice(start, cursor);
        const attempt = attemptParse(candidate);
        if (attempt) return attempt;
      }
    }

    console.error(`Failed to parse ${label}:`, trimmed);
    return null;
  },

  /**
   * Attempt to balance unmatched braces/brackets in malformed JSON text
   */
  repairJsonString(text) {
    if (!text) return null;

    const stack = [];
    let inString = false;
    let escape = false;

    for (let i = 0; i < text.length; i += 1) {
      const char = text[i];

      if (inString) {
        if (escape) {
          escape = false;
          continue;
        }
        if (char === '\\') {
          escape = true;
          continue;
        }
        if (char === '"') {
          inString = false;
        }
        continue;
      }

      if (char === '"') {
        inString = true;
        continue;
      }

      if (char === '{') {
        stack.push('}');
      } else if (char === '[') {
        stack.push(']');
      } else if (char === '}' || char === ']') {
        if (stack.length === 0) {
          // Extra closing bracket; drop it
          text = text.slice(0, i) + text.slice(i + 1);
          i -= 1;
        } else {
          const expected = stack.pop();
          if ((char === '}' && expected !== '}') || (char === ']' && expected !== ']')) {
            // Mismatched closing token
            return null;
          }
        }
      }
    }

    if (inString) {
      // Close unbalanced string
      text += '"';
    }

    if (stack.length > 0) {
      text += stack.reverse().join('');
    }

    return text;
  },

  /**
   * Normalize score to integer 1-9 if possible
   */
  normalizeScore(rawScore) {
    if (typeof rawScore === 'number' && Number.isInteger(rawScore)) {
      if (rawScore >= 1 && rawScore <= 9) {
        return rawScore;
      }
      return null;
    }

    if (typeof rawScore === 'string') {
      const match = rawScore.match(/\d+/);
      if (match) {
        const parsed = parseInt(match[0], 10);
        if (parsed >= 1 && parsed <= 9) {
          return parsed;
        }
      }
    }

    return null;
  },

  /**
   * Ensure required fields exist (v3 schema)
   */
  ensureRequiredFields(analysis, scoring) {
    // Ensure analysis structure
    if (!analysis.markets) analysis.markets = [];
    if (!analysis.primary_market) {
      analysis.primary_market = {
        description: 'Unknown',
        tam_usd: 0,
        cagr_percent: 0,
        selection_rationale: ''
      };
    }
    if (!analysis.scoring_alignment) {
      analysis.scoring_alignment = {};
    }
    if (!Array.isArray(analysis.scoring_alignment.strengths)) {
      analysis.scoring_alignment.strengths = [];
    }
    if (!Array.isArray(analysis.scoring_alignment.limitations)) {
      analysis.scoring_alignment.limitations = [];
    }
    if (!analysis.market_analysis) analysis.market_analysis = {};

    // v3: confidence at analysis top level
    if (!analysis.data_confidence) {
      analysis.data_confidence = ConfidenceUtil.extractFromResponse(analysis, scoring) || 'Medium';
    }
    if (!analysis.data_confidence_justification) {
      analysis.data_confidence_justification = ConfidenceUtil.extractJustificationFromResponse(analysis, scoring) || '';
    }

    // Ensure scoring structure
    if (!scoring.rubric_application) scoring.rubric_application = {};
    // v3: justification is a string (not object)
    if (typeof scoring.justification !== 'string') {
      scoring.justification = scoring.justification?.summary || '';
    }
    if (!Array.isArray(scoring.key_risks)) scoring.key_risks = [];

    // v3: data_quality has only source_credibility and data_concerns
    if (!scoring.data_quality || typeof scoring.data_quality !== 'object') {
      scoring.data_quality = {};
    }
    if (!scoring.data_quality.source_credibility) {
      scoring.data_quality.source_credibility = analysis.data_confidence || 'Medium';
    }
    if (!Array.isArray(scoring.data_quality.data_concerns)) {
      scoring.data_quality.data_concerns = [];
    }
  },

  /**
   * Extract unique market sources from analysis
   */
  extractMarketSources(analysis) {
    if (!analysis || !Array.isArray(analysis.markets)) return [];

    const unique = new Set();
    analysis.markets.forEach(market => {
      const source = typeof market.source_url === 'string' ? market.source_url.trim() : '';
      if (source) unique.add(source);
    });

    return Array.from(unique).slice(0, 5);
  },

  /**
   * Format data for display (v3 schema)
   */
  formatForDisplay(analysis, scoring) {
    // Format markets
    const markets = (analysis.markets || []).map(market => ({
      rank: market.rank || 0,
      description: market.description || '',
      tam: market.tam_current_usd || 0,
      tamYear: market.tam_current_year || new Date().getFullYear(),
      cagr: market.cagr_percent || 0,
      source: market.source_url || ''
    }));

    // Build formatted response
    return {
      // Score and confidence
      score: scoring.score,
      confidence: analysis.data_confidence || scoring.data_quality?.source_credibility || 'Medium',
      confidenceJustification: analysis.data_confidence_justification || '',

      // Primary market
      primaryMarket: {
        description: analysis.primary_market.description,
        tam: analysis.primary_market.tam_usd,
        cagr: analysis.primary_market.cagr_percent,
        rationale: analysis.primary_market.selection_rationale
      },

      // All markets
      markets: markets.slice(0, 5),

      // Scoring alignment
      tamCategory: analysis.scoring_alignment.tam_category || this.deriveTamCategory(analysis.primary_market.tam_usd),
      cagrCategory: analysis.scoring_alignment.cagr_category || this.deriveCagrCategory(analysis.primary_market.cagr_percent),

      // v3: justification is a string, strengths/limitations from scoring_alignment
      justification: scoring.justification || '',
      strengths: analysis.scoring_alignment.strengths || [],
      limitations: analysis.scoring_alignment.limitations || [],
      risks: scoring.key_risks || [],

      // Market analysis
      executiveSummary: analysis.market_analysis.executive_summary || '',
      trends: analysis.market_analysis.trends || [],
      opportunities: analysis.market_analysis.opportunities || [],
      unmetNeeds: analysis.market_analysis.unmet_needs || [],
      barriers: analysis.market_analysis.barriers_to_entry || [],

      // Rubric application
      rubricDetails: {
        tamValue: scoring.rubric_application.tam_value || analysis.primary_market.tam_usd,
        tamCategory: scoring.rubric_application.tam_category || '',
        cagrValue: scoring.rubric_application.cagr_value || analysis.primary_market.cagr_percent,
        cagrCategory: scoring.rubric_application.cagr_category || '',
        baseScore: scoring.rubric_application.base_score || scoring.score,
        adjustment: scoring.rubric_application.adjustment || 0,
        adjustmentRationale: scoring.rubric_application.adjustment_rationale || '',
        finalScoreCalculation: scoring.rubric_application.final_score_calculation || ''
      },

      // Data quality
      sourceCredibility: scoring.data_quality?.source_credibility || 'Medium',
      dataConcerns: scoring.data_quality?.data_concerns || [],
      dataSources: this.extractMarketSources(analysis)
    };
  },

  /**
   * Derive TAM category from value
   */
  deriveTamCategory(tam) {
    const value = parseFloat(tam);
    if (isNaN(value)) return 'unknown';
    
    if (value < 500000000) return 'under_500M';
    if (value <= 5000000000) return '500M_to_5B';
    return 'over_5B';
  },

  /**
   * Derive CAGR category from value (v3: breakpoint at 20%)
   */
  deriveCagrCategory(cagr) {
    const value = parseFloat(cagr);
    if (isNaN(value)) return 'unknown';

    if (value < 10) return 'under_10';
    if (value <= 20) return '10_to_20';
    return 'over_20';
  },

  /**
   * Get rubric description for a score
   */
  getRubricDescription(score) {
    const rubrics = {
      1: "TAM < $500M and CAGR < 10%. Limited opportunity and slow growth.",
      2: "TAM < $500M and CAGR 10-20%. Small but growing market.",
      3: "TAM < $500M and CAGR > 20%. Small market with rapid growth potential.",
      4: "TAM $500M-$5B and CAGR < 10%. Substantial market, limited growth.",
      5: "TAM $500M-$5B and CAGR 10-20%. Good size with healthy growth.",
      6: "TAM $500M-$5B and CAGR > 20%. Strong opportunity with rapid expansion.",
      7: "TAM > $5B and CAGR < 10%. Very large market in a mature growth phase.",
      8: "TAM > $5B and CAGR 10-20%. Excellent size with sustained growth.",
      9: "TAM > $5B and CAGR > 20%. Exceptional opportunity: large and rapidly expanding."
    };
    
    return rubrics[score] || "Invalid score";
  }
};

// Make available globally
window.MarketAPI = MarketAPI;
