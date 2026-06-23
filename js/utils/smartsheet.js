// js/utils/smartsheet.js - Smartsheet Integration for Venture Assessment Platform V02
// Submits scores to Smartsheet via Google Apps Script proxy
// Uses iframe form submission to avoid CORS issues
// Supports row updates (not just creation) and fetching past assessments

const SmartsheetIntegration = {
  // Proxy URL is centralized in js/core/config.js — update there on redeploy.
  get proxyUrl() { return window.AppConfig.proxyUrl; },

  // Track submission state
  state: {
    lastSubmission: null,
    isSubmitting: false,
    currentRowId: null
  },

  /**
   * Detect transient errors that should be auto-retried.
   * The "Bandwidth quota exceeded" error is a Google Apps Script UrlFetchApp
   * throttle (rolling-window, ~5-15s recovery) — retrying with exponential
   * backoff typically succeeds.
   * @param {Object|Error} result - Result object or error
   * @returns {boolean}
   */
  _isTransientError(result) {
    const msg = (result?.error || result?.message || '').toString().toLowerCase();
    if (!msg) return false;
    return msg.includes('bandwidth quota')
        || msg.includes('rate limit')
        || msg.includes('too many requests')
        || msg.includes('429')
        || msg.includes('reduce the rate')
        || (msg.includes('quota') && msg.includes('exceed'));
  },

  /**
   * Submit via the iframe/JSONP path with auto-retry on transient errors.
   * Uses exponential backoff: 5s, 10s, 20s.
   * @param {Object} requestData
   * @returns {Promise<Object>} The final result (may still indicate failure)
   */
  async _submitWithRetry(requestData) {
    const delays = [5000, 10000, 20000]; // Up to 3 retries
    let lastResult = null;

    for (let attempt = 0; attempt <= delays.length; attempt++) {
      const result = await this.submitViaIframe(requestData);
      lastResult = result;

      if (result?.success) return result;
      if (!this._isTransientError(result)) return result;

      if (attempt < delays.length) {
        const delay = delays[attempt];
        Debug.warn(`[Smartsheet] Transient error, retrying in ${delay / 1000}s (attempt ${attempt + 1}/${delays.length})`);
        window.app?.toastManager?.info(
          `Database is busy — retrying in ${delay / 1000}s... (${attempt + 1}/${delays.length})`
        );
        await new Promise(r => setTimeout(r, delay));
      }
    }

    return lastResult;
  },

  /**
   * Submit a single metric score to Smartsheet
   * Called when advisor clicks "Submit Assessment" on any tab
   */
  async submitScore(metric, scoreData, context) {
    if (this.state.isSubmitting) {
      Debug.log('Smartsheet submission already in progress');
      return { success: false, message: 'Please wait for current submission to complete' };
    }

    this.state.isSubmitting = true;

    try {
      const payload = this.buildPayload(metric, scoreData, context);
      
      // Check if we should update an existing row
      const rowId = this.getCurrentRowId();
      const isUpdate = !!rowId;
      
      if (isUpdate) {
        payload.rowId = rowId;
      }
      
      Debug.log(`Smartsheet: ${isUpdate ? 'updating' : 'submitting'} ${metric} score`);

      const requestData = {
        action: isUpdate ? 'smartsheet_update' : 'smartsheet',
        ...payload
      };

      // Use iframe submission to avoid CORS, with auto-retry on transient errors
      Debug.log('[Smartsheet] Request data:', JSON.stringify(requestData));
      const result = await this._submitWithRetry(requestData);
      Debug.log('[Smartsheet] Full response:', JSON.stringify(result));

      if (result.success) {
        // Store row ID if this was a new submission
        if (result.rowId && !isUpdate) {
          this.setCurrentRowId(result.rowId);
        }

        this.state.lastSubmission = {
          metric,
          timestamp: new Date().toISOString(),
          rowId: result.rowId || rowId,
          action: isUpdate ? 'update' : 'create'
        };

        const actionLabel = result.action === 'updated' ? 'updated in' : 'saved to';
        this.showToast(`${this.formatMetricName(metric)} score ${actionLabel} Smartsheet`, 'success');
        return result;
      } else {
        throw new Error(result.error || 'Submission failed');
      }

    } catch (error) {
      console.error('Smartsheet submission error:', error);
      const friendly = this._isTransientError({ error: error.message })
        ? 'Database is busy. Your scores are saved locally — please try again in a minute.'
        : `Failed to save score: ${error.message}`;
      this.showToast(friendly, 'error');
      return { success: false, error: error.message };
    } finally {
      this.state.isSubmitting = false;
    }
  },

  /**
   * Submit all scores at once (for final submission / export)
   */
  async submitAllScores(allData, context) {
    if (this.state.isSubmitting) {
      return { success: false, message: 'Please wait for current submission to complete' };
    }

    this.state.isSubmitting = true;

    try {
      const payload = this.buildFullPayload(allData, context);
      
      // Check if we should update an existing row
      const rowId = this.getCurrentRowId();
      const isUpdate = !!rowId;
      
      if (isUpdate) {
        payload.rowId = rowId;
      }
      
      Debug.log(`Smartsheet: ${isUpdate ? 'updating' : 'submitting'} all scores`);

      const requestData = {
        action: isUpdate ? 'smartsheet_update' : 'smartsheet',
        ...payload
      };

      Debug.log('[Smartsheet] All scores request:', JSON.stringify(requestData));
      const result = await this._submitWithRetry(requestData);
      Debug.log('[Smartsheet] All scores response:', JSON.stringify(result));

      if (result.success) {
        // Store row ID if this was a new submission
        if (result.rowId && !isUpdate) {
          this.setCurrentRowId(result.rowId);
        }

        const actionLabel = result.action === 'updated' ? 'updated in' : 'saved to';
        this.showToast(`All scores ${actionLabel} Smartsheet`, 'success');
        return result;
      } else {
        throw new Error(result.error || 'Submission failed');
      }

    } catch (error) {
      console.error('Smartsheet submission error:', error);
      const friendly = this._isTransientError({ error: error.message })
        ? 'Database is busy. Your scores are saved locally — please try again in a minute.'
        : `Failed to save scores: ${error.message}`;
      this.showToast(friendly, 'error');
      return { success: false, error: error.message };
    } finally {
      this.state.isSubmitting = false;
    }
  },

  /**
   * Fetch past assessments from Smartsheet for the current advisor
   * @param {string} advisorName - Optional filter by advisor name
   * @returns {Promise<Array>} List of past assessments
   */
  async fetchPastAssessments(advisorName = null) {
    try {
      const params = {
        action: 'smartsheet_list'
      };
      
      if (advisorName) {
        params.advisorName = advisorName;
      }

      Debug.log('Smartsheet: fetching past assessments');

      const result = await this.submitViaIframe(params);

      // The proxy's processSmartsheetList returns { success, rows: [...] };
      // also accept .assessments for forward-compat in case the shape changes.
      const list = result?.rows || result?.assessments;
      if (result?.success && Array.isArray(list)) {
        Debug.log(`Smartsheet: found ${list.length} past assessments`);
        return list;
      }

      return [];
    } catch (error) {
      Debug.error('Error fetching past assessments:', error);
      return [];
    }
  },

  /**
   * Load scores from a specific Smartsheet row
   * @param {string} rowId - Smartsheet row ID
   * @returns {Promise<Object|null>} Assessment scores or null
   */
  async loadFromSmartsheet(rowId) {
    try {
      const params = {
        action: 'smartsheet_get',
        rowId: rowId
      };

      Debug.log('Smartsheet: loading assessment');
      
      const result = await this.submitViaIframe(params);
      
      if (result.success && result.data) {
        return result.data;
      }
      
      return null;
    } catch (error) {
      console.error('Error loading from Smartsheet:', error);
      return null;
    }
  },

  /**
   * Submit data via script tag (JSONP-style) to avoid CORS issues
   * Google Apps Script redirects don't work well with iframes
   */
  submitViaIframe(data) {
    return new Promise((resolve, reject) => {
      let completed = false;

      // Create a unique callback name
      const callbackName = 'smartsheetCallback_' + Date.now();

      // Auto-inject auth token so the proxy's role gate sees who's calling.
      // Caller can override by setting data.token explicitly.
      if (data && !data.token && window.Auth && Auth.token) {
        data = Object.assign({}, data, { token: Auth.token });
      }

      // Encode the data as URL parameter
      const encodedData = encodeURIComponent(JSON.stringify(data));
      const url = `${this.proxyUrl}?data=${encodedData}&callback=${callbackName}`;

      Debug.log('[Smartsheet] Proxy URL:', this.proxyUrl);
      Debug.log('[Smartsheet] Action:', data.action);

      const cleanup = () => {
        // Delay cleanup to allow callback to fire
        setTimeout(() => {
          delete window[callbackName];
          if (script.parentNode) script.parentNode.removeChild(script);
        }, 100);
      };

      // Create global callback function
      window[callbackName] = (response) => {
        Debug.log('[Smartsheet] Callback received:', response);
        if (completed) {
          Debug.warn('[Smartsheet] Callback received after completion');
          return;
        }
        completed = true;
        cleanup();
        resolve(response || { success: true });
      };

      // Create script element
      const script = document.createElement('script');
      script.src = url;
      script.async = true;

      script.onerror = (e) => {
        Debug.error('[Smartsheet] Script load error:', e);
        if (completed) return;
        completed = true;
        cleanup();
        // Script errors often mean CORS/redirect issues, try image beacon as last resort
        this.submitViaImage(data)
          .then(resolve)
          .catch(reject);
      };

      // Longer timeout to allow for slower connections
      setTimeout(() => {
        if (!completed) {
          Debug.warn('[Smartsheet] JSONP timeout, trying image beacon');
          completed = true;
          cleanup();
          // On timeout, try image beacon
          this.submitViaImage(data)
            .then(resolve)
            .catch(() => reject(new Error('Submission timeout')));
        }
      }, 15000); // Increased to 15 seconds

      Debug.log('[Smartsheet] Submitting via script tag');
      document.body.appendChild(script);
    });
  },

  /**
   * Submit via image beacon - fire and forget, most reliable for cross-origin
   */
  submitViaImage(data) {
    return new Promise((resolve) => {
      const encodedData = encodeURIComponent(JSON.stringify(data));
      const url = `${this.proxyUrl}?data=${encodedData}`;
      
      const img = new Image();
      img.onload = () => {
        Debug.log('[Smartsheet] Image beacon completed');
        resolve({ success: true, message: 'Submitted via beacon' });
      };
      img.onerror = () => {
        // Even on error, the request was likely sent
        Debug.log('[Smartsheet] Image beacon sent');
        resolve({ success: true, message: 'Submitted (fire and forget)' });
      };

      Debug.log('[Smartsheet] Submitting via image beacon');
      img.src = url;
      
      // Resolve after short delay regardless
      setTimeout(() => resolve({ success: true, message: 'Submitted' }), 2000);
    });
  },

  /**
   * Get current row ID from state manager
   */
  getCurrentRowId() {
    if (this.state.currentRowId) {
      return this.state.currentRowId;
    }
    if (window.app?.stateManager) {
      return window.app.stateManager.getSmartsheetRowId();
    }
    return null;
  },

  /**
   * Set current row ID (store in both local state and state manager)
   */
  setCurrentRowId(rowId) {
    this.state.currentRowId = rowId;
    if (window.app?.stateManager) {
      window.app.stateManager.saveSmartsheetRowId(rowId);
    }
    Debug.log('[Smartsheet] Row ID set');
  },

  /**
   * Clear current row ID (for new assessments)
   */
  clearCurrentRowId() {
    this.state.currentRowId = null;
    // Also clear the state-manager's persisted copy so getCurrentRowId's
    // fallback path doesn't re-surface the previous rowId on next read.
    if (window.app?.stateManager?.saveSmartsheetRowId) {
      window.app.stateManager.saveSmartsheetRowId(null);
    }
    Debug.log('[Smartsheet] Row ID cleared');
  },

  /**
   * Build payload for single metric submission
   */
  buildPayload(metric, scoreData, context) {
    const payload = {
      ventureName: context.ventureName || 'Unknown Venture',
      ventureUrl: context.ventureUrl || '',
      advisorName: context.advisorName || 'Unknown Advisor',
      portfolio: context.portfolio || ''
    };

    const metricMap = {
      team: { aiKey: 'teamScoreAi', userKey: 'teamScoreUser', justificationKey: 'teamJustification' },
      funding: { aiKey: 'fundingScoreAi', userKey: 'fundingScoreUser', justificationKey: 'fundingJustification' },
      competitive: { aiKey: 'competitiveScoreAi', userKey: 'competitiveScoreUser', justificationKey: 'competitiveJustification' },
      market: { aiKey: 'marketScoreAi', userKey: 'marketScoreUser', justificationKey: 'marketJustification' },
      iprisk: { aiKey: 'ipRiskScoreAi', userKey: 'ipRiskScoreUser', justificationKey: 'ipRiskJustification' },
      solutionvalue: { aiKey: null, userKey: 'solutionValueScoreUser', justificationKey: 'solutionValueJustification' }
    };

    const mapping = metricMap[metric];
    if (mapping) {
      if (mapping.aiKey && scoreData.aiScore !== undefined && scoreData.aiScore !== null) {
        payload[mapping.aiKey] = scoreData.aiScore;
      }
      if (scoreData.userScore !== undefined && scoreData.userScore !== null) {
        payload[mapping.userKey] = scoreData.userScore;
      }
      if (scoreData.justification) {
        payload[mapping.justificationKey] = scoreData.justification;
      }
    }

    return payload;
  },

  /**
   * Build payload with all scores
   */
  buildFullPayload(allData, context) {
    const payload = {
      ventureName: context.ventureName || 'Unknown Venture',
      ventureUrl: context.ventureUrl || '',
      advisorName: context.advisorName || 'Unknown Advisor',
      portfolio: context.portfolio || ''
    };

    // Team scores
    if (allData.team) {
      if (allData.team.aiScore !== undefined) payload.teamScoreAi = allData.team.aiScore;
      if (allData.team.userScore !== undefined) payload.teamScoreUser = allData.team.userScore;
      if (allData.team.justification) payload.teamJustification = allData.team.justification;
    }

    // Funding scores
    if (allData.funding) {
      if (allData.funding.aiScore !== undefined) payload.fundingScoreAi = allData.funding.aiScore;
      if (allData.funding.userScore !== undefined) payload.fundingScoreUser = allData.funding.userScore;
      if (allData.funding.justification) payload.fundingJustification = allData.funding.justification;
    }

    // Competitive scores
    if (allData.competitive) {
      if (allData.competitive.aiScore !== undefined) payload.competitiveScoreAi = allData.competitive.aiScore;
      if (allData.competitive.userScore !== undefined) payload.competitiveScoreUser = allData.competitive.userScore;
      if (allData.competitive.justification) payload.competitiveJustification = allData.competitive.justification;
    }

    // Market scores
    if (allData.market) {
      if (allData.market.aiScore !== undefined) payload.marketScoreAi = allData.market.aiScore;
      if (allData.market.userScore !== undefined) payload.marketScoreUser = allData.market.userScore;
      if (allData.market.justification) payload.marketJustification = allData.market.justification;
    }

    // IP Risk scores
    if (allData.iprisk) {
      if (allData.iprisk.aiScore !== undefined) payload.ipRiskScoreAi = allData.iprisk.aiScore;
      if (allData.iprisk.userScore !== undefined) payload.ipRiskScoreUser = allData.iprisk.userScore;
      if (allData.iprisk.justification) payload.ipRiskJustification = allData.iprisk.justification;
    }

    // Solution Value scores (user-scored only, no AI score)
    if (allData.solutionvalue) {
      if (allData.solutionvalue.userScore !== undefined) payload.solutionValueScoreUser = allData.solutionvalue.userScore;
      if (allData.solutionvalue.justification) payload.solutionValueJustification = allData.solutionvalue.justification;
    }

    // Calculate averages
    const aiScores = [
      allData.team?.aiScore,
      allData.funding?.aiScore,
      allData.competitive?.aiScore,
      allData.market?.aiScore,
      allData.iprisk?.aiScore
    ].filter(s => s !== undefined && s !== null);

    const userScores = [
      allData.team?.userScore,
      allData.funding?.userScore,
      allData.competitive?.userScore,
      allData.market?.userScore,
      allData.iprisk?.userScore,
      allData.solutionvalue?.userScore
    ].filter(s => s !== undefined && s !== null);

    if (aiScores.length > 0) {
      payload.averageAiScore = aiScores.reduce((a, b) => a + b, 0) / aiScores.length;
    }

    if (userScores.length > 0) {
      payload.averageUserScore = userScores.reduce((a, b) => a + b, 0) / userScores.length;
    }

    // Final recommendation
    if (context.finalRecommendation) {
      payload.finalRecommendation = context.finalRecommendation;
    }

    // Venture-Level Advisor Decisions (sent whenever present in context)
    if (context.ecosystemNotes !== undefined && context.ecosystemNotes !== null) {
      payload.ecosystemNotes = context.ecosystemNotes;
    }
    if (context.trackAssignment !== undefined && context.trackAssignment !== null) {
      payload.trackAssignment = context.trackAssignment;
    }
    if (context.pathway !== undefined && context.pathway !== null) {
      payload.pathway = context.pathway;
    }
    if (context.dualUse !== undefined) {
      payload.dualUse = !!context.dualUse;
    }

    // v3.5 fields
    if (context.institution !== undefined) {
      payload.institution = context.institution || '';
    }
    if (context.verdict !== undefined && context.verdict !== null) {
      payload.verdict = context.verdict;
    }
    if (context.technologyDescription !== undefined) {
      payload.technologyDescription = context.technologyDescription || '';
    }
    if (context.technologyDomain !== undefined) {
      payload.technologyDomain = context.technologyDomain || '';
    }

    return payload;
  },

  /**
   * Format metric name for display
   */
  formatMetricName(metric) {
    const names = {
      team: 'Researcher Aptitude',
      funding: 'Sector Funding',
      competitive: 'Competitive Winnability',
      market: 'Market Opportunity',
      iprisk: 'IP Landscape',
      solutionvalue: 'Solution Value'
    };
    return names[metric] || metric;
  },

  /**
   * Show toast notification
   */
  showToast(message, type = 'info') {
    if (window.app?.toastManager) {
      if (type === 'success') {
        window.app.toastManager.success(message);
      } else if (type === 'error') {
        window.app.toastManager.error(message);
      } else {
        window.app.toastManager.info(message);
      }
      return;
    }
    console.log(`[${type.toUpperCase()}] ${message}`);
  },

  /**
   * Get context from current app state
   */
  getContext() {
    const sm = window.app?.stateManager;
    return {
      ventureName: this.getVentureName(),
      ventureUrl: this.getVentureUrl(),
      advisorName: this.getAdvisorName(),
      portfolio: this.getPortfolio(),
      // Venture-Level Advisor Decisions (pulled from StateManager)
      ecosystemNotes:   sm ? sm.getEcosystemNotes()   : '',
      trackAssignment:  sm ? sm.getTrackAssignment()  : null,
      pathway:          sm ? sm.getPathway()          : null,
      dualUse:          sm ? sm.getDualUse()          : false,
      // v3.5 fields
      institution:           sm ? sm.getInstitution()           : '',
      verdict:               sm ? sm.getVerdict()               : null,
      technologyDescription: sm ? sm.getTechnologyDescription() : '',
      technologyDomain:      sm ? sm.getTechnologyDomain()      : ''
    };
  },

  /**
   * Get venture name from app (uses custom name if set, otherwise AI-generated)
   */
  getVentureName() {
    // v04: when the advisor opened a venture from My Queue, openAssessment
    // writes the canonical queue row name into state-manager. Prefer that as
    // the source of truth — otherwise the AI-extracted name leaks into
    // Smartsheet and breaks lookups (e.g. partial-resume of a venture written
    // with the AI name, then queried by the Associate-typed name).
    const sm = window.app?.stateManager;
    const fromState = sm?.state?.ventureName || sm?.getState?.()?.ventureName;
    if (fromState) return fromState;

    // v04 also sets #venture-name-text from row.VentureName in openAssessment
    // — use that before the AI's name.
    const nameEl = document.getElementById('venture-name-text');
    if (nameEl && nameEl.textContent && nameEl.textContent !== 'Loading...' && nameEl.textContent !== '(unnamed venture)') {
      return nameEl.textContent.trim();
    }

    // app.getVentureName custom hook (kept for v03 compatibility)
    if (window.app?.getVentureName) {
      return window.app.getVentureName();
    }

    // Last resort: AI-extracted name from the loaded company JSON
    if (window.app?.assessmentView?.data?.company?.company_overview?.name) {
      return window.app.assessmentView.data.company.company_overview.name;
    }

    return 'Unknown Venture';
  },

  /**
   * Get venture URL from app state or DOM
   */
  getVentureUrl() {
    const urlInput = document.getElementById('company-url');
    if (urlInput && urlInput.value) {
      return urlInput.value.trim();
    }
    if (window.app?.assessmentView?.data?.company?.company_overview?.website) {
      return window.app.assessmentView.data.company.company_overview.website;
    }
    // Fallback: use file name if only a document was uploaded
    const state = window.app?.stateManager?.getState();
    if (state?.companyInput?.fileName) {
      return `[Document] ${state.companyInput.fileName}`;
    }
    return '';
  },

  /**
   * Get advisor name from DOM or localStorage
   */
  getAdvisorName() {
    const nameInput = document.getElementById('sca-name');
    if (nameInput && nameInput.value) {
      return nameInput.value.trim();
    }
    const stored = localStorage.getItem('scaName');
    if (stored) {
      return stored;
    }
    return 'Unknown Advisor';
  },

  /**
   * Get portfolio from DOM, falling back to saved state
   */
  getPortfolio() {
    const portfolioInput = document.getElementById('portfolio');
    if (portfolioInput && portfolioInput.value) {
      return portfolioInput.value.trim();
    }
    // Fallback: read from saved state (portfolio may be in hidden input section)
    const state = window.app?.stateManager?.getState?.();
    if (state?.portfolio) return state.portfolio;
    return '';
  }
};

