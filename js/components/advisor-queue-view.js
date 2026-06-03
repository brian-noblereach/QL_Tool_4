// js/components/advisor-queue-view.js — "My Queue" for Internal Advisors and Admins.
//
// Lists Ready and Reviewed queue rows assigned to the selected advisor name.
// Clicking a Ready row fetches the AI evidence JSON (via the v04 GAS proxy's
// queue_get_evidence action) and hands it off to the existing v03 assessment-view
// for rendering and scoring. The scoring submit path uses the existing
// SmartsheetIntegration helpers (writes to the v03 scores sheet, unchanged).

const AdvisorQueueView = {
  state: {
    advisorName: localStorage.getItem('v04_my_advisor_name') || '',
    advisors: [],
    rows: [],
    activeRowId: null
  },

  async init() {
    this._root = document.getElementById('advisor-queue-view');
    if (!this._root) return;
    // Show a loading skeleton while config fetch is in flight — otherwise the
    // pane sits blank for 1–3 s and looks broken.
    this._renderLoadingSkeleton();
    await this._loadConfig();
    this._render();
    this._wireEvents();
    // v04.2.4: wire the pencil-edit button on the assessment-view venture-name
    // header. The HTML scaffold existed in index.html but was never wired —
    // clicking it did nothing. Wire once on init since the elements are static.
    this._wireRenameVenturePencil();
    if (this.state.advisorName) {
      await this.refresh();
    }
  },

  // Pencil-edit button for the venture name shown at the top of the assessment
  // view. The button toggles a hidden input + Save/Cancel pair. Save:
  //   1. Update the displayed name (#venture-name-text)
  //   2. Update state-manager.state.ventureName so SmartsheetIntegration picks
  //      it up on score submit (writes to the v03 scoresheet's ventureName col).
  //   3. Update the v04 queue row's VentureName column when there's an
  //      activeRowId (load-from-runner or live-run flows). Best-effort; a
  //      failure here doesn't block the local rename.
  _wireRenameVenturePencil() {
    if (this._renameWired) return;
    this._renameWired = true;
    const btn      = document.getElementById('edit-venture-name-btn');
    const display  = document.querySelector('.venture-name-display');
    const editBox  = document.getElementById('venture-name-edit');
    const nameH1   = document.getElementById('venture-name-text');
    const input    = document.getElementById('venture-name-input');
    const saveBtn  = document.getElementById('save-venture-name-btn');
    const cancel   = document.getElementById('cancel-venture-name-btn');
    if (!btn || !display || !editBox || !nameH1 || !input || !saveBtn || !cancel) {
      Debug.warn('[v04] rename-venture wiring skipped — missing elements');
      return;
    }
    const open = () => {
      input.value = (nameH1.textContent || '').trim();
      editBox.classList.remove('hidden');
      display.classList.add('v04-hidden');
      input.focus();
      input.select();
    };
    const close = () => {
      editBox.classList.add('hidden');
      display.classList.remove('v04-hidden');
    };
    const save = async () => {
      const newName = (input.value || '').trim();
      if (!newName) {
        window.app?.toastManager?.error?.('Venture name cannot be empty.');
        return;
      }
      // 1. UI update
      nameH1.textContent = newName;
      // 2. State-manager update (for score-submit pickup)
      const sm = window.app?.stateManager;
      if (sm) {
        sm.state = sm.state || {};
        sm.state.ventureName = newName;
        try { sm.saveState?.(); } catch (e) { Debug.warn('[v04] saveState after rename failed:', e); }
      }
      // 3. Persist to the v04 queue row (best-effort; rename still applies
      //    locally even if Smartsheet update fails).
      const rowId = this.state.activeRowId;
      if (rowId && window.QueueClient) {
        try {
          const r = await QueueClient.update(rowId, { VentureName: newName });
          if (!r?.success) {
            Debug.warn('[v04] queue VentureName update returned non-success:', r?.error);
            window.app?.toastManager?.warning?.('Name updated locally; queue update failed (will retry on next submit).');
          } else {
            window.app?.toastManager?.success?.('Venture name updated.');
          }
        } catch (e) {
          Debug.warn('[v04] queue VentureName update threw:', e);
          window.app?.toastManager?.warning?.('Name updated locally; queue update failed.');
        }
      } else {
        window.app?.toastManager?.success?.('Venture name updated.');
      }
      close();
    };
    btn.addEventListener('click', open);
    cancel.addEventListener('click', close);
    saveBtn.addEventListener('click', save);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); save(); }
      else if (e.key === 'Escape') { e.preventDefault(); close(); }
    });
  },

  _renderLoadingSkeleton() {
    this._root.innerHTML = `
      <div class="v04-advisor-pane">
        <header class="v04-pane-header">
          <h2>My Queue</h2>
          <p class="v04-pane-sub">Opportunities that are ready for your review.</p>
        </header>
        <div class="v04-loading-inline"><span class="v04-spinner"></span> Loading advisor list…</div>
      </div>
    `;
  },

  async _loadConfig() {
    try {
      const r = await fetch(`${Auth.proxyUrl}?action=config`);
      const j = await r.json();
      this.state.config   = j.config || {};
      this.state.advisors = this.state.config.advisors || [];
    } catch (e) {
      console.warn('[AdvisorQueueView] config fetch failed', e);
    }
  },

  async refresh({ silent = false } = {}) {
    if (!this.state.advisorName) {
      this._stopAutoRefresh();
      this._renderList();
      return;
    }
    const wrap = document.getElementById('v04-myqueue-list');
    // Skip the loading flash on the auto-refresh polls — only show spinner on
    // first load / manual refresh / advisor switch.
    if (wrap && !silent) {
      wrap.innerHTML = '<div class="v04-loading-inline"><span class="v04-spinner"></span> Loading your queue…</div>';
      this._lastListFingerprint = null;  // ensure the next _renderList writes the real list
    }
    const r = await QueueClient.list({ advisorName: this.state.advisorName });
    const KEEP = new Set(['Queued', 'Running', 'Ready', 'Reviewed', 'Failed']);
    this.state.rows = r.success
      ? (r.rows || []).filter(row => KEEP.has(row.Status))
      : [];
    this._renderList();
    this._maybeScheduleAutoRefresh();
  },

  // Poll queue_list every 30s while any Queued/Running row is present so the
  // advisor sees the status transition without manually clicking Refresh.
  // Stops when nothing is in-progress or when they leave the queue view.
  _maybeScheduleAutoRefresh() {
    this._stopAutoRefresh();
    const inProgress = this.state.rows.some(r => r.Status === 'Queued' || r.Status === 'Running');
    if (!inProgress) return;
    this._refreshTimer = setTimeout(() => { this.refresh({ silent: true }); }, 30000);
  },
  _stopAutoRefresh() {
    if (this._refreshTimer) { clearTimeout(this._refreshTimer); this._refreshTimer = null; }
  },

  _render() {
    const opts = this.state.advisors.map(a =>
      `<option value="${a}" ${a === this.state.advisorName ? 'selected' : ''}>${a}</option>`
    ).join('');

    this._root.innerHTML = `
      <div class="v04-advisor-pane">
        <header class="v04-pane-header">
          <h2>My Queue</h2>
          <p class="v04-pane-sub">Opportunities that are ready for your review.</p>
        </header>
        <div class="v04-advisor-picker">
          <label>Reviewing as
            <select id="v04-advisor-picker">
              <option value="">-- select your name --</option>
              ${opts}
            </select>
          </label>
          <button id="v04-myqueue-refresh" class="v04-btn-secondary">Refresh</button>
          <button id="v04-run-new" class="v04-run-new-btn" type="button" title="Run a live analysis on an opportunity that hasn't been queued">+ Run new analysis</button>
        </div>
        <div id="v04-myqueue-list"></div>
      </div>
    `;
  },

  _renderList() {
    const wrap = document.getElementById('v04-myqueue-list');
    if (!wrap) return;
    if (!this.state.advisorName) {
      wrap.innerHTML = '<p class="v04-empty">Pick your name above to see your queue.</p>';
      this._lastListFingerprint = null;
      return;
    }
    if (!this.state.rows.length) {
      wrap.innerHTML = '<p class="v04-empty">No opportunities assigned to you right now.</p>';
      this._lastListFingerprint = 'empty';
      return;
    }

    // Skip the full innerHTML rebuild when nothing the renderer cares about
    // has changed (the 30s auto-refresh polls land here every cycle even on
    // a static queue). Fingerprint covers fields the row card actually shows.
    const fingerprint = this.state.rows.map(r => [
      r.id, r.Status, r.LastError ? 1 : 0, r.CompletedPhases || '',
      r.VentureName || '', r.Portfolio || '', r.Institution || '',
      r.TechnologyDomain || '', r.TechnologyDescription || '', r.PreloadNotes || ''
    ].join('|')).join('\n');
    if (fingerprint === this._lastListFingerprint) return;
    this._lastListFingerprint = fingerprint;

    const inProgress = this.state.rows.filter(r => r.Status === 'Queued' || r.Status === 'Running');
    const failed     = this.state.rows.filter(r => r.Status === 'Failed');
    const todo       = this.state.rows.filter(r => r.Status === 'Ready');
    const done       = this.state.rows.filter(r => r.Status === 'Reviewed');

    // Generic card builder — actionable controls vary by status.
    const cardHtml = (r, kind) => {
      const reviewed = r.Status === 'Reviewed';
      let sideHtml = '';
      if (kind === 'in-progress') {
        const subtext = r.Status === 'Running'
          ? 'AI analysis in progress…'
          : 'Waiting for the runner…';
        sideHtml = `
          <span class="v04-status v04-status-${r.Status.toLowerCase()}">${this._esc(r.Status)}</span>
          <span class="v04-row-subtext"><span class="v04-spinner"></span> ${this._esc(subtext)}</span>
        `;
      } else if (kind === 'failed') {
        const err = (r.LastError || '').toString().slice(0, 200);
        const errAttr = err ? `title="${this._esc(err)}"` : '';
        sideHtml = `
          <span class="v04-status v04-status-failed" ${errAttr}>FAILED</span>
          <span class="v04-row-subtext">Ask the Associate to retry</span>
        `;
      } else {
        // ready / reviewed — open button available
        sideHtml = `
          <span class="v04-status v04-status-${r.Status.toLowerCase()}">${this._esc(r.Status)}</span>
          <button class="v04-btn-primary v04-open" data-row-id="${r.id}">Open</button>
        `;
      }
      return `
        <article class="v04-queue-card-row ${reviewed ? 'v04-reviewed' : ''} ${kind === 'failed' ? 'v04-failed' : ''} ${kind === 'in-progress' ? 'v04-inprogress' : ''}" data-row-id="${r.id}">
          <div class="v04-row-main">
            <h4>${this._esc(r.VentureName)}</h4>
            <p class="v04-row-meta">
              ${this._esc(r.Portfolio || '')}
              ${r.Institution ? ' · ' + this._esc(r.Institution) : ''}
              ${r.TechnologyDomain ? ' · ' + this._esc(r.TechnologyDomain) : ''}
            </p>
            ${r.TechnologyDescription ? `<p class="v04-row-tech">${this._esc(r.TechnologyDescription)}</p>` : ''}
            ${r.PreloadNotes ? `<p class="v04-row-notes"><strong>Note:</strong> ${this._esc(r.PreloadNotes)}</p>` : ''}
          </div>
          <div class="v04-row-side">
            ${sideHtml}
          </div>
        </article>
      `;
    };

    const section = (cls, label, rows, kind, emptyMsg) => `
      <section class="v04-queue-section ${cls}">
        <header class="v04-queue-section-header">
          <h3 class="v04-queue-section-title">${label}</h3>
          <span class="v04-queue-section-count">${rows.length}</span>
        </header>
        ${rows.length ? rows.map(r => cardHtml(r, kind)).join('') : `<p class="v04-empty">${emptyMsg}</p>`}
      </section>
    `;

    wrap.innerHTML = [
      inProgress.length ? section('v04-section-progress',    'In Progress',     inProgress, 'in-progress', '') : '',
      failed.length     ? section('v04-section-needs-attn',  'Needs Attention', failed,     'failed',      '') : '',
      section('v04-section-todo', 'To Review', todo, 'ready', 'Nothing waiting on you right now.'),
      done.length       ? section('v04-section-done',        'Completed',       done,       'reviewed',    '') : ''
    ].join('');
  },

  _wireEvents() {
    const root = this._root;
    root.addEventListener('change', async (e) => {
      if (e.target.id === 'v04-advisor-picker') {
        this.state.advisorName = e.target.value;
        localStorage.setItem('v04_my_advisor_name', this.state.advisorName);
        this._lastListFingerprint = null;  // force re-render for the new advisor
        await this.refresh();
      }
    });
    root.addEventListener('click', async (e) => {
      const t = e.target;
      if (t.id === 'v04-myqueue-refresh') { await this.refresh(); }
      else if (t.id === 'v04-run-new')    { this.openRunNewModal(); }
      else if (t.classList.contains('v04-open')) {
        const rowId = t.dataset.rowId;
        await this.openAssessment(rowId);
      }
    });
  },

  /**
   * Open the "Run new analysis" modal. Populates the portfolio dropdown from
   * the cached config and clears the form. Bound once per modal-open.
   */
  openRunNewModal() {
    const modal = document.getElementById('v04-run-modal');
    if (!modal) return;
    const portfolioSelect = document.getElementById('v04-run-portfolio');
    if (portfolioSelect && this.state.config?.portfolios) {
      const portfolios = (this.state.config.portfolios || []).map(p => p.value || p);
      portfolioSelect.innerHTML = '<option value="">— pick a portfolio —</option>' +
        portfolios.map(p => `<option value="${p}">${p}</option>`).join('');
    }
    const form = document.getElementById('v04-run-form');
    if (form) form.reset();
    const err = document.getElementById('v04-run-form-error');
    if (err) err.textContent = '';
    modal.classList.remove('v04-hidden');
    // Wire the modal events lazily (once) so we don't re-attach on every open.
    if (!this._runModalWired) {
      this._wireRunModal();
      this._runModalWired = true;
    }
    setTimeout(() => document.getElementById('v04-run-venture-url')?.focus(), 50);
  },

  closeRunNewModal() {
    const modal = document.getElementById('v04-run-modal');
    if (modal) modal.classList.add('v04-hidden');
  },

  _wireRunModal() {
    const modal  = document.getElementById('v04-run-modal');
    const form   = document.getElementById('v04-run-form');
    const cancel = document.getElementById('v04-run-cancel');
    const close  = document.getElementById('v04-run-modal-close');
    const backdrop = modal?.querySelector('.v04-run-modal-backdrop');
    const errEl  = document.getElementById('v04-run-form-error');

    const closeFn = () => this.closeRunNewModal();
    cancel?.addEventListener('click', closeFn);
    close?.addEventListener('click', closeFn);
    backdrop?.addEventListener('click', closeFn);

    // Show selected files in a list under the file input.
    const fileInput = document.getElementById('v04-run-documents');
    const fileList  = document.getElementById('v04-run-file-list');
    fileInput?.addEventListener('change', () => {
      if (!fileList) return;
      const files = Array.from(fileInput.files || []);
      if (files.length === 0) { fileList.innerHTML = ''; return; }
      fileList.innerHTML = files.map(f =>
        `<div class="v04-file-row"><span>${this._esc(f.name)}</span><span class="v04-file-size">${this._formatBytes(f.size)}</span></div>`
      ).join('');
    });

    form?.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (errEl) errEl.textContent = '';
      const fd = new FormData(form);
      const ventureUrl  = (fd.get('ventureUrl')  || '').toString().trim();
      const portfolio   = (fd.get('portfolio')   || '').toString().trim();
      const ventureName = (fd.get('ventureName') || '').toString().trim();
      const files       = Array.from(fileInput?.files || []);

      if (!ventureUrl && files.length === 0) {
        if (errEl) errEl.textContent = 'Provide a Website URL, upload at least one document, or both.';
        return;
      }
      if (!portfolio) { if (errEl) errEl.textContent = 'Pick a portfolio.'; return; }
      // Cap total upload size to avoid blowing up Stack AI's document service.
      const MAX_BYTES = 50 * 1024 * 1024; // 50 MB total
      const total = files.reduce((s, f) => s + (f.size || 0), 0);
      if (total > MAX_BYTES) {
        if (errEl) errEl.textContent = `Total upload size ${this._formatBytes(total)} exceeds 50 MB limit.`;
        return;
      }

      this.closeRunNewModal();
      await this.runLivePipeline({ ventureUrl, portfolio, ventureName, files });
    });
  },

  _formatBytes(n) {
    if (n == null) return '';
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / 1024 / 1024).toFixed(1)} MB`;
  },

  /**
   * Kick off the v03-style in-browser analysis pipeline. Wires events to the
   * progress overlay and assessment-view loaders. On completion, transitions
   * into the assessment view where the advisor scores normally.
   *
   * Ephemeral by design — no queue row, no persistence between page loads.
   */
  async runLivePipeline({ ventureUrl, portfolio, ventureName, files }) {
    if (typeof AnalysisPipeline === 'undefined') {
      alert('Pipeline component not loaded. Refresh and try again.');
      return;
    }

    // Reset state-manager + assessment view + tabs so the live run starts clean
    // (don't carry over scores/justifications from a previously-opened venture).
    const sm = window.app?.stateManager;
    try { sm?.resetAssessment?.(); } catch (e) { Debug.warn('[v04] resetAssessment failed:', e); }
    try { window.assessmentView?.reset?.(); } catch (e) { Debug.warn('[v04] assessmentView.reset failed:', e); }
    try {
      const tm = window.app?.tabManager;
      if (tm?.tabs) Object.keys(tm.tabs).forEach(t => tm.setState?.(t, 'pending'));
    } catch (e) { Debug.warn('[v04] reset tab states failed:', e); }
    const banner = document.getElementById('v04-updating-banner');
    if (banner) banner.classList.add('v04-hidden');
    window.__v04_currentQueueRowId = null;
    this.state.activeRowId = null;

    // Bridge form values into the same v03 inputs the scoring submit reads.
    const advisorName = this.state.advisorName;
    const setInput = (id, val) => { const el = document.getElementById(id); if (el && val) el.value = val; };
    if (advisorName) {
      setInput('sca-name', advisorName);
      try { localStorage.setItem('scaName', advisorName); } catch (e) { Debug.warn('[v04] scaName persist failed:', e); }
    }
    setInput('portfolio', portfolio);
    setInput('company-url', ventureUrl);

    const pipeline = new AnalysisPipeline();
    window.__v04_livePipeline = pipeline;

    // Create a queue row up front so this live run is visible in the advisor's
    // queue (as Running) and gets the evidence attached at the end. AssociateName
    // is hardcoded to "(self-service)" — the proxy uses this marker to skip the
    // KNOWN_ASSOCIATES check and waive the VentureURL/InputPointer requirement
    // (live-run inputs are ephemeral). The VentureName is provisional; we
    // rewrite it after the company phase produces a better name. If the create
    // fails, log it and continue — the live analysis still works, just isn't
    // captured in the queue.
    let liveRowId = null;
    const provisionalName = (ventureName && ventureName.trim()) ||
      (ventureUrl ? this._hostnameFromUrl(ventureUrl) : '') ||
      '(live run)';
    try {
      const createRes = await QueueClient.create({
        VentureName:   provisionalName,
        AdvisorName:   advisorName || 'Unknown',
        AssociateName: '(self-service)',
        Portfolio:     portfolio || 'Other',
        VentureURL:    ventureUrl || '',
        PreloadNotes:  'Live run via "Run new analysis" — inputs were ephemeral.'
      });
      if (createRes?.success && createRes.rowId) {
        liveRowId = createRes.rowId;
        window.__v04_currentQueueRowId = liveRowId;
        this.state.activeRowId = liveRowId;
        // Flip to Running immediately so it's visually distinct in the queue.
        QueueClient.update(liveRowId, { Status: 'Running', StartedAt: new Date().toISOString() })
          .catch(e => Debug.warn('[v04] live-run Status=Running update failed:', e));
      } else {
        Debug.warn('[v04] live-run queue row create failed:', createRes?.error);
        window.app?.toastManager?.warning?.('Live run not saved to queue: ' + (createRes?.error || 'unknown error'));
      }
    } catch (e) {
      Debug.warn('[v04] queue create threw:', e);
    }

    this._showProgressOverlay(ventureName || 'opportunity', pipeline);

    const view = window.assessmentView;
    const tm   = window.app?.tabManager;
    const enable = (tabId) => { try { tm?.enableTab(tabId); } catch (e) { Debug.warn('[v04] enableTab failed:', tabId, e); } };

    // Map pipeline phase keys to assessment-view loaders + tab IDs.
    const phaseToTab = { company: 'overview', team: 'team', funding: 'funding',
                         competitive: 'competitive', market: 'market', iprisk: 'iprisk' };

    pipeline.on('phaseStart', ({ phase }) => {
      this._setPipelinePhaseState(phase, 'active');
      // Advance the bar on start too — the company phase takes ~4 min and is
      // the only phase visible before the overlay hides (overviewReady). Without
      // a start-time bump the bar stays at 0% for that full window.
      this._bumpPipelineBar();
      const tab = phaseToTab[phase];
      if (tab) try { tm?.setLoading(tab); } catch (e) { Debug.warn('[v04] setLoading failed:', tab, e); }
    });

    pipeline.on('phaseComplete', ({ phase, data }) => {
      this._setPipelinePhaseState(phase, 'complete');
      this._bumpPipelineBar();
      try {
        if (phase === 'company' && data) {
          // CompanyAPI.analyze returns { full, short } — `full` is the
          // company-shape JSON (company_overview, technology, etc.) the
          // assessment view expects; `short` is a description used by the
          // downstream phases. Passing the wrapper through unwrapped renders
          // "Unknown Company" with no products. (v03 does the same unwrap;
          // see v03 app.js: `data?.full || data`.)
          const companyData = data.full || data;
          view?.loadCompanyData(companyData);
          enable('overview');
          // Use custom name if provided, else AI-detected.
          const nameEl = document.getElementById('venture-name-text');
          if (nameEl) nameEl.textContent = ventureName || companyData.company_overview?.name || 'opportunity';
          // Auto-detect institution + tech fields from company data.
          if (window.VentureExtractors && sm) {
            try {
              const det = window.VentureExtractors.detectInstitution?.(ventureUrl, companyData, []);
              if (det) { sm.saveInstitution(det); setInput('venture-institution', det); }
              const desc = window.VentureExtractors.deriveTechnologyDescription?.(companyData);
              if (desc) { sm.saveTechnologyDescription(desc); setInput('venture-tech-description', desc); }
              const dom = window.VentureExtractors.extractTechnologyDomain?.(companyData);
              if (dom)  { sm.saveTechnologyDomain(dom);  setInput('venture-tech-domain', dom); }
            } catch (e) { console.warn('[v04] venture-field auto-detect failed:', e); }
          }
        } else if (phase === 'team')        { view?.loadTeamData(data);        enable('team'); }
        else if (phase === 'funding')       { view?.loadFundingData(data);     enable('funding'); }
        else if (phase === 'competitive')   { view?.loadCompetitiveData(data); enable('competitive'); }
        else if (phase === 'market')        { view?.loadMarketData(data);      enable('market'); }
        else if (phase === 'iprisk')        { view?.loadIpRiskData(data);      enable('iprisk'); }
        else if (phase === 'literature')    { view?.loadLiteratureData?.(data); }
        else if (phase === 'synthesis')     { view?.loadSynthesisData?.(data); }
      } catch (e) { console.error('[v04] live load failed for', phase, e); }
    });

    pipeline.on('phaseError', ({ phase, error }) => {
      this._setPipelinePhaseState(phase, 'error');
      console.error('[v04] live pipeline phase error:', phase, error);
      // Mark the corresponding tab as ERROR so the user sees the failure on
      // the tab strip (TabManager renders a retry overlay on error tabs).
      // Without this, the tab stays in 'loading' state forever and the user
      // has no idea anything failed.
      const tab = phaseToTab[phase];
      if (tab) try { tm?.setError(tab); } catch (e) { Debug.warn('[v04] setError failed:', tab, e); }
      // Surface a toast as well in case the user is on a different tab — the
      // tab-strip indicator alone is easy to miss.
      const phaseLabel = ({
        company: 'Company Overview', team: 'Researcher Aptitude',
        funding: 'Sector Funding', competitive: 'Competitive Winnability',
        market: 'Market Opportunity', iprisk: 'IP Landscape',
        literature: 'Scientific Evidence',
        synthesis: 'Unified Synthesis'
      })[phase] || phase;
      // Scientific Evidence + Synthesis failures degrade gracefully — the
      // Competitive and Solution Value sections still render with the v04.1
      // fallback layout. Surface a softer notice so the advisor knows but
      // doesn't think the assessment is broken.
      if (phase === 'literature' || phase === 'synthesis') {
        const msg = phase === 'literature'
          ? `${phaseLabel} analysis failed — proceeding without literature-derived context.`
          : `${phaseLabel} failed — Competitive and Solution Value will render with the unmerged v04.1 layout.`;
        window.app?.toastManager?.warning?.(msg)
          || window.app?.toastManager?.error?.(msg);
      } else {
        window.app?.toastManager?.error?.(`${phaseLabel} analysis failed. Click the tab and use Retry.`);
      }
    });

    pipeline.on('overviewReady', () => {
      // Switch the page into the assessment view as soon as company is ready,
      // so the advisor can start reading while the 5 downstream phases finish.
      this._hideProgressOverlay();
      document.getElementById('advisor-queue-view')?.classList.add('v04-hidden');
      const av = document.getElementById('results-section');
      if (av) { av.classList.remove('v04-hidden'); av.classList.remove('hidden'); }
      enable('solutionvalue');
      try { view?.loadSolutionValueEvidence?.(); } catch (e) { Debug.warn('[v04] loadSolutionValueEvidence failed:', e); }
    });

    pipeline.on('complete', () => {
      enable('summary');
      this._hideProgressOverlay();
      window.__v04_livePipeline = null;
      // Populate the summary tab + reveal the recommendation/submit section
      // immediately — same reasoning as in openAssessment.
      if (window.summaryView && view?.data) {
        try {
          window.summaryView.update({
            company:     view.data.company,
            team:        view.data.team,
            funding:     view.data.funding,
            competitive: view.data.competitive,
            market:      view.data.market,
            iprisk:      view.data.iprisk
          });
        } catch (e) { Debug.warn('[v04] summaryView.update (live) failed:', e); }
      }
      // Persist the run to the queue: attach the assembled assessment JSON +
      // flip Status to Ready + update the venture name with the AI-detected
      // one. Each step is best-effort — if the attach fails (e.g. URL length
      // for unusually large evidence), the row still flips to Ready with the
      // scores; just the AI evidence won't be re-loadable from My Queue.
      if (liveRowId) {
        this._persistLiveRunToQueue(liveRowId, view?.data, ventureName);
      }
    });

    pipeline.on('error', (error) => {
      this._hideProgressOverlay();
      window.__v04_livePipeline = null;
      alert('Analysis failed: ' + (error?.message || error));
      if (liveRowId) {
        QueueClient.update(liveRowId, {
          Status: 'Failed',
          LastError: String(error?.message || error).slice(0, 1000),
          LastActivityAt: new Date().toISOString()
        }).catch(e => Debug.warn('[v04] live-run Status=Failed update failed:', e));
      }
    });

    pipeline.on('cancelled', () => {
      this._hideProgressOverlay();
      window.__v04_livePipeline = null;
      if (liveRowId) {
        QueueClient.update(liveRowId, {
          Status: 'Canceled',
          LastActivityAt: new Date().toISOString()
        }).catch(e => Debug.warn('[v04] live-run Status=Canceled update failed:', e));
      }
    });

    try {
      const fileArray = Array.isArray(files) ? files : [];
      await pipeline.start({ url: ventureUrl || null, files: fileArray });
    } catch (e) {
      this._hideProgressOverlay();
      window.__v04_livePipeline = null;
      alert('Analysis failed to start: ' + (e?.message || e));
    }
  },

  // Best-effort: extract a clean hostname for the provisional VentureName when
  // the advisor didn't enter a custom name. Falls back to the raw URL on parse
  // failure (bad input is the user's problem; the live run rejects it earlier).
  _hostnameFromUrl(url) {
    try {
      const u = new URL(url);
      return u.hostname.replace(/^www\./, '');
    } catch (_) { return url; }
  },

  /**
   * Attach the assembled assessment JSON to a live-run queue row and flip its
   * status to Ready. Updates the VentureName to the AI-detected one if better
   * than the provisional value. Best-effort: a failure here is logged but
   * doesn't abort the advisor's flow — the queue row still exists with scores.
   */
  async _persistLiveRunToQueue(rowId, viewData, customVentureName) {
    if (!viewData) return;
    // Live-run evidence shape mirrors what openAssessment expects to load: each
    // dimension is the already-shaped value loadXxxData consumes. (The shape()
    // helper in openAssessment passes through when there's no `outputs`
    // wrapper, so already-shaped data round-trips correctly.)
    const assessment = {
      schemaVersion: 'v04-live-1',
      composedAt:    new Date().toISOString(),
      source:        'live-run',
      company:       viewData.company || null,
      team:          viewData.team || null,
      funding:       viewData.funding || null,
      competitive:   viewData.competitive || null,
      market:        viewData.market || null,
      iprisk:        viewData.iprisk || null,
      literature:    viewData.literature || null,
      synthesis:     viewData.synthesis || null
    };

    // Update name + Status first — even if the attach fails for size reasons,
    // the row is in Ready state with the right name.
    const aiName = viewData.company?.company_overview?.name;
    const finalName = (customVentureName && customVentureName.trim()) || aiName || null;
    const fields = {
      Status:        'Ready',
      LastActivityAt: new Date().toISOString(),
      CompletedAt:    new Date().toISOString()
    };
    if (finalName) fields.VentureName = finalName;
    try {
      const upd = await QueueClient.update(rowId, fields);
      if (!upd?.success) Debug.warn('[v04] live-run Status=Ready update failed:', upd?.error);
    } catch (e) {
      Debug.warn('[v04] live-run Status=Ready update threw:', e);
    }

    // Attach the evidence JSON. The JSONP-via-script-tag transport encodes the
    // payload into the URL; for large ventures this can exceed browser URL
    // limits and fail. We surface the failure as a toast but don't roll back —
    // the queue row is still useful for tracking the score submission.
    try {
      const att = await QueueClient.attachEvidence(rowId, assessment);
      if (!att?.success) {
        Debug.warn('[v04] live-run evidence attach failed:', att?.error);
        window.app?.toastManager?.warning?.(
          'Run saved to queue, but AI evidence could not be attached (likely payload too large). Your scores will still record correctly.'
        );
      } else {
        Debug.log('[v04] live-run evidence attached:', att.attachmentId);
      }
    } catch (e) {
      Debug.warn('[v04] live-run evidence attach threw:', e);
    }
  },

  _showProgressOverlay(ventureName, pipeline) {
    const overlay = document.getElementById('v04-pipeline-progress');
    if (!overlay) return;
    const titleEl = document.getElementById('v04-pipeline-title');
    if (titleEl) titleEl.textContent = `Analyzing ${ventureName}…`;
    const bar = document.getElementById('v04-pipeline-bar-fill');
    if (bar) bar.style.width = '0%';
    const phasesEl = document.getElementById('v04-pipeline-phases');
    if (phasesEl) {
      const phases = [
        ['company',     'Company Overview',       '~4 min'],
        ['team',        'Researcher Aptitude',    '~2 min'],
        ['funding',     'Sector Funding',         '~2 min'],
        ['competitive', 'Competitive Winnability','~3 min'],
        ['market',      'Market Opportunity',     '~2 min'],
        ['iprisk',      'IP Landscape',           '~3 min'],
        ['literature',  'Scientific Evidence',    '~2 min'],
        ['synthesis',   'Unified Synthesis',      '~1 min']
      ];
      phasesEl.innerHTML = phases.map(([k, label, dur]) => `
        <li class="v04-pipeline-phase" data-phase="${k}">
          <span class="v04-pipeline-phase-icon">·</span>
          <span class="v04-pipeline-phase-name">${label}</span>
          <span class="v04-pipeline-phase-duration">${dur}</span>
        </li>
      `).join('');
    }
    overlay.classList.remove('v04-hidden');

    // Wire cancel once.
    const cancelBtn = document.getElementById('v04-pipeline-cancel');
    if (cancelBtn && !cancelBtn._v04Wired) {
      cancelBtn.addEventListener('click', () => {
        const p = window.__v04_livePipeline;
        if (p && typeof p.cancel === 'function') p.cancel();
      });
      cancelBtn._v04Wired = true;
    }
  },

  _hideProgressOverlay() {
    const overlay = document.getElementById('v04-pipeline-progress');
    if (overlay) overlay.classList.add('v04-hidden');
  },

  _setPipelinePhaseState(phaseKey, state) {
    const li = document.querySelector(`.v04-pipeline-phase[data-phase="${phaseKey}"]`);
    if (!li) return;
    li.classList.remove('v04-phase-active', 'v04-phase-complete', 'v04-phase-error');
    li.classList.add(`v04-phase-${state}`);
    const icon = li.querySelector('.v04-pipeline-phase-icon');
    if (icon) {
      if (state === 'complete') icon.textContent = '✓';
      else if (state === 'error') icon.textContent = '!';
      else if (state === 'active') icon.textContent = '';
      else icon.textContent = '·';
    }
  },

  _bumpPipelineBar() {
    const total = 8;
    const done   = document.querySelectorAll('.v04-pipeline-phase.v04-phase-complete').length;
    const active = document.querySelectorAll('.v04-pipeline-phase.v04-phase-active').length;
    // Active phases count as half-credit so the bar moves the moment work
    // starts, not only when a phase finishes 3-4 min later.
    const pct = Math.min(100, Math.round(((done + active * 0.5) / total) * 100));
    const bar = document.getElementById('v04-pipeline-bar-fill');
    if (bar) bar.style.width = `${pct}%`;
  },

  /**
   * Fetch the evidence JSON, hand off to the existing v03 assessment-view, and
   * arrange the post-submit handler so scoring submit also flips the queue row
   * to Reviewed.
   */
  async openAssessment(rowId) {
    this.state.activeRowId = rowId;
    this._stopAutoRefresh();
    const row = this.state.rows.find(r => String(r.id) === String(rowId));
    if (!row) { alert('Row not found'); return; }
    // Reset the rename pencil UI to display-mode in case it was left open on
    // a previous venture (the venture-name-header is reused across opens).
    try {
      const editBox = document.getElementById('venture-name-edit');
      const display = document.querySelector('.venture-name-display');
      if (editBox) editBox.classList.add('hidden');
      if (display) display.classList.remove('v04-hidden');
    } catch (_) { /* non-fatal */ }

    // Show a full-screen overlay while we fetch the evidence JSON and shape it
    // for display. queue_get_evidence does 3 HTTP hops (list → meta → download),
    // typically 2–5 s; without a spinner the Open click feels like nothing happened.
    const overlay = document.createElement('div');
    overlay.className = 'v04-overlay-loading';
    overlay.innerHTML = `
      <span class="v04-spinner v04-spinner-lg"></span>
      <div>Loading assessment for <strong>${this._esc(row.VentureName || 'opportunity')}</strong>…</div>
    `;
    document.body.appendChild(overlay);
    const dismissOverlay = () => { if (overlay.parentNode) overlay.parentNode.removeChild(overlay); };

    let ev;
    try {
      ev = await QueueClient.getEvidence(rowId);
    } catch (e) {
      dismissOverlay();
      alert('Failed to load assessment evidence: ' + (e?.message || e));
      return;
    }
    if (!ev?.success || !ev.assessment) {
      dismissOverlay();
      alert('Failed to load assessment evidence: ' + (ev?.error || 'unknown'));
      return;
    }
    // Defer overlay dismissal until after the heavy DOM rendering below runs,
    // so the spinner stays visible through the full "Open click → page ready"
    // wait, not just the network fetch portion.
    setTimeout(dismissOverlay, 0);

    // Hydrate v03's state-manager with the assessment so the existing assessment-view
    // renders. The shape is what the runner composed: { company, team, funding, ... }
    // mapped onto state.assessment for v03 compatibility.
    const state = window.app?.stateManager;
    if (state && typeof state.restoreAssessment === 'function') {
      // restoreAssessment(cacheKey | {company, team, funding, ...})
      state.restoreAssessment(ev.assessment);
    } else if (state) {
      // Fallback: write into the state object directly
      state.state = state.state || {};
      state.state.assessment = ev.assessment;
      state.state.ventureName  = row.VentureName;
      state.state.advisorName  = row.AdvisorName;
      state.state.portfolio    = row.Portfolio;
      state.state.institution  = row.Institution;
      state.state.technologyDescription = row.TechnologyDescription;
      state.state.technologyDomain      = row.TechnologyDomain;
    }

    // Reveal the v03 assessment view section, hide the queue list. The results
    // section has BOTH `hidden` (v03's hide class) and `v04-hidden` on it at
    // page load — remove both, or it stays invisible.
    document.getElementById('advisor-queue-view').classList.add('v04-hidden');
    const av = document.getElementById('results-section');
    if (av) { av.classList.remove('v04-hidden'); av.classList.remove('hidden'); }

    // Reset everything from the previously-opened venture so nothing bleeds
    // through. clearVentureDecisions wipes the verdict/track/pathway/dual-use/
    // ecosystem-notes/institution/tech-desc/tech-domain state-manager fields;
    // view.reset() wipes per-dimension scores; we also poke the DOM so the
    // radios/checkboxes/textareas visually clear (the SummaryView's listeners
    // were attached once at init and only re-render on state-manager *change*,
    // not on a fresh load).
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
    // Also clear the v03 "previously submitted" treatment on the per-dimension cards
    ['team', 'funding', 'competitive', 'market', 'iprisk', 'solutionvalue'].forEach(dim => {
      const card = document.getElementById(`${dim}-scoring-card`);
      if (card) card.classList.remove('has-submission');
      const btn = document.getElementById(`${dim}-submit-btn`);
      if (btn) { btn.classList.remove('update-mode'); btn.textContent = 'Submit Assessment'; }
    });

    // Update the venture-name header from the queue row (in v03 the pipeline did
    // this as data arrived; v04 has no pipeline so we do it ourselves).
    const nameEl = document.getElementById('venture-name-text');
    if (nameEl) nameEl.textContent = row.VentureName || '(unnamed opportunity)';

    // Bridge queue-row fields into the v03 inputs/state the submit path reads.
    // SmartsheetIntegration.getAdvisorName() looks at #sca-name and localStorage.scaName;
    // getPortfolio() reads #portfolio. Venture-level fields (institution, tech desc,
    // tech domain) populate their respective inputs so the v03 SummaryView shows them
    // and the v03 submit path picks them up via state-manager.
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

    // The runner stores raw Stack AI outputs per phase ({outputs: {'out-0', 'out-1'}}).
    // v03's per-API processResponse() transforms those into the { score, formatted, ... }
    // envelope assessment-view's loadXxxData methods expect. Run it here, then load.
    // (company is special: runner stores it as the company JSON directly, not wrapped.)
    console.log('[v04] openAssessment evidence keys:', Object.keys(ev.assessment || {}));
    const view = window.assessmentView;
    const a = ev.assessment;
    if (view && a) {
      const apiAvailable = !!(window.TeamAPI && window.TeamAPI.processResponse);
      console.log('[v04] API modules loaded:', apiAvailable, {
        TeamAPI: !!window.TeamAPI, FundingAPI: !!window.FundingAPI,
        CompetitiveAPI: !!window.CompetitiveAPI, MarketAPI: !!window.MarketAPI,
        IPRiskAPI: !!window.IPRiskAPI
      });

      const shape = (label, api, raw) => {
        if (!raw) { console.warn(`[v04] ${label}: no data`); return null; }
        const hasOutputs = !!raw.outputs;
        const hasProcess = !!(api && typeof api.processResponse === 'function');
        console.log(`[v04] ${label}: hasOutputs=${hasOutputs} hasProcess=${hasProcess} rawKeys=`, Object.keys(raw).slice(0, 8));
        if (hasOutputs && hasProcess) {
          try {
            const shaped = api.processResponse(raw);
            console.log(`[v04] ${label} shaped, score=${shaped?.score}`);
            return shaped;
          } catch (e) {
            console.error(`[v04] ${label} processResponse failed:`, e);
            return null;
          }
        }
        // No outputs wrapper or no API — pass through (may be incomplete display).
        return raw;
      };

      const tm = window.app?.tabManager;
      const enable = (tabId) => { try { tm?.enableTab(tabId); } catch (e) { Debug.warn('[v04] enableTab failed:', tabId, e); } };

      if (a.company) {
        try { view.loadCompanyData(a.company); enable('overview'); console.log('[v04] company loaded'); }
        catch (e) { console.error('[v04] loadCompanyData failed:', e); }
        // v04.2.1: Auto-detect institution + tech-description + tech-domain
        // from the AI-extracted company data, mirroring the live-run path
        // (advisor-queue-view phaseComplete handler for 'company'). The
        // runner does NOT run these JS-side extractors, so without this the
        // venture-decisions section stays blank on opened-from-queue
        // ventures unless the Associate pre-filled them. Only fills when
        // the queue-row value is empty — never overwrites an explicit value.
        if (window.VentureExtractors && sm) {
          try {
            const ventureUrl = row.VentureURL || '';
            if (!row.Institution) {
              const det = window.VentureExtractors.detectInstitution?.(ventureUrl, a.company, []);
              if (det) {
                sm.saveInstitution(det);
                setInput('venture-institution', det);
                console.log('[v04] auto-filled Institution from AI:', det);
              }
            }
            if (!row.TechnologyDescription) {
              const desc = window.VentureExtractors.deriveTechnologyDescription?.(a.company);
              if (desc) {
                sm.saveTechnologyDescription(desc);
                setInput('venture-tech-description', desc);
              }
            }
            if (!row.TechnologyDomain) {
              const dom = window.VentureExtractors.extractTechnologyDomain?.(a.company);
              if (dom) {
                sm.saveTechnologyDomain(dom);
                setInput('venture-tech-domain', dom);
              }
            }
          } catch (e) { Debug.warn('[v04] auto-detect on openAssessment failed:', e); }
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

        // Always land on the Overview tab when opening an assessment from the
        // queue, regardless of which tab the advisor was last viewing on a
        // prior venture. TabManager.activeTab is NOT reset by
        // assessmentView.reset(), so without this explicit activation the
        // previous venture's active tab (e.g., Competitive) stays selected and
        // the user sees the new venture's wrong-tab content. activateTab()
        // handles the panel-hide / panel-show transition.
        try { tm?.activateTab('overview'); } catch (e) { Debug.warn('[v04] activateTab(overview) failed:', e); }

        // Populate the summary tab (score grid + recommendation section) up
        // front so the advisor sees the full layout — including the Submit
        // Final Assessment button — without having to submit a per-dimension
        // score first. Without this call, summary-content stays empty and
        // final-recommendation-section stays hidden until submitScore fires.
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
    } else {
      console.error('[v04] missing view or assessment', { view: !!view, assessment: !!a });
    }

    // Save a hook so the existing scoring submission path can mark this row Reviewed.
    window.__v04_currentQueueRowId = rowId;

    // Clear any stale smartsheet scoresheet rowId from a previous venture
    // (both in-memory and the state-manager's persisted copy). Submits start
    // with no rowId → create a new row. If we find a prior submission below
    // (Reviewed venture), _applyPriorScores sets the rowId from that prior
    // row so the submit updates instead of duplicating.
    try { window.SmartsheetIntegration?.clearCurrentRowId?.(); } catch (e) { Debug.warn('[v04] clearCurrentRowId failed:', e); }

    // Always check the scoresheet for prior submissions for this venture +
    // advisor — partial per-dimension submits leave the queue row in 'Ready'
    // (only the final submitAllScores hook flips it to 'Reviewed'), so we
    // can't gate on row.Status. If anything is there, pre-populate the form
    // so the advisor can continue where they left off. The banner is the UI
    // signal that this is a *finalized* re-score, so it's still gated on
    // Reviewed.
    const isReviewed = row.Status === 'Reviewed';
    const banner = document.getElementById('v04-updating-banner');
    if (banner) banner.classList.add('v04-hidden');
    try {
      const prior = await this._fetchPriorScores(row.VentureName, row.AdvisorName);
      if (prior) {
        this._applyPriorScores(prior);
        if (isReviewed && banner) banner.classList.remove('v04-hidden');
      }
    } catch (e) {
      Debug.warn('[v04] failed to load prior scores:', e);
    }

    // Re-render the summary tab AFTER priors are applied so the score grid
    // reflects already-submitted dimensions, the next-steps checklist crosses
    // off what's done, and `showRecommendationSection` flips Submit Final
    // Assessment to enabled (allScoresSubmitted now sees view.userScores[*]
    // .submitted === true). The earlier update() call rendered the grid
    // before priors loaded — accurate then, stale now.
    if (window.summaryView && view?.data) {
      try {
        window.summaryView.update({
          company:     view.data.company,
          team:        view.data.team,
          funding:     view.data.funding,
          competitive: view.data.competitive,
          market:      view.data.market,
          iprisk:      view.data.iprisk
        });
      } catch (e) { Debug.warn('[v04] summaryView.update (post-priors) failed:', e); }
    }
  },

  /**
   * Fetch the prior score-sheet row for (ventureName, advisorName) via the
   * existing smartsheet_list action. Returns the row object (flat field-named
   * map) or null if no match.
   *
   * Results are cached per-advisor for 5 minutes — opening the same advisor's
   * Reviewed ventures back-to-back was previously re-fetching the full sheet
   * each time.
   */
  async _fetchPriorScores(ventureName, advisorName) {
    if (!ventureName || !advisorName) {
      Debug.log('[v04] _fetchPriorScores: missing inputs', { ventureName, advisorName });
      return null;
    }
    const cacheKey = advisorName.toLowerCase();
    const now = Date.now();
    const ttl = 5 * 60 * 1000;
    if (!this._priorScoresCache) this._priorScoresCache = new Map();
    let entry = this._priorScoresCache.get(cacheKey);
    if (!entry || (now - entry.fetchedAt) > ttl) {
      const rows = await SmartsheetIntegration.fetchPastAssessments(advisorName);
      entry = { rows: Array.isArray(rows) ? rows : [], fetchedAt: now };
      this._priorScoresCache.set(cacheKey, entry);
      Debug.log(`[v04] prior-scores fetched: ${entry.rows.length} row(s) for advisor "${advisorName}"`);
    } else {
      Debug.log(`[v04] prior-scores from cache: ${entry.rows.length} row(s) for advisor "${advisorName}"`);
    }
    // Match by ventureName, case-insensitive, with whitespace tolerance.
    // Smartsheet stores whatever was written via context.ventureName at submit
    // time, which can differ from the queue row's VentureName (the AI-extracted
    // name vs the Associate's input). Be generous here.
    const norm = s => String(s || '').trim().toLowerCase();
    const target = norm(ventureName);
    const aiName = norm(window.app?.assessmentView?.data?.company?.company_overview?.name);
    const match = entry.rows.find(r => {
      const rn = norm(r.ventureName);
      return rn === target || (aiName && rn === aiName);
    }) || null;
    Debug.log('[v04] prior-scores match:', {
      target,
      aiName: aiName || '(none)',
      foundRowIds: entry.rows.map(r => `${r.id}:${r.ventureName}`).slice(0, 5),
      matched: match ? `${match.id}:${match.ventureName}` : 'NO MATCH'
    });
    return match;
  },

  // Call this from the scoring-submit hook so the next Open re-fetches the
  // freshly-written row instead of returning the cached (pre-submit) version.
  invalidatePriorScoresCache(advisorName) {
    if (!this._priorScoresCache || !advisorName) return;
    this._priorScoresCache.delete(advisorName.toLowerCase());
  },

  /**
   * Apply a prior score-sheet row into the assessment view + state-manager so
   * sliders, justifications, venture-level decisions, and the recommendation
   * textarea all reflect the saved values. The advisor's edits will overwrite
   * the existing Smartsheet row on the next submit (existingRowId match path).
   */
  _applyPriorScores(prior) {
    const view = window.assessmentView;
    const sm   = window.app?.stateManager;
    if (!view) return;

    Debug.log('[v04] _applyPriorScores running for row', prior.id, 'dims:', {
      team:        prior.teamScoreUser,
      funding:     prior.fundingScoreUser,
      competitive: prior.competitiveScoreUser,
      market:      prior.marketScoreUser,
      iprisk:      prior.ipRiskScoreUser,
      solutionvalue: prior.solutionValueScoreUser
    });

    // Wire the prior row's Smartsheet rowId into both the in-memory
    // SmartsheetIntegration state and the state-manager's persisted copy so the
    // next submit calls smartsheet_update on the existing row instead of
    // creating a duplicate. (Pre-fix: this never ran, so re-scoring would
    // either 404 against a stale rowId or duplicate the row.)
    if (prior.id != null) {
      try { window.SmartsheetIntegration?.setCurrentRowId?.(prior.id); }
      catch (e) { Debug.warn('[v04] setCurrentRowId from prior failed:', e); }
    }

    // Per-dimension scores + justifications. Score-sheet column name → assessment-view dimension key.
    const dimMap = [
      ['team',          'teamScoreUser',          'teamJustification'],
      ['funding',       'fundingScoreUser',       'fundingJustification'],
      ['competitive',   'competitiveScoreUser',   'competitiveJustification'],
      ['market',        'marketScoreUser',        'marketJustification'],
      ['iprisk',        'ipRiskScoreUser',        'ipRiskJustification'],
      ['solutionvalue', 'solutionValueScoreUser', 'solutionValueJustification']
    ];
    dimMap.forEach(([dim, scoreKey, justKey]) => {
      const raw = prior[scoreKey];
      const score = raw != null && raw !== '' ? Number(raw) : null;
      const justification = prior[justKey] || '';
      if (score != null || justification) {
        view.setUserScore(dim, { score, justification });
        // Mark this dimension as previously submitted so the right-hand "Your
        // Assessment" panel shows the v03 "has-submission" treatment and the
        // submit button flips to "Update Score". setUserScore alone doesn't do
        // this — v03 does it after restoring from cache (see v03 app.js:1925).
        if (score != null) {
          if (view.userScores && view.userScores[dim]) {
            view.userScores[dim].submitted = true;
            view.userScores[dim].timesSubmitted = 1;
          }
          const submitBtn = document.getElementById(`${dim}-submit-btn`);
          if (submitBtn) {
            submitBtn.classList.add('update-mode');
            submitBtn.innerHTML = `
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
              </svg>
              Update Score
            `;
          }
          const scoringCard = document.getElementById(`${dim}-scoring-card`);
          if (scoringCard) scoringCard.classList.add('has-submission');
        }
      }
    });

    if (!sm) return;

    // Venture-level decisions. Reverse the picklist translation the proxy
    // applied on write ("Track 1" → 1, "License" → "license", "Yes" → "yes").
    if (prior.trackAssignment) {
      const m = String(prior.trackAssignment).match(/([123])/);
      if (m) {
        const n = Number(m[1]);
        sm.saveTrackAssignment(n);
        const radio = document.querySelector(`input[name="venture-track"][value="${n}"]`);
        if (radio) radio.checked = true;
      }
    }
    if (prior.pathway) {
      const pw = String(prior.pathway).toLowerCase();
      if (pw === 'license' || pw === 'company' || pw === 'both') {
        sm.savePathway(pw);
        const radio = document.querySelector(`input[name="venture-pathway"][value="${pw}"]`);
        if (radio) radio.checked = true;
      }
    }
    if (prior.verdict) {
      const v = String(prior.verdict).toLowerCase();
      if (v === 'yes' || v === 'maybe' || v === 'no') {
        sm.saveVerdict(v);
        const radio = document.querySelector(`input[name="venture-verdict"][value="${v}"]`);
        if (radio) radio.checked = true;
      }
    }
    if (prior.dualUse !== undefined && prior.dualUse !== null && prior.dualUse !== '') {
      const flag = prior.dualUse === true || prior.dualUse === 'true';
      sm.saveDualUse(flag);
      const cb = document.getElementById('venture-dual-use');
      if (cb) cb.checked = flag;
    }
    if (prior.ecosystemNotes) {
      sm.saveEcosystemNotes(prior.ecosystemNotes);
      const ta = document.getElementById('venture-ecosystem-notes');
      if (ta) ta.value = prior.ecosystemNotes;
    }
    if (prior.finalRecommendation) {
      sm.saveFinalRecommendation(prior.finalRecommendation);
      const ta = document.getElementById('final-recommendation-text');
      if (ta) ta.value = prior.finalRecommendation;
    }
    // The score-sheet row may have more authoritative versions of institution /
    // tech desc / tech domain if the advisor edited them during prior scoring.
    if (prior.institution)           { sm.saveInstitution(prior.institution);                   const el = document.getElementById('venture-institution');      if (el) el.value = prior.institution; }
    if (prior.technologyDescription) { sm.saveTechnologyDescription(prior.technologyDescription); const el = document.getElementById('venture-tech-description'); if (el) el.value = prior.technologyDescription; }
    if (prior.technologyDomain)      { sm.saveTechnologyDomain(prior.technologyDomain);          const el = document.getElementById('venture-tech-domain');      if (el) el.value = prior.technologyDomain; }

    // Enable Export PDF — the venture has been submitted before, so an export
    // should be possible without re-submitting first. The submit path also
    // enables this, but for prior loads we have to do it here.
    const exportBtn = document.getElementById('export-btn');
    if (exportBtn) exportBtn.disabled = false;
  },

  /**
   * Return from the assessment view back to the My Queue list. Refreshes the
   * queue so any status change (Ready → Reviewed) from a just-submitted
   * scoring shows up.
   */
  async backToQueue() {
    const av = document.getElementById('results-section');
    if (av) { av.classList.add('v04-hidden'); av.classList.add('hidden'); }
    const queue = document.getElementById('advisor-queue-view');
    if (queue) queue.classList.remove('v04-hidden');
    const banner = document.getElementById('v04-updating-banner');
    if (banner) banner.classList.add('v04-hidden');
    // Export PDF only makes sense inside an assessment; the assessment data is
    // cleared on next Open, so disable the header button when returning to the
    // queue list. Re-enabled when an assessment is opened (with priors) or
    // after Submit Final Assessment.
    const exportBtn = document.getElementById('export-btn');
    if (exportBtn) exportBtn.disabled = true;
    window.__v04_currentQueueRowId = null;
    this.state.activeRowId = null;
    await this.refresh();
  },

  _esc(s) {
    // Thin shim — actual escape lives in js/utils/formatters.js as escapeHtml.
    return window.escapeHtml(s);
  }
};

window.AdvisorQueueView = AdvisorQueueView;

// Wire the Back-to-Queue button via event delegation on document — works
// regardless of script-load order and survives any DOM swaps the assessment
// view does internally. closest() handles clicks on the SVG/inner spans too.
document.addEventListener('click', (e) => {
  if (e.target.closest && e.target.closest('.v04-back-to-queue')) {
    e.preventDefault();
    AdvisorQueueView.backToQueue();
  }
});

// When the FINAL submit (submitAllScores) succeeds, flip the v04 queue row
// to Reviewed and invalidate the prior-scores cache. Hook in once at load.
(function attachReviewedHook() {
  const orig = window.SmartsheetIntegration && window.SmartsheetIntegration.submitAllScores;
  if (!orig) return;
  window.SmartsheetIntegration.submitAllScores = async function (...args) {
    const result = await orig.apply(window.SmartsheetIntegration, args);
    try {
      if (result?.success && window.__v04_currentQueueRowId) {
        const rowId = window.__v04_currentQueueRowId;
        const upd = await window.QueueClient.update(rowId, { Status: 'Reviewed' });
        if (!upd?.success) {
          // Surface the failure — silent swallow here is why "Hydronet stayed
          // in To Review" went undetected. The advisor's scores submitted
          // fine but the queue row never flipped, leaving them stuck.
          Debug.error('[v04] Queue row update to Reviewed failed:', upd?.error, 'rowId=', rowId);
          window.app?.toastManager?.warning?.('Scores saved — but failed to update queue status. Refresh to retry.');
        } else {
          const advisorName = AdvisorQueueView.state?.advisorName;
          AdvisorQueueView.invalidatePriorScoresCache?.(advisorName);
        }
      } else if (result?.success && !window.__v04_currentQueueRowId) {
        Debug.warn('[v04] submitAllScores success but no __v04_currentQueueRowId — queue row will not flip to Reviewed');
      }
    } catch (e) {
      Debug.error('[v04] Failed to flip queue row to Reviewed:', e);
    }
    return result;
  };
})();

// When a per-DIMENSION submit (submitScore) succeeds, the advisor's row in
// the score sheet has changed — invalidate the cache so the next Open
// re-fetches and pre-populates with the latest values. Without this, a Back
// → Re-open after partial scoring would still show empty fields (or stale
// values) because _fetchPriorScores would return the cached pre-submit list.
(function attachPerDimInvalidate() {
  const orig = window.SmartsheetIntegration && window.SmartsheetIntegration.submitScore;
  if (!orig) return;
  window.SmartsheetIntegration.submitScore = async function (...args) {
    const result = await orig.apply(window.SmartsheetIntegration, args);
    try {
      if (result?.success) {
        const advisorName = AdvisorQueueView.state?.advisorName;
        AdvisorQueueView.invalidatePriorScoresCache?.(advisorName);
      }
    } catch (e) {
      Debug.warn('[v04] cache invalidate after submitScore failed:', e);
    }
    return result;
  };
})();
