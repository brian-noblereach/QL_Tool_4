// js/core/state-manager.js
// State Persistence Component
//
// Manages localStorage operations for:
// - Checkpointing analysis progress
// - Recovering from interruptions
// - Multi-venture state isolation
// - Caching full assessments for reload
// - Tracking Smartsheet row IDs for updates

class StateManager {
  constructor() {
    // v04: localStorage keys standardized under noblereach_v04_*. The old
    // v03 keys (noblereach_qa_state, noblereach_assessments) are migrated
    // once on init — see _migrateLegacyStorageKeys.
    this.storageKey = 'noblereach_v04_state';
    this.assessmentCacheKey = 'noblereach_v04_assessments';
    this.legacyStorageKey = 'noblereach_qa_state';
    this.legacyAssessmentCacheKey = 'noblereach_assessments';
    this.version = '2.1'; // Bumped for new assessment caching
    this.storageAvailable = true;
    this._storageHealthy = true;
    this._lastStorageWarningTime = 0;
    // Auto-expire cached assessments after this many days
    this.cacheMaxAgeDays = 90;
    this.cacheMaxEntries = 50;
    // Trailing-debounce window for saveState so a slider drag (~50 events/s)
    // doesn't fire 50 stringify+setItem cycles. flushPendingSave() flushes
    // immediately and is called from submit handlers / before navigation.
    this._saveDebounceMs = 200;
    this._saveDebounceTimer = null;
    this._pendingState = null;
  }

  init() {
    Debug.log('StateManager initialized');
    this.checkStorageAvailability();
    if (this.storageAvailable) {
      // One-time migration from the v03-era noblereach_qa_* / noblereach_assessments
      // keys to the v04 noblereach_v04_* namespace. Runs only when the new key
      // is absent and the old key exists, so it's a no-op for fresh installs
      // and for anyone who already migrated.
      this._migrateLegacyStorageKeys();
      this.migrateIfNeeded();
    }
    // Flush any pending debounced save on tab close so the user doesn't lose
    // the most recent 0-200ms of edits.
    window.addEventListener('beforeunload', () => this.flushPendingSave());
  }

  _migrateLegacyStorageKeys() {
    const moves = [
      [this.legacyStorageKey,          this.storageKey],
      [this.legacyAssessmentCacheKey,  this.assessmentCacheKey]
    ];
    for (const [oldKey, newKey] of moves) {
      try {
        if (localStorage.getItem(newKey) != null) continue;  // already migrated
        const legacy = localStorage.getItem(oldKey);
        if (legacy == null) continue;                        // nothing to migrate
        localStorage.setItem(newKey, legacy);
        localStorage.removeItem(oldKey);
        Debug.log(`[StateManager] Migrated ${oldKey} → ${newKey}`);
      } catch (e) {
        Debug.warn(`[StateManager] Migration ${oldKey} → ${newKey} failed:`, e);
      }
    }
  }

  /**
   * Probe localStorage with a test write/read/delete cycle.
   * Sets this.storageAvailable to false if storage is inaccessible.
   * @returns {boolean} Whether localStorage is available
   */
  checkStorageAvailability() {
    try {
      const testKey = '__storage_test__';
      localStorage.setItem(testKey, '1');
      const val = localStorage.getItem(testKey);
      localStorage.removeItem(testKey);
      if (val !== '1') {
        this.storageAvailable = false;
      }
    } catch (e) {
      this.storageAvailable = false;
    }
    if (!this.storageAvailable) {
      Debug.error('[StateManager] localStorage is not available (private browsing or storage blocked)');
    }
    return this.storageAvailable;
  }

  // ========== CURRENT SESSION STATE ==========

  checkpoint(phaseKey, phaseData) {
    if (!this.storageAvailable) return;
    const currentState = this.getState() || this.createEmptyState();

    currentState.completedPhases = currentState.completedPhases || {};
    currentState.completedPhases[phaseKey] = phaseData;
    currentState.timestamp = Date.now();
    currentState.status = 'in_progress';

    if (!this.saveState(currentState)) {
      Debug.error('[StateManager] Checkpoint failed for phase:', phaseKey);
    } else {
      Debug.log('Checkpoint saved:', phaseKey);
    }
  }

