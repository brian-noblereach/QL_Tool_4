// js/api/iprisk.js - Intellectual property risk analysis API (Proxied)

const IPRiskAPI = {
  config: {
    timeout: 600000 // 10 minutes
  },

  /**
   * Analyze IP risk using company description
   * 
   * @param {string} companyDescription - Short company description JSON from CompanyAPI
   * @param {AbortSignal} abortSignal - Optional abort signal
   */
  async analyze(companyDescription, abortSignal = null) {
    if (!companyDescription || typeof companyDescription !== 'string') {
      throw new Error('Company description is required for IP risk analysis');
    }

    const trimmed = companyDescription.trim();
    if (trimmed.length < 20) {
      throw new Error('Company description too short for IP risk analysis');
    }

    const payload = {
      'user_id': StackProxy.buildUserId('iprisk'),
      'in-0': trimmed
    };

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.config.timeout);

    if (abortSignal) {
      abortSignal.addEventListener('abort', () => controller.abort());
    }

    try {
      // Use proxy instead of direct API call
      const data = await window.StackProxy.call('iprisk', payload, controller.signal);
      
      clearTimeout(timeoutId);
      return this.processResponse(data);
      
    } catch (error) {
      clearTimeout(timeoutId);

      if (error.name === 'AbortError') {
        throw new Error('IP risk analysis timeout or cancelled');
      }

      throw error;
    }
  },

  /**
   * Process API response (v3: out-0 = analysis, out-1 = score; legacy: out-1/out-2)
   */
  processResponse(data) {
    const outputs = data?.outputs || {};

    // v3: out-0 = analysis data, out-1 = score
    // Legacy: out-1 = analysis, out-2 = score
    let analysisRaw, scoreRaw;

    if (outputs['out-0'] !== undefined) {
      // v3 keys
      analysisRaw = outputs['out-0'];
      scoreRaw = outputs['out-1'];
    } else {
      // Legacy keys
      analysisRaw = outputs['out-1'];
      scoreRaw = outputs['out-2'];
    }

    const analysis = this.parseOutput(analysisRaw);
    const scoreData = this.parseOutput(scoreRaw);

    if (!analysis) {
      throw new Error('No IP landscape data returned from API');
    }

    // Merge score data into analysis report
    if (scoreData) {
      this.mergeSummary(analysis, scoreData);
    }

    this.ensureRequiredFields(analysis);

    const score = this.extractScore(analysis, scoreData);

    return {
      data: analysis,
      score,
      scoreData: scoreData || {},
      rubricDescription: score ? this.getRubricDescription(score) : null,
      formatted: this.formatForDisplay(analysis, scoreData || {}, score)
    };
  },

  /**
   * Parse model output regardless of envelope format
   */
  parseOutput(rawOutput) {
    if (!rawOutput) return null;

    if (typeof rawOutput === 'object') {
      if (rawOutput.text && typeof rawOutput.text === 'string') {
        try {
          return JSON.parse(rawOutput.text);
        } catch (e) {
          return null;
        }
      }
      return rawOutput;
    }

    if (typeof rawOutput !== 'string') {
      return null;
    }

    let trimmed = rawOutput.trim();
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
      console.error('Failed to parse IP risk output:', error);
      return null;
    }
  },

  /**
   * Merge score data into analysis report (v3 schema)
   */
  mergeSummary(report, scoreData) {
    if (!scoreData || typeof scoreData !== 'object') return;

    // Store score data reference on the report for easy access
    report._scoreData = scoreData;
  },

  /**
   * Ensure data has required structure (v3 IP Landscape schema)
   */
  ensureRequiredFields(report) {
    // Company IP position
    if (!report.company_ip_position || typeof report.company_ip_position !== 'object') {
      report.company_ip_position = {
        patents_found: 0,
        summary: 'No IP position data available.',
        owned_patent_ids: []
      };
    }
    if (!Array.isArray(report.company_ip_position.owned_patent_ids)) {
      report.company_ip_position.owned_patent_ids = [];
    }

    // Landscape analysis
    if (!report.landscape_analysis || typeof report.landscape_analysis !== 'object') {
      report.landscape_analysis = {
        total_relevant_patents_found: 0,
        patent_density: 'moderate',
        unique_patentable_features: [],
        crowded_patentable_features: [],
        top_patent_owners: []
      };
    }
    const landscape = report.landscape_analysis;
    if (!Array.isArray(landscape.unique_patentable_features)) landscape.unique_patentable_features = [];
    if (!Array.isArray(landscape.crowded_patentable_features)) landscape.crowded_patentable_features = [];
    if (!Array.isArray(landscape.top_patent_owners)) landscape.top_patent_owners = [];

    // Top relevant patents
    if (!Array.isArray(report.top_relevant_patents)) report.top_relevant_patents = [];

    // Risk assessment
    if (!report.risk_assessment || typeof report.risk_assessment !== 'object') {
      report.risk_assessment = {
        overall_risk: 'medium',
        freedom_to_operate: 'moderate',
        blocking_patents_identified: false,
        third_party_challenges: [],
        analysis: ''
      };
    }
    if (!Array.isArray(report.risk_assessment.third_party_challenges)) {
      report.risk_assessment.third_party_challenges = [];
    }

    // Patent table
    if (!report.patent_table || typeof report.patent_table !== 'object') {
      report.patent_table = { company_patents: [], third_party_patents: [] };
    }
    if (!Array.isArray(report.patent_table.company_patents)) report.patent_table.company_patents = [];
    if (!Array.isArray(report.patent_table.third_party_patents)) report.patent_table.third_party_patents = [];

    // Confidence
    if (!report.data_confidence) {
      report.data_confidence = ConfidenceUtil.normalizeLevel(report.data_confidence) || 'Medium';
    }
    if (!report.data_confidence_justification) {
      report.data_confidence_justification = '';
    }
  },

  /**
   * Extract numeric score from score data or analysis (v3)
   */
  extractScore(report, scoreData) {
    // v3: score is at top level of scoreData JSON
    let rawScore = scoreData?.score;

    if (rawScore === undefined || rawScore === null) {
      // Fallback: try from report (legacy merged data)
      rawScore = report._scoreData?.score ?? report.ipRiskSummary?.overallIPRisk?.score;
    }

    if (typeof rawScore === 'string') {
      const match = rawScore.match(/\d+/);
      if (match) rawScore = Number(match[0]);
    }

    if (Number.isInteger(rawScore) && rawScore >= 1 && rawScore <= 9) {
      return rawScore;
    }

    // Fallback: map risk level to score
    const riskLevel = report.risk_assessment?.overall_risk;
    return this.mapRiskLevelToScore(riskLevel);
  },

  /**
   * Map qualitative risk levels to 1-9 scale
   */
  mapRiskLevelToScore(level) {
    if (!level) return null;

    const normalized = String(level).toLowerCase().trim().replace(/[_-]/g, ' ');
    const mapping = {
      'very low': 8, low: 7, moderate: 6, medium: 5,
      balanced: 5, elevated: 4, high: 3, 'very high': 2, critical: 1
    };

    return mapping[normalized] ?? null;
  },

  /**
   * Format data for UI consumption (v3 IP Landscape schema)
   */
  formatForDisplay(report, scoreData, score) {
    const ipPos = report.company_ip_position || {};
    const landscape = report.landscape_analysis || {};
    const risk = report.risk_assessment || {};
    const table = report.patent_table || {};
    const evalSteps = scoreData?.evaluation_steps || {};

    return {
      score,

      // Company IP position
      companyIP: {
        patentsFound: ipPos.patents_found || 0,
        summary: ipPos.summary || '',
        ownedPatentIds: ipPos.owned_patent_ids || []
      },

      // Landscape analysis
      patentDensity: landscape.patent_density || 'unknown',
      totalRelevantPatents: landscape.total_relevant_patents_found || 0,
      uniqueFeatures: landscape.unique_patentable_features || [],
      crowdedFeatures: landscape.crowded_patentable_features || [],
      topOwners: (landscape.top_patent_owners || []).map(owner => ({
        assignee: owner.assignee || 'Unknown',
        patentCount: owner.patent_count ?? 0
      })),

      // Top relevant patents
      relevantPatents: (report.top_relevant_patents || []).map(patent => ({
        id: patent.patent_id || 'Unknown',
        title: patent.title || 'Untitled',
        assignee: patent.assignee || 'Unknown',
        year: patent.year || null,
        relevance: patent.relevance || '',
        blockingPotential: patent.blocking_potential || 'low',
        status: patent.status || 'Unknown',
        link: patent.link || ''
      })),

      // Risk assessment
      overallRisk: risk.overall_risk || 'medium',
      freedomToOperate: risk.freedom_to_operate || 'moderate',
      blockingPatentsIdentified: !!risk.blocking_patents_identified,
      challenges: risk.third_party_challenges || [],
      riskAnalysis: risk.analysis || '',

      // Patent table
      companyPatents: table.company_patents || [],
      thirdPartyPatents: table.third_party_patents || [],

      // Score details
      justification: scoreData?.score_justification || '',
      keyRiskFactors: scoreData?.key_risk_factors || [],
      rubricMatch: scoreData?.rubric_match_explanation || '',
      evaluationSteps: evalSteps,
      dataConfidenceImpact: scoreData?.data_confidence_impact || '',

      // Data quality
      dataConfidence: report.data_confidence || 'Medium',
      dataConfidenceJustification: report.data_confidence_justification || ''
    };
  },

  /**
   * Get rubric description for IP risk score
   */
  getRubricDescription(score) {
    const rubric = {
      1: 'Severe IP exposure with little protectable differentiation. Crowded landscape with likely blockers held by others.',
      2: 'High IP risk with limited protectable differentiation. Existing patents suggest likely blocking issues or costly workarounds.',
      3: 'Significant IP challenges. Some protectable features, but key areas look crowded or uncertain.',
      4: 'Moderate IP risk with some protectable features. Mixed landscape; targeted FTO likely needed to avoid blockers.',
      5: 'Average IP position. Neither particularly strong nor weak; protection strategy still required.',
      6: 'Good protectability with some unique features. Risks appear manageable with an IP strategy and targeted FTO review.',
      7: 'Clear protectable differentiation and a plausible strategy to file/defend. Limited apparent blocking risk.',
      8: 'Excellent future protectability with few apparent conflicts. Low likelihood of blocking IP; FTO appears favorable.',
      9: 'No obvious blocking IP identified and strong freedom-to-operate plus future protectability signal (subject to diligence).'
    };

    return rubric[score] || 'No rubric description available';
  }
};

// Make available globally
window.IPRiskAPI = IPRiskAPI;
