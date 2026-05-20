// js/api/synthesis.js - Unified Evidence Synthesis API (Proxied)
//
// Calls the Stack AI Synthesis workflow (one workflow, two LLM nodes producing
// `out-0` and `out-1`) and shapes both outputs into:
//   { competitive, sv, formatted }
//
// The synthesis flow is the v04.2 addition that consolidates the Competitive
// flow output and the Literature Review output into:
//   * out-0 (synthesis-competitive) — a deduped unified_competitors[] with
//     multi-source badges + Reranker scores carried through inline + a
//     2-3 paragraph competitive_narrative.
//   * out-1 (synthesis-sv) — a value_prop_rows[] table (one row per claim,
//     with multi-source evidence + reconciled summary) + an sv_lead_narrative
//     + sv_unmet_need_framing + domain/incumbent_label/source_label.
//
// Synthesis is NOT a scored dimension. It's contextual evidence that the
// Competitive section and Solution Value section consume to render a unified
// view. The 1-9 score on Competitive still comes from the Grader; the SV
// score is still human-entered.
//
// Graceful degradation: if any required field is missing or the response is
// malformed, processResponse throws — the caller should surface a soft toast
// and let the frontend fall back to the v04.1 layout (separate panels, two
// SV tables).

const SynthesisAPI = {
  config: {
    timeout: 240000 // 4 minutes — synthesis is fast (two GPT-5 calls, no tools)
  },

  /**
   * Run the synthesis workflow.
   *
   * @param {object} inputs - { ventureSummary, competitiveJson, literatureJson, companySvJson }
   *   - ventureSummary (string): the upstream downstream_summary text.
   *   - competitiveJson (string|object): the v04.2 Competitive flow's out-0
   *     consolidated output. If an object is passed, it's JSON-stringified.
   *   - literatureJson (string|object): the Scientific Evidence flow's output.
   *     Narrative fields should be stripped by the caller before pass-in (see
   *     synthesis_flow_reference.md for the field list). If an object is
   *     passed, it's JSON-stringified.
   *   - companySvJson (string|object): the company flow's solution_value
   *     subtree. If an object, it's JSON-stringified.
   * @param {AbortSignal} abortSignal - optional abort signal.
   */
  async analyze({ ventureSummary, competitiveJson, literatureJson, companySvJson }, abortSignal = null) {
    if (!ventureSummary || typeof ventureSummary !== 'string') {
      throw new Error('Synthesis: ventureSummary is required');
    }

    const toText = (v) => {
      if (v === null || v === undefined) return '';
      if (typeof v === 'string') return v;
      try { return JSON.stringify(v); } catch (_) { return String(v); }
    };

    const payload = {
      'user_id': StackProxy.buildUserId('synthesis'),
      'in-0': ventureSummary.trim(),
      'in-1': toText(competitiveJson),
      'in-2': toText(literatureJson),
      'in-3': toText(companySvJson)
    };

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.config.timeout);

    if (abortSignal) {
      abortSignal.addEventListener('abort', () => controller.abort());
    }

    try {
      const data = await window.StackProxy.call('synthesis', payload, controller.signal);
      clearTimeout(timeoutId);
      return this.processResponse(data);
    } catch (error) {
      clearTimeout(timeoutId);
      if (error.name === 'AbortError') {
        throw new Error('Synthesis timeout or cancelled');
      }
      throw error;
    }
  },

  /**
   * Strip the literature output's narrative fields before passing as in-2 to
   * the synthesis flow. Keeps the input lean per the prompt's design — the
   * narrative fields are duplicate text synthesis would otherwise rewrite.
   *
   * Caller-side stripping (not inside the Stack AI flow) so we can adjust
   * what's stripped without redeploying. See synthesis_flow_reference.md
   * "Caller-side input shaping" for the rationale.
   *
   * @param {object} literatureRaw - the parsed lit-review JSON output
   * @returns {object} a deep copy with narrative fields removed
   */
  stripLiteratureNarratives(literatureRaw) {
    if (!literatureRaw || typeof literatureRaw !== 'object') return literatureRaw;
    let lit;
    try { lit = JSON.parse(JSON.stringify(literatureRaw)); }
    catch (_) { return literatureRaw; }

    if (lit.validation_assessment && typeof lit.validation_assessment === 'object') {
      delete lit.validation_assessment.evidence_summary;
    }
    if (lit.duplication_assessment && typeof lit.duplication_assessment === 'object') {
      delete lit.duplication_assessment.differentiation_summary;
    }
    if (lit.pathway_signals && typeof lit.pathway_signals === 'object') {
      delete lit.pathway_signals.analog_progress_summary;
    }
    delete lit.data_confidence_justification;
    return lit;
  },

  /**
   * Shape the Stack AI response into { competitive, sv, formatted }.
   * Synthesis has two output nodes (out-0 = synthesis-competitive,
   * out-1 = synthesis-sv).
   */
  processResponse(data) {
    const outputs = data?.outputs || {};
    const rawCompetitive = outputs['out-0'];
    const rawSv          = outputs['out-1'];

    if (!rawCompetitive || !rawSv) {
      throw new Error('Synthesis: missing out-0 or out-1');
    }

    const competitive = this.parseOutput(rawCompetitive, 'synthesis-competitive');
    if (!competitive || typeof competitive !== 'object') {
      throw new Error('Synthesis: invalid out-0 (synthesis-competitive)');
    }
    const sv = this.parseOutput(rawSv, 'synthesis-sv');
    if (!sv || typeof sv !== 'object') {
      throw new Error('Synthesis: invalid out-1 (synthesis-sv)');
    }

    return {
      competitive,
      sv,
      formatted: this.formatForDisplay(competitive, sv)
    };
  },

  /**
   * Parse a Stack AI output value that may be string or object.
   * Same markdown-stripping pattern as competitive.js / literature.js.
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
    if (trimmed.startsWith('```'))     trimmed = trimmed.slice(3);
    if (trimmed.endsWith('```'))       trimmed = trimmed.slice(0, -3);
    trimmed = trimmed.trim();

    try {
      return JSON.parse(trimmed);
    } catch (error) {
      console.error(`Failed to parse ${label}:`, error);
      return null;
    }
  },

  /**
   * Shape the two outputs into a display-ready envelope. Both nodes
   * independently produce domain/source_label; prefer the SV node's
   * incumbent_label since it has more SV context to draw from, and prefer
   * either node's domain/source_label (they should agree; if they don't,
   * the SV node wins).
   */
  formatForDisplay(comp, sv) {
    // Unified competitor list, ordered for the UI. Sort by:
    //   1. category priority (direct > indirect > substitute > academic_only > discontinued)
    //   2. then threat_score desc (high threats first within the same category)
    //   3. then relevance_score desc
    //   4. then name asc
    const catOrder = {
      direct: 0, indirect: 1, substitute: 2, academic_only: 3, discontinued: 4
    };
    const unifiedCompetitors = Array.isArray(comp.unified_competitors)
      ? comp.unified_competitors.slice().sort((a, b) => {
          const ca = catOrder[a.category] ?? 9;
          const cb = catOrder[b.category] ?? 9;
          if (ca !== cb) return ca - cb;
          const ta = (a.threat_score === null || a.threat_score === undefined) ? -1 : a.threat_score;
          const tb = (b.threat_score === null || b.threat_score === undefined) ? -1 : b.threat_score;
          if (ta !== tb) return tb - ta;
          const ra = (a.relevance_score === null || a.relevance_score === undefined) ? -1 : a.relevance_score;
          const rb = (b.relevance_score === null || b.relevance_score === undefined) ? -1 : b.relevance_score;
          if (ra !== rb) return rb - ra;
          return String(a.name || '').localeCompare(String(b.name || ''));
        })
      : [];

    // Value-prop rows: keep order from the synthesis output (it's already
    // domain-ordered by importance per the prompt). Drop rows with no claim
    // AND no incumbent baseline (defensive — shouldn't happen).
    const valuePropRows = Array.isArray(sv.value_prop_rows)
      ? sv.value_prop_rows.filter(r => r && (r.venture_claim || r.incumbent_baseline))
      : [];

    return {
      // Domain / incumbent / source label — prefer SV node's values when both nodes set them
      domain:         sv.domain || comp.domain || 'other',
      incumbentLabel: sv.incumbent_label || 'current state of the art',
      sourceLabel:    sv.source_label || comp.source_label || 'Scientific literature & public registries',

      // Competitive-side
      unifiedCompetitors,
      competitiveNarrative: comp.competitive_narrative || '',

      // SV-side
      valuePropRows,
      svLeadNarrative:    sv.sv_lead_narrative || '',
      svUnmetNeedFraming: sv.sv_unmet_need_framing || '',

      // Confidence — surface both nodes' calls
      competitiveConfidence:              comp.data_confidence || 'Medium',
      competitiveConfidenceJustification: comp.data_confidence_justification || '',
      svConfidence:                       sv.data_confidence || 'Medium',
      svConfidenceJustification:          sv.data_confidence_justification || '',

      // Counts (UI uses these for empty-state suppression + summary chips)
      counts: {
        unifiedCompetitors:  unifiedCompetitors.length,
        valuePropRows:       valuePropRows.length,
        // Per-source breakdowns on the competitor list — used for the
        // Detailed-tab section ordering and any summary chips.
        sourceTypes: unifiedCompetitors.reduce((acc, c) => {
          for (const s of (c.sources || [])) {
            if (s && s.type) acc[s.type] = (acc[s.type] || 0) + 1;
          }
          return acc;
        }, {})
      }
    };
  }
};

window.SynthesisAPI = SynthesisAPI;
