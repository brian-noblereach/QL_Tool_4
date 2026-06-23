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

    // Let external users export the AI analysis as a PDF without first entering
    // a recommendation (the loader disables the button during reset).
    const exportBtn = document.getElementById('export-btn');
    if (exportBtn) exportBtn.disabled = false;
  },

  // The results-section markup is shared with the advisor flow. For external we
  // repoint its Back buttons at this list and remove the rename affordance.
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
  },

  // Invoked by the shared .v04-back-to-queue delegated handler when the active
  // role is external (see advisor-queue-view.js).
  backToList() {
    const av = document.getElementById('results-section');
    if (av) { av.classList.add('v04-hidden'); av.classList.add('hidden'); }
    if (this._root) this._root.classList.remove('v04-hidden');
    this.refresh();
  },

  _esc(s) { return window.escapeHtml(s); }
};

window.ExternalView = ExternalView;
