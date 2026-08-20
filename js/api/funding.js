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

    // Grant-retrieval recall guards (v04.9). Legacy attachments predate the
    // guards entirely, so the default must be SILENT, not `unknown` -- an
    // `unknown` default would raise the caveat banner on every pre-v04.9
    // venture. Same reasoning as iprisk.js's retrieval_recall_assessment
    // default: absent guards mean "this run was never instrumented", not
    // "this run was thin".
    if (!analysis.grant_recall || typeof analysis.grant_recall !== 'object') {
      analysis.grant_recall = {};
    }
    const gr = analysis.grant_recall;
    if (typeof gr.grant_recall_confidence !== 'string') gr.grant_recall_confidence = '';
    if (typeof gr.recall_confidence_reason !== 'string') gr.recall_confidence_reason = '';
    if (typeof gr.precise_leg_us_hits !== 'number') gr.precise_leg_us_hits = null;
    if (typeof gr.anchors_missing !== 'boolean') gr.anchors_missing = false;
    if (!Array.isArray(gr.precise_legs_without_results)) gr.precise_legs_without_results = [];
    if (typeof gr.recall_caveat_flag !== 'boolean') gr.recall_caveat_flag = false;

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
   * The eight Weighted Sector Activity weights from the v02 rubric
   * (Prompts and Schemas/Sector Funding/sector_funding_flow_v02.md, Node 7
   * "SCORING WEIGHTS"). Broad-relevance records are context only and carry no
   * weight; pipeline opportunities are a band modifier, not a WSA term.
   *
   * Keep these in sync with the spec. They are the rubric -- changing a value
   * here silently re-bases every score the tool displays.
   */
  WSA_WEIGHTS: {
    vc_deal_count_core: 1.0,
    vc_deal_count_adjacent: 0.5,
    translational_grant_count_core: 1.0,
    translational_grant_count_adjacent: 0.5,
    applied_grant_count_core: 0.7,
    applied_grant_count_adjacent: 0.35,
    basic_grant_count_core: 0.2,
    basic_grant_count_adjacent: 0.1,
  },

  /**
   * Shape the grant-retrieval recall guards for the view.
   *
   * `caveatFlag` is DERIVED here from the underlying facts rather than trusted
   * from the Grader/Output-Agent boolean, because that boolean has already been
   * wrong once in the direction that matters: a run reported
   * grant_recall_confidence "medium" with the mechanism leg empty and
   * recall_caveat_flag false, which silently suppressed the advisor banner. The
   * two triggers are independent -- retrieval that could not reach the sector
   * (low/unknown/anchors_missing), and retrieval that reached it but left a
   * named slice unsurveyed (precise_legs_without_results). Deriving means a
   * stale or mis-set upstream flag cannot hide either one.
   *
   * Legacy attachments carry no guards at all, so every input is falsy/empty
   * and the flag stays false -- pre-v04.9 ventures show no banner.
   */
  shapeGrantRecall(grantRecall, assessment) {
    const gr = grantRecall || {};
    const impact = (assessment || {}).grant_recall_impact || {};
    const confidence = gr.grant_recall_confidence || '';
    const legs = Array.isArray(gr.precise_legs_without_results)
      ? gr.precise_legs_without_results.filter(Boolean)
      : [];
    const coverageGap = legs.length > 0;
    const unreachable = confidence === 'low' || confidence === 'unknown' || !!gr.anchors_missing;
    return {
      confidence,
      reason: gr.recall_confidence_reason || '',
      preciseLegUsHits: gr.precise_leg_us_hits,
      anchorsMissing: !!gr.anchors_missing,
      preciseLegsWithoutResults: legs,
      // Which trigger fired -- the banner copy differs, because "we could not
      // search" and "we searched but skipped a slice" are different warnings.
      unreachable,
      coverageGap,
      caveatFlag: unreachable || coverageGap || !!gr.recall_caveat_flag,
      floorApplied: !!impact.recall_floor_applied,
      impactExplanation: impact.impact_explanation || '',
    };
  },

  /**
   * Compute WSA deterministically from summary_statistics.
   *
   * Falls back to the Grader's reported number only when summary_statistics
   * carries none of the eight count fields -- i.e. a v01-era attachment that
   * predates the counts entirely. Returning 0 in that case would blank out the
   * WSA on old ventures, which is worse than showing the model's figure.
   */
  computeWsa(summaryStatistics, assessment) {
    const s = summaryStatistics || {};
    const keys = Object.keys(this.WSA_WEIGHTS);
    const present = keys.some(k => Number.isFinite(Number(s[k])));
    if (!present) {
      const reported = Number((assessment || {}).weighted_sector_activity);
      return Number.isFinite(reported) ? reported : 0;
    }
    let total = 0;
    keys.forEach(k => {
      const n = Number(s[k]);
      if (Number.isFinite(n) && n > 0) total += n * this.WSA_WEIGHTS[k];
    });
    // Round to one decimal -- the rubric bands are coarse and the raw sum
    // produces float artifacts (6.6499999999999995).
    return Math.round(total * 10) / 10;
  },

  /**
   * Diagnostic: how far the Grader's reported WSA drifted from the computed
   * one. Returns null when there is nothing to compare or the gap is trivial.
   */
  wsaMismatch(summaryStatistics, assessment) {
    const s = summaryStatistics || {};
    const keys = Object.keys(this.WSA_WEIGHTS);
    if (!keys.some(k => Number.isFinite(Number(s[k])))) return null;
    const reported = Number((assessment || {}).weighted_sector_activity);
    if (!Number.isFinite(reported)) return null;
    const computed = this.computeWsa(summaryStatistics, assessment);
    const delta = Math.round((reported - computed) * 10) / 10;
    return Math.abs(delta) < 0.15 ? null : { computed, reported, delta };
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
      // v04.7: numeric raw-USD amount. Null for undisclosed deals and absent on
      // pre-v04.7 attachments -- the view falls back to parsing `amount` prose.
      amountUsd: typeof deal.amount_usd === 'number' ? deal.amount_usd : null,
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
      // v04.9.1: WSA is COMPUTED here, not read from the Grader. It is a pure
      // function of summary_statistics and the eight fixed rubric weights, and
      // the Grader has twice emitted a number that contradicts its own
      // `wsa_arithmetic` prose (26.8 vs 19.8, which crossed a band edge and
      // inflated a score by a full point; then 8.2 vs 6.65). A prompt
      // instruction telling it to stay consistent did not hold. This does not
      // change the rubric -- the weights and bands are exactly as specified in
      // sector_funding_flow_v02.md; it just stops asking a language model to do
      // arithmetic. `weightedSectorActivityReported` and `wsaMismatch` are kept
      // for diagnostics.
      weightedSectorActivity: this.computeWsa(analysis.summary_statistics, assessment),
      weightedSectorActivityReported: assessment.weighted_sector_activity || 0,
      wsaMismatch: this.wsaMismatch(analysis.summary_statistics, assessment),
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

      // Grant-retrieval recall guards (v04.9). `caveatFlag` drives the amber
      // banner on the Funding tab; `floorApplied` comes off the Grader and
      // tells the advisor the score was raised off 1-2 because a verified
      // absence could not be established.
      grantRecall: this.shapeGrantRecall(analysis.grant_recall, assessment),

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
