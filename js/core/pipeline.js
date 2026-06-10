// js/core/pipeline.js - Sequential analysis pipeline manager
// V02.1: Updated to support file uploads and short company description

class AnalysisPipeline {
  constructor() {
    this.phases = [
      {
        name: 'Company Analysis',
        key: 'company',
        duration: 220,  // ~3.7 minutes (rubric-aligned solution_value extraction added in v3.3)
        status: 'pending',
        startTime: null,
        endTime: null,
        data: null,
        error: null
      },
      {
        name: 'Researcher Aptitude',
        key: 'team',
        duration: 125,  // observed range 60-180s; mid-high estimate
        status: 'pending',
        startTime: null,
        endTime: null,
        data: null,
        error: null
      },
      {
        name: 'Sector Funding Activity',
        key: 'funding',
        duration: 400,  // v02 7-node flow: ~400s observed (was 115s in v01 4-node flow)
        status: 'pending',
        startTime: null,
        endTime: null,
        data: null,
        error: null
      },
      {
        name: 'Competitive Winnability',
        key: 'competitive',
        duration: 195,  // observed range 120-260s
        status: 'pending',
        startTime: null,
        endTime: null,
        data: null,
        error: null
      },
      {
        name: 'Market Opportunity',
        key: 'market',
        duration: 140,  // observed range 84-180s
        status: 'pending',
        startTime: null,
        endTime: null,
        data: null,
        error: null
      },
      {
        name: 'IP Landscape',
        key: 'iprisk',
        duration: 200,  // v04.4 claim-aware 10-node flow; observed ~210s (2026-06-10)
        status: 'pending',
        startTime: null,
        endTime: null,
        data: null,
        error: null
      },
      {
        name: 'Scientific Evidence',
        key: 'literature',
        duration: 130,  // observed ~130s on first end-to-end run
        status: 'pending',
        startTime: null,
        endTime: null,
        data: null,
        error: null
      },
      {
        name: 'Unified Synthesis',
        key: 'synthesis',
        duration: 60,  // estimate: 2 parallel GPT-5 LLM nodes ~30s each + overhead
        status: 'pending',
        startTime: null,
        endTime: null,
        data: null,
        error: null
      }
    ];
    
    this.startTime = null;
    this.abortController = null;
    this.companyUrl = null;
    this.companyFiles = [];
    this.companyDescription = null;  // Short description for other APIs
    this.callbacks = {};
    this.isRunning = false;
    this.activePhases = new Set();
    
    this.events = new EventTarget();
  }

  /**
   * Register callback functions
   */
  on(event, callback) {
    this.callbacks[event] = callback;
  }

  /**
   * Emit event to registered callback
   */
  emit(event, data) {
    if (this.callbacks[event]) {
      this.callbacks[event](data);
    }
    
    this.events.dispatchEvent(new CustomEvent(event, { detail: data }));
  }

  addEventListener(event, handler) {
    this.events.addEventListener(event, handler);
  }

  removeEventListener(event, handler) {
    this.events.removeEventListener(event, handler);
  }