  hasIncompleteAnalysis() {
    const state = this.getState();
    if (!state) return false;
    
    // Check if status is in_progress and has some completed phases
    if (state.status !== 'in_progress') return false;
    
    const completedCount = Object.keys(state.completedPhases || {}).length;
    return completedCount > 0 && completedCount < 6;
  }

  getState() {
    // If a debounced save is in flight, the in-memory copy is the freshest
    // truth ” return it so callers don't see a stale localStorage read.
    if (this._pendingState) return this._pendingState;
    try {
      const saved = localStorage.getItem(this.storageKey);
      if (!saved) return null;

      const state = JSON.parse(saved);

      // Version check - allow 2.0 and 2.1
      if (state.version && !state.version.startsWith('2.')) {
        Debug.log('State version mismatch, clearing');
        this.clearState();
        return null;
      }

      return state;
    } catch (error) {
      Debug.error('Error reading state:', error);
      return null;
    }
  }

  saveState(state) {
    if (!this.storageAvailable) {
      this._notifySaveFailure('storage_unavailable');
      return false;
    }
    state.version = this.version;
    // Replace any in-flight pending state with the latest snapshot and
    // (re)arm the trailing debounce. Returns true optimistically ” the
    // actual setItem happens on the next flush. Callers that need the
    // write to land before navigation should call flushPendingSave().
    this._pendingState = state;
    if (this._saveDebounceTimer) clearTimeout(this._saveDebounceTimer);
    this._saveDebounceTimer = setTimeout(() => this._writePendingState(), this._saveDebounceMs);
    return true;
  }

  _writePendingState() {
    if (this._saveDebounceTimer) {
      clearTimeout(this._saveDebounceTimer);
      this._saveDebounceTimer = null;
    }
    const state = this._pendingState;
    if (!state) return true;
    this._pendingState = null;
    try {
      localStorage.setItem(this.storageKey, JSON.stringify(state));
      return true;
    } catch (error) {
      Debug.error('[StateManager] Error saving state:', error);
      this._storageHealthy = false;
      this._notifySaveFailure('saveState');
      return false;
    }
  }

  // Public: flush any pending debounced save right now. Call before submit /
  // navigation / page-unload so the latest in-memory state lands in storage.
  flushPendingSave() {
    return this._writePendingState();
  }

  /**
   * Notify user of a localStorage save failure via toast.
   * Debounced to avoid flooding the user with repeated warnings.
   * @param {string} context - Descriptive context for the failure (for logging)
   */
  _notifySaveFailure(context) {
    const now = Date.now();
    if (now - this._lastStorageWarningTime < 30000) return; // Debounce: 30s
    this._lastStorageWarningTime = now;
    Debug.error('[StateManager] Save failure:', context);
    window.app?.toastManager?.warning(
      'Unable to save locally. Your scores will still submit to Smartsheet, but cannot be recovered if you close this tab.'
    );
  }

  clearState() {
    localStorage.removeItem(this.storageKey);
    Debug.log('State cleared');
  }

  createEmptyState() {
    return {
      version: this.version,
      timestamp: Date.now(),
      status: 'idle',
      companyInput: null,
      completedPhases: {},
      userScores: {},
      scaName: null,
      smartsheetRowId: null,
      assessmentKey: null,
      finalRecommendation: '',
      customVentureName: null,
      // Venture-level advisor decisions (no AI phase; Summary tab)
      ecosystemNotes: '',
      trackAssignment: null,    // 1 | 2 | 3 | null
      pathway: null,            // 'license' | 'company' | 'both' | null
      dualUse: false,
      // v3.5 additions ” captured to Smartsheet alongside the venture-level decisions
      institution: '',          // free-text; auto-detected, advisor can edit
      verdict: null,            // 'yes' | 'hold' | 'no' | null
      technologyDescription: '', // free-text; auto-filled, advisor can edit
      technologyDomain: ''      // free-text; auto-filled by AI, advisor can edit
    };
  }

  setCompanyInput(url, scaName, fileName = null, portfolio = null) {
    const state = this.getState() || this.createEmptyState();
    state.companyInput = { url, scaName, fileName };
    state.scaName = scaName;
    state.portfolio = portfolio;
    state.status = 'in_progress';
    state.timestamp = Date.now();
    state.assessmentKey = this.generateAssessmentKey(url, scaName, fileName);
    this.saveState(state);
  }

  getCompanyInput() {
    const state = this.getState();
    return state ? state.companyInput : null;
  }

