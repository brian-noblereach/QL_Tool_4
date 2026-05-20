// js/components/modal-manager.js
// Modal Management Component

class ModalManager {
  constructor() {
    this.activeModal = null;
    this.overlay = null;
    this.content = null;
    this.resolvePromise = null;
  }

  init() {
    this.overlay = document.getElementById('modal-overlay');
    this.content = document.getElementById('modal-content');
    
    if (!this.overlay) {
      console.error('Modal overlay not found');
      return;
    }
    
    this.overlay.addEventListener('click', (e) => {
      if (e.target === this.overlay) {
        this.close();
      }
    });
    
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.activeModal) {
        this.close();
      }
    });
    
    console.log('ModalManager initialized');
  }

  escapeHtml(text) {
    // Thin shim — actual escape lives in js/utils/formatters.js as escapeHtml.
    return window.escapeHtml(text);
  }

  showResumeModal(savedState) {
    return new Promise((resolve) => {
      this.resolvePromise = resolve;
      
      const companyUrl = savedState.companyInput?.url || 'Unknown';
      const completedPhases = savedState.completedPhases || {};
      const completedCount = Object.keys(completedPhases).length;
      const timestamp = savedState.timestamp ? new Date(savedState.timestamp).toLocaleString() : 'Unknown';
      
      const phases = ['company', 'team', 'funding', 'competitive', 'market', 'iprisk'];
      const phaseNames = {
        company: 'Company Overview',
        team: 'Researcher Aptitude',
        funding: 'Sector Funding Activity',
        competitive: 'Competitive Winnability',
        market: 'Market Opportunity',
        iprisk: 'IP Landscape'
      };

      let checklistHtml = '';
      phases.forEach(phase => {
        const isComplete = !!completedPhases[phase];
        const iconClass = isComplete ? 'check-icon' : 'pending-icon';
        const iconPath = isComplete 
          ? '<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>'
          : '<circle cx="12" cy="12" r="10"/>';
        checklistHtml += '<li><svg class="' + iconClass + '" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">' + iconPath + '</svg> ' + phaseNames[phase] + '</li>';
      });
      
      const modalHtml = '<div class="modal-header"><h3><svg class="modal-icon" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>Incomplete Analysis Found</h3></div>' +
        '<div class="modal-body">' +
        '<p>You have an incomplete assessment. Would you like to resume or start fresh?</p>' +
        '<div class="modal-info">' +
        '<div class="modal-info-row"><span class="modal-info-label">Company URL</span><span class="modal-info-value">' + this.escapeHtml(companyUrl) + '</span></div>' +
        '<div class="modal-info-row"><span class="modal-info-label">Progress</span><span class="modal-info-value">' + completedCount + ' of 6 complete</span></div>' +
        '<div class="modal-info-row"><span class="modal-info-label">Last Updated</span><span class="modal-info-value">' + timestamp + '</span></div>' +
        '</div>' +
        '<ul class="modal-checklist">' + checklistHtml + '</ul>' +
        '</div>' +
        '<div class="modal-footer">' +
        '<button class="btn outline" data-action="new">Start New</button>' +
        '<button class="btn primary" data-action="resume">Resume Analysis</button>' +
        '</div>';
      
      this.show(modalHtml, (action) => {
        resolve(action === 'resume' ? 'resume' : 'new');
      });
    });
  }

  showPartialExportModal(exportStatus) {
    return new Promise((resolve) => {
      this.resolvePromise = resolve;
      
      const phases = ['company', 'team', 'funding', 'competitive', 'market', 'iprisk'];
      const phaseNames = {
        company: 'Company Overview',
        team: 'Researcher Aptitude',
        funding: 'Sector Funding Activity',
        competitive: 'Competitive Winnability',
        market: 'Market Opportunity',
        iprisk: 'IP Landscape'
      };

      let checklistHtml = '';
      let completeCount = 0;
      
      phases.forEach(phase => {
        const isComplete = exportStatus[phase] === 'complete' || exportStatus[phase] === true;
        if (isComplete) completeCount++;
        
        const iconClass = isComplete ? 'check-icon' : 'pending-icon';
        const iconPath = isComplete 
          ? '<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>'
          : '<circle cx="12" cy="12" r="10"/>';
        const status = isComplete ? '' : ' (not included)';
        checklistHtml += '<li><svg class="' + iconClass + '" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">' + iconPath + '</svg> ' + phaseNames[phase] + status + '</li>';
      });
      
      const modalHtml = '<div class="modal-header"><h3><svg class="modal-icon" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>Partial Export</h3></div>' +
        '<div class="modal-body">' +
        '<p>' + completeCount + ' of 6 assessments are complete. The PDF will indicate missing sections.</p>' +
        '<ul class="modal-checklist">' + checklistHtml + '</ul>' +
        '</div>' +
        '<div class="modal-footer">' +
        '<button class="btn outline" data-action="cancel">Cancel</button>' +
        '<button class="btn primary" data-action="export">Export Partial PDF</button>' +
        '</div>';
      
      this.show(modalHtml, (action) => {
        resolve(action === 'export');
      });
    });
  }

  showErrorModal(phase, error) {
    return new Promise((resolve) => {
      this.resolvePromise = resolve;
      
      const modalHtml = '<div class="modal-header"><h3><svg class="modal-icon" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>Analysis Error</h3></div>' +
        '<div class="modal-body">' +
        '<p>The ' + this.escapeHtml(phase) + ' analysis encountered an error:</p>' +
        '<div class="modal-info"><p style="color: var(--brand-error);">' + this.escapeHtml(error.message || 'Unknown error') + '</p></div>' +
        '</div>' +
        '<div class="modal-footer">' +
        '<button class="btn outline" data-action="skip">Skip</button>' +
        '<button class="btn outline danger" data-action="cancel">Cancel All</button>' +
        '<button class="btn primary" data-action="retry">Retry</button>' +
        '</div>';
      
      this.show(modalHtml, resolve);
    });
  }

  /**
   * Show final submit confirmation modal when all scores are entered
   * @param {Object} data - Scores data and metadata
   * @param {Object} data.scores - Score data for each dimension
   * @param {Array} data.missingJustifications - Dimensions missing justifications
   * @param {string} data.avgAiScore - Average AI score
   * @param {string} data.avgUserScore - Average user score
   * @returns {Promise<string>} - 'submit', 'addJustifications', or 'cancel'
   */
  showFinalSubmitModal(data) {
    return new Promise((resolve) => {
      this.resolvePromise = resolve;
      
      const { scores, missingJustifications, avgAiScore, avgUserScore } = data;
      const hasMissingJustifications = missingJustifications && missingJustifications.length > 0;
      
      const dimensionNames = {
        team: 'Researcher Aptitude',
        funding: 'Sector Funding Activity',
        competitive: 'Competitive Winnability',
        market: 'Market Opportunity',
        iprisk: 'IP Landscape',
        solutionvalue: 'Solution Value'
      };
      
      // Build missing justifications list
      let missingListHtml = '';
      if (hasMissingJustifications) {
        missingListHtml = '<div class="modal-warning">' +
          '<div class="warning-icon">⚠️</div>' +
          '<div class="warning-content">' +
          '<strong>Missing justifications:</strong>' +
          '<ul class="missing-list">' +
          missingJustifications.map(dim => '<li>' + dimensionNames[dim] + '</li>').join('') +
          '</ul>' +
          '<p class="warning-note">You can add justifications now or submit without them.</p>' +
          '</div>' +
          '</div>';
      }
      
      const modalHtml = '<div class="modal-header">' +
        '<h3>' +
        '<svg class="modal-icon success" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">' +
        '<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>' +
        '<polyline points="22 4 12 14.01 9 11.01"/>' +
        '</svg>' +
        'All Assessments Complete' +
        '</h3>' +
        '</div>' +
        '<div class="modal-body">' +
        '<p>Ready to submit final scores to the database. Scores can be updated later if needed.</p>' +
        '<div class="modal-info">' +
        '<div class="modal-info-row">' +
        '<span class="modal-info-label">Average AI Score</span>' +
        '<span class="modal-info-value score-value">' + avgAiScore + '</span>' +
        '</div>' +
        '<div class="modal-info-row">' +
        '<span class="modal-info-label">Average User Score</span>' +
        '<span class="modal-info-value score-value">' + avgUserScore + '</span>' +
        '</div>' +
        '</div>' +
        missingListHtml +
        '</div>' +
        '<div class="modal-footer">' +
        '<button class="btn outline" data-action="cancel">Cancel</button>' +
        (hasMissingJustifications ? '<button class="btn outline" data-action="addJustifications">Add Justifications</button>' : '') +
        '<button class="btn primary" data-action="submit">' + (hasMissingJustifications ? 'Submit Anyway' : 'Submit Final Scores') + '</button>' +
        '</div>';
      
      this.show(modalHtml, resolve);
    });
  }

  /**
   * Show Load Previous Assessment modal with searchable list
   * @param {Array} assessments - List of cached assessments
   * @returns {Promise<Object|null>} - Selected assessment or null if cancelled
   */
  /**
   * Render venture-level decision badges (Track / Pathway / Dual-use) for an
   * assessment entry. Returns an empty string if no decisions are set.
   */
  renderDecisionBadges(a) {
    if (!a) return '';
    const badges = [];
    if (a.trackAssignment === 1 || a.trackAssignment === 2 || a.trackAssignment === 3) {
      badges.push(`<span class="assessment-badge decision-track">Track ${a.trackAssignment}</span>`);
    }
    if (a.pathway === 'license') {
      badges.push('<span class="assessment-badge decision-pathway">License</span>');
    } else if (a.pathway === 'company') {
      badges.push('<span class="assessment-badge decision-pathway">Company</span>');
    } else if (a.pathway === 'both') {
      badges.push('<span class="assessment-badge decision-pathway">Both</span>');
    }
    if (a.dualUse) {
      badges.push('<span class="assessment-badge decision-dualuse">Dual-use</span>');
    }
    return badges.join('');
  }

  showLoadPreviousModal(assessments, options = {}) {
    return new Promise((resolve) => {
      this.resolvePromise = resolve;
      this.selectedAssessment = null;
      this.selectedAssessmentSource = 'local'; // 'local' or 'smartsheet'
      this._allAssessments = assessments; // local assessments
      this._smartsheetAssessments = []; // populated on search
      const isExternal = options.isExternal || false;

      // Build assessment list HTML
      const trashIconSvg = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>';
      const listHtml = assessments.length > 0
        ? assessments.map((a, i) => `
          <div class="assessment-list-item" data-key="${this.escapeHtml(a.key)}" data-index="${i}" data-source="local">
            <div class="assessment-item-main">
              <span class="assessment-venture-name">${this.escapeHtml(a.ventureName)}</span>
              <span class="assessment-date">${a.date}</span>
            </div>
            <div class="assessment-item-meta">
              <span class="assessment-advisor">${this.escapeHtml(a.advisorName)}</span>
              ${this.renderDecisionBadges(a)}
              ${a.hasFullData ? '<span class="assessment-badge full-data">Full Data</span>' : '<span class="assessment-badge scores-only">Scores Only</span>'}
              <button type="button" class="assessment-delete-btn" data-delete-key="${this.escapeHtml(a.key)}" title="Delete this cached assessment" aria-label="Delete assessment for ${this.escapeHtml(a.ventureName)}">${trashIconSvg}</button>
            </div>
          </div>
        `).join('')
        : '<div class="no-assessments-message">No previous assessments found in local cache.</div>';

      // Smartsheet section HTML (hidden for external users)
      const smartsheetSectionHtml = isExternal ? '' : `
          <div class="assessment-list-section smartsheet-section">
            <div class="assessment-list-label">
              From Smartsheet
              <button class="btn-link" id="search-smartsheet-btn">Search Smartsheet</button>
            </div>
            <div class="assessment-list" id="smartsheet-assessment-list">
              <div class="no-assessments-message" id="smartsheet-placeholder">Click "Search Smartsheet" to find assessments submitted to Smartsheet.</div>
            </div>
          </div>`;

      const modalHtml = `
        <div class="modal-header">
          <h3>
            <svg class="modal-icon" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/>
              <path d="M3 3v5h5"/>
            </svg>
            Load Previous Assessment
          </h3>
        </div>
        <div class="modal-body">
          <p>Select a previous assessment to load. Assessments with "Full Data" include all AI evidence.</p>
          <div class="assessment-search-container">
            <input type="text" id="assessment-search" class="assessment-search" placeholder="Search by name..." autocomplete="off">
          </div>
          <div class="assessment-list-section">
            <div class="assessment-list-label">
              <span><span id="local-list-count-label">${isExternal ? 'Previous Assessments' : 'Saved Locally'} (${assessments.length})</span></span>
              ${assessments.length > 0 ? '<button class="btn-link" id="clear-all-local-btn" type="button">Clear all</button>' : ''}
            </div>
            <div class="assessment-list" id="assessment-list">
              ${listHtml}
            </div>
          </div>
          ${smartsheetSectionHtml}
        </div>
        <div class="modal-footer">
          <button class="btn outline" data-action="cancel">Cancel</button>
          <button class="btn primary" data-action="load" id="load-assessment-btn" disabled>Load Assessment</button>
        </div>
      `;

      this.show(modalHtml, (action) => {
        if (action === 'load' && this.selectedAssessment !== null) {
          if (this.selectedAssessmentSource === 'smartsheet') {
            const ssEntry = this._smartsheetAssessments[this.selectedAssessment];
            resolve({ ...ssEntry, _source: 'smartsheet' });
          } else {
            resolve(assessments[this.selectedAssessment]);
          }
        } else {
          resolve(null);
        }
      });

      // Set up search and selection handlers
      this.setupLoadPreviousHandlers(assessments);
    });
  }

  /**
   * Set up event handlers for Load Previous modal
   * @param {Array} assessments - List of assessments
   */
  setupLoadPreviousHandlers(assessments) {
    const searchInput = document.getElementById('assessment-search');
    const localList = document.getElementById('assessment-list');
    const smartsheetList = document.getElementById('smartsheet-assessment-list');
    const loadBtn = document.getElementById('load-assessment-btn');
    const searchSmartsheetBtn = document.getElementById('search-smartsheet-btn');

    if (!searchInput || !localList || !loadBtn) return;

    // Deselect all across both lists
    const deselectAll = () => {
      localList.querySelectorAll('.assessment-list-item').forEach(i => i.classList.remove('selected'));
      if (smartsheetList) smartsheetList.querySelectorAll('.assessment-list-item').forEach(i => i.classList.remove('selected'));
    };

    // Search handler (filters local list only)
    searchInput.addEventListener('input', () => {
      const query = searchInput.value.toLowerCase().trim();
      const items = localList.querySelectorAll('.assessment-list-item');

      items.forEach(item => {
        const ventureName = item.querySelector('.assessment-venture-name')?.textContent?.toLowerCase() || '';
        const advisorName = item.querySelector('.assessment-advisor')?.textContent?.toLowerCase() || '';
        const matches = !query || ventureName.includes(query) || advisorName.includes(query);
        item.style.display = matches ? '' : 'none';
      });

      // Also filter smartsheet list
      if (smartsheetList) {
        const ssItems = smartsheetList.querySelectorAll('.assessment-list-item');
        ssItems.forEach(item => {
          const ventureName = item.querySelector('.assessment-venture-name')?.textContent?.toLowerCase() || '';
          const advisorName = item.querySelector('.assessment-advisor')?.textContent?.toLowerCase() || '';
          const matches = !query || ventureName.includes(query) || advisorName.includes(query);
          item.style.display = matches ? '' : 'none';
        });
      }
    });

    // Selection handler for local list
    localList.addEventListener('click', (e) => {
      // Per-row delete (trash icon)
      const deleteBtn = e.target.closest('.assessment-delete-btn');
      if (deleteBtn) {
        e.stopPropagation();
        const key = deleteBtn.dataset.deleteKey;
        const item = deleteBtn.closest('.assessment-list-item');
        const ventureName = item?.querySelector('.assessment-venture-name')?.textContent || 'this assessment';
        if (!confirm(`Delete cached assessment for "${ventureName}"?\n\nThis only removes the local copy. Anything already submitted to Smartsheet stays there.`)) {
          return;
        }
        const sm = window.app?.stateManager;
        if (sm && key) {
          sm.deleteAssessment(key);
        }
        item?.remove();
        // If the deleted row was the selected one, reset selection
        if (this.selectedAssessmentSource === 'local' &&
            item && parseInt(item.dataset.index, 10) === this.selectedAssessment) {
          this.selectedAssessment = null;
          loadBtn.disabled = true;
        }
        // Update count + remove "Clear all" button if list is now empty
        const remaining = localList.querySelectorAll('.assessment-list-item').length;
        const countLabel = document.getElementById('local-list-count-label');
        if (countLabel) {
          const labelPrefix = countLabel.textContent.replace(/\s*\(\d+\)\s*$/, '');
          countLabel.textContent = `${labelPrefix} (${remaining})`;
        }
        if (remaining === 0) {
          localList.innerHTML = '<div class="no-assessments-message">No previous assessments found in local cache.</div>';
          document.getElementById('clear-all-local-btn')?.remove();
        }
        return;
      }

      const item = e.target.closest('.assessment-list-item');
      if (!item) return;

      deselectAll();
      item.classList.add('selected');
      this.selectedAssessment = parseInt(item.dataset.index, 10);
      this.selectedAssessmentSource = 'local';
      loadBtn.disabled = false;
    });

    // Clear-all button
    const clearAllBtn = document.getElementById('clear-all-local-btn');
    if (clearAllBtn) {
      clearAllBtn.addEventListener('click', () => {
        if (!confirm('Delete all cached assessments from this browser?\n\nThis only clears the local cache. Anything already submitted to Smartsheet stays there.')) {
          return;
        }
        const sm = window.app?.stateManager;
        if (sm) sm.clearAllAssessments();
        localList.innerHTML = '<div class="no-assessments-message">No previous assessments found in local cache.</div>';
        clearAllBtn.remove();
        const countLabel = document.getElementById('local-list-count-label');
        if (countLabel) {
          const labelPrefix = countLabel.textContent.replace(/\s*\(\d+\)\s*$/, '');
          countLabel.textContent = `${labelPrefix} (0)`;
        }
        this.selectedAssessment = null;
        this.selectedAssessmentSource = 'local';
        loadBtn.disabled = true;
      });
    }

    // Double-click to load immediately (local)
    localList.addEventListener('dblclick', (e) => {
      const item = e.target.closest('.assessment-list-item');
      if (!item) return;

      this.selectedAssessment = parseInt(item.dataset.index, 10);
      this.selectedAssessmentSource = 'local';
      loadBtn.click();
    });

    // Selection handler for smartsheet list
    if (smartsheetList) {
      smartsheetList.addEventListener('click', (e) => {
        const item = e.target.closest('.assessment-list-item');
        if (!item) return;

        deselectAll();
        item.classList.add('selected');
        this.selectedAssessment = parseInt(item.dataset.index, 10);
        this.selectedAssessmentSource = 'smartsheet';
        loadBtn.disabled = false;
      });

      smartsheetList.addEventListener('dblclick', (e) => {
        const item = e.target.closest('.assessment-list-item');
        if (!item) return;

        this.selectedAssessment = parseInt(item.dataset.index, 10);
        this.selectedAssessmentSource = 'smartsheet';
        loadBtn.click();
      });
    }

    // Search Smartsheet button
    if (searchSmartsheetBtn) {
      searchSmartsheetBtn.addEventListener('click', async () => {
        searchSmartsheetBtn.disabled = true;
        searchSmartsheetBtn.textContent = 'Searching...';
        const placeholder = document.getElementById('smartsheet-placeholder');

        try {
          if (!window.SmartsheetIntegration) {
            if (placeholder) placeholder.textContent = 'Smartsheet integration not available.';
            return;
          }

          const advisorName = document.getElementById('sca-name')?.value || null;
          const results = await window.SmartsheetIntegration.fetchPastAssessments(advisorName);
          this._smartsheetAssessments = results;

          if (results.length === 0) {
            if (smartsheetList) smartsheetList.innerHTML = '<div class="no-assessments-message">No assessments found in Smartsheet.</div>';
          } else {
            const ssHtml = results.map((a, i) => `
              <div class="assessment-list-item" data-index="${i}" data-source="smartsheet">
                <div class="assessment-item-main">
                  <span class="assessment-venture-name">${this.escapeHtml(a.ventureName || 'Unknown')}</span>
                  <span class="assessment-date">${a.timestamp ? new Date(a.timestamp).toLocaleDateString() : ''}</span>
                </div>
                <div class="assessment-item-meta">
                  <span class="assessment-advisor">${this.escapeHtml(a.advisorName || '')}</span>
                  ${this.renderDecisionBadges(a)}
                  <span class="assessment-badge smartsheet-source">Smartsheet</span>
                </div>
              </div>
            `).join('');
            if (smartsheetList) smartsheetList.innerHTML = ssHtml;
          }
        } catch (error) {
          console.error('Smartsheet search failed:', error);
          if (smartsheetList) smartsheetList.innerHTML = '<div class="no-assessments-message">Search failed. Please try again.</div>';
        } finally {
          searchSmartsheetBtn.disabled = false;
          searchSmartsheetBtn.textContent = 'Search Smartsheet';
        }
      });
    }

    // Focus search input
    searchInput.focus();
  }

  /**
   * Show notification that only scores were loaded (no full AI data)
   * @param {string} ventureName - Name of the venture
   * @returns {Promise<string>} - 'continue' or 'rerun'
   */
  showScoresOnlyLoadedModal(ventureName) {
    return new Promise((resolve) => {
      this.resolvePromise = resolve;
      
      const modalHtml = `
        <div class="modal-header">
          <h3>
            <svg class="modal-icon" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="10"/>
              <line x1="12" y1="16" x2="12" y2="12"/>
              <line x1="12" y1="8" x2="12.01" y2="8"/>
            </svg>
            Scores Loaded
          </h3>
        </div>
        <div class="modal-body">
          <p>Previous scores for <strong>${this.escapeHtml(ventureName)}</strong> have been loaded.</p>
          <div class="modal-info">
            <p style="margin: 0;">The full AI analysis data is not available. You can:</p>
            <ul style="margin: 12px 0 0 20px; padding: 0;">
              <li style="margin-bottom: 8px;">Continue with just the scores (update them as needed)</li>
              <li>Re-run the full analysis to regenerate AI evidence</li>
            </ul>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn outline" data-action="rerun">Re-run Analysis</button>
          <button class="btn primary" data-action="continue">Continue with Scores</button>
        </div>
      `;
      
      this.show(modalHtml, resolve);
    });
  }

  /**
   * Show welcome modal for first-time users
   * @returns {Promise<string>} - 'start'
   */
  showWelcomeModal() {
    return new Promise((resolve) => {
      const modalHtml =
        '<div class="modal-header">' +
          '<h3>' +
            '<svg class="modal-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">' +
              '<path d="M12 2L2 7l10 5 10-5-10-5z"/>' +
              '<path d="M2 17l10 5 10-5"/>' +
              '<path d="M2 12l10 5 10-5"/>' +
            '</svg>' +
            'Welcome to Opportunity Assessment' +
          '</h3>' +
        '</div>' +
        '<div class="modal-body">' +
          '<p>This tool uses AI to help you evaluate deep-tech opportunities across five key dimensions.</p>' +
          '<div class="welcome-steps">' +
            '<div class="welcome-step">' +
              '<span class="step-number">1</span>' +
              '<span class="step-text">Enter a company website URL, upload a PDF about the company, or both</span>' +
            '</div>' +
            '<div class="welcome-step">' +
              '<span class="step-number">2</span>' +
              '<span class="step-text">Wait for AI analysis (~5-10 minutes)</span>' +
            '</div>' +
            '<div class="welcome-step">' +
              '<span class="step-number">3</span>' +
              '<span class="step-text">Review AI scores and add your own assessment for each dimension</span>' +
            '</div>' +
            '<div class="welcome-step">' +
              '<span class="step-number">4</span>' +
              '<span class="step-text">Submit final scores and export your report</span>' +
            '</div>' +
          '</div>' +
          '<div class="welcome-guidance">' +
            '<strong>Scoring Guidance:</strong> Assess today\'s reality and expected conditions ' +
            'over the next <strong>3\u20135 years</strong> unless otherwise specified.' +
          '</div>' +
          '<label class="welcome-checkbox">' +
            '<input type="checkbox" id="welcome-dont-show">' +
            '<span>Don\'t show this again</span>' +
          '</label>' +
        '</div>' +
        '<div class="modal-footer">' +
          '<button class="btn primary" data-action="start">Get Started</button>' +
        '</div>';

      this.show(modalHtml, (action) => {
        const dontShow = document.getElementById('welcome-dont-show')?.checked;
        if (dontShow) {
          localStorage.setItem('welcome_modal_dismissed', 'true');
        }
        resolve(action);
      });
    });
  }

  show(html, onAction) {
    if (!this.content || !this.overlay) return;
    
    this.content.innerHTML = html;
    this.activeModal = true;
    this.overlay.classList.add('visible');
    
    // Add button handlers
    this.content.querySelectorAll('[data-action]').forEach(btn => {
      btn.addEventListener('click', () => {
        const action = btn.dataset.action;
        this.close();
        if (onAction) onAction(action);
      });
    });
    
    // Focus first button
    const firstBtn = this.content.querySelector('button');
    if (firstBtn) firstBtn.focus();
  }

  close() {
    if (!this.overlay) return;
    
    this.overlay.classList.remove('visible');
    this.activeModal = null;
    
    if (this.content) {
      setTimeout(() => {
        this.content.innerHTML = '';
      }, 200);
    }
  }
}

window.ModalManager = ModalManager;