  /**
   * Start the analysis pipeline
   * 
   * @param {Object} options - Input options
   * @param {string} options.url - Company website URL (optional)
   * @param {File} options.file - Uploaded document (optional)
   */
  async start({ url, file, files } = {}) {
    if (this.isRunning) {
      throw new Error('Analysis already in progress');
    }

    // Support both single file and files array (backward compat)
    const fileArray = files || (file ? [file] : []);

    // Validate inputs - need at least one
    const hasUrl = url && typeof url === 'string' && url.trim().length > 0;
    const hasFile = fileArray.length > 0;

    if (!hasUrl && !hasFile) {
      throw new Error('Either a company URL or document is required');
    }

    // Validate URL if provided
    if (hasUrl) {
      const validation = Validators.validateUrl(url);
      if (!validation.valid) {
        throw new Error(validation.error);
      }
      this.companyUrl = validation.url;
    } else {
      this.companyUrl = null;
    }

    this.companyFiles = hasFile ? fileArray : [];
    this.companyDescription = null;
    this.startTime = Date.now();
    this.abortController = new AbortController();
    this.isRunning = true;
    this.activePhases.clear();

    this.phases.forEach(phase => {
      phase.status = 'pending';
      phase.startTime = null;
      phase.endTime = null;
      phase.data = null;
      phase.error = null;
      delete phase.promise;
    });

    this.emit('start', {
      url: this.companyUrl,
      hasFile: hasFile,
      fileName: hasFile ? fileArray.map(f => f.name).join(', ') : null
    });

    try {
      // Company analysis must complete first
      await this.executePhase('company');

      // Emit event for UI to show overview
      this.emit('overviewReady', {
        phase: 'company',
        data: this.phases.find(p => p.key === 'company')?.data
      });

      // v3: All 5 downstream analyses run in parallel (market no longer depends on competitive)
      const parallelPhases = [
        { key: 'team', promise: this.executePhase('team') },
        { key: 'funding', promise: this.executePhase('funding') },
        { key: 'competitive', promise: this.executePhase('competitive') },
        { key: 'market', promise: this.executePhase('market') },
        { key: 'iprisk', promise: this.executePhase('iprisk') },
        { key: 'literature', promise: this.executePhase('literature') }
      ];

      const parallelResults = await Promise.allSettled(parallelPhases.map(p => p.promise));

      // Log results for debugging
      parallelResults.forEach((result, index) => {
        const phaseKey = parallelPhases[index].key;
        if (result.status === 'rejected') {
          Debug.log(`Phase ${phaseKey} failed:`, result.reason?.message || 'Unknown error');
        }
      });

      // v04.2: Synthesis runs sequentially after the parallel wave. It
      // depends on Competitive + Literature both having succeeded; if either
      // failed, skip synthesis and let the frontend's graceful-degradation
      // path fall back to the v04.1 layout. Synthesis is non-fatal — its
      // failure does NOT mark the pipeline as failed.
      const compOk = this.phases.find(p => p.key === 'competitive')?.status === 'completed';
      const litOk  = this.phases.find(p => p.key === 'literature')?.status === 'completed';
      if (compOk && litOk) {
        try {
          await this.executePhase('synthesis');
        } catch (synthErr) {
          Debug.log(`Synthesis phase failed (non-fatal): ${synthErr?.message || synthErr}`);
        }
      } else {
        Debug.log('Synthesis skipped — Competitive or Literature did not succeed.');
      }

      const allSucceeded = this.phases.every(p => p.status === 'completed' || p.key === 'synthesis');
      
      if (allSucceeded) {
        this.emit('allComplete', this.getResults());
        this.emit('complete', this.getResults());
      } else {
        const failedPhases = this.phases.filter(p => p.status === 'error').map(p => p.key);
        this.emit('partialComplete', {
          results: this.getResults(),
          failedPhases
        });
      }
      
      return this.getResults();

    } catch (error) {
      if (this.abortController && !this.abortController.signal.aborted) {
        this.abortController.abort();
      }
      this.emit('error', error);
      throw error;
    } finally {
      this.isRunning = false;
      this.abortController = null;
      this.activePhases.clear();
    }
  }

  /**
   * Run a single phase
   */
  executePhase(key) {
    const phase = this.phases.find(p => p.key === key);
    if (!phase) {
      return Promise.reject(new Error(`Unknown phase: ${key}`));
    }

    if (phase.promise) {
      return phase.promise;
    }

    phase.status = 'active';
    phase.startTime = Date.now();
    phase.endTime = null;
    phase.error = null;
    this.activePhases.add(key);

    this.emit('phaseStart', {
      phase: phase.key,
      name: phase.name,
      estimatedDuration: phase.duration
    });

    const callPhaseApi = async () => {
      switch (phase.key) {
        case 'company':    return this.runCompanyAnalysis();
        case 'team':       return this.runTeamAnalysis();
        case 'competitive':return this.runCompetitiveAnalysis();
        case 'funding':    return this.runFundingAnalysis();
        case 'market':     return this.runMarketAnalysis();
        case 'iprisk':     return this.runIpRiskAnalysis();
        case 'literature': return this.runLiteratureAnalysis();
        case 'synthesis':  return this.runSynthesisAnalysis();
        default:           throw new Error(`Unknown phase: ${phase.key}`);
      }
    };

    const runPhase = async () => {
      try {
        let result;
        try {
          result = await callPhaseApi();
        } catch (firstError) {
          // Auto-retry once for transient LLM issues — token-limit errors and
          // incomplete responses (content-moderation refusals or stream
          // truncation). Both classes are non-deterministic and usually succeed
          // on a second attempt because the model's output varies.
          if (this._isTokenLimitError(firstError) || this._isIncompleteResponseError(firstError)) {
            Debug.log(`[Pipeline] Transient LLM error in ${phase.key} (${firstError.code || 'token_limit'}), auto-retrying...`);
            this.emit('phaseAutoRetry', {
              phase: phase.key,
              name: phase.name
            });
            // Brief delay before retry — the AI search tools typically return
            // different (shorter) results on the second attempt
            await new Promise(r => setTimeout(r, 3000));
            result = await callPhaseApi();
          } else {
            throw firstError;
          }
        }

        phase.data = result;
        phase.status = 'completed';
        phase.endTime = Date.now();

        this.emit('phaseComplete', {
          phase: phase.key,
          name: phase.name,
          duration: (phase.endTime - phase.startTime) / 1000,
          data: result,
          completedCount: this.getCompletedCount(),
          totalCount: this.phases.length
        });

        return result;
      } catch (error) {
        phase.status = 'error';
        phase.error = error;
        phase.endTime = Date.now();

        // Replace raw transient LLM errors with user-friendly messages.
        let friendlyMessage = error.message;
        if (this._isTokenLimitError(error)) {
          friendlyMessage = `${phase.name} failed: the website content was too large to process. Click Retry to try again.`;
        } else if (this._isIncompleteResponseError(error)) {
          friendlyMessage = `${phase.name} got an incomplete response from the AI (often a content-moderation interruption on sensitive topics). Click Retry — re-runs usually succeed.`;
        }

        this.emit('phaseError', {
          phase: phase.key,
          name: phase.name,
          error: friendlyMessage,
          canRetry: true
        });

        throw error;
      } finally {
        this.activePhases.delete(key);
        delete phase.promise;
      }
    };

    phase.promise = runPhase();
    return phase.promise;
  }