  saveUserScore(dimension, scoreData) {
    if (!this.storageAvailable) return;
    const state = this.getState() || this.createEmptyState();

    state.userScores = state.userScores || {};
    // Merge so partial updates (e.g. drafting a justification) don't blow away
    // submitted/timesSubmitted set by an earlier Submit click.
    const existing = state.userScores[dimension] || { score: null, justification: '', submitted: false, timesSubmitted: 0 };
    state.userScores[dimension] = { ...existing, ...scoreData };
    state.timestamp = Date.now();
    this.saveState(state);
    this._scheduleCacheSync();
  }

  getUserScores() {
    const state = this.getState();
    return state ? state.userScores : {};
  }

  /**
   * Save final recommendation text
   * @param {string} text - The recommendation text
   */
  saveFinalRecommendation(text) {
    if (!this.storageAvailable) return;
    const state = this.getState() || this.createEmptyState();
    state.finalRecommendation = text;
    state.timestamp = Date.now();
    this.saveState(state);
    this._scheduleCacheSync();
  }

  /**
   * Get saved final recommendation text
   * @returns {string} The recommendation text or empty string
   */
  getFinalRecommendation() {
    const state = this.getState();
    return state?.finalRecommendation || '';
  }

  /**
   * Save custom venture name (user override of AI-generated name)
   * @param {string} name - The custom venture name
   */
  saveCustomVentureName(name) {
    if (!this.storageAvailable) return;
    const state = this.getState() || this.createEmptyState();
    state.customVentureName = name || null;
    state.timestamp = Date.now();
    this.saveState(state);
    this._scheduleCacheSync();
  }

  /**
   * Get custom venture name if set
   * @returns {string|null} The custom name or null
   */
  getCustomVentureName() {
    const state = this.getState();
    return state?.customVentureName || null;
  }

  // ========== VENTURE-LEVEL ADVISOR DECISIONS ==========

  /**
   * Save the Local Ecosystem Activation notes
   * @param {string} text - Free-text notes about local ecosystem partners
   */
  saveEcosystemNotes(text) {
    if (!this.storageAvailable) return;
    const state = this.getState() || this.createEmptyState();
    state.ecosystemNotes = text || '';
    state.timestamp = Date.now();
    this.saveState(state);
    this._scheduleCacheSync();
  }

  getEcosystemNotes() {
    const state = this.getState();
    return state?.ecosystemNotes || '';
  }

  /**
   * Save Track assignment (1, 2, or 3)
   * @param {number|null} track - 1, 2, 3, or null to clear
   */
  saveTrackAssignment(track) {
    if (!this.storageAvailable) return;
    const state = this.getState() || this.createEmptyState();
    const valid = (track === 1 || track === 2 || track === 3) ? track : null;
    state.trackAssignment = valid;
    state.timestamp = Date.now();
    this.saveState(state);
    this._scheduleCacheSync();
  }

  getTrackAssignment() {
    const state = this.getState();
    return state?.trackAssignment ?? null;
  }

  /**
   * Save Pathway choice
   * @param {string|null} pathway - 'license' | 'company' | 'both' | null
   */
  savePathway(pathway) {
    if (!this.storageAvailable) return;
    const state = this.getState() || this.createEmptyState();
    const valid = ['license', 'company', 'both'].includes(pathway) ? pathway : null;
    state.pathway = valid;
    state.timestamp = Date.now();
    this.saveState(state);
    this._scheduleCacheSync();
  }

  getPathway() {
    const state = this.getState();
    return state?.pathway ?? null;
  }

  /**
   * Save Dual-use flag
   * @param {boolean} flag
   */
  saveDualUse(flag) {
    if (!this.storageAvailable) return;
    const state = this.getState() || this.createEmptyState();
    state.dualUse = !!flag;
    state.timestamp = Date.now();
    this.saveState(state);
    this._scheduleCacheSync();
  }

  getDualUse() {
    const state = this.getState();
    return !!state?.dualUse;
  }

  /**
   * Save Institution (free-text). Advisor or auto-detector populates.
   * @param {string} value
   */
  saveInstitution(value) {
    if (!this.storageAvailable) return;
    const state = this.getState() || this.createEmptyState();
    state.institution = (value || '').trim();
    state.timestamp = Date.now();
    this.saveState(state);
    this._scheduleCacheSync();
  }

  getInstitution() {
    const state = this.getState();
    return state?.institution || '';
  }

