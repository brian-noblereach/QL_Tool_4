// js/api/literature.js - Scientific Evidence (Literature Review) API (Proxied)
//
// Calls the Stack AI Scientific Evidence workflow and shapes its strict-JSON
// output into:
//   { literature, formatted }
// where `literature` is the raw schema-conformant object (preserved for
// downstream consumers / future use) and `formatted` is the display-shaped
// envelope consumed by:
//   * Competitive section -> trialCompetitors[], labCompetitors[],
//                            discontinuedSignals[]
//   * Solution Value section -> statusQuoSummary, incumbentRows[],
//                               incumbentLimitations[], pathwayMaturity
//
// Lit-review is NOT a scored dimension — it is contextual evidence that fuses
// into Competitive and Solution Value. There is no AI score here.

const LiteratureAPI = {
  config: {
    timeout: 600000 // 10 minutes (observed runtime ~130s, generous buffer)
  },

  /**
   * Run the Scientific Evidence workflow.
   *
   * @param {string} companyDescription - downstream_summary from CompanyAPI
   * @param {AbortSignal} abortSignal - optional abort signal
   */
  async analyze(companyDescription, abortSignal = null) {
    if (!companyDescription || typeof companyDescription !== 'string') {
      throw new Error('Company description is required');
    }

    const payload = {
      'user_id': StackProxy.buildUserId('literature'),
      'in-0': companyDescription.trim()
    };

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.config.timeout);

    if (abortSignal) {
      abortSignal.addEventListener('abort', () => controller.abort());
    }

    try {
      const data = await window.StackProxy.call('literature', payload, controller.signal);
      clearTimeout(timeoutId);
      return this.processResponse(data);
    } catch (error) {
      clearTimeout(timeoutId);
      if (error.name === 'AbortError') {
        throw new Error('Literature analysis timeout or cancelled');
      }
      throw error;
    }
  },

  /**
   * Shape the Stack AI response into { literature, formatted }.
   * The Scientific Evidence flow has a single synthesis output at out-0.
   */
  processResponse(data) {
    const outputs = data?.outputs || {};
    const raw = outputs['out-0'];
    if (!raw) {
      throw new Error('Literature API did not return expected output (out-0)');
    }

    const literature = this.parseOutput(raw, 'literature evidence');
    if (!literature || typeof literature !== 'object') {
      throw new Error('Invalid literature evidence format');
    }

    return {
      literature,
      formatted: this.formatForDisplay(literature)
    };
  },

  /**
   * Parse a Stack AI output value that may be string or object.
   * Mirrors the markdown-stripping pattern in competitive.js / market.js.
   */
  parseOutput(raw, label) {
    if (!raw) return null;

    if (typeof raw === 'object') {
      if (raw.text && typeof raw.text === 'string') {
        return this.parseOutput(raw.text, label);
      }
      return raw;
    }

    if (typeof raw !== 'string') return null;

    let trimmed = raw.trim();
    if (!trimmed) return null;

    if (trimmed.startsWith('```json')) trimmed = trimmed.slice(7);
    if (trimmed.startsWith('```')) trimmed = trimmed.slice(3);
    if (trimmed.endsWith('```')) trimmed = trimmed.slice(0, -3);
    trimmed = trimmed.trim();

    try {
      return JSON.parse(trimmed);
    } catch (error) {
      console.error(`Failed to parse ${label}:`, error);
      return null;
    }
  },

  /**
   * Shape the strict-schema JSON into a display envelope. Curates top-N per
   * section so the UI renders without dumping every entry.
   */
  formatForDisplay(lit) {
    const statusQuo = lit.status_quo || {};
    const litLandscape = lit.literature_landscape || {};
    const clinical = lit.clinical_evidence || null;
    const pathway = lit.pathway_signals || {};
    const validation = lit.validation_assessment || {};
    const duplication = lit.duplication_assessment || {};
    const inherent = lit.inherent_advantages || {};

    // --- Status quo (incumbent baseline) ---
    const statusQuoSummary = {
      dominantApproach: statusQuo.dominant_approach_name || '',
      mechanism: statusQuo.mechanism_description || '',
      supportingPubs: (statusQuo.key_supporting_publications || []).slice(0, 5)
    };
    const incumbentLimitations = (statusQuo.known_limitations || []).slice(0, 5);

    // --- Incumbent comparison rows (TPP-style) ---
    // Combine performance / mechanism / stage-of-evidence advantages, sorted by
    // evidence_quality (confirmed -> inferred -> aspirational).
    const qOrder = { confirmed: 0, inferred: 1, aspirational: 2 };
    const rawAdv = [
      ...(inherent.performance_advantages || []).map(a => ({ ...a, dimension: 'Performance' })),
      ...(inherent.mechanism_advantages || []).map(a => ({ ...a, dimension: 'Mechanism' })),
      ...(inherent.stage_of_evidence_advantages || []).map(a => ({ ...a, dimension: 'Stage of evidence' }))
    ];
    const incumbentRows = rawAdv
      .map(a => ({
        dimension: a.dimension,
        claim: a.claim || '',
        baseline: a.comparison_baseline || '',
        evidenceQuality: a.evidence_quality || 'inferred'
      }))
      .sort((x, y) => (qOrder[x.evidenceQuality] ?? 3) - (qOrder[y.evidenceQuality] ?? 3));

    // --- Pathway maturity ---
    const pathwayMaturity = {
      moreAdvancedExists: !!pathway.more_advanced_analogs_exist,
      analogName: pathway.closest_commercialized_or_late_stage_analog || '',
      analogProgress: pathway.analog_progress_summary || '',
      supportingEvidence: (pathway.supporting_evidence || []).slice(0, 3)
    };

    // --- Clinical-trial competitors (biomedical only) ---
    // Active/recruiting trials first, terminated/discontinued last (negative
    // signal but still informative). Phase string is preserved verbatim from
    // the flow output (e.g., "PHASE2", "Phase 1/2").
    let trialCompetitors = [];
    let discontinuedSignals = [];
    if (clinical && typeof clinical === 'object') {
      const activeStatuses = /(recruit|active|enroll|not yet|approved for marketing|available)/i;
      const terminatedStatuses = /(terminat|withdraw|suspend|discontinu|completed)/i;

      const allTrials = [
        ...(clinical.intervention_trials || []),
        ...(clinical.venture_trials || [])
      ];
      // Dedupe by trial_id.
      const seen = new Set();
      for (const t of allTrials) {
        if (!t || !t.trial_id) continue;
        if (seen.has(t.trial_id)) continue;
        seen.add(t.trial_id);
        const status = String(t.overall_status || '');
        const entry = {
          trialId: t.trial_id,
          title: t.title || '',
          phase: t.phase || '',
          status,
          sponsor: t.sponsor || '',
          intervention: t.intervention || '',
          condition: t.condition || '',
          link: t.link || ''
        };
        if (terminatedStatuses.test(status) && !activeStatuses.test(status)) {
          discontinuedSignals.push(entry);
        } else {
          trialCompetitors.push(entry);
        }
      }
    }

    // --- Academic-lab competitors ---
    const labCompetitors = (litLandscape.top_research_groups || [])
      .filter(g => g && g.name)
      .map(g => ({
        name: g.name,
        publicationCount: g.publication_count || 0
      }))
      .sort((a, b) => (b.publicationCount || 0) - (a.publicationCount || 0));

    // --- Key publications (for the Sources tab) ---
    const keyPublications = (litLandscape.key_publications || []).filter(p => p && (p.doi || p.link));

    // --- Confidence ---
    const confidence = ConfidenceUtil.normalizeLevel(lit.data_confidence) || 'Medium';
    const confidenceJustification = lit.data_confidence_justification || '';

    // --- Counts (for the one-line summary headers) ---
    const counts = {
      trials: trialCompetitors.length,
      discontinued: discontinuedSignals.length,
      labs: labCompetitors.length,
      keyPublications: keyPublications.length,
      inherentAdvantages: incumbentRows.length,
      ventureOwnPublications: lit.venture_evidence_position?.own_publications_found || 0,
      ventureOwnTrials: lit.venture_evidence_position?.own_trials_found || 0
    };

    return {
      // Solution-Value-side
      statusQuoSummary,
      incumbentLimitations,
      incumbentRows,
      pathwayMaturity,
      validation: {
        verdict: validation.venture_tech_validated || 'insufficient_data',
        independentReplication: !!validation.independent_replication,
        summary: validation.evidence_summary || ''
      },
      duplication: {
        verdict: duplication.existing_tech_achieves_same_outcome || 'no',
        summary: duplication.differentiation_summary || ''
      },

      // Competitive-side
      trialCompetitors,
      discontinuedSignals,
      labCompetitors,

      // Shared / sources
      keyPublications,
      counts,
      confidence,
      confidenceJustification,

      // Convenience flags for caller use
      isBiomedical: clinical !== null,
      hasAnyCompetitiveSignal: trialCompetitors.length > 0
        || labCompetitors.length > 0
        || discontinuedSignals.length > 0
    };
  }
};

window.LiteratureAPI = LiteratureAPI;