  getCompletedCount() {
    return this.phases.filter(p => p.status === 'completed').length;
  }

  getPartialResults() {
    const results = {};
    this.phases.forEach(phase => {
      if (phase.status === 'completed' && phase.data) {
        results[phase.key] = phase.data;
      }
    });
    return results;
  }

  async retryPhase(key) {
    const phase = this.phases.find(p => p.key === key);
    if (!phase) {
      throw new Error(`Unknown phase: ${key}`);
    }
    
    if (phase.status !== 'error') {
      throw new Error(`Phase ${key} is not in error state`);
    }
    
    if (!this.abortController) {
      this.abortController = new AbortController();
    }
    
    phase.status = 'pending';
    phase.error = null;
    delete phase.promise;
    
    return this.executePhase(key);
  }

  /**
   * Check if an error is a token/context length limit error from the LLM.
   * These are transient — retrying often succeeds because web search tools
   * return different (shorter) content on each attempt.
   * @param {Error} error
   * @returns {boolean}
   */
  _isTokenLimitError(error) {
    if (!error || !error.message) return false;
    const msg = error.message.toLowerCase();
    return (msg.includes('token') && (msg.includes('limit') || msg.includes('exceed')))
        || msg.includes('context_length_exceeded')
        || msg.includes('context length')
        || (msg.includes('input') && msg.includes('too long'));
  }

  /**
   * Check if an error is a content-moderation refusal or truncated LLM
   * response (CompanyAPI throws with code='incomplete_llm_response'). These
   * are non-deterministic; a re-run typically produces a complete response.
   * @param {Error} error
   * @returns {boolean}
   */
  _isIncompleteResponseError(error) {
    if (!error) return false;
    if (error.code === 'incomplete_llm_response') return true;
    if (typeof error.message === 'string' && error.message.toLowerCase().includes('incomplete response')) return true;
    return false;
  }

  /**
   * Run company analysis - handles URL, file, or both
   */
  async runCompanyAnalysis() {
    const response = await CompanyAPI.analyze(
      { url: this.companyUrl, files: this.companyFiles },
      this.abortController.signal
    );
    
    // Response now contains { full, short }
    // Validate the full output for display
    const validation = Validators.validateCompany(response.full || response);
    if (!validation.valid) {
      throw new Error(`Invalid company data: ${validation.error}`);
    }
    
    // Store short description for other APIs
    this.companyDescription = CompanyAPI.getShortDescription(response);
    
    console.log('[Pipeline] Company analysis complete, short description length:', this.companyDescription?.length);
    
    return response;
  }

  /**
   * Run team analysis - now uses company description
   */
  async runTeamAnalysis() {
    if (!this.companyDescription) {
      throw new Error('Company description not available');
    }

    const response = await TeamAPI.analyze(
      this.companyDescription,
      this.abortController.signal
    );

    const validation = Validators.validateTeam(response);
    if (!validation.valid) {
      throw new Error(`Invalid team data: ${validation.error}`);
    }

    return response;
  }

  /**
   * Run funding analysis - uses short company description
   */
  async runFundingAnalysis() {
    if (!this.companyDescription) {
      throw new Error('Company description not available');
    }

    const response = await FundingAPI.analyze(
      this.companyDescription,
      this.abortController.signal
    );

    const validation = Validators.validateFunding(response);
    if (!validation.valid) {
      throw new Error(`Invalid funding data: ${validation.error}`);
    }

    return response;
  }