  /**
   * Save Verdict choice
   * @param {string|null} verdict - 'yes' | 'hold' | 'no' | null
   */
  saveVerdict(verdict) {
    if (!this.storageAvailable) return;
    const state = this.getState() || this.createEmptyState();
    const valid = ['yes', 'hold', 'no'].includes(verdict) ? verdict : null;
    state.verdict = valid;
    state.timestamp = Date.now();
    this.saveState(state);
    this._scheduleCacheSync();
  }

  getVerdict() {
    const state = this.getState();
    return state?.verdict ?? null;
  }

  /**
   * Save Technology Description (free-text). Auto-filled from AI extraction; editable.
   * @param {string} value
   */
  saveTechnologyDescription(value) {
    if (!this.storageAvailable) return;
    const state = this.getState() || this.createEmptyState();
    state.technologyDescription = value || '';
    state.timestamp = Date.now();
    this.saveState(state);
    this._scheduleCacheSync();
  }

  getTechnologyDescription() {
    const state = this.getState();
    return state?.technologyDescription || '';
  }

  /**
   * Save Technology Domain (free-text). Auto-filled by AI; advisor can override.
   * @param {string} value
   */
  saveTechnologyDomain(value) {
    if (!this.storageAvailable) return;
    const state = this.getState() || this.createEmptyState();
    state.technologyDomain = (value || '').trim();
    state.timestamp = Date.now();
    this.saveState(state);
    this._scheduleCacheSync();
  }

  getTechnologyDomain() {
    const state = this.getState();
    return state?.technologyDomain || '';
  }

  /**
   * Wipe all venture-level advisor decisions from state in one write.
   * Called when starting a new analysis so the prior venture's verdict /
   * institution / track / pathway / dual-use / ecosystem notes / tech
   * description / tech domain don't bleed into the new one.
   */
  clearVentureDecisions() {
    if (!this.storageAvailable) return;
    const state = this.getState() || this.createEmptyState();
    state.verdict = null;
    state.institution = '';
    state.technologyDescription = '';
    state.technologyDomain = '';
    state.trackAssignment = null;
    state.pathway = null;
    state.dualUse = false;
    state.ecosystemNotes = '';
    state.timestamp = Date.now();
    this.saveState(state);
    this._scheduleCacheSync();
  }

  /**
   * Debounced write-through from live state to the assessment cache.
   * Without this, edits to userScores / venture decisions / final recommendation
   * after the last cacheFullAssessment() call live only in `noblereach_qa_state`
   * ” and Load Previous reads from `noblereach_assessments`, so those edits get
   * lost on reload. Updates only the user-input fields; AI data stays as last cached.
   */
  _scheduleCacheSync() {
    if (this._cacheSyncTimer) clearTimeout(this._cacheSyncTimer);
    this._cacheSyncTimer = setTimeout(() => {
      this._cacheSyncTimer = null;
      this._syncUserFieldsToCache();
    }, 1000);
  }

  _syncUserFieldsToCache() {
    if (!this.storageAvailable) return;
    try {
      const state = this.getState();
      if (!state || !state.assessmentKey) return;
      const cache = this.getAssessmentCache();
      const existing = cache[state.assessmentKey];
      // Only sync if the cache entry already exists (created by cacheFullAssessment after a phase).
      // Otherwise we'd be writing user fields without ventureName/aiData scaffolding.
      if (!existing) return;
      existing.userScores = state.userScores || {};
      existing.finalRecommendation = state.finalRecommendation || '';
      existing.customVentureName = state.customVentureName || null;
      existing.ecosystemNotes = state.ecosystemNotes || '';
      existing.trackAssignment = state.trackAssignment ?? null;
      existing.pathway = state.pathway ?? null;
      existing.dualUse = !!state.dualUse;
      existing.institution = state.institution || '';
      existing.verdict = state.verdict ?? null;
      existing.technologyDescription = state.technologyDescription || '';
      existing.technologyDomain = state.technologyDomain || '';
      existing.timestamp = Date.now();
      cache[state.assessmentKey] = existing;
      this.saveAssessmentCache(cache);
    } catch (e) {
      // Non-fatal: live state still has the data.
    }
  }

  markComplete() {
    if (!this.storageAvailable) return;
    const state = this.getState();
    if (state) {
      state.status = 'complete';
      state.timestamp = Date.now();
      this.saveState(state);
    }
  }

