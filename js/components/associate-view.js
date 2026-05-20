// js/components/associate-view.js — Queue Management view for Associates and Admins.
//
// Layout: a sticky "Add Venture" form at the top and a table of queue rows below.
// Read-only fields the runner populates after analysis (TechnologyDescription /
// TechnologyDomain / Institution) are shown in the table; the Add form lets
// Associates supply *optional* values for them if they want to seed them.

const AssociateView = {
  state: {
    rows: [],
    config: null,            // pulled from /?action=config (advisors, associates, portfolios)
    filterPortfolio: '',
    filterStatus: ''
  },

  async init() {
    this._root = document.getElementById('associate-view');
    if (!this._root) return;
    await this._loadConfig();
    this._render();
    await this.refresh();
    this._wireEvents();
  },

  async _loadConfig() {
    try {
      const res = await fetch(`${Auth.proxyUrl}?action=config`);
      const json = await res.json();
      this.state.config = json.config || {};
    } catch (e) {
      console.warn('[AssociateView] config fetch failed', e);
      this.state.config = {};
    }
  },

  async refresh() {
    try {
      const filter = {};
      if (this.state.filterPortfolio) filter.portfolio = this.state.filterPortfolio;
      if (this.state.filterStatus)    filter.status    = this.state.filterStatus;
      const r = await QueueClient.list(filter);
      this.state.rows = r.success ? (r.rows || []) : [];
      this._renderTable();
    } catch (e) {
      console.error('[AssociateView] refresh failed', e);
      this._renderTable();
    }
  },

  _render() {
    const cfg = this.state.config || {};
    const portfolios = (cfg.portfolios || []).map(p => p.value || p);
    const advisors   = cfg.advisors   || [];
    const associates = cfg.associates || [];

    this._root.innerHTML = `
      <div class="v04-associate-pane">
        <header class="v04-pane-header">
          <h2>Queue Management</h2>
          <p class="v04-pane-sub">Add opportunities to the analysis queue. The background runner picks them up automatically.</p>
        </header>

        <section class="v04-add-card">
          <h3>Add Opportunity</h3>
          <form id="v04-add-form" class="v04-add-form" autocomplete="off">
            <div class="v04-grid">
              <label>Opportunity Name *<input name="VentureName" required></label>
              <label>Advisor *
                <select name="AdvisorName" required>
                  <option value="">-- select --</option>
                  ${advisors.map(a => `<option value="${a}">${a}</option>`).join('')}
                </select>
              </label>
              <label>Associate *
                <select name="AssociateName" required>
                  <option value="">-- select --</option>
                  ${associates.map(a => `<option value="${a}">${a}</option>`).join('')}
                </select>
              </label>
              <label>Portfolio *
                <select name="Portfolio" required>
                  <option value="">-- select --</option>
                  ${portfolios.map(p => `<option value="${p}">${p}</option>`).join('')}
                </select>
              </label>
              <label class="v04-span-2">Website URL <input name="VentureURL" type="url" placeholder="https://..."></label>
              <label class="v04-span-2">SharePoint Input File URL(s)
                <textarea name="InputPointer" rows="3" placeholder="https://nrf.sharepoint.us/sites/.../queue-inputs/pitch-deck.pdf
https://nrf.sharepoint.us/sites/.../queue-inputs/invention-disclosure.pdf"></textarea>
                <span class="v04-hint">
                  Upload each file into <code>queue-inputs/</code> in SharePoint first, then paste the URLs here — <strong>one URL per line</strong> (commas or semicolons also work).
                  Common case: pitch deck + invention disclosure → paste both URLs on separate lines.
                </span>
              </label>
              <label>Institution<input name="Institution" placeholder="optional — AI will fill"></label>
              <label>Tech Domain<input name="TechnologyDomain" placeholder="optional — AI will fill"></label>
              <label class="v04-span-2">Contacts<input name="Contacts" placeholder="optional — founders/PIs/emails"></label>
              <label class="v04-span-2">Pre-load Notes<textarea name="PreloadNotes" rows="2" placeholder="optional context for the advisor"></textarea></label>
            </div>
            <div class="v04-form-actions">
              <button type="submit" class="v04-btn-primary">Add to Queue</button>
              <span id="v04-add-feedback" class="v04-feedback"></span>
            </div>
          </form>
        </section>

        <section class="v04-queue-card">
          <header class="v04-queue-header">
            <h3>Queue</h3>
            <div class="v04-queue-filters">
              <select id="v04-filter-portfolio">
                <option value="">All portfolios</option>
                ${portfolios.map(p => `<option value="${p}">${p}</option>`).join('')}
              </select>
              <select id="v04-filter-status">
                <option value="">All statuses</option>
                <option>Queued</option><option>Running</option><option>Ready</option>
                <option>Failed</option><option>Reviewed</option><option>Canceled</option>
              </select>
              <button id="v04-refresh-queue" class="v04-btn-secondary">Refresh</button>
            </div>
          </header>
          <div id="v04-queue-table-wrap"></div>
        </section>
      </div>
    `;
  },

  _renderTable() {
    const wrap = document.getElementById('v04-queue-table-wrap');
    if (!wrap) return;
    if (!this.state.rows.length) {
      wrap.innerHTML = '<p class="v04-empty">No opportunities match the current filter.</p>';
      return;
    }
    const rowHtml = this.state.rows.map(r => {
      const cls = 'v04-status-' + String(r.Status || '').toLowerCase();
      return `
        <tr data-row-id="${r.id}">
          <td>${this._esc(r.VentureName)}</td>
          <td><span class="v04-status ${cls}">${this._esc(r.Status || '')}</span></td>
          <td>${this._esc(r.Portfolio || '')}</td>
          <td>${this._esc(r.AdvisorName || '')}</td>
          <td>${this._esc(r.AssociateName || '')}</td>
          <td>${r.CompletedPhases ? r.CompletedPhases.split(',').length + '/6' : '0/6'}</td>
          <td>${r.Attempts ?? 0}</td>
          <td title="${this._esc(r.LastError || '')}">${r.LastError ? '⚠' : ''}</td>
          <td>${r.CreatedAt ? new Date(r.CreatedAt).toLocaleString() : ''}</td>
          <td class="v04-row-actions">
            ${(r.Status === 'Failed' || r.Status === 'Canceled') ? `<button class="v04-btn-mini v04-retry" data-row-id="${r.id}">Retry</button>` : ''}
            ${(r.Status === 'Queued' || r.Status === 'Running') ? `<button class="v04-btn-mini v04-cancel" data-row-id="${r.id}">Cancel</button>` : ''}
          </td>
        </tr>`;
    }).join('');
    wrap.innerHTML = `
      <table class="v04-queue-table">
        <thead><tr>
          <th>Opportunity</th><th>Status</th><th>Portfolio</th><th>Advisor</th><th>Associate</th>
          <th>Phases</th><th>Attempts</th><th></th><th>Created</th><th></th>
        </tr></thead>
        <tbody>${rowHtml}</tbody>
      </table>`;
  },

  _wireEvents() {
    const root = this._root;
    root.addEventListener('submit', async (e) => {
      if (e.target.id !== 'v04-add-form') return;
      e.preventDefault();
      const fd = new FormData(e.target);
      const fields = {};
      fd.forEach((v, k) => { if (typeof v === 'string' && v.trim()) fields[k] = v.trim(); });
      // Validate every SharePoint URL if provided — InputPointer accepts one
      // URL per line (commas/semicolons also work). The GAS proxy does the
      // canonical validation, but we surface mistakes immediately.
      if (fields.InputPointer) {
        const urls = fields.InputPointer.split(/[\r\n,;]+/).map(s => s.trim()).filter(s => s);
        const bad = urls.find(u => !/^https:\/\/nrf\.sharepoint\.us\//.test(u));
        if (bad) {
          this._feedback('Each input URL must start with https://nrf.sharepoint.us/. Bad URL: ' + bad, 'error');
          return;
        }
      }
      if (!fields.VentureURL && !fields.InputPointer) {
        this._feedback('Provide a Website URL or at least one SharePoint input-file URL (or both).', 'error');
        return;
      }
      this._feedback('Submitting...', 'info');
      const result = await QueueClient.create(fields);
      if (result?.success) {
        this._feedback('Added to queue. Row ' + result.rowId, 'ok');
        e.target.reset();
        await this.refresh();
      } else {
        this._feedback('Failed: ' + (result?.error || 'unknown error'), 'error');
      }
    });

    root.addEventListener('click', async (e) => {
      const t = e.target;
      if (t.id === 'v04-refresh-queue') { await this.refresh(); }
      else if (t.classList.contains('v04-retry')) {
        const rowId = t.dataset.rowId;
        await QueueClient.update(rowId, { Status: 'Queued', Attempts: 0, LastError: '' });
        await this.refresh();
      } else if (t.classList.contains('v04-cancel')) {
        if (!confirm('Cancel this opportunity? It can be re-queued later.')) return;
        const rowId = t.dataset.rowId;
        await QueueClient.update(rowId, { Status: 'Canceled' });
        await this.refresh();
      }
    });

    root.addEventListener('change', (e) => {
      if (e.target.id === 'v04-filter-portfolio') { this.state.filterPortfolio = e.target.value; this.refresh(); }
      if (e.target.id === 'v04-filter-status')    { this.state.filterStatus    = e.target.value; this.refresh(); }
    });
  },

  _feedback(msg, kind) {
    const el = document.getElementById('v04-add-feedback');
    if (!el) return;
    el.textContent = msg;
    el.className = 'v04-feedback v04-feedback-' + (kind || 'info');
  },

  _esc(s) {
    // Thin shim — actual escape lives in js/utils/formatters.js as escapeHtml.
    return window.escapeHtml(s);
  }
};

window.AssociateView = AssociateView;
