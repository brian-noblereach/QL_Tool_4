// js/api/funding.js - Funding landscape and deal activity API (Proxied)

const FundingAPI = {
  config: {
    timeout: 600000 // 10 minutes
  },

  /**
   * Analyze funding landscape and market deals
   * 
   * @param {string} companyDescription - Short company description JSON from CompanyAPI
   * @param {AbortSignal} abortSignal - Optional abort signal
   */
  async analyze(companyDescription, abortSignal = null) {
    if (!companyDescription || typeof companyDescription !== 'string') {
      throw new Error('Company description is required for funding analysis');
    }

    const trimmed = companyDescription.trim();
    if (trimmed.length < 20) {
      throw new Error('Company description too short for funding analysis');
    }

    const payload = {
      'user_id': StackProxy.buildUserId('funding'),
      'in-0': trimmed
    };

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.config.timeout);

    if (abortSignal) {
      abortSignal.addEventListener('abort', () => controller.abort());
    }

    try {
      // Use proxy instead of direct API call
      const data = await window.StackProxy.call('funding', payload, controller.signal);
      
      clearTimeout(timeoutId);
      return this.processResponse(data);

    } catch (error) {
      clearTimeout(timeoutId);

      if (error.name === 'AbortError') {
        throw new Error('Funding analysis timeout or cancelled');
      }

      throw error;
    }
  },

  /**
   * Process API response (out-0 = analysis, out-1 = score)
   */
  processResponse(data) {
    const validation = Validators.validateApiResponse(data, ['out-0', 'out-1']);
    if (!validation.valid) {
      throw new Error(validation.error);
    }

    const outputs = data.outputs || {};

    const analysis = this.parseOutput(outputs['out-0'], 'funding analysis');
    const assessment = this.parseOutput(outputs['out-1'], 'funding assessment');

    if (!analysis || typeof analysis !== 'object') {
      throw new Error('Invalid funding analysis format');
    }

    if (!assessment || typeof assessment !== 'object') {
      throw new Error('Invalid funding assessment format');
    }

    const score =
      assessment.funding_score ??
      assessment.score ??
      assessment.fundingScore;

    const normalizedScore = Number.parseInt(score, 10);
    if (!Number.isInteger(normalizedScore) || normalizedScore < 1 || normalizedScore > 9) {
      throw new Error(`Invalid funding score: ${score}`);
    }
    assessment.score = normalizedScore;

    this.ensureRequiredFields(analysis, assessment);

    return {
      analysis,
      assessment,
      score: assessment.score,
      formatted: this.formatForDisplay(analysis, assessment)
    };
  },

  /**
   * Parse output payload that may be a string or { text }
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
      console.error(`Unexpected ${label} output type:`, typeof raw);
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
      console.error(`Failed to parse ${label}:`, error, trimmed);
      return null;
    }
  },

  /**
   * Ensure required fields exist for downstream consumers (v3 Sector Funding)
   */
  ensureRequiredFields(analysis, assessment) {
    // Sector activity summary
    if (!analysis.sector_activity_summary || typeof analysis.sector_activity_summary !== 'object') {
      analysis.sector_activity_summary = {
        overall_activity_level: 'none_found',
        stage_maturity: 'unknown',
        investor_types_present: [],
        funding_trend: 'unknown',
        scaled_winners_present: false,
        narrative_summary: ''
      };
    }
    const summary = analysis.sector_activity_summary;
    if (!Array.isArray(summary.investor_types_present)) summary.investor_types_present = [];

    // Verified deals
    if (!Array.isArray(analysis.verified_deals)) analysis.verified_deals = [];
    if (typeof analysis.verified_deals_count !== 'number') {
      analysis.verified_deals_count = analysis.verified_deals.length;
    }
    if (typeof analysis.distinct_sources_count !== 'number') {
      analysis.distinct_sources_count = 0;
    }

    // Market reports and government programs
    if (!Array.isArray(analysis.market_reports)) analysis.market_reports = [];
    if (!Array.isArray(analysis.government_programs)) analysis.government_programs = [];
    if (!Array.isArray(analysis.search_queries_used)) analysis.search_queries_used = [];

    // Assessment fields
    if (!assessment.score_justification || typeof assessment.score_justification !== 'object') {
      assessment.score_justification = {
        deal_volume_assessment: '',
        stage_distribution_assessment: '',
        investor_quality_assessment: '',
        scaled_outcomes_assessment: '',
        trend_assessment: '',
        evidence_summary: '',
        sector_evidence: []
      };
    }
    if (!Array.isArray(assessment.score_justification.sector_evidence)) {
      assessment.score_justification.sector_evidence = [];
    }
    if (!Array.isArray(assessment.human_review_flags)) {
      assessment.human_review_flags = [];
    }
  },

  /**
   * Format data for UI consumption (v3 Sector Funding)
   */
  formatForDisplay(analysis, assessment) {
    const summary = analysis.sector_activity_summary || {};
    const justification = assessment.score_justification || {};

    const verifiedDeals = (analysis.verified_deals || []).map(deal => ({
      company: deal.startup_name || 'Unknown',
      date: deal.deal_date || '',
      series: deal.series || 'Undisclosed',
      amount: deal.funding_amount || 'undisclosed',
      investors: deal.investors || '',
      relevance: deal.sector_relevance || 'broad',
      relevanceRationale: deal.relevance_rationale || '',
      sourceName: deal.source_name || '',
      sourceUrl: deal.source_url || ''
    }));

    const marketReports = (analysis.market_reports || []).map(report => ({
      title: report.title || '',
      sourceUrl: report.source_url || '',
      keyFinding: report.key_finding || ''
    }));

    const governmentPrograms = (analysis.government_programs || []).map(prog => ({
      name: prog.program_name || '',
      amount: prog.funding_amount || 'undisclosed',
      description: prog.description || '',
      sourceUrl: prog.source_url || ''
    }));

    return {
      score: assessment.score,
      rubricLevel: assessment.rubric_level || '',
      dataReliability: assessment.data_reliability || 'unverified',
      weightedDealCount: assessment.weighted_deal_count || 0,

      // Sector activity overview
      activityLevel: summary.overall_activity_level || 'none_found',
      stageMaturity: summary.stage_maturity || 'unknown',
      investorTypes: summary.investor_types_present || [],
      fundingTrend: summary.funding_trend || 'unknown',
      scaledWinners: !!summary.scaled_winners_present,
      narrativeSummary: summary.narrative_summary || '',

      // Research context
      researchTopic: analysis.research_topic || '',
      primarySector: analysis.primary_sector || '',
      broaderSector: analysis.broader_sector || '',
      searchDate: analysis.search_date || null,
      toolsExecuted: !!analysis.tools_executed,

      // Deal data
      verifiedDeals,
      totalVerifiedDeals: analysis.verified_deals_count || verifiedDeals.length,
      distinctSources: analysis.distinct_sources_count || 0,

      // Supporting evidence
      marketReports,
      governmentPrograms,
      dataGaps: analysis.data_gaps || '',

      // Score justification
      summary: justification.evidence_summary || '',
      dealVolumeAssessment: justification.deal_volume_assessment || '',
      stageDistribution: justification.stage_distribution_assessment || '',
      investorQuality: justification.investor_quality_assessment || '',
      scaledOutcomes: justification.scaled_outcomes_assessment || '',
      trendAssessment: justification.trend_assessment || '',
      sectorEvidence: justification.sector_evidence || [],
      humanReviewFlags: assessment.human_review_flags || [],

      // Assessment metadata
      assessmentDate: assessment.assessment_date || null,
      ventureName: assessment.venture_name || '',
      sectorAssessed: assessment.sector_assessed || ''
    };
  },

  /**
   * Get rubric description
   */
  getRubricDescription(score) {
    const rubric = {
      1: 'No comparable funding activity in the sector. Minimal investor interest or deal activity.',
      2: 'Very limited funding activity, mostly grants. Few institutional investors active in the space.',
      3: 'Some angel/seed activity, limited institutional participation. Funding ecosystem still nascent.',
      4: 'Growing investor interest; early-stage rounds becoming more common. A few notable deals.',
      5: 'Regular Series A/B activity with established VC interest. Healthy, repeatable deal flow.',
      6: 'Strong institutional backing with multiple growth rounds. Sector attracting significant capital.',
      7: 'High-profile investors and strong deal flow. Multiple companies reaching large scale (often $1B+ valuation).',
      8: 'Exceptional funding environment with multiple scaled winners. Top-tier VCs actively competing for deals.',
      9: 'Peak funding activity with repeated mega-rounds. Sector is a top investment category.'
    };

    return rubric[score] || 'No rubric description available';
  }
};

// Make available globally
window.FundingAPI = FundingAPI;