  getProgressSummary() {
    const state = this.getState();
    if (!state) return null;
    
    const totalPhases = 6;
    const completedCount = Object.keys(state.completedPhases || {}).length;
    
    return {
      companyUrl: state.companyInput?.url || 'Unknown',
      scaName: state.companyInput?.scaName || state.scaName || '',
      completedCount,
      totalPhases,
      percentage: Math.round((completedCount / totalPhases) * 100),
      timestamp: state.timestamp,
      status: state.status,
      completedPhases: state.completedPhases || {},
      userScores: state.userScores || {}
    };
  }

  getCompletedPhases() {
    const state = this.getState();
    return state ? state.completedPhases || {} : {};
  }

  isPhaseComplete(phaseKey) {
    const state = this.getState();
    return state && state.completedPhases && !!state.completedPhases[phaseKey];
  }

  restoreFromState() {
    const state = this.getState();
    if (!state) return null;

    return {
      companyInput: state.companyInput,
      completedPhases: state.completedPhases || {},
      userScores: state.userScores || {},
      finalRecommendation: state.finalRecommendation || '',
      customVentureName: state.customVentureName || null,
      ecosystemNotes: state.ecosystemNotes || '',
      trackAssignment: state.trackAssignment ?? null,
      pathway: state.pathway ?? null,
      dualUse: !!state.dualUse,
      institution: state.institution || '',
      verdict: state.verdict ?? null,
      technologyDescription: state.technologyDescription || '',
      technologyDomain: state.technologyDomain || ''
    };
  }

  // ========== SMARTSHEET ROW ID TRACKING ==========

  /**
   * Save Smartsheet row ID for updates
   * @param {string} rowId - The Smartsheet row ID
   */
  saveSmartsheetRowId(rowId) {
    if (!this.storageAvailable) return;
    const state = this.getState() || this.createEmptyState();
    state.smartsheetRowId = rowId;
    state.timestamp = Date.now();
    this.saveState(state);
    Debug.log('Smartsheet row ID saved:', rowId);
  }

  /**
   * Get stored Smartsheet row ID
   * @returns {string|null} The row ID or null
   */
  getSmartsheetRowId() {
    const state = this.getState();
    return state ? state.smartsheetRowId : null;
  }

  // ========== ASSESSMENT KEY GENERATION ==========

  /**
   * Generate unique assessment key
   * @param {string} url - Company URL
   * @param {string} advisorName - Advisor name
   * @param {string} fileName - Optional file name
   * @returns {string} Unique key
   */
  generateAssessmentKey(url, advisorName, fileName = null) {
    // 'Document Upload' is a placeholder used by file-only runs (see app.js startAnalysis).
    // Treat it as a non-URL so the filename branch applies ” otherwise every file-only
    // assessment by the same advisor collides on the same key.
    const isPlaceholderUrl = url === 'Document Upload' || url === 'Admin Import';
    const hasRealUrl = url && !isPlaceholderUrl;

    let identifier = '';
    if (hasRealUrl) {
      try {
        const parsed = new URL(url.startsWith('http') ? url : `https://${url}`);
        identifier = parsed.hostname.replace('www.', '');
      } catch {
        identifier = url.toLowerCase().replace(/[^a-z0-9]/g, '');
      }
    } else if (fileName) {
      // Use file name without extension as identifier (first file if multiple)
      const firstFile = fileName.split(',')[0].trim();
      identifier = firstFile.replace(/\.[^/.]+$/, '').toLowerCase().replace(/[^a-z0-9]/g, '-');
    } else {
      identifier = 'venture';
    }

    const advisor = (advisorName || 'unknown').toLowerCase().replace(/[^a-z0-9]/g, '-');
    // Append timestamp so each new analysis gets a distinct cache slot.
    // The Load Previous modal shows ventureName/date ” the user never sees this key.
    return `${identifier}_${advisor}_${Date.now()}`;
  }

  /**
   * Get the current assessment key
   * @returns {string|null} The assessment key
   */
  getAssessmentKey() {
    const state = this.getState();
    return state ? state.assessmentKey : null;
  }

  // ========== ASSESSMENT CACHING ==========