  /**
   * Run competitive analysis - uses short company description
   */
  async runCompetitiveAnalysis() {
    if (!this.companyDescription) {
      throw new Error('Company description not available');
    }

    const response = await CompetitiveAPI.analyze(
      this.companyDescription,
      this.abortController.signal
    );
    
    const validation = Validators.validateCompetitive(response);
    if (!validation.valid) {
      throw new Error(`Invalid competitive data: ${validation.error}`);
    }
    
    return response;
  }

  /**
   * Run market analysis - v3: uses only company description (no competitive dependency)
   */
  async runMarketAnalysis() {
    if (!this.companyDescription) {
      throw new Error('Company description not available');
    }

    const response = await MarketAPI.analyze(
      this.companyDescription,
      this.abortController.signal
    );

    const validation = Validators.validateMarket(response);
    if (!validation.valid) {
      throw new Error(`Invalid market data: ${validation.error}`);
    }

    return response;
  }

  /**
   * Run IP risk analysis - uses short company description
   */
  async runIpRiskAnalysis() {
    if (!this.companyDescription) {
      throw new Error('Company description not available');
    }

    const response = await IPRiskAPI.analyze(
      this.companyDescription,
      this.abortController.signal
    );

    return response;
  }

  /**
   * Run literature / scientific-evidence analysis - uses short company description.
   * Lit-review is not a scored dimension; the output fuses into Competitive and
   * Solution Value sections as contextual evidence (status quo, trial/lab
   * competitors, inherent advantages vs. incumbent baseline). No validator —
   * non-biomedical ventures return null for clinical_evidence, which is valid.
   */
  async runLiteratureAnalysis() {
    if (!this.companyDescription) {
      throw new Error('Company description not available');
    }

    const response = await LiteratureAPI.analyze(
      this.companyDescription,
      this.abortController.signal
    );

    return response;
  }

  /**
   * Run unified synthesis - consolidates competitive + literature + company SV
   * outputs into one unified competitor list + one merged value-prop table.
   * Not a scored dimension; non-fatal if it fails (graceful frontend fallback).
   * Inputs are pulled from the already-completed phases in this.phases.
   */
  async runSynthesisAnalysis() {
    const compPhase = this.phases.find(p => p.key === 'competitive');
    const litPhase  = this.phases.find(p => p.key === 'literature');
    const companyPhase = this.phases.find(p => p.key === 'company');
    if (!compPhase?.data || !litPhase?.data) {
      throw new Error('Synthesis requires competitive + literature data');
    }
    // Competitive flow's processResponse returns { analysis, assessment, formatted }.
    // Synthesis only needs the consolidated Output Agent JSON (out-0, surfaced
    // as competitive.analysis here — the strict JSON we'd hand a downstream
    // node). Pass it as a JSON string for the LLM input.
    const competitiveJson = compPhase.data.analysis || compPhase.data;

    // Literature's processResponse returns { literature, formatted }. Synthesis
    // wants the raw structured JSON with narrative fields stripped — defer
    // that stripping to SynthesisAPI so the upstream cache keeps the full
    // payload for debugging.
    const literatureRaw = litPhase.data.literature || litPhase.data;
    const literatureForSynth = (window.SynthesisAPI && typeof window.SynthesisAPI.stripLiteratureNarratives === 'function')
      ? window.SynthesisAPI.stripLiteratureNarratives(literatureRaw)
      : literatureRaw;

    // Company SV subtree only — synthesis doesn't need team / IP / etc.
    const companyData = companyPhase?.data?.full || companyPhase?.data || {};
    const companySvJson = companyData.solution_value || {};

    const response = await SynthesisAPI.analyze({
      ventureSummary: this.companyDescription,
      competitiveJson,
      literatureJson: literatureForSynth,
      companySvJson
    }, this.abortController.signal);

    return response;
  }

  /**
   * Cancel the analysis
   */
  cancel() {
    if (this.abortController) {
      this.abortController.abort();
      const activeKeys = Array.from(this.activePhases);
      this.emit('cancelled', {
        phase: activeKeys.length > 0 ? activeKeys[0] : null
      });
    }
  }

