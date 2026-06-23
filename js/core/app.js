// js/core/app.js — v04 application controller.
//
// v04 removes the v03 "advisor types URL+file and waits for the AI" flow
// entirely. Associates queue ventures; the runner does the analysis; advisors
// open Ready rows from their queue and score using the existing v03 assessment
// view. The pipeline + progress view + input screen are gone.

class App {
  constructor() {
    this.stateManager   = null;
    this.tabManager     = null;
    this.toastManager   = null;
    this.modalManager   = null;
    this.assessmentView = null;
    this.summaryView    = null;
    this.state = 'idle';
  }

  async init() {
    try {
      console.log('Initializing Qualification Tool v04...');

      // Core managers (carried over from v03 — needed for scoring)
      this.stateManager = new StateManager();
      this.stateManager.init();

      this.tabManager   = new TabManager();   this.tabManager.init();
      this.toastManager = new ToastManager(); this.toastManager.init();
      this.modalManager = new ModalManager(); this.modalManager.init();

      this.assessmentView = new AssessmentView(); this.assessmentView.init();
      this.summaryView    = new SummaryView();    this.summaryView.init();

      window.assessmentView = this.assessmentView;
      window.summaryView    = this.summaryView;
      window.tabManager     = this.tabManager;

      this._setupHeader();
      this._setupPilotBanner();
      await this._routeByRole();
    } catch (e) {
      console.error('App init failed:', e);
      alert('Initialization error: ' + e.message);
    }
  }

  _setupPilotBanner() {
    const closeBtn    = document.getElementById('pilot-close');
    const feedbackBtn = document.getElementById('feedback-btn');
    const banner      = document.getElementById('pilot-banner');
    if (banner && localStorage.getItem('pilot_banner_closed') === 'true') {
      banner.style.display = 'none';
    }
    if (closeBtn && banner) {
      closeBtn.addEventListener('click', () => {
        banner.style.display = 'none';
        localStorage.setItem('pilot_banner_closed', 'true');
      });
    }
    if (feedbackBtn) {
      feedbackBtn.addEventListener('click', () => {
        window.open('https://forms.osi.office365.us/r/kWXTaUrAAd', '_blank');
      });
    }
  }

  _setupHeader() {
    // Show user info and (for admin) the role switcher
    const userBadge   = document.getElementById('v04-user-badge');
    const switchPane  = document.getElementById('v04-role-switch');
    const switchSel   = document.getElementById('v04-role-select');
    const logoutBtn   = document.getElementById('v04-logout');

    if (userBadge) {
      const labels = Auth.roles.map(r => r[0].toUpperCase() + r.slice(1)).join(', ');
      userBadge.textContent = 'Signed in: ' + (labels || 'unknown');
    }
    if (Auth.isAdmin() && switchPane && switchSel) {
      switchPane.classList.remove('v04-hidden');
      switchSel.value = Auth.activeRole;
      switchSel.addEventListener('change', () => {
        if (Auth.setActiveRole(switchSel.value)) {
          this._routeByRole();
        }
      });
    }
    if (logoutBtn) logoutBtn.addEventListener('click', () => Auth.logout());

    // Wire the Export PDF button. v03 attached this in app.js too; in v04 the
    // header was carried over but the listener wasn't. Without this, the
    // button rendered but clicks did nothing.
    const exportBtn = document.getElementById('export-btn');
    if (exportBtn) {
      exportBtn.addEventListener('click', () => this.exportReport());
    }
  }

  // TabManager calls this when the user clicks the retry overlay on an
  // errored tab. For v04 the only retry-able context is an in-flight live
  // pipeline (queue-loaded ventures don't have a re-runnable phase here —
  // they retry via the Associate marking the row Queued again on the VM).
  async retryFromTab(phase) {
    const pipeline = window.__v04_livePipeline;
    if (!pipeline) {
      this.toastManager?.warning?.('No active analysis to retry. Re-open the venture or start a new run.');
      return;
    }
    const phaseToTab = { company: 'overview', team: 'team', funding: 'funding',
                         competitive: 'competitive', market: 'market', iprisk: 'iprisk' };
    const tab = phaseToTab[phase];
    try {
      this.tabManager?.setLoading(tab);
      this.toastManager?.info?.(`Retrying ${phase}…`);
      const result = await pipeline.retryPhase(phase);
      // Hand the result off to the assessment view the same way the original
      // phaseComplete handler does. The phaseComplete event fires from inside
      // executePhase, so loadXxxData has already run — nothing more to do here.
      return result;
    } catch (e) {
      console.error('[v04] retry failed:', phase, e);
      this.toastManager?.error?.(`Retry of ${phase} failed: ${e.message}`);
    }
  }