  /**
   * Cache a full assessment for later reload
   * @param {Object} data - Full assessment data including AI outputs
   */
  cacheFullAssessment(data) {
    try {
      const state = this.getState();
      if (!state || !state.assessmentKey) {
        Debug.warn('Cannot cache assessment: no assessment key');
        return;
      }

      const cache = this.getAssessmentCache();
      
      // Build cached assessment object
      const cachedAssessment = {
        key: state.assessmentKey,
        timestamp: Date.now(),
        companyInput: state.companyInput,
        smartsheetRowId: state.smartsheetRowId,
        userScores: state.userScores,
        aiData: {
          company: data.company || null,
          team: data.team || null,
          funding: data.funding || null,
          competitive: data.competitive || null,
          market: data.market || null,
          iprisk: data.iprisk || null
        },
        ventureName: data.ventureName || this.extractVentureName(data),
        advisorName: state.scaName || state.companyInput?.scaName || 'Unknown',
        // Venture-level advisor decisions
        finalRecommendation: state.finalRecommendation || '',
        ecosystemNotes: state.ecosystemNotes || '',
        trackAssignment: state.trackAssignment ?? null,
        pathway: state.pathway ?? null,
        dualUse: !!state.dualUse,
        // v3.5 fields
        institution: state.institution || '',
        verdict: state.verdict ?? null,
        technologyDescription: state.technologyDescription || '',
        technologyDomain: state.technologyDomain || ''
      };

      // Store in cache (keyed by assessment key)
      cache[state.assessmentKey] = cachedAssessment;

      // Cap cache size to avoid localStorage quota issues
      const keys = Object.keys(cache);
      if (keys.length > this.cacheMaxEntries) {
        const sorted = keys.sort((a, b) => (cache[a].timestamp || 0) - (cache[b].timestamp || 0));
        for (let i = 0; i < keys.length - this.cacheMaxEntries; i++) {
          delete cache[sorted[i]];
        }
      }

      this.saveAssessmentCache(cache);
      Debug.log('Assessment cached:', state.assessmentKey);
    } catch (error) {
      Debug.error('Error caching assessment:', error);
    }
  }

  /**
   * Extract venture name from data
   * @param {Object} data - Assessment data
   * @returns {string} Venture name
   */
  extractVentureName(data) {
    if (data.company?.company_overview?.name) {
      return data.company.company_overview.name;
    }
    const state = this.getState();
    if (state?.companyInput?.url) {
      try {
        const parsed = new URL(state.companyInput.url.startsWith('http') ? state.companyInput.url : `https://${state.companyInput.url}`);
        return parsed.hostname.replace('www.', '');
      } catch {
        return state.companyInput.url;
      }
    }
    if (state?.companyInput?.fileName) {
      return state.companyInput.fileName.replace(/\.[^/.]+$/, '');
    }
    return 'Unknown Venture';
  }

  /**
   * Get the assessment cache object. Auto-prunes entries older than cacheMaxAgeDays.
   * @returns {Object} Cache object
   */
  getAssessmentCache() {
    try {
      const saved = localStorage.getItem(this.assessmentCacheKey);
      const cache = saved ? JSON.parse(saved) : {};
      return this._pruneExpired(cache);
    } catch (error) {
      Debug.error('Error reading assessment cache (possible corruption):', error);
      // Attempt to repair by clearing corrupted cache
      try {
        localStorage.removeItem(this.assessmentCacheKey);
        Debug.warn('Cleared corrupted assessment cache');
      } catch (e) {
        // localStorage itself may be inaccessible
      }
      return {};
    }
  }

  /**
   * Drop entries older than cacheMaxAgeDays. Persists the trimmed cache only if
   * something was actually removed, so callers don't pay write cost on every read.
   * @param {Object} cache
   * @returns {Object} The (possibly trimmed) cache
   */
  _pruneExpired(cache) {
    if (!cache || typeof cache !== 'object') return {};
    const cutoff = Date.now() - (this.cacheMaxAgeDays * 24 * 60 * 60 * 1000);
    let removed = 0;
    for (const key of Object.keys(cache)) {
      const ts = cache[key]?.timestamp || 0;
      if (ts && ts < cutoff) {
        delete cache[key];
        removed++;
      }
    }
    if (removed > 0) {
      Debug.log(`[StateManager] Pruned ${removed} expired assessment(s) older than ${this.cacheMaxAgeDays} days`);
      try {
        localStorage.setItem(this.assessmentCacheKey, JSON.stringify(cache));
      } catch (e) {
        // Non-fatal: pruning failed to persist; will retry on next read
      }
    }
    return cache;
  }

