// js/api/competitive.js - Competitive analysis API (Proxied)

const CompetitiveAPI = {
  config: {
    timeout: 480000 // 8 minutes
  },

  /**
   * Analyze competitive landscape
   * 
   * @param {string} companyDescription - Short company description JSON from CompanyAPI
   * @param {AbortSignal} abortSignal - Optional abort signal
   */
  async analyze(companyDescription, abortSignal = null) {
    if (!companyDescription || typeof companyDescription !== 'string') {
      throw new Error('Company description is required');
    }

    const trimmed = companyDescription.trim();
    if (trimmed.length < 20) {
      throw new Error('Company description too short');
    }

    const payload = {
      'user_id': StackProxy.buildUserId('competitive'),
      'in-0': trimmed
    };

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.config.timeout);
    
    if (abortSignal) {
      abortSignal.addEventListener('abort', () => controller.abort());
    }

    try {
      // Use proxy instead of direct API call
      const data = await window.StackProxy.call('competitive', payload, controller.signal);
      
      clearTimeout(timeoutId);
      return this.processResponse(data);

    } catch (error) {
      clearTimeout(timeoutId);
      
      if (error.name === 'AbortError') {
        throw new Error('Competitive analysis timeout or cancelled');
      }
      
      throw error;
    }
  },

  /**
   * Process API response (v3: out-0 = analysis, out-1 = score; legacy: out-3/out-4)
   */
  processResponse(data) {
    const outputs = data?.outputs || {};

    // Try v3 keys first, then legacy
    const rawAnalysis = outputs['out-0'] || outputs['out-3'];
    const rawAssessment = outputs['out-1'] || outputs['out-4'];

    if (!rawAnalysis || !rawAssessment) {
      throw new Error('Competitive API did not return expected outputs');
    }

    // Parse the structured competitive analysis
    const analysis = this.parseOutput(rawAnalysis, 'competitive analysis');
    if (!analysis || typeof analysis !== 'object') {
      throw new Error('Invalid competitive analysis format');
    }

    // Parse the graded assessment
    const assessment = this.parseOutput(rawAssessment, 'competitive assessment');
    if (!assessment || typeof assessment !== 'object') {
      throw new Error('Invalid competitive assessment format');
    }

    // Validate assessment score
    const score = Number.parseInt(assessment.score, 10);
    if (!score || score < 1 || score > 9) {
      throw new Error(`Invalid competitive score: ${assessment.score}`);
    }
    assessment.score = score;

    // Ensure required fields
    this.ensureRequiredFields(analysis, assessment);

    // Return structured response
    return {
      analysis,
      assessment,
      analysisText: JSON.stringify(analysis), // For market analysis input
      formatted: this.formatForDisplay(analysis, assessment)
    };
  },

  /**
   * Parse output that may be string or object
   */
  parseOutput(raw, label) {
    if (!raw) return null;

    if (typeof raw === 'object') {
      if (raw.text && typeof raw.text === 'string') {
        return this.parseOutput(raw.text, label);
      }
      return raw;
    }

    if (typeof raw !== 'string') {
      return null;
    }

    let trimmed = raw.trim();
    if (!trimmed) return null;

    // Clean up markdown code blocks
    if (trimmed.startsWith('```json')) {
      trimmed = trimmed.slice(7);
    }
    if (trimmed.startsWith('```')) {
      trimmed = trimmed.slice(3);
    }
    if (trimmed.endsWith('```')) {
      trimmed = trimmed.slice(0, -3);
    }
    trimmed = trimmed.trim();

    try {
      return JSON.parse(trimmed);
    } catch (error) {
      console.error(`Failed to parse ${label}:`, error);
      return null;
    }
  },

  /**
   * Ensure required fields exist (v3 flat schema)
   */
  ensureRequiredFields(analysis, assessment) {
    // v3: flat top-level fields (no market_overview wrapper)
    if (!analysis.job_to_be_done) analysis.job_to_be_done = 'Not specified';
    if (!analysis.competitive_scope) analysis.competitive_scope = '';
    if (!analysis.estimated_total_competitors) analysis.estimated_total_competitors = 'Unknown';
    if (!analysis.competitive_intensity) analysis.competitive_intensity = 'moderate';
    if (!analysis.market_dynamics) analysis.market_dynamics = 'Not provided';
    if (!analysis.competitors) analysis.competitors = [];
    if (!Array.isArray(analysis.market_gaps)) analysis.market_gaps = [];

    // v3: confidence at top level
    if (!analysis.data_confidence) {
      analysis.data_confidence = ConfidenceUtil.extractFromResponse(analysis, assessment);
    }
    if (!analysis.data_confidence_justification) {
      analysis.data_confidence_justification = ConfidenceUtil.extractJustificationFromResponse(analysis, assessment);
    }

    // Legacy compat: populate market_overview from flat fields for any code that reads it
    if (!analysis.market_overview) {
      analysis.market_overview = {
        job_to_be_done: analysis.job_to_be_done,
        market_dynamics: analysis.market_dynamics,
        total_competitors: {}
      };
    }

    // Ensure assessment structure
    if (!assessment.evaluation_steps) {
      assessment.evaluation_steps = {
        saturation_assessment: '',
        baseline_range: 'moderate_4_6',
        incumbent_strength_assessment: '',
        differentiation_assessment: ''
      };
    }

    if (!assessment.competitor_count || typeof assessment.competitor_count !== 'object') {
      assessment.competitor_count = {
        total: 0,
        large_companies: 0,
        mid_size_companies: 0,
        startups: 0,
        estimated_total_market: analysis.estimated_total_competitors || 'Unknown'
      };
    } else {
      const counts = assessment.competitor_count;
      counts.total = Number(counts.total) || 0;
      counts.large_companies = Number(counts.large_companies) || 0;
      counts.mid_size_companies = Number(counts.mid_size_companies) || 0;
      counts.startups = Number(counts.startups) || 0;
      if (!counts.estimated_total_market) {
        counts.estimated_total_market = analysis.estimated_total_competitors || 'Unknown';
      }
    }

    if (!assessment.market_leaders) assessment.market_leaders = [];
    if (!assessment.competitive_intensity) assessment.competitive_intensity = analysis.competitive_intensity || 'unknown';
    if (!assessment.key_risk_factors) assessment.key_risk_factors = [];
    if (!assessment.differentiation_opportunities) assessment.differentiation_opportunities = [];
    if (!assessment.rubric_match_explanation) assessment.rubric_match_explanation = '';
    if (!assessment.confidence_note) assessment.confidence_note = '';
  },

  /**
   * Format data for display (v3 flat schema)
   */
  formatForDisplay(analysis, assessment) {
    // Extract competitor details.
    // v04.2 additions: per-competitor Reranker fields (relevance_score,
    // threat_score, winnability_vs, plus the three rationales). These come
    // through inline on the consolidated Output Agent JSON (out-0). They may
    // be null per the strict schema's anyOf — null means the Reranker didn't
    // score this entity (would only happen if the schema is violated upstream;
    // normally every Output Agent entry has Reranker fields populated).
    const competitors = (analysis.competitors || []).map(comp => ({
      name: comp.company_name || 'Unknown',
      size: comp.companySize || comp.size_category || 'Unknown',
      product: comp.product_name || '',
      description: comp.product_description || '',
      strengths: comp.strengths || [],
      weaknesses: comp.weaknesses || [],
      revenue: comp.revenue || 'Unknown',
      funding: comp.funding_raised || 'N/A',
      position: comp.market_position || 'Unknown',
      competitorType: comp.competitorType || '',
      differentiation: comp.differentiation || '',
      yearFounded: comp.yearFounded || null,
      sources: comp.sources || [],
      relevanceScore:       (typeof comp.relevance_score === 'number') ? comp.relevance_score : null,
      threatScore:          (typeof comp.threat_score === 'number') ? comp.threat_score : null,
      winnabilityVs:        comp.winnability_vs || null,
      relevanceRationale:   comp.relevance_rationale || null,
      threatRationale:      comp.threat_rationale || null,
      winnabilityRationale: comp.winnability_rationale || null
    }));

    const competitorCount = assessment.competitor_count || {};

    // Build formatted response
    return {
      // Score and justification
      score: assessment.score,
      justification: assessment.score_justification || '',
      rubricMatch: assessment.rubric_match_explanation || '',

      // Evaluation methodology
      evaluationSteps: assessment.evaluation_steps || {},

      // Competitor metrics
      competitorCount,
      totalCompetitors: competitorCount.estimated_total_market
        || analysis.estimated_total_competitors
        || competitorCount.total
        || null,
      competitors: competitors.slice(0, 12),

      // v3: flat top-level fields
      marketOverview: {
        jobToBeDone: analysis.job_to_be_done || '',
        competitiveScope: analysis.competitive_scope || '',
        marketDynamics: analysis.market_dynamics || '',
        competitiveIntensity: analysis.competitive_intensity || assessment.competitive_intensity || ''
      },

      // Market analysis
      marketLeaders: assessment.market_leaders || [],
      competitiveIntensity: assessment.competitive_intensity || analysis.competitive_intensity || '',

      // Risk and opportunities
      keyRisks: assessment.key_risk_factors || [],
      opportunities: assessment.differentiation_opportunities || [],

      // v3: market_gaps at top level (was in competitive_analysis)
      marketGaps: analysis.market_gaps || [],

      // Data quality
      confidence: analysis.data_confidence || 'Medium',
      confidenceJustification: analysis.data_confidence_justification || '',
      confidenceNote: assessment.confidence_note || '',

      // v04.2 Reranker aggregates. Carry through from out-0 (preferred) or
      // out-1 (Grader echoes them); fall back to null when neither is present
      // so the frontend can suppress rendering of the new winnability badge.
      effectiveCompetitorCount: (typeof analysis.effective_competitor_count === 'number')
        ? analysis.effective_competitor_count
        : (typeof assessment.effective_competitor_count === 'number'
            ? assessment.effective_competitor_count
            : null),
      highThreatCount: (typeof analysis.high_threat_count === 'number')
        ? analysis.high_threat_count
        : (typeof assessment.high_threat_count === 'number'
            ? assessment.high_threat_count
            : null),
      winnabilitySummary: analysis.winnability_summary || assessment.winnability_summary || null,
      winnabilitySummaryRationale: analysis.winnability_summary_rationale || '',
      rerankNotes: analysis.rerank_notes || '',
      winnabilityGateApplied: !!(assessment.evaluation_steps?.winnability_gate_applied),
      winnabilityGateExplanation: assessment.evaluation_steps?.winnability_gate_explanation || '',

      // Collect sources from competitors
      sources: [...new Set(
        (analysis.competitors || []).flatMap(c => c.sources || []).filter(Boolean)
      )]
    };
  },

  /**
   * Get rubric description for a score
   */
  getRubricDescription(score) {
    const rubrics = {
      1: "Market dominated by incumbents with entrenched advantages. Very difficult to differentiate or compete.",
      2: "Many strong competitors with established share. Differentiation opportunities are limited.",
      3: "Several capable players. Differentiation possible but challenging and often costly.",
      4: "Moderate competition with clear differentiation paths. Some barriers to entry exist.",
      5: "Average competitive landscape. Competition is manageable but offers no inherent advantage.",
      6: "Market may be competitive, but clear differentiation and defensibility are achievable (tech, cost, channel, or timing).",
      7: "Limited competition with strong differentiation. Significant barriers protect a defensible niche.",
      8: "Few direct competitors and meaningful barriers to entry. Strong defensive moat and pricing power potential.",
      9: "No true direct competitors today; defines a new category. Must still validate that a real market exists."
    };
    
    return rubrics[score] || "Invalid score";
  }
};

// Make available globally
window.CompetitiveAPI = CompetitiveAPI;
