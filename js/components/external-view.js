// js/components/external-view.js — read-only "shared analyses" view for an
// external university partner (e.g. Georgetown).
//
// The external login is scope-locked server-side: QueueClient.listExternal() and
// getEvidenceExternal() only ever return the ventures tagged with this partner's
// scope (ExternalShareTag) whose Status is Ready or Reviewed. This view lists
// those ventures and opens each assessment through the SAME shared loader the
// advisor view uses (AssessmentLoader.loadEvidenceIntoView).
//
// External users may move sliders, type justifications, and set a verdict, but
// nothing is written to Smartsheet (submitToSmartsheet/submitAllScores short-
// circuit for external, and the proxy gates every write action against the role).
// This view simply omits the queue-management / run-analysis affordances and
// hides the rename pencil (which would call the gated queue_update).

const ExternalView = {
  state: { rows: [], activeRowId: null },

  async init() {
    this._root = document.getElementById('external-view');
    if (!this._root) return;
    this._render();
    await this.refresh();
    this._wireEvents();
    this._wireScorePersistence();
  },

  _render() {
    const label = (window.Auth && Auth.scopeLabel) || 'Shared';
    this._root.innerHTML = `
      <div class="v04-associate-pane">
        <header class="v04-pane-header">
          <h2>${this._esc(label)} &mdash; Venture Analyses</h2>
          <p class="v04-pane-sub">
            Read-only view of the completed analyses shared with ${this._esc(label)}.
            Open a venture to review its assessment. Any scores or notes you enter
            stay on this device only &mdash; they are not saved or shared.
          </p>
        </header>
        <section class="v04-queue-card">
          <header class="v04-queue-header">
            <h3>Available analyses</h3>
            <button id="v04-ext-refresh" class="v04-btn-secondary">Refresh</button>
          </header>
          <div id="v04-ext-list-wrap"></div>
        </section>
      </div>
    `;
  },

  async refresh() {
    try {
      const r = await QueueClient.listExternal();
      this.state.rows = r && r.success ? (r.rows || []) : [];
      this._renderList();
    } catch (e) {
      console.error('[ExternalView] refresh failed', e);
      this.state.rows = [];
      this._renderList();
    }
  },

  _renderList() {
    const wrap = document.getElementById('v04-ext-list-wrap');
    if (!wrap) return;
    if (!this.state.rows.length) {
      wrap.innerHTML = '<p class="v04-empty">No analyses are available yet. Check back later.</p>';
      return;
    }
    const rowHtml = this.state.rows.map(r => {
      const cls = 'v04-status-' + String(r.Status || '').toLowerCase();
      const when = r.CompletedAt || r.LastActivityAt || '';
      return `
        <tr data-row-id="${r.id}">
          <td>${this._esc(r.VentureName)}</td>
          <td>${this._esc(r.Institution || '')}</td>
          <td>${this._esc(r.TechnologyDomain || '')}</td>
          <td><span class="v04-status ${cls}">${this._esc(r.Status || '')}</span></td>
          <td>${when ? new Date(when).toLocaleDateString() : ''}</td>
          <td class="v04-row-actions">
            <button class="v04-btn-mini v04-ext-open" data-row-id="${r.id}">Open</button>
          </td>
        </tr>`;
    }).join('');
    wrap.innerHTML = `
      <table class="v04-queue-table">
        <thead><tr>
          <th>Venture</th><th>Institution</th><th>Domain</th><th>Status</th><th>Completed</th><th></th>
        </tr></thead>
        <tbody>${rowHtml}</tbody>
      </table>`;
  },

  _wireEvents() {
    this._root.addEventListener('click', async (e) => {
      const t = e.target;
      if (t.id === 'v04-ext-refresh') { await this.refresh(); return; }
      const openBtn = t.closest && t.closest('.v04-ext-open');
      if (openBtn) { await this.openAssessment(openBtn.dataset.rowId); }
    });
  },

  async openAssessment(rowId) {
    this.state.activeRowId = rowId;
    // Kill any pending save from the previously-open venture so it can't fire
    // mid-load and clobber this venture's stored snapshot.
    if (this._snapshotTimer) { clearTimeout(this._snapshotTimer); this._snapshotTimer = null; }
    const row = this.state.rows.find(r => String(r.id) === String(rowId));
    if (!row) { alert('Venture not found'); return; }

    const overlay = document.createElement('div');
    overlay.className = 'v04-overlay-loading';
    overlay.innerHTML = `
      <span class="v04-spinner v04-spinner-lg"></span>
      <div>Loading assessment for <strong>${this._esc(row.VentureName || 'venture')}</strong>...</div>
    `;
    document.body.appendChild(overlay);
    const dismiss = () => { if (overlay.parentNode) overlay.parentNode.removeChild(overlay); };

    let ev;
    try {
      ev = await QueueClient.getEvidenceExternal(rowId);
    } catch (e) {
      dismiss();
      alert('Failed to load assessment: ' + (e?.message || e));
      return;
    }
    if (!ev || !ev.success || !ev.assessment) {
      dismiss();
      alert('Failed to load assessment: ' + ((ev && ev.error) || 'unknown'));
      return;
    }
    setTimeout(dismiss, 0);

    // Hide the list; the shared loader reveals + renders the assessment view.
    this._root.classList.add('v04-hidden');
    window.AssessmentLoader.loadEvidenceIntoView(ev.assessment, row);

    // External users score locally only — make sure no advisor "mark Reviewed"
    // hook is armed and clear any stale scoresheet rowId from a prior open.
    window.__v04_currentQueueRowId = null;
    try { window.SmartsheetIntegration?.clearCurrentRowId?.(); } catch (e) { Debug.warn('[ExternalView] clearCurrentRowId failed:', e); }

    // Read-only chrome adjustments (relabel Back, hide the rename pencil).
    this._applyExternalChrome();

    // Restore any scores/justifications/verdict this reviewer previously entered
    // for THIS venture on this device (the loader just reset the view). Must run
    // after the loader's initial render so it re-applies on top.
    this._restoreExternalScores(rowId);

    // Let external users export the AI analysis as a PDF without first entering
    // a recommendation (the loader disables the button during reset).
    const exportBtn = document.getElementById('export-btn');
    if (exportBtn) exportBtn.disabled = false;
  },

  // The results-section markup is shared with the advisor flow. For external we
  // repoint its Back buttons at this list and remove staff-only affordances.
  _applyExternalChrome() {
    document.querySelectorAll('.v04-back-to-queue').forEach(btn => {
      const svg = btn.querySelector('svg');
      btn.textContent = '';
      if (svg) btn.appendChild(svg);
      btn.appendChild(document.createTextNode(svg ? ' Back to analyses' : '← Back to analyses'));
      btn.setAttribute('title', 'Back to analyses');
    });
    const pencil = document.getElementById('edit-venture-name-btn');
    if (pencil) pencil.classList.add('v04-hidden');
    const hint = document.querySelector('.venture-name-hint');
    if (hint) hint.classList.add('v04-hidden');
    // The Database Sync section (check-status / force-sync) only makes sense for
    // staff who write to Smartsheet. External scoring is local-only, so hide it.
    const sync = document.getElementById('database-sync-section');
    if (sync) sync.classList.add('v04-hidden');
  },

  // Invoked by the shared .v04-back-to-queue delegated handler when the active
  // role is external (see advisor-queue-view.js).
  backToList() {
    const av = document.getElementById('results-section');
    if (av) { av.classList.add('v04-hidden'); av.classList.add('hidden'); }
    if (this._root) this._root.classList.remove('v04-hidden');
    this.refresh();
  },

  // ---- Local-only score persistence (per venture, this device) -------------
  // External scores never touch Smartsheet. We keep them in localStorage keyed
  // by rowId so a reviewer can score across multiple sittings / reloads and not
  // lose work. A single delegated, debounced listener snapshots the whole
  // scoring surface on any interaction; _restoreExternalScores re-applies it.

  DIMENSIONS: ['team', 'funding', 'competitive', 'market', 'iprisk', 'solutionvalue'],

  _extKey(rowId) { return 'noblereach_v04_ext_scores_' + rowId; },

  _wireScorePersistence() {
    if (this._scoreSaveWired) return;
    const rs = document.getElementById('results-section');
    if (!rs) return;
    const schedule = () => {
      if (this._snapshotTimer) clearTimeout(this._snapshotTimer);
      this._snapshotTimer = setTimeout(() => {
        this._snapshotTimer = null;
        this._snapshotExternalScores();
      }, 400);
    };
    // input: sliders + textareas; change: radios/checkbox; click: catches the
    // per-dimension "Submit/Update" button so the submitted flag is captured.
    ['input', 'change', 'click'].forEach(ev => rs.addEventListener(ev, schedule));
    this._scoreSaveWired = true;
  },

  _snapshotExternalScores() {
    // Only an external session writes these, and only for the open venture.
    if (!(window.Auth && Auth.isExternal && Auth.isExternal())) return;
    const rowId = this.state.activeRowId;
    const view = window.assessmentView;
    if (!rowId || !view || !view.userScores) return;

    const val   = (id) => { const el = document.getElementById(id); return el ? el.value : ''; };
    const radio = (name) => { const el = document.querySelector(`input[name="${name}"]:checked`); return el ? el.value : ''; };

    const snap = { userScores: {}, decisions: {
      verdict:        radio('venture-verdict'),
      track:          radio('venture-track'),
      pathway:        radio('venture-pathway'),
      dualUse:        !!(document.getElementById('venture-dual-use') || {}).checked,
      ecosystemNotes: val('venture-ecosystem-notes'),
      recommendation: val('final-recommendation-text')
    }};
    this.DIMENSIONS.forEach(dim => {
      const us = view.userScores[dim];
      if (us && (us.score != null || us.justification)) {
        snap.userScores[dim] = { score: us.score, justification: us.justification || '', submitted: !!us.submitted };
      }
    });

    // Skip writing an entirely-empty snapshot (e.g. a stray click before any
    // input) so we never overwrite real saved work with nothing.
    const hasAny = Object.keys(snap.userScores).length ||
      Object.values(snap.decisions).some(v => v && v !== false);
    try {
      if (hasAny) localStorage.setItem(this._extKey(rowId), JSON.stringify(snap));
    } catch (e) { Debug.warn('[ExternalView] score snapshot save failed:', e); }
  },

  _restoreExternalScores(rowId) {
    let snap = null;
    try { snap = JSON.parse(localStorage.getItem(this._extKey(rowId)) || 'null'); }
    catch (e) { snap = null; }
    if (!snap) return;
    const view = window.assessmentView;
    if (!view) return;

    Object.keys(snap.userScores || {}).forEach(dim => {
      const s = snap.userScores[dim];
      if (!s) return;
      if (typeof view.setUserScore === 'function') {
        view.setUserScore(dim, { score: s.score, justification: s.justification });
      }
      if (s.submitted && s.score != null && view.userScores && view.userScores[dim]) {
        view.userScores[dim].submitted = true;
        view.userScores[dim].timesSubmitted = view.userScores[dim].timesSubmitted || 1;
        const btn = document.getElementById(`${dim}-submit-btn`);
        if (btn) {
          btn.classList.add('update-mode');
          btn.innerHTML = `
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
            </svg>
            Update Score`;
        }
        const card = document.getElementById(`${dim}-scoring-card`);
        if (card) card.classList.add('has-submission');
      }
    });

    const d = snap.decisions || {};
    const setRadio = (name, v) => { if (v) { const el = document.querySelector(`input[name="${name}"][value="${v}"]`); if (el) el.checked = true; } };
    setRadio('venture-verdict', d.verdict);
    setRadio('venture-track', d.track);
    setRadio('venture-pathway', d.pathway);
    const du = document.getElementById('venture-dual-use'); if (du) du.checked = !!d.dualUse;
    const en = document.getElementById('venture-ecosystem-notes'); if (en && d.ecosystemNotes) en.value = d.ecosystemNotes;
    const rec = document.getElementById('final-recommendation-text'); if (rec && d.recommendation) rec.value = d.recommendation;

    // Re-render the summary so the score grid + recommendation section reflect
    // the restored state (mirrors the advisor post-priors re-render).
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
      } catch (e) { Debug.warn('[ExternalView] summary update after restore failed:', e); }
    }
  },

  _esc(s) { return window.escapeHtml(s); }
};

window.ExternalView = ExternalView;