  /**
   * Get current progress
   * v3: Two phases — company (sequential) then all 5 in parallel
   */
  getProgress() {
    const companyDuration = this.phases.find(p => p.key === 'company')?.duration || 150;
    const parallelPhaseKeys = ['team', 'funding', 'competitive', 'market', 'iprisk', 'literature'];
    const maxParallelDuration = Math.max(
      ...parallelPhaseKeys.map(k => this.phases.find(p => p.key === k)?.duration || 60)
    );
    // Synthesis runs sequentially after the parallel wave, so its duration
    // adds to the total rather than competing with the max-parallel
    // calculation. Treat 0 as missing (older pipelines that don't have
    // synthesis configured).
    const synthDuration = this.phases.find(p => p.key === 'synthesis')?.duration || 0;

    const effectiveTotalDuration = companyDuration + maxParallelDuration + synthDuration;

    const now = Date.now();
    const elapsed = this.startTime ? (now - this.startTime) / 1000 : 0;

    const companyPhase = this.phases.find(p => p.key === 'company');

    let progressContribution = 0;

    if (companyPhase.status === 'completed') {
      progressContribution += companyDuration;
    } else if (companyPhase.status === 'active' && companyPhase.startTime) {
      const phaseElapsed = (now - companyPhase.startTime) / 1000;
      progressContribution += Math.min(phaseElapsed, companyDuration);
    }

    if (companyPhase.status === 'completed') {
      const allParallelDone = parallelPhaseKeys.every(k => {
        const p = this.phases.find(ph => ph.key === k);
        return p.status === 'completed' || p.status === 'error';
      });

      if (allParallelDone) {
        progressContribution += maxParallelDuration;
      } else {
        // Estimate based on longest active parallel phase
        let maxParallelElapsed = 0;
        for (const k of parallelPhaseKeys) {
          const p = this.phases.find(ph => ph.key === k);
          if (p.status === 'active' && p.startTime) {
            maxParallelElapsed = Math.max(maxParallelElapsed, (now - p.startTime) / 1000);
          } else if (p.status === 'completed' || p.status === 'error') {
            maxParallelElapsed = Math.max(maxParallelElapsed, maxParallelDuration * 0.5);
          }
        }
        progressContribution += Math.min(maxParallelElapsed, maxParallelDuration);
      }

      // Synthesis runs sequentially after the parallel wave completes. Add
      // its contribution when relevant.
      if (synthDuration > 0) {
        const synthPhase = this.phases.find(p => p.key === 'synthesis');
        if (synthPhase) {
          if (synthPhase.status === 'completed' || synthPhase.status === 'error') {
            progressContribution += synthDuration;
          } else if (synthPhase.status === 'active' && synthPhase.startTime) {
            const synthElapsed = (now - synthPhase.startTime) / 1000;
            progressContribution += Math.min(synthElapsed, synthDuration);
          }
        }
      }
    }

    const allCompleted = this.phases.every(phase =>
      phase.status === 'completed' || phase.status === 'error'
    );
    const percentage = allCompleted
      ? 100
      : Math.min(95, (progressContribution / effectiveTotalDuration) * 100);

    const remaining = Math.max(0, effectiveTotalDuration - elapsed);
    const activeNames = Array.from(this.activePhases)
      .map(key => this.phases.find(phase => phase.key === key)?.name)
      .filter(Boolean);

    return {
      percentage,
      elapsed,
      estimated: effectiveTotalDuration,
      remaining,
      currentPhase: activeNames.length > 0 ? activeNames.join(', ') : null,
      completedCount: this.getCompletedCount(),
      totalCount: this.phases.length
    };
  }

  /**
   * Get results
   */
  getResults() {
    const companyData = this.phases.find(p => p.key === 'company')?.data;
    
    return {
      // Return full company output for display
      company: companyData?.full || companyData || null,
      team: this.phases.find(p => p.key === 'team')?.data || null,
      funding: this.phases.find(p => p.key === 'funding')?.data || null,
      competitive: this.phases.find(p => p.key === 'competitive')?.data || null,
      market: this.phases.find(p => p.key === 'market')?.data || null,
      iprisk: this.phases.find(p => p.key === 'iprisk')?.data || null,
      companyDescription: this.companyDescription,
      duration: (Date.now() - this.startTime) / 1000
    };
  }

  isComplete() {
    return this.phases.every(phase => phase.status === 'completed');
  }

  getPhaseStatus(key) {
    const phase = this.phases.find(p => p.key === key);
    return phase ? phase.status : null;
  }

  reset() {
    if (this.abortController) {
      this.abortController.abort();
    }
    
    this.startTime = null;
    this.abortController = null;
    this.companyUrl = null;
    this.companyFiles = [];
    this.companyDescription = null;
    this.isRunning = false;
    this.activePhases.clear();

    this.phases.forEach(phase => {
      phase.status = 'pending';
      phase.startTime = null;
      phase.endTime = null;
      phase.data = null;
      phase.error = null;
      delete phase.promise;
    });
  }
}

// Make available globally
window.AnalysisPipeline = AnalysisPipeline;
