// js/components/assessment-loader.js — shared "render a queue row's evidence
// JSON into the v03 assessment view" core.
//
// Extracted from advisor-queue-view.openAssessment so the read-only external
// (university) view can reuse the exact same runner-output -> assessment-view
// shaping without forking it. This function is PURE rendering: it hydrates the
// state-manager, resets bleed from a previously-opened venture, bridges the
// queue-row fields into the v03 inputs, shapes each dimension via the per-API
// processResponse(), loads it into the assessment view, and does the initial
// summary render.
//
// It deliberately does NOT do the advisor-only steps:
//   - the v03 prior-score fetch/pre-populate (external has no scores + can't
//     call smartsheet_get), and
//   - setting window.__v04_currentQueueRowId (the "mark this row Reviewed on
//     final submit" hook).
// Those stay in advisor-queue-view.openAssessment, after this call.

window.AssessmentLoader = {
  /**
   * @param {Object} assessment  the evidence JSON ({ company, team, funding, ... })
   * @param {Object} row         the queue row (VentureName, Institution, ...)
   */
  loadEvidenceIntoView(assessment, row) {
    row = row || {};

    // Hydrate v03's state-manager with the assessment so the existing
    // assessment-view renders. Shape is what the runner composed.
    const state = window.app?.stateManager;
    if (state && typeof state.restoreAssessment === 'function') {
      state.restoreAssessment(assessment);
    } else if (state) {
      state.state = state.state || {};
      state.state.assessment = assessment;
      state.state.ventureName  = row.VentureName;
      state.state.advisorName  = row.AdvisorName;
      state.state.portfolio    = row.Portfolio;
      state.state.institution  = row.Institution;
      state.state.technologyDescription = row.TechnologyDescription;
      state.state.technologyDomain      = row.TechnologyDomain;
    }

    // Reveal the v03 assessment view section. The results section has BOTH
    // `hidden` (v03's hide class) and `v04-hidden` at page load — remove both.
    // (Each caller hides its own source pane before calling this.)
    const av = document.getElementById('results-section');
    if (av) { av.classList.remove('v04-hidden'); av.classList.remove('hidden'); }

    // Reset everything from the previously-opened venture so nothing bleeds through.
    const smReset = window.app?.stateManager;
    try { smReset?.clearVentureDecisions?.(); } catch (e) { Debug.warn('[v04] clearVentureDecisions failed:', e); }
    try { smReset?.saveFinalRecommendation?.(''); } catch (e) { Debug.warn('[v04] saveFinalRecommendation reset failed:', e); }
    try { window.assessmentView?.reset?.(); } catch (e) { Debug.warn('[v04] assessmentView.reset failed:', e); }
    document.querySelectorAll('input[name="venture-verdict"], input[name="venture-track"], input[name="venture-pathway"]').forEach(r => { r.checked = false; });
    const dualUseCb = document.getElementById('venture-dual-use');
    if (dualUseCb) dualUseCb.checked = false;
    ['venture-institution', 'venture-tech-description', 'venture-tech-domain', 'venture-ecosystem-notes', 'final-recommendation-text']
      .forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
    const exportBtn = document.getElementById('export-btn');
    if (exportBtn) exportBtn.disabled = true;
    ['team', 'funding', 'competitive', 'market', 'iprisk', 'solutionvalue'].forEach(dim => {
      const card = document.getElementById(`${dim}-scoring-card`);
      if (card) card.classList.remove('has-submission');
      const btn = document.getElementById(`${dim}-submit-btn`);
      if (btn) { btn.classList.remove('update-mode'); btn.textContent = 'Submit Assessment'; }
    });

    // Update the venture-name header from the queue row.
    const nameEl = document.getElementById('venture-name-text');
    if (nameEl) nameEl.textContent = row.VentureName || '(unnamed opportunity)';

    // Bridge queue-row fields into the v03 inputs/state the submit path reads.
    const sm = window.app?.stateManager;
    const setInput = (id, val) => {
      const el = document.getElementById(id);
      if (el && val != null && val !== '') el.value = val;
    };
    if (row.AdvisorName) {
      setInput('sca-name', row.AdvisorName);
      try { localStorage.setItem('scaName', row.AdvisorName); } catch (e) { Debug.warn('[v04] scaName persist failed:', e); }
    }
    setInput('portfolio', row.Portfolio);
    setInput('venture-institution',      row.Institution);
    setInput('venture-tech-description', row.TechnologyDescription);
    setInput('venture-tech-domain',      row.TechnologyDomain);
    if (sm) {
      try {
        sm.saveInstitution?.(row.Institution || '');
        sm.saveTechnologyDescription?.(row.TechnologyDescription || '');
        sm.saveTechnologyDomain?.(row.TechnologyDomain || '');
      } catch (e) { console.warn('[v04] state-manager venture-field save failed:', e); }
    }

    // The runner stores raw Stack AI outputs per phase ({outputs: {'out-0','out-1'}}).
    // v03's per-API processResponse() transforms those into the { score, formatted, ... }
    // envelope assessment-view's loadXxxData methods expect.
    console.log('[v04] loadEvidenceIntoView evidence keys:', Object.keys(assessment || {}));
    const view = window.assessmentView;
    const a = assessment;
    if (!view || !a) {
      console.error('[v04] missing view or assessment', { view: !!view, assessment: !!a });
      return;
    }

    const shape = (label, api, raw) => {
      if (!raw) { console.warn(`[v04] ${label}: no data`); return null; }
      const hasOutputs = !!raw.outputs;
      const hasProcess = !!(api && typeof api.processResponse === 'function');
      if (hasOutputs && hasProcess) {
        try {
          const shaped = api.processResponse(raw);
          return shaped;
        } catch (e) {
          console.error(`[v04] ${label} processResponse failed:`, e);
          return null;
        }
      }
      return raw;
    };

    const tm = window.app?.tabManager;
    const enable = (tabId) => { try { tm?.enableTab(tabId); } catch (e) { Debug.warn('[v04] enableTab failed:', tabId, e); } };

    if (a.company) {
      try { view.loadCompanyData(a.company); enable('overview'); }
      catch (e) { console.error('[v04] loadCompanyData failed:', e); }
      // Auto-detect institution + tech-description + tech-domain from the
      // AI-extracted company data when the queue-row value is empty (mirrors
      // the live-run path). Never overwrites an explicit row value.
      if (window.VentureExtractors && sm) {
        try {
          const ventureUrl = row.VentureURL || '';
          if (!row.Institution) {
            const det = window.VentureExtractors.detectInstitution?.(ventureUrl, a.company, []);
            if (det) { sm.saveInstitution(det); setInput('venture-institution', det); }
          }
          if (!row.TechnologyDescription) {
            const desc = window.VentureExtractors.deriveTechnologyDescription?.(a.company);
            if (desc) { sm.saveTechnologyDescription(desc); setInput('venture-tech-description', desc); }
          }
          if (!row.TechnologyDomain) {
            const dom = window.VentureExtractors.extractTechnologyDomain?.(a.company);
            if (dom) { sm.saveTechnologyDomain(dom); setInput('venture-tech-domain', dom); }
          }
        } catch (e) { Debug.warn('[v04] auto-detect in loadEvidenceIntoView failed:', e); }
      }
    } else {
      console.warn('[v04] no company in assessment');
    }

    const team        = shape('team',        window.TeamAPI,        a.team);
    const funding     = shape('funding',     window.FundingAPI,     a.funding);
    const competitive = shape('competitive', window.CompetitiveAPI, a.competitive);
    const market      = shape('market',      window.MarketAPI,      a.market);
    const iprisk      = shape('iprisk',      window.IPRiskAPI,      a.iprisk);
    const literature  = shape('literature',  window.LiteratureAPI,  a.literature);
    const synthesis   = shape('synthesis',   window.SynthesisAPI,   a.synthesis);
    try {
      if (team)        { view.loadTeamData(team);               enable('team'); }
      if (funding)     { view.loadFundingData(funding);         enable('funding'); }
      // Load synthesis + literature BEFORE competitive so the competitive
      // section picks up the unified-competitor grid on its first render.
      if (synthesis && typeof view.loadSynthesisData === 'function') {
        view.loadSynthesisData(synthesis);
      }
      if (literature && typeof view.loadLiteratureData === 'function') {
        view.loadLiteratureData(literature);
      }
      if (competitive) { view.loadCompetitiveData(competitive, literature || null, synthesis || null); enable('competitive'); }
      if (market)      { view.loadMarketData(market);           enable('market'); }
      if (iprisk)      { view.loadIpRiskData(iprisk);           enable('iprisk'); }
      if (typeof view.loadSolutionValueEvidence === 'function') {
        view.loadSolutionValueEvidence();
        enable('solutionvalue');
      }
      enable('summary');

      // Always land on the Overview tab when opening an assessment.
      try { tm?.activateTab('overview'); } catch (e) { Debug.warn('[v04] activateTab(overview) failed:', e); }

      // Populate the summary tab up front so the full layout shows without a
      // per-dimension submit first.
      if (window.summaryView && view.data) {
        try {
          window.summaryView.update({
            company:     view.data.company,
            team:        view.data.team,
            funding:     view.data.funding,
            competitive: view.data.competitive,
            market:      view.data.market,
            iprisk:      view.data.iprisk
          });
        } catch (e) { Debug.warn('[v04] summaryView.update failed:', e); }
      }
    } catch (e) {
      console.error('[v04] loadXxxData failed:', e);
    }
  }
};