  // Port of v03's exportReport — the assessment view exposes getExportData(),
  // ExportUtility.generateReport produces and downloads the PDF. Skips the
  // v03 partial-export modal because in v04 the assessment data is already
  // fully loaded (or already-Reviewed) by the time the advisor sees it.
  async exportReport() {
    try {
      if (!window.jspdf) throw new Error('PDF library not loaded. Please refresh the page.');
      if (!this.assessmentView || !window.ExportUtility) {
        throw new Error('Export not ready — open a venture first.');
      }
      const data = this.assessmentView.getExportData?.();
      if (!data) throw new Error('No assessment data to export.');
      const filename = await window.ExportUtility.generateReport(data);
      this.toastManager?.success?.(`Report exported: ${filename}`);
    } catch (error) {
      console.error('Export failed:', error);
      this.toastManager?.error?.(`Export failed: ${error.message}`);
    }
  }

  // Port of v03's same-named method. SummaryView calls this when the advisor
  // clicks Submit Final Recommendation. Gathers all dimension scores from the
  // assessment view and submits them via the v03 score-sheet path.
  async submitFinalAssessmentWithRecommendation(recommendationText) {
    // Flush any pending debounced save before reading state for submission
    // so the most recent score/justification edits are in localStorage too.
    this.stateManager?.flushPendingSave?.();

    if (Auth.isExternal()) {
      this.stateManager?.saveFinalRecommendation?.(recommendationText);
      this.stateManager?.flushPendingSave?.();
      this.toastManager?.success?.('Assessment saved locally');
      const exportBtn = document.getElementById('export-btn');
      if (exportBtn) exportBtn.disabled = false;
      return { success: true };
    }

    if (!window.SmartsheetIntegration) {
      throw new Error('SmartsheetIntegration not loaded');
    }

    const context = window.SmartsheetIntegration.getContext();
    context.finalRecommendation = recommendationText;

    const av = this.assessmentView;
    const score = (dim, ai = true) => ({
      aiScore:      ai ? av.aiScores?.[dim] : null,
      userScore:    av.userScores?.[dim]?.score,
      justification:av.userScores?.[dim]?.justification
    });
    const allData = {
      team:          score('team'),
      funding:       score('funding'),
      competitive:   score('competitive'),
      market:        score('market'),
      iprisk:        score('iprisk'),
      solutionvalue: score('solutionvalue', false)
    };

    const result = await window.SmartsheetIntegration.submitAllScores(allData, context);
    if (!result?.success) throw new Error(result?.error || 'Submission failed');

    this.stateManager?.saveFinalRecommendation?.(recommendationText);
    const exportBtn = document.getElementById('export-btn');
    if (exportBtn) exportBtn.disabled = false;
    return result;
  }

  async _routeByRole() {
    // Hide all view sections first
    const ids = ['associate-view', 'advisor-queue-view', 'external-view', 'results-section'];
    ids.forEach(id => { const el = document.getElementById(id); if (el) el.classList.add('v04-hidden'); });

    const active = Auth.activeRole;
    if (active === 'associate') {
      const el = document.getElementById('associate-view');
      if (el) el.classList.remove('v04-hidden');
      if (!this._associateInited) {
        await AssociateView.init();
        this._associateInited = true;
      } else {
        await AssociateView.refresh();
      }
    } else if (active === 'internal') {
      const el = document.getElementById('advisor-queue-view');
      if (el) el.classList.remove('v04-hidden');
      if (!this._advisorInited) {
        await AdvisorQueueView.init();
        this._advisorInited = true;
      } else {
        await AdvisorQueueView.refresh();
      }
    } else if (active === 'external') {
      // Read-only university partner view (scope-locked server-side).
      const el = document.getElementById('external-view');
      if (el) el.classList.remove('v04-hidden');
      if (!this._externalInited) {
        await ExternalView.init();
        this._externalInited = true;
      } else {
        await ExternalView.refresh();
      }
    }
  }
}

window.App = App;

// Bootstrapping
document.addEventListener('DOMContentLoaded', async () => {
  Auth.initLoginForm();
  const ok = await Auth.checkAccess();
  if (!ok) {
    Auth.showLoginOverlay();
    return;
  }
  window.app = new App();
  window.app.init();
});
