// js/api/funding.js - Sector Funding API (v02 - 7-node flow)
//
// Shaper for the v02 Stack AI Sector Funding workflow. The workflow now exposes
// three first-class funding channels — VC equity deals, federal grants
// (translational/applied/basic), and active pipeline opportunities — plus a
// venture-own funding context narrative and structured summary statistics.
// The grader produces an explicit Weighted Sector Activity (WSA) calculation
// with band assignment and modifiers.

const FundingAPI = {
  config: {
    timeout: 900000 // 15 minutes (v02 flow runs ~400s + headroom)
  },

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
   * Process v02 API response (out-0 = SectorFundingResearch, out-1 = SectorFundingScore)
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

    if (trimmed.startsWith('```json')) trimmed = trimmed.slice(7);
    if (trimmed.startsWith('```')) trimmed = trimmed.slice(3);
    if (trimmed.endsWith('```')) trimmed = trimmed.slice(0, -3);
    trimmed = trimmed.trim();

    try {
      return JSON.parse(trimmed);
    } catch (error) {
      console.error(`Failed to parse ${label}:`, error, trimmed);
      return null;
    }
  },

  /**
   * Ensure required fields exist for downstream consumers (v02 Sector Funding).
   * Also tolerant of v01 attachments: old fields are left in place and the
   * formatter falls back to empty arrays/strings where v02 fields are missing.
   */
  ensureRequiredFields(analysis, assessment) {
    // Sector activity summary (v02 fields)
    if (!analysis.sector_activity_summary || typeof analysis.sector_activity_summary !== 'object') {
      analysis.sector_activity_summary = {};
    }
    const summary = analysis.sector_activity_summary;
    if (!summary.overall_activity_level) summary.overall_activity_level = 'none_found';
    if (!Array.isArray(summary.vc_investor_types_present)) {
      summary.vc_investor_types_present = Array.isArray(summary.investor_types_present)
        ? summary.investor_types_present // v01 fallback
        : [];
    }
    if (!Array.isArray(summary.primary_grant_funders)) summary.primary_grant_funders = [];
    if (!Array.isArray(summary.primary_pipeline_agencies)) summary.primary_pipeline_agencies = [];
    if (!summary.vc_funding_trend) {
      summary.vc_funding_trend = summary.funding_trend || 'unknown'; // v01 fallback
    }
    if (!summary.grant_funding_trend) summary.grant_funding_trend = 'unknown';
    if (typeof summary.scaled_winners_present !== 'boolean') summary.scaled_winners_present = false;
    if (!summary.narrative_summary) summary.narrative_summary = '';
    if (!summary.highest_vc_stage_observed) {
      summary.highest_vc_stage_observed = summary.stage_maturity || 'unknown'; // v01 fallback
    }

    // VC deals (v02). Accept v01 verified_deals as fallback for legacy attachments.
    if (!Array.isArray(analysis.vc_deals)) {
      analysis.vc_deals = Array.isArray(analysis.verified_deals) ? analysis.verified_deals : [];
    }
    if (!Array.isArray(analysis.grants)) analysis.grants = [];
    if (!Array.isArray(analysis.pipeline_opportunities)) analysis.pipeline_opportunities = [];

    // Summary statistics object (v02)
    if (!analysis.summary_statistics || typeof analysis.summary_statistics !== 'object') {
      analysis.summary_statistics = {};
    }

    // Venture-own narrative (v02)
    if (typeof analysis.venture_own_funding_context !== 'string') {
      analysis.venture_own_funding_context = '';
    }

    // Misc analysis fields
    if (typeof analysis.tools_executed_all_sources !== 'boolean') {
      analysis.tools_executed_all_sources = !!analysis.tools_executed;
    }
    if (!Array.isArray(analysis.search_queries_used)) analysis.search_queries_used = [];
    if (typeof analysis.data_gaps !== 'string') analysis.data_gaps = '';

    // Grader fields (v02)
    if (typeof assessment.weighted_sector_activity !== 'number') {
      // v01 fallback
      const legacy = Number(assessment.weighted_deal_count);
      assessment.weighted_sector_activity = Number.isFinite(legacy) ? legacy : 0;
    }
    if (typeof assessment.wsa_arithmetic !== 'string') assessment.wsa_arithmetic = '';
    if (typeof assessment.band_assignment !== 'string') assessment.band_assignment = '';
    if (!Array.isArray(assessment.modifiers_applied)) assessment.modifiers_applied = [];

    if (!assessment.score_justification || typeof assessment.score_justification !== 'object') {
      assessment.score_justification = {};
    }
    const j = assessment.score_justification;
    if (typeof j.vc_assessment !== 'string') j.vc_assessment = j.deal_volume_assessment || '';
    if (typeof j.grants_assessment !== 'string') j.grants_assessment = '';
    if (typeof j.pipeline_assessment !== 'string') j.pipeline_assessment = '';
    if (typeof j.scaled_outcomes_assessment !== 'string') j.scaled_outcomes_assessment = '';
    if (typeof j.trend_assessment !== 'string') j.trend_assessment = '';
    if (typeof j.evidence_summary !== 'string') j.evidence_summary = '';
    if (!Array.isArray(j.key_evidence)) {
      // v01 fallback: lift sector_evidence into key_evidence with a generic type
      const legacy = Array.isArray(j.sector_evidence) ? j.sector_evidence : [];
      j.key_evidence = legacy.map(e => ({
        evidence_type: e.evidence_type || 'vc_deal',
        description: e.description || '',
        score_implication: e.score_implication || ''
      }));
    }
    if (!Array.isArray(assessment.human_review_flags)) assessment.human_review_flags = [];
  },

  /**
   * Format data for UI consumption (v02 Sector Funding).
   */
  formatForDisplay(analysis, assessment) {
    const summary = analysis.sector_activity_summary || {};
    const justification = assessment.score_justification || {};

    const vcDeals = (analysis.vc_deals || []).map(deal => ({
      company: deal.company || deal.startup_name || 'Unknown', // v01 fallback
      dateApprox: deal.deal_date_approx || deal.deal_date || '',
      stage: deal.stage || deal.series || 'Undisclosed',
      amount: deal.amount || deal.funding_amount || 'undisclosed',
      investors: deal.investors || '',
      relevance: deal.sector_relevance || 'broad',
      isVentureOwn: !!deal.is_venture_own,
      sourceExcerpt: deal.source_excerpt || deal.relevance_rationale || '',
      sourceUrl: deal.source_url || ''
    }));

    const grants = (analysis.grants || []).map(g => ({
      grantId: g.grant_id || '',
      title: g.title || '',
      funder: g.funder || 'Unknown',
      funderAcronym: g.funder_acronym || '',
      startYear: g.start_year || null,
      fundingUsd: typeof g.funding_usd === 'number' ? g.funding_usd : null,
      classification: g.classification || 'applied',
      classificationRationale: g.classification_rationale || '',
      relevance: g.sector_relevance || 'broad',
      isVentureOwn: !!g.is_venture_own
    }));

    const pipelineOpportunities = (analysis.pipeline_opportunities || []).map(p => ({
      programName: p.program_name || '',
      agency: p.agency || '',
      type: p.type || 'other',
      status: p.status || 'standing_interest',
      responseDeadline: p.response_deadline || '',
      relevance: p.sector_relevance || 'broad',
      sourceUrl: p.source_url || '',
      summary: p.summary || ''
    }));

    // Partition venture-own records out of sector lists for separate display
    const sectorVcDeals = vcDeals.filter(d => !d.isVentureOwn);
    const ventureOwnVcDeals = vcDeals.filter(d => d.isVentureOwn);
    const sectorGrants = grants.filter(g => !g.isVentureOwn);
    const ventureOwnGrants = grants.filter(g => g.isVentureOwn);

    const keyEvidence = (justification.key_evidence || []).map(e => ({
      evidenceType: e.evidence_type || 'vc_deal',
      description: e.description || '',
      scoreImplication: e.score_implication || ''
    }));

    return {
      // Score + grader fields
      score: assessment.score,
      rubricLevel: assessment.rubric_level || '',
      dataReliability: assessment.data_reliability || 'unverified',
      weightedSectorActivity: assessment.weighted_sector_activity || 0,
      wsaArithmetic: assessment.wsa_arithmetic || '',
      bandAssignment: assessment.band_assignment || '',
      modifiersApplied: assessment.modifiers_applied || [],

      // Sector activity overview
      activityLevel: summary.overall_activity_level || 'none_found',
      highestVcStage: summary.highest_vc_stage_observed || 'unknown',
      investorTypes: summary.vc_investor_types_present || [],
      primaryGrantFunders: summary.primary_grant_funders || [],
      primaryPipelineAgencies: summary.primary_pipeline_agencies || [],
      vcFundingTrend: summary.vc_funding_trend || 'unknown',
      grantFundingTrend: summary.grant_funding_trend || 'unknown',
      scaledWinners: !!summary.scaled_winners_present,
      narrativeSummary: summary.narrative_summary || '',

      // Research context
      researchTopic: analysis.research_topic || '',
      primarySector: analysis.primary_sector || '',
      broaderSector: analysis.broader_sector || '',
      searchDate: analysis.search_date || null,
      toolsExecuted: !!analysis.tools_executed_all_sources,

      // Three funding channels (sector-only; venture-own partitioned separately)
      vcDeals,
      sectorVcDeals,
      ventureOwnVcDeals,
      grants,
      sectorGrants,
      ventureOwnGrants,
      pipelineOpportunities,

      // Venture-own narrative
      ventureOwnFundingContext: analysis.venture_own_funding_context || '',

      // Summary statistics (passed through verbatim for the detailed-view table)
      summaryStatistics: analysis.summary_statistics || {},

      dataGaps: analysis.data_gaps || '',

      // Score justification (v02: three channel assessments + outcomes + trend)
      summary: justification.evidence_summary || '',
      vcAssessment: justification.vc_assessment || '',
      grantsAssessment: justification.grants_assessment || '',
      pipelineAssessment: justification.pipeline_assessment || '',
      scaledOutcomes: justification.scaled_outcomes_assessment || '',
      trendAssessment: justification.trend_assessment || '',
      keyEvidence,
      humanReviewFlags: assessment.human_review_flags || [],

      // Assessment metadata
      assessmentDate: assessment.assessment_date || null,
      ventureName: assessment.venture_name || '',
      sectorAssessed: assessment.sector_assessed || ''
    };
  },

  /**
   * Advisor-facing rubric description (v02). Plain language — no WSA arithmetic.
   * Mirrors the methodology (three channels: VC + grants + pipeline; scaled-winner
   * gating at 7+; top-tier VC at 8+; peak cycle at 9) but stays human-readable.
   *
   * Kept in sync with getRubricDefinitions('funding') in assessment-view.js.
   */
  getRubricDescription(score) {
    const rubric = {
      1: 'No comparable VC deals, federal grants, or active opportunities in the sector.',
      2: 'Sparse signals across channels: maybe a handful of small grants or one-off deals; no sustained VC or agency interest.',
      3: 'Early-stage signals: a few translational or applied grants and the occasional seed deal. Ecosystem still nascent.',
      4: 'Notable mix of grants and early-stage VC deals, with a few open BAAs or SBIR topics targeting the sector.',
      5: 'Regular Series A/B deals plus steady translational/applied grant flow. Multiple federal opportunities currently open.',
      6: 'Significant capital across VC and federal grants, with active pipeline opportunities from multiple agencies. Sector clearly on the funding map.',
      7: 'Heavy activity across all three channels, and at least one sector company has reached a $1B+ valuation or major exit.',
      8: 'Top-tier VCs (a16z, Sequoia, Founders Fund, etc.) actively competing in the sector, with multiple companies at scale.',
      9: 'Repeated mega-rounds ($500M+); sector is a dominant investment category and federal pipeline is robust.'
    };

    return rubric[score] || 'No rubric description available';
  }
};

// Make available globally
window.FundingAPI = FundingAPI;