  /**
   * Delete every cached assessment. Used by the "Clear All" button in the
   * Load Previous modal.
   */
  clearAllAssessments() {
    try {
      localStorage.removeItem(this.assessmentCacheKey);
      Debug.log('[StateManager] All cached assessments cleared');
      return true;
    } catch (e) {
      Debug.error?.('[StateManager] Failed to clear cache:', e);
      return false;
    }
  }

  /**
   * Save the assessment cache
   * @param {Object} cache - Cache object to save
   */
  saveAssessmentCache(cache) {
    if (!this.storageAvailable) {
      this._notifySaveFailure('cache_storage_unavailable');
      return;
    }
    try {
      const data = JSON.stringify(cache);
      localStorage.setItem(this.assessmentCacheKey, data);
    } catch (error) {
      Debug.error('[StateManager] Error saving assessment cache:', error);
      // If localStorage is full, try to clear oldest entries
      if (error.name === 'QuotaExceededError') {
        Debug.warn('Assessment cache quota exceeded, pruning oldest entries...');
        this.pruneAssessmentCache();
        try {
          localStorage.setItem(this.assessmentCacheKey, JSON.stringify(cache));
        } catch (e) {
          Debug.error('[StateManager] Still cannot save after pruning. Cache has', Object.keys(cache).length, 'entries.');
          this._storageHealthy = false;
          this._notifySaveFailure('cache_quota');
        }
      } else {
        this._storageHealthy = false;
        this._notifySaveFailure('cache_save');
      }
    }
  }

  /**
   * Prune old assessments from cache
   */
  pruneAssessmentCache() {
    const cache = this.getAssessmentCache();
    const keys = Object.keys(cache);
    if (keys.length > 20) {
      const sorted = keys.sort((a, b) => (cache[a].timestamp || 0) - (cache[b].timestamp || 0));
      for (let i = 0; i < keys.length - 20; i++) {
        delete cache[sorted[i]];
      }
      this.saveAssessmentCache(cache);
    }
  }

  /**
   * List all cached assessments with metadata
   * @returns {Array} List of assessment summaries
   */
  listPastAssessments() {
    const cache = this.getAssessmentCache();
    const assessments = Object.values(cache).map(a => ({
      key: a.key,
      ventureName: a.ventureName || 'Unknown',
      advisorName: a.advisorName || 'Unknown',
      timestamp: a.timestamp,
      date: new Date(a.timestamp).toLocaleDateString(),
      hasFullData: !!(a.aiData && Object.values(a.aiData).some(v => v !== null)),
      companyUrl: a.companyInput?.url || '',
      fileName: a.companyInput?.fileName || '',
      smartsheetRowId: a.smartsheetRowId,
      // Venture-level decision badges
      trackAssignment: a.trackAssignment ?? null,
      pathway: a.pathway ?? null,
      dualUse: !!a.dualUse
    }));
    
    // Sort by most recent first
    return assessments.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
  }

  /**
   * Load a cached assessment by key
   * @param {string} key - Assessment key
   * @returns {Object|null} Full assessment data
   */
  loadAssessment(key) {
    const cache = this.getAssessmentCache();
    return cache[key] || null;
  }

  /**
   * Check if an assessment exists in cache
   * @param {string} key - Assessment key
   * @returns {boolean} True if exists
   */
  hasAssessment(key) {
    const cache = this.getAssessmentCache();
    return !!cache[key];
  }

  /**
   * Delete a cached assessment
   * @param {string} key - Assessment key
   */
  deleteAssessment(key) {
    const cache = this.getAssessmentCache();
    if (cache[key]) {
      delete cache[key];
      this.saveAssessmentCache(cache);
      Debug.log('Assessment deleted from cache:', key);
    }
  }

  // ========== MIGRATION ==========

  /**
   * Migrate old data format if needed
   */
  migrateIfNeeded() {
    const state = this.getState();
    if (state && state.version === '2.0') {
      // Migrate 2.0 to 2.1 - just add missing fields
      state.version = this.version;
      if (!state.smartsheetRowId) state.smartsheetRowId = null;
      if (!state.assessmentKey) state.assessmentKey = null;
      this.saveState(state);
      Debug.log('Migrated state from 2.0 to 2.1');
    }
  }
}

window.StateManager = StateManager;