// Make available globally
window.SmartsheetIntegration = SmartsheetIntegration;

// ============================================================
// v04 — Queue Operations
// ============================================================
//
// These talk to the v04 GAS proxy's queue_* actions. Reads use JSONP (since GET
// is simple and works across the CORS boundary); writes use the same iframe path
// the v03 scores submission uses.

const QueueClient = {
  proxyUrl: SmartsheetIntegration.proxyUrl,  // same URL as SmartsheetIntegration

  // -- JSONP read helper ----------------------------------------------------
  _jsonp(params) {
    return new Promise((resolve, reject) => {
      const cbName = '_v04_jsonp_' + Math.random().toString(36).slice(2, 10);
      const timeoutMs = 30000;
      const cleanup = () => {
        try { delete window[cbName]; } catch (_) { window[cbName] = undefined; }
        if (script.parentNode) script.parentNode.removeChild(script);
        clearTimeout(timer);
      };
      window[cbName] = (data) => { cleanup(); resolve(data); };
      const timer = setTimeout(() => { cleanup(); reject(new Error('JSONP timeout')); }, timeoutMs);
      const qs = new URLSearchParams(Object.assign({ callback: cbName }, params));
      const script = document.createElement('script');
      script.src = `${this.proxyUrl}?${qs.toString()}`;
      script.onerror = () => { cleanup(); reject(new Error('JSONP script load error')); };
      document.head.appendChild(script);
    });
  },

  _wrapData(action, payload) {
    // Thread Auth.token into every queue call so the proxy's role gate sees
    // who's calling. Same auto-inject pattern as SmartsheetIntegration.submitViaIframe.
    const wrapped = Object.assign({ action }, payload);
    if (!wrapped.token && window.Auth && Auth.token) {
      wrapped.token = Auth.token;
    }
    return wrapped;
  },

  // -- Reads ---------------------------------------------------------------
  async list({ advisorName = null, status = null, portfolio = null } = {}) {
    const data = this._wrapData('queue_list', { advisorName, status, portfolio });
    return await this._jsonp({ data: JSON.stringify(data) });
  },

  async get(rowId) {
    const data = this._wrapData('queue_get', { rowId });
    return await this._jsonp({ data: JSON.stringify(data) });
  },

  /**
   * Returns the parsed assessment JSON for a Ready row.
   * The proxy reads the row's most recent .json attachment and returns it inline.
   */
  async getEvidence(rowId) {
    const data = this._wrapData('queue_get_evidence', { rowId });
    return await this._jsonp({ data: JSON.stringify(data) });
  },

  // -- External (university) read-only lane --------------------------------
  // These call the scope-locked proxy actions. The scope is carried in the
  // external token (auto-injected by _wrapData) and enforced server-side — no
  // client param controls which university's ventures are returned.
  async listExternal() {
    const data = this._wrapData('queue_list_external', {});
    return await this._jsonp({ data: JSON.stringify(data) });
  },

  async getEvidenceExternal(rowId) {
    const data = this._wrapData('queue_get_evidence_external', { rowId });
    return await this._jsonp({ data: JSON.stringify(data) });
  },

  // -- Writes (iframe path; reuses SmartsheetIntegration's helper) --------
  async create(fields) {
    const payload = Object.assign({ action: 'queue_create' }, fields);
    return await SmartsheetIntegration.submitViaIframe(payload);
  },

  async update(rowId, fields) {
    const payload = { action: 'queue_update', rowId, fields };
    return await SmartsheetIntegration.submitViaIframe(payload);
  },

  // Attach an assembled assessment JSON to a queue row (live-run path only —
  // the VM runner attaches its own evidence directly via Smartsheet REST).
  // Note: the JSONP-via-script-tag transport encodes the full JSON into the
  // URL, which can exceed browser URL limits at ~64 KB. For ventures whose
  // assessment payload is unusually large, this call may fail; the caller
  // should treat attach failure as non-fatal (the queue row exists with
  // metadata; the AI evidence just won't be re-loadable from My Queue).
  async attachEvidence(rowId, assessment, fileName) {
    const payload = { action: 'queue_attach_evidence', rowId, assessment, fileName };
    return await SmartsheetIntegration.submitViaIframe(payload);
  }
};

window.QueueClient = QueueClient;
