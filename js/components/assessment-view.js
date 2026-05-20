// js/components/assessment-view.js - Assessment display and user scoring (V03)
// Updated to work with v3 API schemas (sector funding, IP landscape, flat competitive, solution_value)

class AssessmentView {
  constructor() {
    this.currentView = {
      team: 'summary',
      funding: 'summary',
      competitive: 'summary',
      market: 'summary',
      iprisk: 'summary',
      solutionvalue: 'summary'
    };

    this.data = {
      company: null,
      team: null,
      funding: null,
      competitive: null,
      market: null,
      iprisk: null,
      solutionvalue: null,
      literature: null,
      synthesis: null
    };

    this.userScores = {
      team: { score: null, justification: '', submitted: false, timesSubmitted: 0 },
      funding: { score: null, justification: '', submitted: false, timesSubmitted: 0 },
      competitive: { score: null, justification: '', submitted: false, timesSubmitted: 0 },
      market: { score: null, justification: '', submitted: false, timesSubmitted: 0 },
      iprisk: { score: null, justification: '', submitted: false, timesSubmitted: 0 },
      solutionvalue: { score: null, justification: '', submitted: false, timesSubmitted: 0 }
    };

    this.aiScores = {
      team: null,
      funding: null,
      competitive: null,
      market: null,
      iprisk: null,
      solutionvalue: null
    };
  }

  init() {
    this.setupSliders();
    this.setupViewToggles();
    this.setupSubmitButtons();
    this.setupJustificationAutoSave();
    console.log('AssessmentView initialized');
  }

  /**
   * Debounced auto-save of justification textareas. Without this, draft text
   * the advisor types but doesn't Submit is lost on Load Previous.
   */
  setupJustificationAutoSave() {
    const dimensions = ['team', 'funding', 'competitive', 'market', 'iprisk', 'solutionvalue'];
    this._justTimers = this._justTimers || {};
    dimensions.forEach(dim => {
      const el = document.getElementById(`${dim}-justification`);
      if (!el) return;
      el.addEventListener('input', () => {
        const text = el.value;
        this.userScores[dim].justification = text;
        clearTimeout(this._justTimers[dim]);
        this._justTimers[dim] = setTimeout(() => {
          if (window.app?.stateManager) {
            window.app.stateManager.saveUserScore(dim, { justification: text });
          }
        }, 300);
      });
    });
  }

  /**
   * Reset all assessment state and DOM elements for a fresh assessment.
   * Must be called when starting a new analysis or clicking "New Assessment."
   */
  reset() {
    const dimensions = ['team', 'funding', 'competitive', 'market', 'iprisk', 'solutionvalue'];

    dimensions.forEach(dim => {
      // Reset in-memory state
      this.userScores[dim] = { score: null, justification: '', submitted: false, timesSubmitted: 0 };
      this.aiScores[dim] = null;
      this.data[dim] = null;
      this.currentView[dim] = 'summary';

      // Reset DOM: textarea
      const justEl = document.getElementById(`${dim}-justification`);
      if (justEl) justEl.value = '';

      // Reset DOM: slider to default (5)
      const slider = document.getElementById(`${dim}-score-slider`);
      if (slider) slider.value = 5;

      // Reset DOM: score display
      const display = document.getElementById(`${dim}-user-score`);
      if (display) display.textContent = '5';

      // Reset DOM: rubric display to default score 5
      this.updateRubricDisplay(dim, 5);

      // Reset DOM: deviation warning
      const deviation = document.getElementById(`${dim}-deviation`);
      if (deviation) {
        deviation.textContent = '';
        deviation.className = 'deviation-warning';
      }

      // Reset DOM: submit button
      const submitBtn = document.getElementById(`${dim}-submit-btn`);
      if (submitBtn) {
        submitBtn.classList.remove('submitted', 'update-mode');
        submitBtn.disabled = false;
        submitBtn.innerHTML = 'Submit Assessment';
      }

      // Reset DOM: scoring card
      const scoringCard = document.getElementById(`${dim}-scoring-card`);
      if (scoringCard) scoringCard.classList.remove('has-submission');

      // Reset DOM: score badges
      const aiBadge = document.getElementById(`${dim}-ai-score-badge`);
      if (aiBadge) aiBadge.textContent = '-';
      const userBadge = document.getElementById(`${dim}-user-score-badge`);
      if (userBadge) userBadge.textContent = '-';
    });

    // Reset company data
    this.data.company = null;
    this.data.literature = null;
    this.data.synthesis = null;

    // Clear Solution Value evidence
    const svEvidence = document.getElementById('solutionvalue-evidence');
    if (svEvidence) svEvidence.innerHTML = '<div class="evidence-pending-notice">Evidence will appear as Company, Market, and Competitive analyses complete.</div>';

    console.log('[AssessmentView] Reset complete');
  }

  // ========== SLIDER SETUP ==========
  
  setupSliders() {
    const dimensions = ['team', 'funding', 'competitive', 'market', 'iprisk', 'solutionvalue'];

    dimensions.forEach(dim => {
      const slider = document.getElementById(`${dim}-score-slider`);
      const display = document.getElementById(`${dim}-user-score`);
      const deviationEl = document.getElementById(`${dim}-deviation`);
      const rubricEl = document.getElementById(`${dim}-rubric`);
      
      if (slider && display) {
        slider.addEventListener('input', (e) => {
          const score = parseInt(e.target.value);
          display.textContent = score;
          this.userScores[dim].score = score;
          this.updateRubricDisplay(dim, score);
          this.checkDeviation(dim, score, deviationEl);
          
          if (window.app?.stateManager) {
            window.app.stateManager.saveUserScore(dim, {
              score,
              justification: this.userScores[dim].justification
            });
          }
        });
      }
      
      if (rubricEl) {
        this.updateRubricDisplay(dim, 5);
      }
    });
  }

  // ========== RUBRIC DEFINITIONS ==========
  
  getRubricDefinitions(dimension) {
    const rubrics = {
      team: {
        1: { label: 'No Signal', description: 'No credible signals of research quality or translation interest. Limited track record; no relevant highlights.' },
        2: { label: 'Weak Signal', description: 'Limited credibility signals and no translation indicators. Early work exists but little evidence of momentum or fit.' },
        3: { label: 'Developing', description: 'Some credible academic signals (for stage) but translation orientation unclear. Limited evidence of impact or applied interest.' },
        4: { label: 'Credible (Stage-Adjusted)', description: 'Credible academic profile relative to career stage. Translation orientation unclear; no clear applied/commercial signals.' },
        5: { label: 'Credible + Some Applied', description: 'Solid credibility for stage with at least one applied/industry or tech-transfer indicator. Translation interest plausible but unproven.' },
        6: { label: 'High-Potential Early-Career', description: 'Strong credibility for stage with standout signals (awards, high-impact work, key role) and signs of passion/drive. Translation orientation limited but promising.' },
        7: { label: 'Translational Operator', description: 'Strong credibility plus clear translation orientation (industry collabs, licensing/SBIR, startup/advisory). Likely to engage in spinout activities.' },
        8: { label: 'Proven Translator', description: 'Excellent credibility and repeated translation signals with demonstrated execution (multiple partnerships, successful tech transfer, startup leadership/advisory).' },
        9: { label: 'Category Leader', description: 'Field-leading credibility with exceptional translation track record and leadership. High confidence in sustained engagement and ability to drive commercialization.' }
      },
      funding: {
        1: { label: 'No Investor Signal', description: 'No comparable funding activity in the sector. Minimal investor interest or deal activity.' },
        2: { label: 'Very Limited', description: 'Very limited funding activity, mostly grants. Few institutional investors active in the space.' },
        3: { label: 'Early/Angel-Led', description: 'Some angel/seed activity, limited institutional participation. Funding ecosystem still nascent.' },
        4: { label: 'Growing Early-Stage', description: 'Growing investor interest; early-stage rounds becoming more common. A few notable deals.' },
        5: { label: 'Established VC Activity', description: 'Regular Series A/B activity with established VC interest. Healthy, repeatable deal flow.' },
        6: { label: 'Strong Institutional Backing', description: 'Strong institutional backing with multiple growth rounds. Sector attracting significant capital.' },
        7: { label: 'Scaled Winners', description: 'High-profile investors and strong deal flow. Multiple companies reaching large scale (often $1B+ valuation).' },
        8: { label: 'Top-Tier Frenzy', description: 'Exceptional funding environment with multiple scaled winners. Top-tier VCs actively competing for deals.' },
        9: { label: 'Peak Capital Cycle', description: 'Peak funding activity with repeated mega-rounds. Sector is a top investment category.' }
      },
      competitive: {
        1: { label: 'Dominated Market', description: 'Market dominated by incumbents with entrenched advantages. Very difficult to differentiate or compete.' },
        2: { label: 'Crowded Field', description: 'Many strong competitors with established share. Differentiation opportunities are limited.' },
        3: { label: 'Competitive', description: 'Several capable players. Differentiation possible but challenging and often costly.' },
        4: { label: 'Differentiable', description: 'Moderate competition with clear differentiation paths. Some barriers to entry exist.' },
        5: { label: 'Neutral Landscape', description: 'Average competitive landscape. Competition is manageable but offers no inherent advantage.' },
        6: { label: 'Winnable Position', description: 'Market may be competitive, but clear differentiation and defensibility are achievable (tech, cost, channel, or timing).' },
        7: { label: 'Protected Niche', description: 'Limited competition with strong differentiation. Significant barriers protect a defensible niche.' },
        8: { label: 'Strong Moat', description: 'Few direct competitors and meaningful barriers to entry. Strong defensive moat and pricing power potential.' },
        9: { label: 'Category Creator', description: 'No true direct competitors today; defines a new category. Must still validate that a real market exists.' }
      },
      market: {
        1: { label: 'Tiny / Slow', description: 'TAM < $500M and CAGR < 10%. Limited opportunity and slow growth.' },
        2: { label: 'Small / Steady', description: 'TAM < $500M and CAGR 10-20%. Small but growing market.' },
        3: { label: 'Small / Fast', description: 'TAM < $500M and CAGR > 20%. Small market with rapid growth potential.' },
        4: { label: 'Mid / Slow', description: 'TAM $500M-$5B and CAGR < 10%. Substantial market, limited growth.' },
        5: { label: 'Mid / Steady', description: 'TAM $500M-$5B and CAGR 10-20%. Good size with healthy growth.' },
        6: { label: 'Mid / Fast', description: 'TAM $500M-$5B and CAGR > 20%. Strong opportunity with rapid expansion.' },
        7: { label: 'Large / Slow', description: 'TAM > $5B and CAGR < 10%. Very large market in a mature growth phase.' },
        8: { label: 'Large / Steady', description: 'TAM > $5B and CAGR 10-20%. Excellent size with sustained growth.' },
        9: { label: 'Large / Fast', description: 'TAM > $5B and CAGR > 20%. Exceptional opportunity: large and rapidly expanding.' }
      },
      iprisk: {
        1: { label: 'Severe Exposure', description: 'Severe IP exposure with little protectable differentiation. Crowded landscape with likely blockers held by others.' },
        2: { label: 'High Risk', description: 'High IP risk with limited protectable differentiation. Existing patents suggest likely blocking issues or costly workarounds.' },
        3: { label: 'Major Challenges', description: 'Significant IP challenges. Some protectable features, but key areas look crowded or uncertain.' },
        4: { label: 'Moderate Risk', description: 'Moderate IP risk with some protectable features. Mixed landscape; targeted FTO likely needed to avoid blockers.' },
        5: { label: 'Average Position', description: 'Average IP position. Neither particularly strong nor weak; protection strategy still required.' },
        6: { label: 'Good Position', description: 'Good protectability with some unique features. Risks appear manageable with an IP strategy and targeted FTO review.' },
        7: { label: 'Strong Foundation', description: 'Clear protectable differentiation and a plausible strategy to file/defend. Limited apparent blocking risk.' },
        8: { label: 'Very Low Risk', description: 'Excellent future protectability with few apparent conflicts. Low likelihood of blocking IP; FTO appears favorable.' },
        9: { label: 'Minimal Blocking Risk', description: 'No obvious blocking IP identified and strong freedom-to-operate plus future protectability signal (subject to diligence).' }
      },
      solutionvalue: {
        1: { label: 'Negligible', description: 'No clear customer value or meaningful problem addressed.' },
        2: { label: 'Low Value / Nice-to-Have', description: 'Primarily convenience or marginal optimization; not tied to a strong unmet need.' },
        3: { label: 'Marginal', description: 'Minor benefit and/or unclear problem severity; difficult to justify switching from current approaches.' },
        4: { label: 'Limited Value', description: 'Some benefit, but the problem is not acute or the improvement over current options is small/uncertain.' },
        5: { label: 'Moderate Value', description: 'Useful improvement but not decisive; helps with a real problem, yet benefits may be incremental or limited in scope.' },
        6: { label: 'Clear Value', description: 'Material benefit for an important problem; improvement is obvious and compelling, though not a breakthrough.' },
        7: { label: 'High Value', description: 'Strong improvement in key outcomes (cost/time/risk/performance) for a clear pain point; meaningfully better than alternatives.' },
        8: { label: 'Breakthrough', description: 'Very large improvement vs status quo; solves a painful, high-priority problem with substantial measurable benefit.' },
        9: { label: 'Transformative (Major Unmet Need)', description: 'Step-change improvement for the beachhead customer; clearly addresses a severe unmet need with outsized outcome impact.' }
      }
    };
    return rubrics[dimension] || {};
  }

  updateRubricDisplay(dimension, score) {
    const rubricEl = document.getElementById(`${dimension}-rubric`);
    if (!rubricEl) return;
    
    const rubrics = this.getRubricDefinitions(dimension);
    const rubric = rubrics[score];
    
    if (rubric) {
      const colorClass = score <= 3 ? 'low' : (score <= 6 ? 'medium' : 'high');
      rubricEl.innerHTML = `
        <div class="rubric-content ${colorClass}">
          <strong>Score ${score}: ${this.escape(rubric.label)}</strong>
          <p>${this.escape(rubric.description)}</p>
        </div>
      `;
      rubricEl.classList.remove('hidden');
    }
  }

  checkDeviation(dim, userScore, deviationEl) {
    const aiScore = this.aiScores[dim];
    if (aiScore === null || aiScore === undefined || !deviationEl) {
      if (deviationEl) deviationEl.classList.add('hidden');
      return;
    }
    const diff = Math.abs(userScore - aiScore);
    const valueEl = deviationEl.querySelector('.deviation-value');
    if (diff >= 2 && valueEl) {
      valueEl.textContent = diff;
      deviationEl.classList.remove('hidden');
    } else {
      deviationEl.classList.add('hidden');
    }
  }

  // ========== VIEW TOGGLES ==========
  
  setupViewToggles() {
    document.querySelectorAll('.view-toggle-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const view = e.currentTarget.dataset.view;
        const panel = e.currentTarget.closest('.tab-panel');
        if (!panel) return;
        
        const dimension = panel.id.replace('panel-', '');
        this.switchView(dimension, view);
        
        panel.querySelectorAll('.view-toggle-btn').forEach(b => b.classList.remove('active'));
        e.currentTarget.classList.add('active');
      });
    });
  }

  switchView(dimension, view) {
    this.currentView[dimension] = view;
    const container = document.getElementById(`${dimension}-evidence`);
    if (!container) return;
    
    const content = container.dataset[view];
    if (content) {
      container.innerHTML = content;
      // Re-attach accordion listeners if in detailed view
      if (view === 'detailed') {
        this.setupAccordions(container);
      }
    }
  }

  setupAccordions(container) {
    container.querySelectorAll('.accordion-header').forEach(header => {
      header.addEventListener('click', () => {
        const item = header.closest('.accordion-item');
        item.classList.toggle('expanded');
      });
    });
  }

  // ========== SUBMIT BUTTONS ==========
  
  setupSubmitButtons() {
    const dimensions = ['team', 'funding', 'competitive', 'market', 'iprisk', 'solutionvalue'];
    dimensions.forEach(dim => {
      const submitBtn = document.getElementById(`${dim}-submit-btn`);
      if (submitBtn) {
        submitBtn.addEventListener('click', () => this.submitAssessment(dim));
      }
    });
  }

  submitAssessment(dimension) {
    const justificationEl = document.getElementById(`${dimension}-justification`);
    const submitBtn = document.getElementById(`${dimension}-submit-btn`);
    const slider = document.getElementById(`${dimension}-score-slider`);
    const scoringCard = document.getElementById(`${dimension}-scoring-card`);
    
    const score = this.userScores[dimension].score || parseInt(slider?.value) || 5;
    const justification = justificationEl?.value || '';
    const isUpdate = this.userScores[dimension].submitted;
    
    // Update state
    this.userScores[dimension].score = score;
    this.userScores[dimension].justification = justification;
    this.userScores[dimension].submitted = true;
    this.userScores[dimension].timesSubmitted++;
    
    console.log(`Assessment ${isUpdate ? 'updated' : 'submitted'} for ${dimension}:`, { score, justification, timesSubmitted: this.userScores[dimension].timesSubmitted });
    
    // Update button to show submitted/update state
    if (submitBtn) {
      submitBtn.classList.add('submitted');
      submitBtn.innerHTML = `
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="20 6 9 17 4 12"></polyline>
        </svg>
        ${isUpdate ? 'Updated' : 'Submitted'}
      `;
      
      // After a brief moment, switch to "Update" state
      setTimeout(() => {
        submitBtn.classList.remove('submitted');
        submitBtn.classList.add('update-mode');
        submitBtn.innerHTML = `
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
          </svg>
          Update Score
        `;
        submitBtn.disabled = false;
      }, 1500);
    }
    
    // Add visual indicator to scoring card
    if (scoringCard) {
      scoringCard.classList.add('has-submission');
    }
    
    // Keep slider and justification ENABLED for updates
    // (removed the disabling code)
    
    if (window.app?.stateManager) {
      window.app.stateManager.saveUserScore(dimension, {
        score,
        justification,
        submitted: true,
        timesSubmitted: this.userScores[dimension].timesSubmitted
      });
    }
    if (window.app?.toastManager) {
      window.app.toastManager.success(`${this.capitalize(dimension)} assessment ${isUpdate ? 'updated' : 'submitted'}`);
    }
    
    // Submit to Smartsheet
    this.submitToSmartsheet(dimension);
    
    // Update summary view after submit
    if (window.summaryView && this.data) {
      console.log('Updating summary view with data:', this.data);
      window.summaryView.update({
        company: this.data.company,
        team: this.data.team,
        funding: this.data.funding,
        competitive: this.data.competitive,
        market: this.data.market,
        iprisk: this.data.iprisk
      });
    } else {
      console.warn('Could not update summary:', { summaryView: !!window.summaryView, data: !!this.data });
    }
    
    // Check if all scores are now submitted - trigger auto-submit check
    this.checkAllScoresSubmitted();
  }

  /**
   * Submit score to Smartsheet
   * @param {string} dimension - team, funding, competitive, market, iprisk
   */
  async submitToSmartsheet(dimension) {
    // External mode: skip Smartsheet, scores are saved locally via state manager
    if (Auth.isExternal()) {
      return;
    }

    if (!window.SmartsheetIntegration) {
      console.warn('SmartsheetIntegration not loaded');
      return;
    }

    const context = window.SmartsheetIntegration.getContext();

    // Get AI score based on dimension
    const aiScore = this.aiScores[dimension];

    const scoreData = {
      aiScore: aiScore,
      userScore: this.userScores[dimension].score,
      justification: this.userScores[dimension].justification
    };

    await window.SmartsheetIntegration.submitScore(dimension, scoreData, context);
  }

  /**
   * Check if all 5 scores have been submitted and trigger final submit modal
   */
  checkAllScoresSubmitted() {
    const allDimensions = ['team', 'funding', 'competitive', 'market', 'iprisk', 'solutionvalue'];
    const aiDimensions = ['team', 'funding', 'competitive', 'market', 'iprisk'];
    const allSubmitted = allDimensions.every(dim => this.userScores[dim].submitted);

    if (allSubmitted) {
      console.log('[AssessmentView] All scores submitted, triggering final submit check');

      // Gather data for the modal
      const scores = {};
      const missingJustifications = [];

      allDimensions.forEach(dim => {
        scores[dim] = {
          aiScore: this.aiScores[dim],
          userScore: this.userScores[dim].score,
          justification: this.userScores[dim].justification
        };

        if (!this.userScores[dim].justification || this.userScores[dim].justification.trim() === '') {
          missingJustifications.push(dim);
        }
      });

      // Calculate averages (AI average over 5 AI-scored dimensions only)
      const aiScoreSum = aiDimensions.reduce((sum, dim) => sum + (this.aiScores[dim] || 0), 0);
      const userScoreSum = allDimensions.reduce((sum, dim) => sum + (this.userScores[dim].score || 0), 0);
      const avgAiScore = (aiScoreSum / aiDimensions.length).toFixed(1);
      const avgUserScore = (userScoreSum / allDimensions.length).toFixed(1);

      // Notify app to show the final submit modal
      if (window.app?.showFinalSubmitModal) {
        window.app.showFinalSubmitModal({
          scores,
          missingJustifications,
          avgAiScore,
          avgUserScore
        });
      }
    }
  }

  /**
   * Get the submission status for all dimensions
   * @returns {Object} Status object with counts and details
   */
  getSubmissionStatus() {
    const dimensions = ['team', 'funding', 'competitive', 'market', 'iprisk', 'solutionvalue'];
    const submitted = dimensions.filter(dim => this.userScores[dim].submitted);
    const pending = dimensions.filter(dim => !this.userScores[dim].submitted);
    const missingJustifications = dimensions.filter(dim => 
      this.userScores[dim].submitted && 
      (!this.userScores[dim].justification || this.userScores[dim].justification.trim() === '')
    );
    
    return {
      totalCount: dimensions.length,
      submittedCount: submitted.length,
      pendingCount: pending.length,
      submitted,
      pending,
      missingJustifications,
      allSubmitted: submitted.length === dimensions.length
    };
  }

  setUserScore(dimension, scoreData) {
    if (!scoreData) return;
    const slider = document.getElementById(`${dimension}-score-slider`);
    const display = document.getElementById(`${dimension}-user-score`);
    const justificationEl = document.getElementById(`${dimension}-justification`);

    // Always update slider/display — clear to default if no score
    if (slider) {
      slider.value = scoreData.score || 5;
      this.userScores[dimension].score = scoreData.score || null;
    }
    if (display) display.textContent = scoreData.score || '5';

    // Always update justification — clear if empty
    if (justificationEl) {
      justificationEl.value = scoreData.justification || '';
      this.userScores[dimension].justification = scoreData.justification || '';
    }

    if (scoreData.score) this.updateRubricDisplay(dimension, scoreData.score);
  }

  // ========== COMPANY DATA ==========
  
  loadCompanyData(data) {
    this.data.company = data;
    const container = document.getElementById('overview-content');
    if (!container) return;

    const overview = data.company_overview || {};
    const tech = data.technology || {};
    const products = data.products_services || {};
    const market = data.market_context || {};
    const founders = (data.team?.founders || []).slice(0, 3);
    const news = (data.recent_activity?.news_and_events || []).filter(n => n.source_url && n.headline).slice(0, 2);

    // Build products list from products_services.products[]
    const productsList = (products.products || []).slice(0, 3);

    container.innerHTML = `
      <div class="overview-grid compact">
        <div class="overview-card">
          <h3>Company</h3>
          <h4>${this.escape(overview.name || 'Unknown Company')}</h4>
          <p>${this.escape(overview.one_liner || overview.detailed_description || '')}</p>
          <div class="overview-meta">
            ${overview.website && overview.website !== 'Not available' ? `<span class="meta-item"><span class="meta-icon">🌐</span><a href="${this.escape(this.cleanSourceUrl(overview.website))}" target="_blank" rel="noopener" class="overview-link">${this.displayUrl(overview.website)}</a></span>` : ''}
            ${overview.founded_year ? `<span class="meta-item"><span class="meta-icon">📅</span>Founded ${overview.founded_year}</span>` : ''}
            ${overview.company_stage ? `<span class="meta-item"><span class="meta-icon">📊</span>${this.escape(overview.company_stage)}</span>` : ''}
          </div>
          ${founders.length > 0 ? `
            <div class="founder-links">
              ${founders.map(f => `
                <span class="founder-item">
                  ${this.escape(f.name || '')}${f.title ? `, ${this.escape(f.title)}` : ''}${f.linkedin_url ? ` <a href="${this.escape(f.linkedin_url)}" target="_blank" rel="noopener" class="linkedin-icon" title="LinkedIn profile">in</a>` : ''}
                </span>
              `).join('')}
            </div>
          ` : ''}
          ${news.length > 0 ? `
            <div class="recent-news">
              <div class="card-label">Recent News</div>
              ${news.map(n => `
                <a href="${this.escape(n.source_url)}" target="_blank" rel="noopener" class="news-link">
                  ${this.escape(this.truncate(n.headline, 80))}${n.date ? ` <span class="news-date">${this.escape(n.date)}</span>` : ''}
                </a>
              `).join('')}
            </div>
          ` : ''}
        </div>

        <div class="overview-card">
          <h3>Technology</h3>
          <p>${this.escape(tech.core_technology || '')}</p>
          ${tech.key_differentiators?.length > 0 ? `
            <div class="innovations-list">
              <div class="card-label">Key Differentiators</div>
              <ul>${tech.key_differentiators.slice(0, 3).map(i => `<li>${this.escape(typeof i === 'string' ? i : JSON.stringify(i))}</li>`).join('')}</ul>
            </div>
          ` : ''}
          ${tech.technology_readiness ? `<p><span class="card-label">Readiness</span> ${this.escape(tech.technology_readiness)}</p>` : ''}
          ${tech.patents?.length > 0 ? `
            <div class="patent-links">
              <div class="card-label">Patents</div>
              ${tech.patents.slice(0, 3).map(p => {
                const patNum = p.patent_number || '';
                const patUrl = `https://patents.google.com/patent/${patNum.replace(/-/g, '')}`;
                return `<a href="${this.escape(patUrl)}" target="_blank" rel="noopener" class="patent-link">
                  ${this.escape(patNum)}${p.status ? ` <span class="patent-status ${p.status}">${this.escape(p.status)}</span>` : ''}
                </a>`;
              }).join('')}
            </div>
          ` : ''}
        </div>

        <div class="overview-card">
          <h3>Products & Services</h3>
          ${productsList.length > 0 ? `
            <div class="products-list">
              ${productsList.map(p => `
                <div class="product-item">
                  <strong>${this.escape(p.name || '')}</strong>
                  ${p.status ? `<span class="status-badge">${this.escape(p.status)}</span>` : ''}
                  ${p.description ? `<p title="${this.escape(p.description)}">${this.escape(this.truncate(p.description, 200))}</p>` : ''}
                  ${p.target_customers ? `<p class="target-customers"><em>${this.escape(p.target_customers)}</em></p>` : ''}
                </div>
              `).join('')}
            </div>
          ` : '<p>No products identified.</p>'}
          ${products.business_model ? `<p><span class="card-label">Business Model</span> ${this.escape(products.business_model)}</p>` : ''}
          ${products.target_industries?.length > 0 ? `
            <p><span class="card-label">Industries</span> ${products.target_industries.slice(0, 4).map(i => this.escape(i)).join(', ')}</p>
          ` : ''}
        </div>

        <div class="overview-card">
          <h3>Market Context</h3>
          ${market.target_market ? `<p><span class="card-label">Target Market</span> ${this.escape(market.target_market)}</p>` : ''}
        </div>
      </div>

      ${(() => {
        const dq = data.data_quality_assessment || {};
        const confidence = dq.overall_confidence || '';
        const gaps = dq.information_gaps || [];
        const sources = dq.sources_used || [];
        if (!confidence && gaps.length === 0 && sources.length === 0) return '';

        const confidenceColors = { 'High': 'var(--nr-teal-1)', 'Medium': '#d97706', 'Low': '#dc2626' };
        const confidenceColor = confidenceColors[confidence] || '#6b7280';

        return `
          <div class="data-quality-section">
            <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 8px;">
              <strong style="font-size: 13px; color: var(--slate-700);">Data Quality</strong>
              ${confidence ? `<span class="metric-inline" style="border-color: ${confidenceColor}; color: ${confidenceColor};">${confidence} Confidence</span>` : ''}
            </div>
            ${gaps.length > 0 ? `
              <div style="margin-bottom: 8px;">
                <strong style="font-size: 12px; color: #92400e;">Information Gaps:</strong>
                ${gaps.map(g => `<div class="info-gap-item">&bull; ${this.escape(g)}</div>`).join('')}
              </div>
            ` : ''}
            ${sources.length > 0 ? `
              <details style="margin-top: 4px;">
                <summary style="font-size: 12px; color: var(--slate-500); cursor: pointer;">Sources consulted (${sources.length})</summary>
                <ul style="margin: 4px 0 0 16px; font-size: 12px; color: var(--slate-500);">
                  ${sources.map(s => `<li>${s.startsWith('http') ? `<a href="${this.escape(s)}" target="_blank" rel="noopener" style="color: var(--nr-teal-1); text-decoration: none;">${this.escape(this.truncate(s, 80))}</a>` : this.escape(s)}</li>`).join('')}
                </ul>
              </details>
            ` : ''}
          </div>
        `;
      })()}
    `;
  }

  // ========== TEAM DATA ==========
  
  loadTeamData(data) {
    this.data.team = data;
    
    // API returns: { team: {...}, scoring: {...}, score: 6, formatted: {...} }
    const score = data?.score;
    this.aiScores.team = score;
    
    const aiScoreEl = document.getElementById('team-ai-score');
    if (aiScoreEl) aiScoreEl.textContent = score ?? '-';
    
    const slider = document.getElementById('team-score-slider');
    const display = document.getElementById('team-user-score');
    if (slider && score) {
      slider.value = score;
      if (display) display.textContent = score;
      this.userScores.team.score = score;
      this.updateRubricDisplay('team', score);
    }
    
    this.displayTeamEvidence(data);
  }

  displayTeamEvidence(data) {
    const container = document.getElementById('team-evidence');
    if (!container) return;
    
    // Use formatted data if available, fallback to raw
    const formatted = data?.formatted || {};
    const teamRaw = data?.team || {};
    const scoringRaw = data?.scoring || {};
    
    const members = formatted.members || teamRaw.team_members || [];
    const composition = formatted.teamComposition || {};
    const compositionRaw = scoringRaw.team_composition || {};
    const teamSize = composition.total || compositionRaw.total_members || members.length || '-';

    // Count publications across all team members
    const publicationsCount = members.reduce((count, m) => count + (m.papers_publications?.length || 0), 0);
    // Count commercialization signals from evaluation steps
    const evalSteps = formatted.evaluationSteps || scoringRaw.evaluation_steps || {};
    const commSignalsCount = Array.isArray(evalSteps.commercialization_signals_found) ? evalSteps.commercialization_signals_found.length : 0;

    const strengths = formatted.strengths || scoringRaw.key_strengths || [];
    const gaps = formatted.gaps || scoringRaw.key_gaps || [];
    const sources = formatted.sources || teamRaw.trusted_sources || [];
    const confidence = formatted.confidence || teamRaw.data_confidence;
    const confidenceJustification = formatted.confidenceJustification || teamRaw.confidence_justification || '';
    const justification = formatted.justification || scoringRaw.score_justification || '';
    const rubricMatch = formatted.rubric || scoringRaw.rubric_match_explanation || '';

    // SUMMARY VIEW
    const summaryHTML = `
      <div class="evidence-content">
        <div class="metrics-row">
          <div class="metric-card">
            <span class="metric-label">Team Size</span>
            <span class="metric-value">${teamSize}</span>
          </div>
          <div class="metric-card">
            <span class="metric-label">Publications</span>
            <span class="metric-value">${publicationsCount}</span>
          </div>
          <div class="metric-card">
            <span class="metric-label">Comm. Signals</span>
            <span class="metric-value">${commSignalsCount}</span>
          </div>
          <div class="metric-card">
            <span class="metric-label">Confidence</span>
            <span class="metric-value">${confidence || '-'}</span>
          </div>
        </div>
        
        <div class="evidence-section">
          <h4>AI Assessment Rationale</h4>
          <div class="ai-rationale">${this.formatRationale(justification)}</div>
        </div>
        
        <div class="two-column-grid">
          <div class="evidence-section">
            <h4>Key Strengths</h4>
            <ul class="compact-list">${strengths.map(s => `<li>${this.escape(s)}</li>`).join('') || '<li>None identified</li>'}</ul>
          </div>
          <div class="evidence-section">
            <h4>Key Gaps</h4>
            <ul class="compact-list">${gaps.map(g => `<li>${this.escape(g)}</li>`).join('') || '<li>None identified</li>'}</ul>
          </div>
        </div>
      </div>
    `;
    
    // DETAILED VIEW - Expandable team member cards
    const detailedHTML = `
      <div class="evidence-content">
        <h4>Team Members (${members.length})</h4>
        <div class="accordion-list">
          ${members.map((m, i) => `
            <div class="accordion-item ${i === 0 ? 'expanded' : ''}">
              <div class="accordion-header">
                <div class="member-header-info">
                  <strong>${this.escape(m.name || 'Unknown')}</strong>
                  <span class="member-role-badge">${this.escape(m.role_at_venture || '')}</span>
                </div>
                <span class="accordion-icon">▼</span>
              </div>
              <div class="accordion-content">
                ${m.work_history?.length > 0 ? `
                  <div class="member-section">
                    <h5>Work History</h5>
                    <ul class="timeline-list">
                      ${m.work_history.slice(0, 4).map(w => `
                        <li>
                          <strong>${this.escape(w.position || w.company)}</strong>
                          ${w.company ? `<span class="org-name">@ ${this.escape(w.company)}</span>` : ''}
                          ${w.duration ? `<span class="duration">${this.escape(w.duration)}</span>` : ''}
                        </li>
                      `).join('')}
                    </ul>
                  </div>
                ` : ''}
                ${m.education_history?.length > 0 ? `
                  <div class="member-section">
                    <h5>Education</h5>
                    <ul class="timeline-list">
                      ${m.education_history.map(e => `
                        <li>
                          <strong>${this.escape(e.degree || '')}</strong>
                          <span class="org-name">${this.escape(e.institution || '')}</span>
                          ${e.year ? `<span class="duration">${e.year}</span>` : ''}
                        </li>
                      `).join('')}
                    </ul>
                  </div>
                ` : ''}
                ${m.commercialization_experience?.length > 0 ? `
                  <div class="member-section">
                    <h5>Commercialization Experience</h5>
                    <ul>
                      ${m.commercialization_experience.map(c => `
                        <li>${this.escape(c.description || '')} ${c.outcome ? `<em>(${this.escape(c.outcome)})</em>` : ''}</li>
                      `).join('')}
                    </ul>
                  </div>
                ` : ''}
                ${m.awards_recognition?.length > 0 && m.awards_recognition[0]?.award_name !== '—' ? `
                  <div class="member-section">
                    <h5>Awards & Recognition</h5>
                    <ul>
                      ${m.awards_recognition.filter(a => a.award_name && a.award_name !== '—').map(a => `
                        <li>${this.escape(a.award_name)} ${a.organization ? `(${this.escape(a.organization)})` : ''}</li>
                      `).join('')}
                    </ul>
                  </div>
                ` : ''}
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    `;
    
    // SOURCES VIEW
    const sourcesHTML = `
      <div class="evidence-content">
        <div class="evidence-section">
          <h4>Data Sources</h4>
          ${sources.length > 0 ? `
            <ul class="source-list">
              ${sources.map(s => `<li><a href="${this.escape(this.cleanSourceUrl(s))}" target="_blank" rel="noopener">${this.truncateUrl(s)}</a></li>`).join('')}
            </ul>
          ` : '<p>No sources available.</p>'}
        </div>
        <div class="evidence-section">
          <h4>Rubric Alignment</h4>
          <div class="rubric-explanation">${this.formatRationale(rubricMatch)}</div>
        </div>
        <div class="evidence-section">
          <h4>Confidence Note</h4>
          <p><strong>${confidence || '-'}</strong> confidence level.</p>
          <p>${this.escape(confidenceJustification || 'No additional confidence information.')}</p>
        </div>
      </div>
    `;
    
    container.innerHTML = summaryHTML;
    container.dataset.summary = summaryHTML;
    container.dataset.detailed = detailedHTML;
    container.dataset.sources = sourcesHTML;
    
    // Setup accordions for initial view if detailed
    if (this.currentView.team === 'detailed') {
      this.setupAccordions(container);
    }
  }

  // ========== FUNDING DATA (v3 - Sector Funding) ==========

  loadFundingData(data) {
    this.data.funding = data;

    // v3: { analysis: {...}, assessment: {...}, score: 5, formatted: {...} }
    const score = data?.score || data?.assessment?.score;
    this.aiScores.funding = score;

    const aiScoreEl = document.getElementById('funding-ai-score');
    if (aiScoreEl) aiScoreEl.textContent = score ?? '-';

    const slider = document.getElementById('funding-score-slider');
    const display = document.getElementById('funding-user-score');
    if (slider && score) {
      slider.value = score;
      if (display) display.textContent = score;
      this.userScores.funding.score = score;
      this.updateRubricDisplay('funding', score);
    }

    this.displayFundingEvidence(data);
  }

  /**
   * Format a deal amount from the v3 funding schema for display
   */
  formatDealAmount(amount) {
    if (!amount || amount === 'undisclosed' || amount === 'Undisclosed' || amount === 'Unknown') {
      return 'Undisclosed';
    }
    const parsed = this.parseFundingAmount(amount);
    if (parsed !== null) {
      return this.formatCurrencyWithCommas(parsed, true);
    }
    return this.escape(String(amount));
  }

  /**
   * Render a relevance badge for sector funding deals
   */
  renderRelevanceBadge(relevance) {
    const level = (relevance || 'broad').toLowerCase();
    const labels = { core: 'Core', adjacent: 'Adjacent', broad: 'Broad' };
    return `<span class="relevance-badge relevance-${level}">${labels[level] || this.escape(relevance)}</span>`;
  }

  displayFundingEvidence(data) {
    const container = document.getElementById('funding-evidence');
    if (!container) return;

    // v3 formatted data from funding.js formatForDisplay()
    const formatted = data?.formatted || {};

    // Sector activity metrics
    const activityLevel = formatted.activityLevel || 'none_found';
    const fundingTrend = formatted.fundingTrend || 'unknown';
    const totalDeals = formatted.totalVerifiedDeals || 0;
    const dataReliability = formatted.dataReliability || 'unverified';
    const weightedDeals = formatted.weightedDealCount || 0;
    const narrativeSummary = formatted.narrativeSummary || formatted.summary || '';
    const stageMaturity = formatted.stageMaturity || 'unknown';
    const investorTypes = formatted.investorTypes || [];
    const scaledWinners = formatted.scaledWinners;
    const primarySector = formatted.primarySector || '';
    const broaderSector = formatted.broaderSector || '';

    // Verified deals and supporting evidence
    const verifiedDeals = formatted.verifiedDeals || [];
    const marketReports = formatted.marketReports || [];
    const governmentPrograms = formatted.governmentPrograms || [];
    const humanReviewFlags = formatted.humanReviewFlags || [];
    const dataGaps = formatted.dataGaps || '';

    // Score justification sub-assessments
    const dealVolumeAssessment = formatted.dealVolumeAssessment || '';
    const stageDistribution = formatted.stageDistribution || '';
    const investorQuality = formatted.investorQuality || '';
    const scaledOutcomes = formatted.scaledOutcomes || '';
    const trendAssessment = formatted.trendAssessment || '';
    const sectorEvidence = formatted.sectorEvidence || [];

    // Venture's own funding context (from company data, NOT rating criteria)
    const companyFunding = this.data.company?.funding_and_investors || {};
    const ventureFundingRounds = companyFunding.funding_rounds || [];
    const ventureGrants = companyFunding.government_grants || [];
    const ventureTotalFunding = companyFunding.total_funding || 'Unknown';
    const ventureNotableInvestors = companyFunding.notable_investors || [];

    // Format activity level for display
    const formatActivityLevel = (level) => {
      const labels = {
        'none_found': 'None Found',
        'minimal': 'Minimal',
        'moderate': 'Moderate',
        'active': 'Active',
        'very_active': 'Very Active',
        'hot': 'Hot'
      };
      return labels[level] || this.capitalize(String(level).replace(/_/g, ' '));
    };

    // SUMMARY VIEW - includes sector deals, market reports, and government programs
    const summaryHTML = `
      <div class="evidence-content">
        ${primarySector ? `<p class="industry-context"><strong>Sector Assessed:</strong> ${this.escape(primarySector)}${broaderSector ? ` (${this.escape(broaderSector)})` : ''}</p>` : ''}

        <div class="metrics-row">
          <div class="metric-card">
            <span class="metric-label">Activity Level</span>
            <span class="metric-value">${formatActivityLevel(activityLevel)}</span>
          </div>
          <div class="metric-card">
            <span class="metric-label">Funding Trend</span>
            <span class="metric-value">${this.capitalize(String(fundingTrend).replace(/_/g, ' '))}</span>
          </div>
          <div class="metric-card">
            <span class="metric-label">Verified Deals</span>
            <span class="metric-value">${totalDeals}</span>
          </div>
          <div class="metric-card">
            <span class="metric-label">Distinct Sources</span>
            <span class="metric-value">${formatted.distinctSources || '-'}</span>
          </div>
        </div>

        <div class="evidence-section">
          <h4>AI Assessment Rationale</h4>
          <div class="ai-rationale">${this.formatRationale(narrativeSummary)}</div>
        </div>

        ${humanReviewFlags.length > 0 ? `
          <div class="evidence-section">
            <h4>Human Review Flags</h4>
            <ul class="compact-list warning-list">${humanReviewFlags.map(f => `<li>${this.escape(f)}</li>`).join('')}</ul>
          </div>
        ` : ''}

        ${verifiedDeals.length > 0 ? `
          <div class="evidence-section">
            <h4>Verified Sector Deals (${verifiedDeals.length})</h4>
            <table class="data-table">
              <thead>
                <tr>
                  <th>Company</th>
                  <th>Date</th>
                  <th>Series</th>
                  <th>Amount</th>
                  <th>Relevance</th>
                  <th>Investors</th>
                </tr>
              </thead>
              <tbody>
                ${verifiedDeals.slice(0, 5).map(d => `
                  <tr>
                    <td><strong>${this.escape(d.company || '')}</strong></td>
                    <td>${this.formatDate(d.date)}</td>
                    <td>${this.escape(d.series || 'N/A')}</td>
                    <td>${this.formatDealAmount(d.amount)}</td>
                    <td>${this.renderRelevanceBadge(d.relevance)}</td>
                    <td class="investors-cell">${this.escape(this.truncate(d.investors || '', 60))}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
            ${verifiedDeals.length > 5 ? `<p class="more-link">+ ${verifiedDeals.length - 5} more deals in detailed view</p>` : ''}
          </div>
        ` : ''}

        ${marketReports.length > 0 ? `
          <div class="evidence-section">
            <details class="collapsible-section">
              <summary><h4 style="display:inline;">Market Reports (${marketReports.length})</h4></summary>
              <div class="market-reports-list">
                ${marketReports.map(r => `
                  <div class="market-report-item">
                    <strong>${r.sourceUrl ? `<a href="${this.escape(this.cleanSourceUrl(r.sourceUrl))}" target="_blank" rel="noopener">${this.escape(r.title || 'Report')}</a>` : this.escape(r.title || 'Report')}</strong>
                    ${r.keyFinding ? `<p>${this.escape(r.keyFinding)}</p>` : ''}
                  </div>
                `).join('')}
              </div>
            </details>
          </div>
        ` : ''}

        ${governmentPrograms.length > 0 ? `
          <div class="evidence-section">
            <details class="collapsible-section">
              <summary><h4 style="display:inline;">Government Programs (${governmentPrograms.length})</h4></summary>
              <div class="govt-programs-list">
                ${governmentPrograms.map(g => `
                  <div class="govt-program-item">
                    <strong>${g.sourceUrl ? `<a href="${this.escape(this.cleanSourceUrl(g.sourceUrl))}" target="_blank" rel="noopener">${this.escape(g.name || 'Program')}</a>` : this.escape(g.name || 'Program')}</strong>
                    ${g.amount && g.amount !== 'undisclosed' ? ` ${this.formatDealAmount(g.amount)}` : ''}
                    ${g.description ? `<p>${this.escape(g.description)}</p>` : ''}
                  </div>
                `).join('')}
              </div>
            </details>
          </div>
        ` : ''}

        ${(ventureFundingRounds.length > 0 || ventureGrants.length > 0 || ventureTotalFunding !== 'Unknown') ? `
          <div class="evidence-section venture-context-section">
            <details class="collapsible-section">
              <summary><h4 style="display:inline;">Venture Funding Context (Reference Only)</h4></summary>
              <div class="context-notice">
                <strong>For reference only</strong> -- rate based on sector activity above, not the venture's own funding.
              </div>
              ${ventureTotalFunding && ventureTotalFunding !== 'Unknown' ? `<p><strong>Total Funding:</strong> ${this.escape(ventureTotalFunding)}</p>` : ''}
              ${ventureFundingRounds.length > 0 ? `
                <div class="funding-timeline">
                  ${ventureFundingRounds.slice(0, 3).map(r => `
                    <div class="funding-event">
                      <span class="funding-date">${this.formatDate(r.date)}</span>
                      <span class="funding-type">${this.escape(r.round_type || '')}</span>
                      <span class="funding-amount">${this.formatDealAmount(r.amount)}</span>
                      ${(r.lead_investors || []).length > 0 ? `<span class="funding-investors">${r.lead_investors.slice(0, 2).map(i => this.escape(i)).join(', ')}</span>` : ''}
                    </div>
                  `).join('')}
                  ${ventureFundingRounds.length > 3 ? `<p class="more-link">+ ${ventureFundingRounds.length - 3} more rounds in detailed view</p>` : ''}
                </div>
              ` : '<p class="no-data-message">No prior funding rounds identified for this venture.</p>'}
              ${ventureGrants.length > 0 ? `
                <h5>Government Grants</h5>
                <table class="data-table">
                  <thead><tr><th>Type</th><th>Amount</th><th>Agency</th><th>Year</th></tr></thead>
                  <tbody>
                    ${ventureGrants.map(g => `<tr><td>${this.escape(g.grant_type || '')}</td><td>${this.formatDealAmount(g.amount)}</td><td>${this.escape(g.agency || '')}</td><td>${this.escape(g.year || '')}</td></tr>`).join('')}
                  </tbody>
                </table>
              ` : ''}
              ${ventureNotableInvestors.length > 0 ? `<p><strong>Notable Investors:</strong> ${ventureNotableInvestors.map(i => this.escape(i)).join(', ')}</p>` : ''}
            </details>
          </div>
        ` : ''}
      </div>
    `;

    // DETAILED VIEW - Metrics and deals first, then narrative analysis
    const detailedHTML = `
      <div class="evidence-content">
        <div class="evidence-section">
          <h4>Sector Metrics</h4>
          <div class="metrics-row compact">
            <div class="metric-card small">
              <span class="metric-label">Stage Maturity</span>
              <span class="metric-value">${this.capitalize(String(stageMaturity).replace(/_/g, ' '))}</span>
            </div>
            <div class="metric-card small">
              <span class="metric-label">Scaled Winners</span>
              <span class="metric-value">${scaledWinners ? 'Yes' : 'No'}</span>
            </div>
            <div class="metric-card small">
              <span class="metric-label">Distinct Sources</span>
              <span class="metric-value">${formatted.distinctSources || '-'}</span>
            </div>
          </div>
          ${investorTypes.length > 0 ? `<p><strong>Investor Types:</strong> ${investorTypes.map(t => this.escape(t)).join(', ')}</p>` : ''}
        </div>

        ${verifiedDeals.length > 0 ? `
          <div class="evidence-section">
            <h4>All Verified Sector Deals (${verifiedDeals.length})</h4>
            <table class="data-table">
              <thead>
                <tr>
                  <th>Company</th>
                  <th>Date</th>
                  <th>Series</th>
                  <th>Amount</th>
                  <th>Relevance</th>
                  <th>Investors</th>
                </tr>
              </thead>
              <tbody>
                ${verifiedDeals.map(d => `
                  <tr>
                    <td><strong>${this.escape(d.company || '')}</strong></td>
                    <td>${this.formatDate(d.date)}</td>
                    <td>${this.escape(d.series || 'N/A')}</td>
                    <td>${this.formatDealAmount(d.amount)}</td>
                    <td>${this.renderRelevanceBadge(d.relevance)}</td>
                    <td class="investors-cell">${this.escape(this.truncate(d.investors || '', 60))}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        ` : ''}

        <div class="evidence-section">
          <h4>Scoring Analysis</h4>
          <details open class="collapsible-section">
            <summary><strong style="font-size: 13px;">Score Justification</strong></summary>
            ${dealVolumeAssessment ? `<div class="landscape-narrative"><h5>Deal Volume</h5><p>${this.escape(dealVolumeAssessment)}</p></div>` : ''}
            ${stageDistribution ? `<div class="landscape-narrative"><h5>Stage Distribution</h5><p>${this.escape(stageDistribution)}</p></div>` : ''}
            ${investorQuality ? `<div class="landscape-narrative"><h5>Investor Quality</h5><p>${this.escape(investorQuality)}</p></div>` : ''}
            ${scaledOutcomes ? `<div class="landscape-narrative"><h5>Scaled Outcomes</h5><p>${this.escape(scaledOutcomes)}</p></div>` : ''}
            ${trendAssessment ? `<div class="landscape-narrative"><h5>Trend Assessment</h5><p>${this.escape(trendAssessment)}</p></div>` : ''}
          </details>
          ${sectorEvidence.length > 0 ? `
            <details class="collapsible-section" style="margin-top: 8px;">
              <summary><strong style="font-size: 13px;">Supporting Evidence (${sectorEvidence.length})</strong></summary>
              ${sectorEvidence.map(e => `
                <div class="landscape-narrative">
                  <h5>${this.capitalize(this.escape(e.evidence_type || '').replace(/_/g, ' '))}</h5>
                  <p>${this.escape(e.description || '')}${e.rubric_implication ? ` <em>${this.escape(e.rubric_implication)}</em>` : ''}</p>
                </div>
              `).join('')}
            </details>
          ` : ''}
        </div>

        ${dataGaps ? `
          <div class="evidence-section">
            <h4>Data Gaps</h4>
            <p>${this.escape(dataGaps)}</p>
          </div>
        ` : ''}
      </div>
    `;

    // SOURCES VIEW - Extract source URLs from verified deals and market reports
    const dealSources = verifiedDeals.filter(d => d.sourceUrl).map(d => ({
      label: `${d.company || 'Deal'} (${d.sourceName || 'source'})`,
      url: d.sourceUrl
    }));
    const reportSources = marketReports.filter(r => r.sourceUrl).map(r => ({
      label: r.title || 'Market Report',
      url: r.sourceUrl
    }));
    const programSources = governmentPrograms.filter(g => g.sourceUrl).map(g => ({
      label: g.name || 'Government Program',
      url: g.sourceUrl
    }));
    const allSources = [...dealSources, ...reportSources, ...programSources];

    const sourcesHTML = `
      <div class="evidence-content">
        <div class="evidence-section">
          <h4>Deal Sources (${dealSources.length})</h4>
          ${dealSources.length > 0 ? `
            <ul class="source-list">
              ${dealSources.map(s => `
                <li>
                  <strong>${this.escape(s.label)}</strong>:
                  <a href="${this.escape(this.cleanSourceUrl(s.url))}" target="_blank" rel="noopener">${this.truncateUrl(s.url)}</a>
                </li>
              `).join('')}
            </ul>
          ` : '<p>No source URLs available for deals.</p>'}
        </div>
        ${reportSources.length > 0 ? `
          <div class="evidence-section">
            <h4>Market Report Sources (${reportSources.length})</h4>
            <ul class="source-list">
              ${reportSources.map(s => `
                <li>
                  <strong>${this.escape(s.label)}</strong>:
                  <a href="${this.escape(this.cleanSourceUrl(s.url))}" target="_blank" rel="noopener">${this.truncateUrl(s.url)}</a>
                </li>
              `).join('')}
            </ul>
          </div>
        ` : ''}
        ${programSources.length > 0 ? `
          <div class="evidence-section">
            <h4>Government Program Sources (${programSources.length})</h4>
            <ul class="source-list">
              ${programSources.map(s => `
                <li>
                  <strong>${this.escape(s.label)}</strong>:
                  <a href="${this.escape(this.cleanSourceUrl(s.url))}" target="_blank" rel="noopener">${this.truncateUrl(s.url)}</a>
                </li>
              `).join('')}
            </ul>
          </div>
        ` : ''}
        <div class="evidence-section">
          <h4>Data Reliability</h4>
          <p><strong>${this.capitalize(String(dataReliability).replace(/_/g, ' '))}</strong> -- ${totalDeals} verified deal(s) from ${formatted.distinctSources || 0} distinct source(s).</p>
          ${dataGaps ? `<p><strong>Data Gaps:</strong> ${this.escape(dataGaps)}</p>` : ''}
        </div>
      </div>
    `;

    container.innerHTML = summaryHTML;
    container.dataset.summary = summaryHTML;
    container.dataset.detailed = detailedHTML;
    container.dataset.sources = sourcesHTML;
  }

  // ========== COMPETITIVE DATA ==========
  
  loadCompetitiveData(data, literature = null, synthesis = null) {
    this.data.competitive = data;
    if (literature) this.data.literature = literature;
    if (synthesis) this.data.synthesis = synthesis;

    // API returns: { analysis: {...}, assessment: {...}, score: 2, formatted: {...} }
    const score = data?.score || data?.assessment?.score;
    this.aiScores.competitive = score;

    const aiScoreEl = document.getElementById('competitive-ai-score');
    if (aiScoreEl) aiScoreEl.textContent = score ?? '-';

    const slider = document.getElementById('competitive-score-slider');
    const display = document.getElementById('competitive-user-score');
    if (slider && score) {
      slider.value = score;
      if (display) display.textContent = score;
      this.userScores.competitive.score = score;
      this.updateRubricDisplay('competitive', score);
    }

    this.displayCompetitiveEvidence(data, literature || this.data.literature, synthesis || this.data.synthesis);
  }

  // Store the literature (Scientific Evidence) flow output. Lit-review is not a
  // scored dimension — it surfaces context that fuses into the Competitive and
  // Solution Value sections. If those sections have already been rendered, this
  // method re-renders them so the new lit context shows up immediately.
  loadLiteratureData(data) {
    this.data.literature = data;
    if (this.data.competitive) {
      try { this.displayCompetitiveEvidence(this.data.competitive, data, this.data.synthesis); }
      catch (e) { Debug.warn('[AssessmentView] re-render competitive after literature failed:', e); }
    }
    const svContainer = document.getElementById('solutionvalue-evidence');
    if (svContainer && !svContainer.querySelector('.evidence-pending-notice')) {
      try { this.loadSolutionValueEvidence(); }
      catch (e) { Debug.warn('[AssessmentView] re-render SV after literature failed:', e); }
    }
  }

  // Store the synthesis flow output. Synthesis is not a scored dimension; it
  // consolidates competitive + literature + company-SV data into a unified
  // competitor list (with multi-source dedup and Reranker scores carried
  // through) plus a merged value-prop table. The Competitive section's
  // Detailed tab and the Solution Value tab both rebuild around synthesis
  // output when it's present, with graceful fallback to the v04.1 layout
  // when it's missing.
  loadSynthesisData(data) {
    this.data.synthesis = data;
    if (this.data.competitive) {
      try { this.displayCompetitiveEvidence(this.data.competitive, this.data.literature, data); }
      catch (e) { Debug.warn('[AssessmentView] re-render competitive after synthesis failed:', e); }
    }
    const svContainer = document.getElementById('solutionvalue-evidence');
    if (svContainer && !svContainer.querySelector('.evidence-pending-notice')) {
      try { this.loadSolutionValueEvidence(); }
      catch (e) { Debug.warn('[AssessmentView] re-render SV after synthesis failed:', e); }
    }
  }

  displayCompetitiveEvidence(data, literature = null, synthesis = null) {
    const container = document.getElementById('competitive-evidence');
    if (!container) return;

    // v3 formatted data from competitive.js formatForDisplay()
    const formatted = data?.formatted || {};
    const analysisRaw = data?.analysis || {};
    const assessmentRaw = data?.assessment || {};

    // v3: flat top-level fields (no market_overview/competitive_analysis wrappers)
    const competitors = formatted.competitors || analysisRaw.competitors || [];
    const competitorCount = formatted.competitorCount || assessmentRaw.competitor_count || {};
    const estimatedTotal = formatted.totalCompetitors || competitorCount.estimated_total_market || analysisRaw.estimated_total_competitors || '';
    const marketLeaders = formatted.marketLeaders || assessmentRaw.market_leaders || [];
    const intensity = formatted.competitiveIntensity || assessmentRaw.competitive_intensity || analysisRaw.competitive_intensity || '';
    const keyRisks = formatted.keyRisks || assessmentRaw.key_risk_factors || [];
    const opportunities = formatted.opportunities || assessmentRaw.differentiation_opportunities || [];
    const marketGaps = formatted.marketGaps || analysisRaw.market_gaps || [];

    // v3: evaluation steps and market overview from formatted
    const evaluationSteps = formatted.evaluationSteps || assessmentRaw.evaluation_steps || {};
    const marketOverview = formatted.marketOverview || {};
    const competitiveScope = marketOverview.competitiveScope || analysisRaw.competitive_scope || '';
    const competitiveIntensityDetail = marketOverview.competitiveIntensity || '';

    // v3: justification is a string (not object)
    const justification = formatted.justification || assessmentRaw.score_justification || '';
    const rubricMatch = formatted.rubricMatch || assessmentRaw.rubric_match_explanation || '';
    const confidenceNote = formatted.confidenceNote || assessmentRaw.confidence_note || '';

    const confidence = formatted.confidence || analysisRaw.data_confidence;
    const confidenceJustification = formatted.confidenceJustification || analysisRaw.data_confidence_justification || '';
    const sources = formatted.sources || [];

    // v3: market dynamics at top level
    const marketDynamics = marketOverview.marketDynamics || analysisRaw.market_dynamics || '';
    // v3: job_to_be_done at top level
    const jobToBeDone = marketOverview.jobToBeDone || analysisRaw.job_to_be_done || '';

    // -- Scientific evidence (Literature Review) fragments --
    // Surfaced via progressive disclosure so the existing tabs don't bloat:
    //   * Summary tab: single inline chip when there are any signals.
    //   * Detailed tab: collapsed <details> panel below the competitor grid.
    //   * Sources tab: publication DOIs and trial links appended to the
    //     existing source list (dedup'd against the company-source set).
    const litF = literature?.formatted || null;
    const litCounts = litF?.counts || { trials: 0, labs: 0, discontinued: 0, keyPublications: 0 };
    // v04.2.1: Demoted from a full metric card to an inline chip rendered
    // *below* the metrics row. Most ventures won't surface clinical trials
    // and the labs count alone doesn't merit a top-tier card. The chip only
    // renders when there's a non-zero trial or discontinued signal AND
    // there's no synthesis output (synthesis already names these competitors
    // in the unified grid + narrative, making the chip redundant).
    const hasLitTrialSignal = !!(litF && (litCounts.trials || litCounts.discontinued));
    const litSummaryInline = (hasLitTrialSignal && !hasSynthesisCompetitors)
      ? `<div class="competitive-lit-inline" title="From the Scientific Evidence flow — full breakdown on Detailed tab">
           <strong>Scientific Evidence signal:</strong>
           ${litCounts.trials ? `${litCounts.trials} trial${litCounts.trials === 1 ? '' : 's'}` : ''}${litCounts.trials && (litCounts.discontinued || litCounts.labs) ? ' · ' : ''}${litCounts.discontinued ? `${litCounts.discontinued} discontinued program${litCounts.discontinued === 1 ? '' : 's'}` : ''}${(litCounts.trials || litCounts.discontinued) && litCounts.labs ? ' · ' : ''}${litCounts.labs ? `${litCounts.labs} academic group${litCounts.labs === 1 ? '' : 's'}` : ''}
         </div>`
      : '';

    const renderTrialRow = (t) => {
      const phase = t.phase ? `<span class="lit-trial-phase">${this.escape(t.phase)}</span>` : '';
      const status = t.status ? `<span class="lit-trial-status">${this.escape(t.status)}</span>` : '';
      const sponsor = t.sponsor ? ` · ${this.escape(t.sponsor)}` : '';
      const link = t.link ? `<a href="${this.escape(t.link)}" target="_blank" rel="noopener">${this.escape(t.trialId || 'Trial')}</a>` : this.escape(t.trialId || 'Trial');
      const intervention = t.intervention ? `<div class="lit-trial-intervention">${this.escape(this.truncate(t.intervention, 120))}</div>` : '';
      return `<li class="lit-trial-row">${link} ${phase} ${status}${sponsor}${intervention}</li>`;
    };

    const renderLabRow = (lab) => `
      <li class="lit-lab-row">
        <strong>${this.escape(lab.name)}</strong>
        <span class="lit-lab-count">${lab.publicationCount} publication${lab.publicationCount === 1 ? '' : 's'}</span>
      </li>`;

    let litDetailedHTML = '';
    if (litF && (litCounts.trials || litCounts.labs || litCounts.discontinued)) {
      const trialsTop = litF.trialCompetitors.slice(0, 5);
      const trialsRest = litF.trialCompetitors.slice(5);
      const labsTop = litF.labCompetitors.slice(0, 5);
      const labsRest = litF.labCompetitors.slice(5);
      const discTop = litF.discontinuedSignals.slice(0, 5);
      const summary = `Scientific Evidence Competitors — ${litCounts.trials} trial${litCounts.trials === 1 ? '' : 's'} · ${litCounts.labs} academic group${litCounts.labs === 1 ? '' : 's'}${litCounts.discontinued ? ` · ${litCounts.discontinued} discontinued program${litCounts.discontinued === 1 ? '' : 's'}` : ''}`;
      litDetailedHTML = `
        <details class="lit-evidence-panel">
          <summary>${this.escape(summary)}</summary>
          <p class="lit-evidence-source-tag">Source: Scientific Evidence Analysis (PubMed / ClinicalTrials.gov)</p>
          ${trialsTop.length > 0 ? `
            <div class="lit-evidence-subsection">
              <h5>Active trials &amp; registry signals</h5>
              <ul class="lit-trial-list">${trialsTop.map(renderTrialRow).join('')}</ul>
              ${trialsRest.length > 0 ? `<details class="lit-show-all"><summary>Show ${trialsRest.length} more trials</summary><ul class="lit-trial-list">${trialsRest.map(renderTrialRow).join('')}</ul></details>` : ''}
            </div>
          ` : ''}
          ${discTop.length > 0 ? `
            <div class="lit-evidence-subsection lit-discontinued">
              <h5>Discontinued / completed programs (negative signal)</h5>
              <ul class="lit-trial-list">${discTop.map(renderTrialRow).join('')}</ul>
            </div>
          ` : ''}
          ${labsTop.length > 0 ? `
            <div class="lit-evidence-subsection">
              <h5>Academic groups working on the same target</h5>
              <ul class="lit-lab-list">${labsTop.map(renderLabRow).join('')}</ul>
              ${labsRest.length > 0 ? `<details class="lit-show-all"><summary>Show ${labsRest.length} more groups</summary><ul class="lit-lab-list">${labsRest.map(renderLabRow).join('')}</ul></details>` : ''}
            </div>
          ` : ''}
          ${litF.confidenceJustification ? `<p class="lit-evidence-caveat"><em>Confidence: ${this.escape(litF.confidence || 'Medium')} — ${this.escape(litF.confidenceJustification)}</em></p>` : ''}
        </details>
      `;
    }

    // -- Synthesis (Unified Evidence) fragments --
    // When the synthesis flow has produced a unified_competitors[] list, the
    // Detailed tab swaps out BOTH the existing company-competitor grid AND
    // the lit-evidence <details> panel for a single unified grid that has
    // multi-source badges per entry + the Reranker per-competitor scores
    // inline + expandable rationales. The Summary tab's AI Assessment
    // Rationale is replaced with synthesis.formatted.competitiveNarrative.
    // Falls back to the v04.1 layout (existing grid + lit panel) when
    // synthesis is absent.
    const synF = synthesis?.formatted || null;
    const hasSynthesisCompetitors = !!(synF && Array.isArray(synF.unifiedCompetitors) && synF.unifiedCompetitors.length > 0);
    const hasSynthesisNarrative   = !!(synF && synF.competitiveNarrative && synF.competitiveNarrative.trim());

    // Reranker aggregates for the metrics row + below-grid summary line.
    // These can come from either the new Competitive flow's out-0 (preferred,
    // surfaced via competitive.js formatForDisplay) or — if competitive.js
    // didn't surface them on an older payload — be absent. Treat null as "do
    // not render this card".
    const winnabilitySummary           = formatted.winnabilitySummary || null;
    const winnabilitySummaryRationale  = formatted.winnabilitySummaryRationale || '';
    const effectiveCompetitorCount     = (typeof formatted.effectiveCompetitorCount === 'number') ? formatted.effectiveCompetitorCount : null;
    const highThreatCount              = (typeof formatted.highThreatCount === 'number') ? formatted.highThreatCount : null;
    const winnabilityGateApplied       = !!formatted.winnabilityGateApplied;
    const winnabilityGateExplanation   = formatted.winnabilityGateExplanation || '';

    // v04.2.1 Summary tab gets a curated set of metric cards — overload was
    // confusing advisors with 9 cards. Keep the 5 most decision-relevant on
    // Summary; the rest move to Detailed (see detailedHTML below).
    const winnabilityBadge = winnabilitySummary
      ? `<div class="metric-card metric-card-winnability uc-winnability-${this.escape(winnabilitySummary)}" title="${this.escape(winnabilitySummaryRationale || 'Reranker winnability summary across the named competitor set')}">
           <span class="metric-label">Winnability</span>
           <span class="metric-value">${this.escape(this.capitalize(winnabilitySummary))}</span>
         </div>`
      : '';
    const effectiveCountCard = (effectiveCompetitorCount !== null)
      ? `<div class="metric-card" title="Reranker-weighted competitor count (direct=1.0, indirect=0.5, substitute=0.25, scaled by relevance)">
           <span class="metric-label">Effective Count</span>
           <span class="metric-value">${effectiveCompetitorCount.toFixed(1)}</span>
         </div>`
      : '';
    const highThreatCard = (highThreatCount !== null)
      ? `<div class="metric-card" title="Competitors with Reranker threat score ≥ 7">
           <span class="metric-label">High Threats</span>
           <span class="metric-value">${highThreatCount}</span>
         </div>`
      : '';

    // -- Unified competitor grid (synthesis-only) --
    // One card per unified_competitors entry. Carries source badges,
    // Reranker numeric badges (when non-null), and an expandable
    // rationales panel.
    const renderSourceTypeBadge = (type) => {
      const labels = {
        company: 'Company',
        clinical_trial: 'Trial',
        academic_lab: 'Academic Lab',
        discontinued_trial: 'Discontinued'
      };
      const label = labels[type] || type;
      return `<span class="uc-source-badge uc-source-${this.escape(type)}">${this.escape(label)}</span>`;
    };

    const renderUnifiedCompetitorCard = (uc) => {
      const sources = Array.isArray(uc.sources) ? uc.sources : [];
      // Dedupe badge types (one badge per distinct type even if the entity has
      // multiple sources of the same type).
      const uniqTypes = [...new Set(sources.map(s => s?.type).filter(Boolean))];
      const isMulti = uniqTypes.length > 1;
      const categoryClass = uc.category ? `uc-cat-${this.escape(uc.category)}` : '';
      const isDiscontinued = uc.category === 'discontinued' || uniqTypes.every(t => t === 'discontinued_trial');

      const hasReranker = (uc.relevance_score !== null && uc.relevance_score !== undefined)
        || (uc.threat_score !== null && uc.threat_score !== undefined)
        || (uc.winnability_vs !== null && uc.winnability_vs !== undefined);
      // v04.2.1 — full-word badge labels. The previous "R 9 / T 9" shorthand
      // confused advisors (Brian noted "I don't understand what R9, T9 means").
      // Numbers stay on a 0-10 Reranker scale; click expands the rationale
      // panel below the card.
      const rerankerRow = hasReranker
        ? `<div class="uc-reranker-row">
             ${typeof uc.relevance_score === 'number' ? `<span class="uc-reranker-badge" data-uc-rationale="relevance" title="How directly this competitor addresses the same customer job (0-10). Click for rationale."><span class="uc-rb-label">Relevance</span> <span class="uc-rb-num">${uc.relevance_score}</span></span>` : ''}
             ${typeof uc.threat_score === 'number' ? `<span class="uc-reranker-badge" data-uc-rationale="threat" title="Funding/scale/traction-weighted threat strength (0-10). Click for rationale."><span class="uc-rb-label">Threat</span> <span class="uc-rb-num">${uc.threat_score}</span></span>` : ''}
             ${uc.winnability_vs ? `<span class="uc-winnability-badge uc-winnability-${this.escape(uc.winnability_vs)}" data-uc-rationale="winnability" title="Whether the venture can defensibly beat this competitor. Click for rationale.">${this.escape(this.capitalize(uc.winnability_vs))}</span>` : ''}
           </div>
           <div class="uc-rationale-panel" hidden></div>`
        : '';

      // Source-ref links: collapse to one link per source line.
      const sourceLines = sources.slice(0, 5).map(s => {
        if (!s) return '';
        const refIsUrl = typeof s.ref === 'string' && /^https?:\/\//.test(s.ref);
        const refText = refIsUrl ? `<a href="${this.escape(s.ref)}" target="_blank" rel="noopener">${this.escape(s.details || s.ref)}</a>` : this.escape(s.details || s.ref || '');
        return `<li class="uc-source-line">${renderSourceTypeBadge(s.type)} ${refText}</li>`;
      }).join('');

      // v04.2.2: Academic-lab entries get extra source affordances. The
      // literature flow's top_research_groups[] doesn't carry per-group
      // publication links (just name + count), so synthesis can't attach a
      // specific paper to each lab. As a workaround:
      //   1. Linkify the group name to a Google Scholar search — pure
      //      frontend, no AI changes, gets the advisor to representative
      //      papers in one click.
      //   2. Add a "View representative publications" pointer that switches
      //      the Competitive section to the Sources tab where the literature
      //      flow's key_publications[] are already listed + linked.
      // discontinued_trial entries don't need this — their NCT IDs are
      // already linked via sources[].ref.
      const isAcademicOnly = uc.category === 'academic_only'
        || (uniqTypes.length === 1 && uniqTypes[0] === 'academic_lab');
      const nameDisplay = isAcademicOnly
        ? `<a href="https://scholar.google.com/scholar?q=${encodeURIComponent(uc.name || '')}" target="_blank" rel="noopener" title="Search Google Scholar for publications by this group">${this.escape(uc.name || 'Unknown')}</a>`
        : this.escape(uc.name || 'Unknown');
      const academicPubsPointer = isAcademicOnly
        ? `<p class="uc-academic-pubs-pointer"><a href="#" data-uc-go-to-sources="1">View representative publications &rarr;</a></p>`
        : '';

      return `
        <div class="unified-competitor-card ${categoryClass}${isDiscontinued ? ' uc-discontinued' : ''}"
             data-relevance="${uc.relevance_rationale ? this.escape(uc.relevance_rationale) : ''}"
             data-threat="${uc.threat_rationale ? this.escape(uc.threat_rationale) : ''}"
             data-winnability="${uc.winnability_rationale ? this.escape(uc.winnability_rationale) : ''}">
          <div class="uc-header">
            <strong class="uc-name">${nameDisplay}</strong>
            <div class="uc-source-badges">
              ${uniqTypes.map(renderSourceTypeBadge).join('')}
              ${isMulti ? `<span class="uc-source-badge uc-source-multi" title="Surfaced in multiple sources — stronger signal">${uniqTypes.length}×</span>` : ''}
              ${uc.category ? `<span class="uc-category-tag">${this.escape(uc.category.replace('_', ' '))}</span>` : ''}
            </div>
          </div>
          ${rerankerRow}
          ${uc.summary ? `<p class="uc-summary">${this.escape(uc.summary)}</p>` : ''}
          ${(uc.strengths && uc.strengths.length > 0) ? `
            <div class="uc-strengths">
              <span class="card-label">Strengths</span> ${uc.strengths.slice(0, 3).map(s => this.escape(s)).join('; ')}
            </div>
          ` : ''}
          ${(uc.weaknesses && uc.weaknesses.length > 0) ? `
            <div class="uc-weaknesses">
              <span class="card-label">Weaknesses</span> ${uc.weaknesses.slice(0, 3).map(w => this.escape(w)).join('; ')}
            </div>
          ` : ''}
          ${sourceLines ? `<ul class="uc-sources-list">${sourceLines}</ul>` : ''}
          ${academicPubsPointer}
        </div>
      `;
    };

    const unifiedGridHTML = hasSynthesisCompetitors
      ? `<div class="evidence-section">
           <h4>Competitor Landscape (${synF.unifiedCompetitors.length} entities across all sources)</h4>
           <p class="evidence-source-tag">Source: Unified Synthesis — Competitive flow + Scientific Evidence flow + Reranker scoring</p>
           <div class="unified-competitor-grid">
             ${synF.unifiedCompetitors.map(renderUnifiedCompetitorCard).join('')}
           </div>
           ${winnabilitySummaryRationale ? `
             <div class="competitive-winnability-summary">
               <strong>Winnability summary:</strong> ${this.escape(winnabilitySummaryRationale)}
               ${winnabilityGateApplied ? `<div class="competitive-winnability-gate"><em>Score capped by winnability gate: ${this.escape(winnabilityGateExplanation)}</em></div>` : ''}
             </div>
           ` : ''}
         </div>`
      : '';

    // Literature publications and trial links for the Sources tab.
    const litSourceLinks = [];
    if (litF) {
      for (const pub of (litF.keyPublications || [])) {
        const url = pub.link || (pub.doi ? `https://doi.org/${pub.doi}` : null);
        if (!url) continue;
        const label = pub.title
          ? `${this.truncate(pub.title, 100)}${pub.year ? ` (${pub.year})` : ''}`
          : url;
        litSourceLinks.push({ url, label });
      }
      for (const t of [...(litF.trialCompetitors || []), ...(litF.discontinuedSignals || [])]) {
        if (!t.link) continue;
        litSourceLinks.push({ url: t.link, label: `${t.trialId || 'Trial'}${t.phase ? ` · ${t.phase}` : ''}` });
      }
    }

    // SUMMARY VIEW
    const summaryHTML = `
      <div class="evidence-content">
        ${jobToBeDone ? `<p class="industry-context"><strong>Job to Be Done:</strong> ${this.escape(jobToBeDone)}</p>` : ''}

        <div class="metrics-row">
          <div class="metric-card">
            <span class="metric-label">Competitors Found</span>
            <span class="metric-value">${competitorCount.total || competitors.length || '-'}</span>
          </div>
          ${effectiveCountCard}
          <div class="metric-card">
            <span class="metric-label">Intensity</span>
            <span class="metric-value">${this.capitalize(intensity)}</span>
          </div>
          ${winnabilityBadge}
          <div class="metric-card">
            <span class="metric-label">Confidence</span>
            <span class="metric-value">${confidence || '-'}</span>
          </div>
        </div>
        ${litSummaryInline}

        <div class="evidence-section">
          <h4>${hasSynthesisNarrative ? 'Unified Competitive Picture' : 'AI Assessment Rationale'}</h4>
          ${hasSynthesisNarrative ? `<p class="evidence-source-tag">Source: Unified Synthesis</p>` : ''}
          <div class="ai-rationale">${this.formatRationale(hasSynthesisNarrative ? synF.competitiveNarrative : justification)}</div>
          ${hasSynthesisNarrative && justification ? `
            <details class="competitive-rubric-detail">
              <summary>Grader's rubric-mapped rationale</summary>
              <div class="ai-rationale">${this.formatRationale(justification)}</div>
            </details>
          ` : ''}
        </div>

        ${confidenceNote ? `
          <div class="evidence-section">
            <h4>Confidence Note</h4>
            <p>${this.escape(confidenceNote)}</p>
          </div>
        ` : ''}

        ${(keyRisks.length > 0 || opportunities.length > 0) ? `
          <div class="two-column-grid">
            ${keyRisks.length > 0 ? `
              <div class="evidence-section">
                <h4>Key Risk Factors</h4>
                <ul class="compact-list">${keyRisks.slice(0, 4).map(r => `<li>${this.escape(r)}</li>`).join('')}</ul>
              </div>
            ` : ''}
            ${opportunities.length > 0 ? `
              <div class="evidence-section">
                <h4>Differentiation Opportunities</h4>
                <ul class="compact-list">${opportunities.slice(0, 4).map(o => `<li>${this.escape(o)}</li>`).join('')}</ul>
              </div>
            ` : ''}
          </div>
        ` : ''}

        ${marketLeaders.length > 0 ? `
          <div class="evidence-section">
            <h4>Market Leaders</h4>
            <div class="leader-badges">
              ${marketLeaders.map(l => `<span class="leader-badge">${this.escape(l)}</span>`).join('')}
            </div>
          </div>
        ` : ''}
      </div>
    `;

    // DETAILED VIEW - market context metrics → competitor grid → market analysis
    // v04.2.1: Est. Total Market / Large Corps / High Threats moved here from
    // the Summary metrics row to keep that row focused on the 5 most
    // decision-relevant cards.
    const detailedMetricsRow = `
      <div class="metrics-row metrics-row-detailed">
        ${estimatedTotal ? `
          <div class="metric-card">
            <span class="metric-label">Est. Total Market</span>
            <span class="metric-value">${this.escape(String(estimatedTotal))}</span>
          </div>
        ` : ''}
        ${competitorCount.large_companies ? `
          <div class="metric-card">
            <span class="metric-label">Large Corps</span>
            <span class="metric-value">${competitorCount.large_companies}</span>
          </div>
        ` : ''}
        ${highThreatCard}
      </div>
    `;

    const detailedHTML = `
      <div class="evidence-content">
        ${detailedMetricsRow}
        ${competitiveScope ? `
          <div class="evidence-section">
            <h4>Competitive Scope</h4>
            <p>${this.escape(competitiveScope)}</p>
          </div>
        ` : ''}

        ${hasSynthesisCompetitors ? unifiedGridHTML : `
        <div class="evidence-section">
          <h4>Profiled Competitors (${competitors.length}${estimatedTotal ? ` of ~${this.escape(String(estimatedTotal))} estimated` : ''})</h4>
          <div class="competitor-grid">
            ${competitors.slice(0, 12).map(c => {
              const size = (c.size || c.size_category || c.companySize || '').toLowerCase();
              const rev = c.revenue && c.revenue.toLowerCase() !== 'unknown' ? c.revenue : null;
              return `
              <div class="competitor-card-detailed">
                <div class="competitor-header">
                  <strong class="competitor-name">${this.escape(c.name || c.company_name || 'Unknown Competitor')}${(() => { const src = (c.sources || []).find(s => s && typeof s === 'string' && s.startsWith('http')); return src ? ` <a href="${this.escape(src)}" target="_blank" rel="noopener" class="competitor-source-link" title="Source">↗</a>` : ''; })()}</strong>
                  <div class="competitor-badges">
                    <span class="size-badge ${size}">${this.escape(c.size || c.size_category || c.companySize || '')}</span>
                    ${c.competitorType ? `<span class="type-badge">${this.escape(c.competitorType)}</span>` : ''}
                  </div>
                </div>
                ${c.product ? `<div class="competitor-product">${this.escape(c.product)}</div>` : ''}
                ${c.description ? `<p class="product-desc">${this.escape(this.truncate(c.description, 150))}</p>` : ''}
                ${c.differentiation ? `<div class="competitor-diff-box">${this.escape(c.differentiation)}</div>` : ''}
                ${c.strengths?.length > 0 ? `
                  <div class="competitor-strengths">
                    <span class="card-label">Strengths</span> ${c.strengths.slice(0, 2).map(s => this.escape(s)).join('; ')}
                  </div>
                ` : ''}
                ${c.weaknesses?.length > 0 ? `
                  <div class="competitor-weaknesses">
                    <span class="card-label">Weaknesses</span> ${c.weaknesses.slice(0, 2).map(w => this.escape(w)).join('; ')}
                  </div>
                ` : ''}
                ${rev ? `<p class="competitor-revenue">Revenue: ${this.escape(rev)}</p>` : ''}
              </div>
            `}).join('')}
          </div>
          ${competitors.length > 12 ? `<p class="more-note">+ ${competitors.length - 12} more competitors</p>` : ''}
        </div>
        `}

        ${(!hasSynthesisCompetitors && litDetailedHTML) ? `<div class="evidence-section">${litDetailedHTML}</div>` : ''}

        <div class="evidence-section">
          <h4>Market Dynamics</h4>
          <p>${this.escape(marketDynamics || 'Not provided.')}</p>
        </div>

        ${marketGaps.length > 0 ? `
          <div class="evidence-section">
            <h4>Market Gaps</h4>
            <ul class="compact-list">${marketGaps.map(g => `<li>${this.escape(typeof g === 'string' ? g : JSON.stringify(g))}</li>`).join('')}</ul>
          </div>
        ` : ''}

        ${(evaluationSteps.saturation_assessment || evaluationSteps.incumbent_strength_assessment || evaluationSteps.differentiation_assessment) ? `
          <div class="evidence-section">
            <h4>Competitive Landscape Analysis</h4>
            ${evaluationSteps.saturation_assessment ? `<div class="landscape-narrative"><h5>Market Saturation</h5><p>${this.escape(evaluationSteps.saturation_assessment)}</p></div>` : ''}
            ${evaluationSteps.incumbent_strength_assessment ? `<div class="landscape-narrative"><h5>Incumbent Analysis</h5><p>${this.escape(evaluationSteps.incumbent_strength_assessment)}</p></div>` : ''}
            ${evaluationSteps.differentiation_assessment ? `<div class="landscape-narrative"><h5>Differentiation Assessment</h5><p>${this.escape(evaluationSteps.differentiation_assessment)}</p></div>` : ''}
          </div>
        ` : ''}
      </div>
    `;

    // SOURCES VIEW
    const seenSourceUrls = new Set(sources.map(s => this.cleanSourceUrl(s)));
    const dedupedLitSources = litSourceLinks.filter(s => {
      const c = this.cleanSourceUrl(s.url);
      if (seenSourceUrls.has(c)) return false;
      seenSourceUrls.add(c);
      return true;
    });
    const sourcesHTML = `
      <div class="evidence-content">
        <div class="evidence-section">
          <h4>Data Sources</h4>
          ${sources.length > 0 ? `
            <ul class="source-list">
              ${sources.map(s => {
                const cleanUrl = this.cleanSourceUrl(s);
                return `<li><a href="${this.escape(cleanUrl)}" target="_blank" rel="noopener">${this.truncateUrl(cleanUrl)}</a></li>`;
              }).join('')}
            </ul>
          ` : '<p>No company-source links available.</p>'}
        </div>
        ${dedupedLitSources.length > 0 ? `
          <div class="evidence-section">
            <h4>Scientific Evidence Sources</h4>
            <p class="evidence-source-tag">Publications and trial registry entries surfaced by the Scientific Evidence flow.</p>
            <ul class="source-list">
              ${dedupedLitSources.map(s => `<li><a href="${this.escape(s.url)}" target="_blank" rel="noopener">${this.escape(s.label)}</a></li>`).join('')}
            </ul>
          </div>
        ` : ''}
        <div class="evidence-section">
          <h4>Rubric Alignment</h4>
          <div class="rubric-explanation">${this.formatRationale(rubricMatch)}</div>
        </div>
        <div class="evidence-section">
          <h4>Confidence Note</h4>
          <p><strong>${confidence || '-'}</strong> confidence level.</p>
          <p>${this.escape(confidenceJustification || 'No additional confidence information.')}</p>
        </div>
      </div>
    `;

    container.innerHTML = summaryHTML;
    container.dataset.summary = summaryHTML;
    container.dataset.detailed = detailedHTML;
    container.dataset.sources = sourcesHTML;

    // Wire Reranker badge click-to-expand. Event delegation on the container
    // so the handler works regardless of which tab (summary/detailed/sources)
    // is currently rendered. Each click toggles the .uc-rationale-panel
    // sibling inside the same .unified-competitor-card and fills it with the
    // appropriate rationale from the card's data-* attributes.
    this._wireRerankerRationales(container);
  }

  _wireRerankerRationales(container) {
    if (!container || container._rerankerWired) return;
    container._rerankerWired = true;
    container.addEventListener('click', (e) => {
      // Reranker badge → toggle the rationale panel below the card.
      const badge = e.target.closest('[data-uc-rationale]');
      if (badge) {
        const card = badge.closest('.unified-competitor-card');
        if (!card) return;
        const panel = card.querySelector('.uc-rationale-panel');
        if (!panel) return;
        const which = badge.getAttribute('data-uc-rationale');
        const labels = { relevance: 'Relevance', threat: 'Threat', winnability: 'Winnability' };
        const text = card.getAttribute(`data-${which}`) || '';
        if (!text) {
          panel.hidden = true;
          panel.innerHTML = '';
          return;
        }
        if (!panel.hidden && panel.dataset.which === which) {
          panel.hidden = true;
          panel.innerHTML = '';
          panel.dataset.which = '';
          return;
        }
        panel.dataset.which = which;
        panel.innerHTML = `<strong>${labels[which] || which} rationale:</strong> ${text}`;
        panel.hidden = false;
        return;
      }
      // Academic-lab "View representative publications" pointer — switch
      // the Competitive section's view-toggle to Sources where the
      // literature key_publications[] are listed.
      const goSources = e.target.closest('[data-uc-go-to-sources]');
      if (goSources) {
        e.preventDefault();
        const panel = container.closest('.tab-panel');
        if (!panel) return;
        const sourcesBtn = panel.querySelector('.view-toggle-btn[data-view="sources"]');
        if (sourcesBtn) sourcesBtn.click();
        return;
      }
    });
  }

  // ========== MARKET DATA ==========
  
  loadMarketData(data) {
    this.data.market = data;
    
    // API returns: { analysis: {...}, scoring: {...}, formatted: {...} }
    // Score is in scoring.score
    const score = data?.scoring?.score || data?.score;
    this.aiScores.market = score;
    
    const aiScoreEl = document.getElementById('market-ai-score');
    if (aiScoreEl) aiScoreEl.textContent = score ?? '-';
    
    const slider = document.getElementById('market-score-slider');
    const display = document.getElementById('market-user-score');
    if (slider && score) {
      slider.value = score;
      if (display) display.textContent = score;
      this.userScores.market.score = score;
      this.updateRubricDisplay('market', score);
    }
    
    this.displayMarketEvidence(data);
  }

  displayMarketEvidence(data) {
    const container = document.getElementById('market-evidence');
    if (!container) return;

    // v3 formatted data from market.js formatForDisplay()
    const formatted = data?.formatted || {};
    const analysisRaw = data?.analysis || {};
    const scoringRaw = data?.scoring || {};

    // Primary market from formatted (has tam, cagr) or analysis (has tam_usd, cagr_percent)
    const primaryMarket = formatted.primaryMarket || analysisRaw?.primary_market || {};
    const tam = primaryMarket.tam || primaryMarket.tam_usd;
    const cagr = primaryMarket.cagr || primaryMarket.cagr_percent;

    // Markets array - formatted uses: tam, cagr, source
    const markets = formatted.markets || analysisRaw?.markets || [];

    const marketAnalysis = analysisRaw?.market_analysis || {};
    const confidence = formatted.confidence || formatted.sourceCredibility || scoringRaw?.data_quality?.source_credibility;
    const confidenceJustification = formatted.confidenceJustification || analysisRaw?.data_confidence_justification || '';

    // v3: justification is a string (not object with .summary)
    const justificationSummary = formatted.justification || scoringRaw?.justification || '';
    // v3: strengths/limitations from scoring_alignment
    const strengths = formatted.strengths || analysisRaw?.scoring_alignment?.strengths || [];
    const limitations = formatted.limitations || analysisRaw?.scoring_alignment?.limitations || [];

    // TAM/CAGR categories
    const tamCategory = formatted.tamCategory || formatted.rubricDetails?.tamCategory || scoringRaw?.rubric_application?.tam_category || '';
    const cagrCategory = formatted.cagrCategory || formatted.rubricDetails?.cagrCategory || scoringRaw?.rubric_application?.cagr_category || '';

    // v3: data quality uses sourceCredibility and dataConcerns (no dataDate/dataRecency)
    const sourceCredibility = formatted.sourceCredibility || scoringRaw?.data_quality?.source_credibility || '';
    const dataConcerns = formatted.dataConcerns || scoringRaw?.data_quality?.data_concerns || [];

    // Format category nicely
    const formatCategory = (cat) => {
      if (!cat) return '-';
      return cat.replace(/_/g, ' ')
        .replace('under 500M', '< $500M')
        .replace('500M to 5B', '$500M - $5B')
        .replace('over 5B', '> $5B')
        .replace('under 10', '< 10%')
        .replace('10 to 20', '10-20%')
        .replace('10 to 35', '10-35%')
        .replace('over 20', '> 20%')
        .replace('over 35', '> 35%');
    };

    // SUMMARY VIEW
    const summaryHTML = `
      <div class="evidence-content">
        <div class="metrics-row">
          <div class="metric-card">
            <span class="metric-label">TAM</span>
            <span class="metric-value">${this.formatCurrency(tam)}</span>
          </div>
          <div class="metric-card">
            <span class="metric-label">CAGR</span>
            <span class="metric-value">${typeof cagr === 'number' ? cagr.toFixed(1) + '%' : '-'}</span>
          </div>
          <div class="metric-card">
            <span class="metric-label">Confidence</span>
            <span class="metric-value">${confidence || '-'}</span>
          </div>
        </div>

        ${primaryMarket.description ? `
          <p class="market-basis"><span class="card-label">Based on</span> ${this.escape(primaryMarket.description)}</p>
        ` : ''}

        <div class="evidence-section">
          <h4>AI Assessment Rationale</h4>
          <div class="ai-rationale">${this.formatRationale(justificationSummary)}</div>
        </div>

        <div class="two-column-grid">
          <div class="evidence-section">
            <h4>Strengths</h4>
            <ul class="compact-list">${strengths.map(s => `<li>${this.escape(s)}</li>`).join('') || '<li>None identified</li>'}</ul>
          </div>
          <div class="evidence-section">
            <h4>Limitations</h4>
            <ul class="compact-list">${limitations.map(l => `<li>${this.escape(l)}</li>`).join('') || '<li>None identified</li>'}</ul>
          </div>
        </div>
      </div>
    `;

    // DETAILED VIEW - Market segments table + analysis
    const detailedHTML = `
      <div class="evidence-content">
        ${formatted.executiveSummary ? `
          <div class="evidence-section">
            <h4>Executive Summary</h4>
            <p>${this.escape(formatted.executiveSummary)}</p>
          </div>
        ` : ''}

        <div class="evidence-section">
          <h4>Market Segments</h4>
          ${markets.length > 0 ? `
            <table class="data-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Market</th>
                  <th>TAM</th>
                  <th>CAGR</th>
                  <th>Source</th>
                </tr>
              </thead>
              <tbody>
                ${markets.map((m, i) => {
                  const mTam = m.tam || m.tam_current_usd;
                  const mCagr = m.cagr || m.cagr_percent;
                  const mSrc = m.source || m.source_url || '';
                  return `
                    <tr>
                      <td>${m.rank || i + 1}</td>
                      <td>${this.escape(m.description)}</td>
                      <td>${this.formatCurrency(mTam)}</td>
                      <td>${typeof mCagr === 'number' ? mCagr.toFixed(1) + '%' : '-'}</td>
                      <td>${mSrc && mSrc.startsWith('http') ? `<a href="${this.escape(mSrc)}" target="_blank" rel="noopener" class="table-source-link">${this.escape((() => { try { return new URL(mSrc).hostname.replace('www.',''); } catch { return 'Link'; } })())}</a>` : '—'}</td>
                    </tr>
                  `;
                }).join('')}
              </tbody>
            </table>
          ` : '<p>No market data available.</p>'}
        </div>

        <div class="evidence-section">
          <h4>Primary Market Selection</h4>
          <p><strong>${this.escape(primaryMarket.description || '')}</strong></p>
          <p>${this.escape(primaryMarket.rationale || primaryMarket.selection_rationale || '')}</p>
        </div>

        ${(formatted.trends || marketAnalysis.trends)?.length > 0 ? `
          <div class="evidence-section">
            <h4>Market Trends</h4>
            <ul>${(formatted.trends || marketAnalysis.trends).map(t => `<li>${this.escape(t)}</li>`).join('')}</ul>
          </div>
        ` : ''}

        ${(formatted.unmetNeeds || marketAnalysis.unmet_needs)?.length > 0 ? `
          <div class="evidence-section">
            <h4>Unmet Needs</h4>
            <ul>${(formatted.unmetNeeds || marketAnalysis.unmet_needs).map(n => `<li>${this.escape(typeof n === 'string' ? n : JSON.stringify(n))}</li>`).join('')}</ul>
          </div>
        ` : ''}

        ${(formatted.opportunities || marketAnalysis.opportunities)?.length > 0 ? `
          <div class="evidence-section">
            <h4>Opportunities</h4>
            <ul>${(formatted.opportunities || marketAnalysis.opportunities).map(o => `<li>${this.escape(o)}</li>`).join('')}</ul>
          </div>
        ` : ''}

        ${(formatted.barriers || marketAnalysis.barriers_to_entry)?.length > 0 ? `
          <div class="evidence-section">
            <h4>Barriers to Entry</h4>
            <ul>${(formatted.barriers || marketAnalysis.barriers_to_entry).map(b => `<li>${this.escape(b)}</li>`).join('')}</ul>
          </div>
        ` : ''}
      </div>
    `;

    // SOURCES VIEW
    const marketSources = markets.filter(m => m.source || m.source_url).map(m => ({
      label: m.description,
      url: m.source || m.source_url
    }));
    const dataSources = formatted.dataSources || [];

    const sourcesHTML = `
      <div class="evidence-content">
        <div class="evidence-section">
          <h4>Market Data Sources</h4>
          ${marketSources.length > 0 ? `
            <ul class="source-list">
              ${marketSources.map(s => `
                <li>
                  <strong>${this.escape(s.label)}</strong>:
                  <a href="${this.escape(this.cleanSourceUrl(s.url))}" target="_blank" rel="noopener">${this.truncateUrl(s.url)}</a>
                </li>
              `).join('')}
            </ul>
          ` : (dataSources.length > 0 ? `
            <ul class="source-list">
              ${dataSources.map(s => `<li><a href="${this.escape(this.cleanSourceUrl(s))}" target="_blank" rel="noopener">${this.truncateUrl(s)}</a></li>`).join('')}
            </ul>
          ` : '<p>No source URLs available.</p>')}
        </div>
        <div class="evidence-section">
          <h4>Confidence Note</h4>
          <p><strong>${confidence || '-'}</strong> confidence level.</p>
          <p>${this.escape(confidenceJustification || 'No additional confidence information.')}</p>
        </div>
        <div class="evidence-section">
          <h4>Data Quality</h4>
          ${sourceCredibility ? `<p><strong>Source Credibility:</strong> ${this.escape(sourceCredibility)}</p>` : ''}
          ${dataConcerns.length > 0 ? `
            <p><strong>Concerns:</strong></p>
            <ul>${dataConcerns.map(c => `<li>${this.escape(c)}</li>`).join('')}</ul>
          ` : '<p>No data concerns noted.</p>'}
        </div>
      </div>
    `;

    container.innerHTML = summaryHTML;
    container.dataset.summary = summaryHTML;
    container.dataset.detailed = detailedHTML;
    container.dataset.sources = sourcesHTML;
  }

  // ========== IP RISK DATA ==========
  
  loadIpRiskData(data) {
    this.data.iprisk = data;
    
    // API returns: { data: {...}, score: 3, formatted: {...} }
    const score = data?.score || data?.formatted?.score;
    this.aiScores.iprisk = score;
    
    const aiScoreEl = document.getElementById('iprisk-ai-score');
    if (aiScoreEl) aiScoreEl.textContent = score ?? '-';
    
    const slider = document.getElementById('iprisk-score-slider');
    const display = document.getElementById('iprisk-user-score');
    if (slider && score) {
      slider.value = score;
      if (display) display.textContent = score;
      this.userScores.iprisk.score = score;
      this.updateRubricDisplay('iprisk', score);
    }
    
    this.displayIpRiskEvidence(data);
  }

  displayIpRiskEvidence(data) {
    const container = document.getElementById('iprisk-evidence');
    if (!container) return;

    // v3 formatted data from iprisk.js formatForDisplay()
    const formatted = data?.formatted || {};
    const ipData = data?.data || {};

    // Company IP position
    const companyIP = formatted.companyIP || {};
    const companyPatentsFound = companyIP.patentsFound || 0;
    const companyIPSummary = companyIP.summary || '';
    const ownedPatentIds = companyIP.ownedPatentIds || [];

    // Landscape analysis
    const patentDensity = formatted.patentDensity || 'unknown';
    const totalRelevantPatents = formatted.totalRelevantPatents || 0;
    const uniqueFeatures = formatted.uniqueFeatures || [];
    const crowdedFeatures = formatted.crowdedFeatures || [];
    const topOwners = formatted.topOwners || [];
    const relevantPatents = formatted.relevantPatents || [];

    // Risk assessment
    const overallRisk = formatted.overallRisk || 'medium';
    const freedomToOperate = formatted.freedomToOperate || 'moderate';
    const blockingPatentsIdentified = formatted.blockingPatentsIdentified || false;
    const challenges = formatted.challenges || [];
    const riskAnalysis = formatted.riskAnalysis || '';

    // Patent tables
    const companyPatents = formatted.companyPatents || [];
    const thirdPartyPatents = formatted.thirdPartyPatents || [];

    // Score details
    const justification = formatted.justification || '';
    const keyRiskFactors = formatted.keyRiskFactors || [];
    const rubricMatch = formatted.rubricMatch || '';
    const evaluationSteps = formatted.evaluationSteps || {};
    const dataConfidenceImpact = formatted.dataConfidenceImpact || '';

    // Data quality
    const confidence = formatted.dataConfidence || ipData?.data_confidence;
    const confidenceJustification = formatted.dataConfidenceJustification || ipData?.data_confidence_justification || '';

    // SUMMARY VIEW
    const summaryHTML = `
      <div class="evidence-content">
        <div class="metrics-row">
          <div class="metric-card">
            <span class="metric-label">Overall Risk</span>
            <span class="metric-value risk-${overallRisk.toLowerCase()}">${this.capitalize(overallRisk)}</span>
          </div>
          <div class="metric-card">
            <span class="metric-label">FTO</span>
            <span class="metric-value">${this.capitalize(String(freedomToOperate).replace(/_/g, ' '))}</span>
          </div>
          <div class="metric-card">
            <span class="metric-label">Patent Density</span>
            <span class="metric-value">${this.capitalize(String(patentDensity).replace(/_/g, ' '))}</span>
          </div>
          <div class="metric-card">
            <span class="metric-label">Relevant Patents</span>
            <span class="metric-value">${totalRelevantPatents || '-'}</span>
          </div>
          <div class="metric-card">
            <span class="metric-label">Confidence</span>
            <span class="metric-value">${confidence || '-'}</span>
          </div>
        </div>

        <div class="evidence-section">
          <h4>AI Assessment Rationale</h4>
          <div class="ai-rationale">${this.formatRationale(justification || riskAnalysis || data?.rubricDescription || 'No rationale provided.')}</div>
        </div>

        <div class="evidence-section">
          <h4>Company IP Position</h4>
          <p>${this.escape(companyIPSummary || 'No IP summary available.')}</p>
          <div style="margin-top: 8px;">
            ${companyPatentsFound > 0 ? `<span class="metric-inline">Patents Found: ${companyPatentsFound}</span>` : ''}
            ${blockingPatentsIdentified ? `<span class="warning-badge">Blocking patents identified</span>` : ''}
          </div>
        </div>

        <div class="two-column-grid">
          <div class="evidence-section">
            <h4>Unique Protectable Features</h4>
            <ul class="compact-list">${uniqueFeatures.slice(0, 4).map(f => `<li>${this.escape(f)}</li>`).join('') || '<li>None identified</li>'}</ul>
          </div>
          <div class="evidence-section">
            <h4>Key Challenges</h4>
            <ul class="compact-list">${challenges.slice(0, 4).map(c => `<li>${this.escape(c)}</li>`).join('') || '<li>None identified</li>'}</ul>
          </div>
        </div>

        ${keyRiskFactors.length > 0 ? `
          <div class="evidence-section">
            <h4>Key Risk Factors</h4>
            <ul class="compact-list">${keyRiskFactors.map(f => `<li>${this.escape(f)}</li>`).join('')}</ul>
          </div>
        ` : ''}
      </div>
    `;

    // DETAILED VIEW
    const detailedHTML = `
      <div class="evidence-content">
        <div class="evidence-section">
          <h4>Patent Landscape</h4>
          <div class="metrics-row compact">
            <div class="metric-card small">
              <span class="metric-label">Total Relevant</span>
              <span class="metric-value">${totalRelevantPatents || '-'}</span>
            </div>
            <div class="metric-card small">
              <span class="metric-label">Company Patents</span>
              <span class="metric-value">${companyPatentsFound || companyPatents.length || '-'}</span>
            </div>
            <div class="metric-card small">
              <span class="metric-label">Third Party</span>
              <span class="metric-value">${thirdPartyPatents.length || '-'}</span>
            </div>
            <div class="metric-card small">
              <span class="metric-label">Density</span>
              <span class="metric-value">${this.capitalize(String(patentDensity).replace(/_/g, ' '))}</span>
            </div>
          </div>
        </div>

        ${riskAnalysis ? `
          <div class="evidence-section">
            <h4>Risk Analysis</h4>
            <div class="ai-rationale">${this.formatRationale(riskAnalysis)}</div>
          </div>
        ` : ''}

        ${relevantPatents.length > 0 ? `
          <div class="evidence-section">
            <h4>Key Relevant Patents (${relevantPatents.length})</h4>
            <table class="data-table">
              <thead>
                <tr>
                  <th>Patent ID</th>
                  <th>Title</th>
                  <th>Assignee</th>
                  <th>Year</th>
                  <th>Blocking</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                ${relevantPatents.map(p => `
                  <tr>
                    <td>${p.link ? `<a href="${this.escape(this.cleanPatentLink(p.link))}" target="_blank" rel="noopener">${this.escape(p.id)}</a>` : this.escape(p.id)}</td>
                    <td>${this.escape(this.truncate(p.title, 50))}</td>
                    <td>${this.escape(p.assignee)}</td>
                    <td>${p.year || '-'}</td>
                    <td><span class="risk-badge risk-${(p.blockingPotential || 'low').toLowerCase()}">${this.capitalize(p.blockingPotential || 'low')}</span></td>
                    <td>${this.escape(p.status || '')}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        ` : '<div class="evidence-section"><h4>Key Relevant Patents</h4><p>No relevant patents identified.</p></div>'}

        ${Object.keys(evaluationSteps).length > 0 ? `
          <div class="evidence-section">
            <h4>Scoring Methodology</h4>
            ${(() => {
              const stepLabels = {
                patent_density_baseline: 'Patent Density Baseline',
                blocking_patent_assessment: 'Blocking Patent Assessment',
                venture_ip_assessment: 'IP Assessment',
                fto_assessment: 'Freedom to Operate Assessment'
              };
              return Object.entries(evaluationSteps)
                .filter(([key, val]) => val && key !== 'baseline_range')
                .map(([key, val]) => {
                  const label = stepLabels[key] || this.capitalize(key.replace(/_/g, ' '));
                  return `<div class="landscape-narrative"><h5>${this.escape(label)}</h5><p>${this.escape(String(val))}</p></div>`;
                }).join('');
            })()}
          </div>
        ` : ''}

        ${topOwners.length > 0 ? `
          <div class="evidence-section">
            <h4>Top Patent Holders</h4>
            <div class="patent-holder-chips">
              ${topOwners.slice(0, 8).map(o => `
                <span class="patent-holder-chip">${this.escape(o.assignee)} <strong>${o.patentCount}</strong></span>
              `).join('')}
            </div>
          </div>
        ` : ''}

        ${crowdedFeatures.length > 0 ? `
          <div class="evidence-section">
            <h4>Crowded Patent Areas</h4>
            <ul>${crowdedFeatures.map(f => `<li>${this.escape(f)}</li>`).join('')}</ul>
          </div>
        ` : ''}

        ${dataConfidenceImpact ? `
          <div class="evidence-section">
            <h4>Data Confidence Impact</h4>
            <p>${this.escape(dataConfidenceImpact)}</p>
          </div>
        ` : ''}
      </div>
    `;

    // SOURCES VIEW
    const patentSources = relevantPatents.filter(p => p.link).map(p => ({
      id: p.id,
      link: p.link
    }));

    const sourcesHTML = `
      <div class="evidence-content">
        <div class="evidence-section">
          <h4>Patent Sources</h4>
          ${patentSources.length > 0 ? `
            <ul class="source-list">
              ${patentSources.map(p => `
                <li>
                  <strong>${this.escape(p.id)}</strong>:
                  <a href="${this.escape(this.cleanPatentLink(p.link))}" target="_blank" rel="noopener">Google Patents</a>
                </li>
              `).join('')}
            </ul>
          ` : '<p>No patent sources available.</p>'}
        </div>

        ${topOwners.length > 0 ? `
          <div class="evidence-section">
            <h4>Major Patent Holders</h4>
            <div class="litigator-list">
              ${topOwners.slice(0, 8).map(o => `<span class="litigator-badge">${this.escape(o.assignee)} (${o.patentCount})</span>`).join('')}
            </div>
          </div>
        ` : ''}

        <div class="evidence-section">
          <h4>Rubric Alignment</h4>
          <div class="rubric-explanation">${this.formatRationale(rubricMatch || data?.rubricDescription || '')}</div>
        </div>
        <div class="evidence-section">
          <h4>Confidence Note</h4>
          <p><strong>${confidence || '-'}</strong> confidence level.</p>
          <p>${this.escape(confidenceJustification || 'No additional confidence information.')}</p>
        </div>
      </div>
    `;

    container.innerHTML = summaryHTML;
    container.dataset.summary = summaryHTML;
    container.dataset.detailed = detailedHTML;
    container.dataset.sources = sourcesHTML;
  }

  // ========== EXPORT DATA ==========
  
  /**
   * Load and render aggregated evidence for Solution Value assessment.
   * Organized around the Solution Value rubric's two judgments:
   *   (a) magnitude of benefit vs. current alternatives for the beachhead customer
   *   (b) acuteness of the unmet need
   * Sections: 1) The Unmet Need, 2) Who Feels It Most, 3) Magnitude of Benefit,
   * 4) Related Evidence (Market + Competitive, collapsed).
   */
  loadSolutionValueEvidence() {
    const container = document.getElementById('solutionvalue-evidence');
    if (!container) return;

    const company = this.data.company;
    const market = this.data.market;
    const competitive = this.data.competitive;
    const sv = company?.solution_value || {};

    const escape = (s) => this.escape(s);
    const capitalize = (s) => this.capitalize(s);

    const severityClassMap = { low: 'low', moderate: 'medium', high: 'high', critical: 'high' };
    const severityBadge = (s) => s
      ? `<span class="severity-badge severity-${severityClassMap[s] || 'medium'}">${escape(capitalize(s))}</span>`
      : '';

    const gapTypeLabels = {
      no_solution: 'No solution exists',
      partial_solution: 'Partial solution',
      inadequate_solution: 'Inadequate solution',
      aspirational_only: 'Aspirational only'
    };
    const gapTypeBadge = (gt) => gt
      ? `<span class="sv-gap-badge sv-gap-${gt.replace(/_/g, '-')}">${escape(gapTypeLabels[gt] || gt)}</span>`
      : '';

    const evidenceQualityLabels = { confirmed: 'Confirmed', inferred: 'Inferred', aspirational: 'Aspirational' };
    const evidenceQualityBadge = (eq) => eq
      ? `<span class="sv-quality-badge sv-quality-${eq}">${escape(evidenceQualityLabels[eq] || eq)}</span>`
      : '';

    // v04.2.1: SV evidence container now uses Summary / Detailed / Sources
    // view-toggles (matching the other dimension tabs). Three independent
    // buckets get built and stored in container.dataset; the existing
    // .view-toggle-btn handler swaps innerHTML on click.
    //   - summarySections: chips, synthesis lead narrative, beachhead headline
    //   - detailedSections: value-prop table, source-material detail, full stakeholders
    //   - sourcesSections: per-row evidence refs, confidence justification, lit pubs
    const summarySections = [];
    const detailedSections = [];
    const sourcesSections = [];
    // Back-compat alias so the fallback (v04.1, no synthesis) Sections 3/3.5
    // still push to the Detailed bucket without further edits below.
    const sections = detailedSections;

    // Synthesis flow output (when present). Drives the SV-tab rebuild:
    //   * Lead block (svLeadNarrative + svUnmetNeedFraming) — primary content
    //   * New "Value Proposition vs. Incumbent Baseline" table — replaces
    //     Section 3 (Magnitude of Benefit) AND Section 3.5 (Evidence vs.
    //     Incumbent Baseline) from the v04.1 layout
    //   * Section 1 (The Unmet Need) collapses to a "Source-material detail"
    //     panel default-collapsed
    //   * Section 4 (Related Evidence) is removed entirely — synthesis
    //     subsumes its cross-references
    // When synthesis is absent, the v04.1 layout renders unchanged.
    const synthesis = this.data.synthesis;
    const synFmt = synthesis?.formatted || null;
    const hasSynthesisSV = !!(synFmt && (
      (synFmt.svLeadNarrative && synFmt.svLeadNarrative.trim())
      || (synFmt.svUnmetNeedFraming && synFmt.svUnmetNeedFraming.trim())
      || (Array.isArray(synFmt.valuePropRows) && synFmt.valuePropRows.length > 0)
    ));

    // Summary header
    const stakeholderCount = (sv.affected_stakeholders || []).length;
    const benefitCount = (sv.benefit_magnitude || []).length;
    const gapType = sv.unmet_need_assessment?.gap_type;
    const hasSummaryMetrics = sv.problem_severity || gapType || stakeholderCount > 0 || benefitCount > 0;
    if (hasSummaryMetrics) {
      summarySections.push(`
        <div class="sv-summary-header">
          ${sv.problem_severity ? `<span class="metric-inline">Severity: ${severityBadge(sv.problem_severity)}</span>` : ''}
          ${gapType ? `<span class="metric-inline">Need gap: ${gapTypeBadge(gapType)}</span>` : ''}
          ${benefitCount > 0 ? `<span class="metric-inline">Quantified benefits: ${benefitCount}</span>` : ''}
          ${stakeholderCount > 0 ? `<span class="metric-inline">Stakeholders: ${stakeholderCount}</span>` : ''}
          ${hasSynthesisSV && synFmt.domain ? `<span class="metric-inline">Domain: ${escape(this.capitalize(synFmt.domain.replace('_', ' ')))}</span>` : ''}
        </div>
      `);
    }

    // SYNTHESIS LEAD BLOCK (replaces Sections 3 + 3.5 + Section 4; demotes Section 1)
    if (hasSynthesisSV) {
      const lead = synFmt.svLeadNarrative || '';
      const framing = synFmt.svUnmetNeedFraming || '';
      const rows = Array.isArray(synFmt.valuePropRows) ? synFmt.valuePropRows : [];
      const incumbentLabel = synFmt.incumbentLabel || 'current state of the art';
      const sourceLabel = synFmt.sourceLabel || 'Scientific literature & public registries';

      let leadHTML = `
        <div class="evidence-subsection" data-section="synthesis-lead">
          <h4>Solution Value Picture</h4>
          <div class="evidence-source-tag">Source: Unified Synthesis — ${escape(sourceLabel)}</div>
      `;
      if (lead) {
        leadHTML += `<div class="evidence-item sv-lead-narrative">${this.formatRationale(lead)}</div>`;
      }
      if (framing) {
        leadHTML += `<div class="evidence-item sv-unmet-need-framing"><strong>Unmet need:</strong> ${escape(framing)}</div>`;
      }
      leadHTML += '</div>';
      // v04.2.1: Lead narrative + unmet-need framing belong on the Summary tab
      // — that's the advisor's "what does this venture do?" quick read.
      summarySections.push(leadHTML);

      // Also push a compact beachhead card to Summary when available — it
      // answers "who feels this most?" without making the advisor switch tabs.
      const bch = sv.beachhead_customer || null;
      if (bch?.segment) {
        summarySections.push(`
          <div class="evidence-subsection" data-section="summary-beachhead">
            <h4>Who Feels It Most</h4>
            <div class="evidence-source-tag">Source: Company Analysis</div>
            <div class="sv-beachhead-card">
              <div class="sv-beachhead-header">
                <span class="sv-beachhead-label">Beachhead customer</span>
                ${evidenceQualityBadge(bch.evidence_quality)}
              </div>
              <div class="sv-beachhead-segment">${escape(bch.segment)}</div>
              ${bch.why_acute ? `<p class="sv-beachhead-why">${escape(bch.why_acute)}</p>` : ''}
            </div>
            <p class="sv-tab-pointer"><em>Full stakeholder list on the Detailed tab.</em></p>
          </div>
        `);
      }

      if (rows.length > 0) {
        let tableHTML = `
          <div class="evidence-subsection" data-section="value-prop-table">
            <h4>Value Proposition vs. ${escape(this.capitalize(incumbentLabel))}</h4>
            <div class="evidence-source-tag">Source: Unified Synthesis (company claims + literature evidence, reconciled)</div>
            <div class="sv-benefit-table-wrap">
              <table class="sv-benefit-table sv-value-prop-table">
                <thead>
                  <tr>
                    <th>Dimension</th>
                    <th>Venture Claim</th>
                    <th>Incumbent Baseline</th>
                    <th>Improvement</th>
                    <th>Evidence</th>
                    <th>Strength</th>
                  </tr>
                </thead>
                <tbody>
                  ${rows.map(r => {
                    const evidenceBadges = (r.supporting_evidence || []).slice(0, 3).map(e => {
                      const lbl = e.source === 'both' ? 'Both' : (e.source === 'literature' ? 'Lit' : 'Company');
                      const refIsUrl = typeof e.ref === 'string' && /^https?:\/\//.test(e.ref);
                      const refHtml = refIsUrl ? `<a href="${this.escape(e.ref)}" target="_blank" rel="noopener" title="${this.escape(e.note || '')}">${lbl}</a>` : `<span title="${this.escape((e.note || '') + (e.ref ? ' — ' + e.ref : ''))}">${lbl}</span>`;
                      return `<span class="sv-evidence-pill sv-evidence-${this.escape(e.source || 'company')}">${refHtml}</span>`;
                    }).join(' ');
                    return `
                      <tr class="sv-benefit-row sv-quality-row-${this.escape(r.strength || 'aspirational').replace('partial','inferred').replace('confirmed','confirmed').replace('aspirational','aspirational')}">
                        <td>${escape(r.dimension || '')}</td>
                        <td>${escape(r.venture_claim || '')}</td>
                        <td>${escape(r.incumbent_baseline || '')}</td>
                        <td>${escape(r.improvement_claimed || '')}</td>
                        <td>${evidenceBadges || '<span class="sv-evidence-pill">—</span>'}</td>
                        <td>${evidenceQualityBadge(r.strength === 'partial' ? 'inferred' : r.strength)}</td>
                      </tr>
                      ${r.reconciled_summary ? `
                        <tr class="sv-value-prop-reconciliation">
                          <td colspan="6"><em>${escape(r.reconciled_summary)}</em></td>
                        </tr>
                      ` : ''}
                    `;
                  }).join('')}
                </tbody>
              </table>
            </div>
            ${synFmt.svConfidenceJustification ? `<p class="sv-evidence-caveat"><em>Confidence: ${escape(synFmt.svConfidence || 'Medium')} — ${escape(synFmt.svConfidenceJustification)}</em></p>` : ''}
          </div>
        `;
        sections.push(tableHTML);
      }
    }

    // SECTION 1: The Unmet Need
    // When synthesis is present, Section 1 demotes to "Source-material detail"
    // and starts collapsed — synthesis owns the primary unmet-need framing.
    if (company) {
      const hasUnmetNeed = sv.problem_statement || sv.problem_severity || gapType || (sv.status_quo_limitations || []).length > 0;
      if (hasUnmetNeed) {
        const una = sv.unmet_need_assessment || {};
        const limitations = sv.status_quo_limitations || [];
        const impacts = sv.non_financial_impact || [];
        const s1Title = hasSynthesisSV ? 'Source-material detail' : 'The Unmet Need';
        const s1Collapsed = hasSynthesisSV ? ' sv-collapsed-default' : '';
        let s1 = `
          <div class="evidence-subsection${s1Collapsed}" data-section="unmet-need">
            <h4>${s1Title}</h4>
            <div class="evidence-source-tag">Source: Company Analysis</div>
            ${sv.problem_statement ? `<div class="evidence-item"><strong>Problem:</strong> ${escape(sv.problem_statement)}</div>` : ''}
            ${sv.problem_severity_justification ? `<div class="evidence-item"><strong>Severity${sv.problem_severity ? ` (${escape(capitalize(sv.problem_severity))})` : ''}:</strong> ${escape(sv.problem_severity_justification)}</div>` : ''}
        `;
        if (una.gap_type) {
          s1 += `
            <div class="evidence-item">
              <strong>Need is currently:</strong> ${gapTypeBadge(una.gap_type)}
              ${una.current_coverage ? `<p class="sv-sub">${escape(una.current_coverage)}</p>` : ''}
              ${una.evidence ? `<p class="sv-sub-evidence"><em>Evidence:</em> ${escape(una.evidence)}</p>` : ''}
            </div>
          `;
        }
        if (limitations.length > 0) {
          s1 += `
            <div class="evidence-item">
              <strong>Status quo limitations:</strong>
              <ul class="compact-list">${limitations.map(l => `<li>${escape(l)}</li>`).join('')}</ul>
            </div>
          `;
        }
        if (impacts.length > 0) {
          s1 += `
            <div class="evidence-item sv-non-financial">
              <details>
                <summary><strong>Additional non-financial impact</strong> (${impacts.length})</summary>
                <ul class="compact-list">${impacts.map(i => `<li><strong>${escape(i.dimension || '')}:</strong> ${escape(i.description || '')}</li>`).join('')}</ul>
              </details>
            </div>
          `;
        }
        s1 += '</div>';
        sections.push(s1);
      }
    }

    // SECTION 2: Who Feels It Most
    if (company) {
      const beachhead = sv.beachhead_customer || null;
      const stakeholders = (sv.affected_stakeholders || []).slice();
      const hasNewStakeholderShape = stakeholders.length > 0 && stakeholders.some(s => 'pain_severity' in s || 'is_beachhead' in s);
      if (beachhead?.segment || stakeholders.length > 0) {
        let s2 = `
          <div class="evidence-subsection" data-section="who-feels-it">
            <h4>Who Feels It Most</h4>
            <div class="evidence-source-tag">Source: Company Analysis</div>
        `;
        if (beachhead?.segment) {
          s2 += `
            <div class="sv-beachhead-card">
              <div class="sv-beachhead-header">
                <span class="sv-beachhead-label">Beachhead customer</span>
                ${evidenceQualityBadge(beachhead.evidence_quality)}
              </div>
              <div class="sv-beachhead-segment">${escape(beachhead.segment)}</div>
              ${beachhead.why_acute ? `<p class="sv-beachhead-why">${escape(beachhead.why_acute)}</p>` : ''}
            </div>
          `;
        }
        if (stakeholders.length > 0) {
          if (hasNewStakeholderShape) {
            const sevOrder = { critical: 0, high: 1, moderate: 2, low: 3 };
            const others = stakeholders
              .filter(s => !s.is_beachhead)
              .sort((a, b) => (sevOrder[a.pain_severity] ?? 4) - (sevOrder[b.pain_severity] ?? 4));
            const top = others.slice(0, 2);
            const rest = others.slice(2);
            if (top.length > 0 || rest.length > 0) {
              s2 += `<div class="evidence-item"><strong>Other affected stakeholders:</strong>`;
              s2 += `<ul class="compact-list sv-stakeholder-list">${top.map(s => `<li>${severityBadge(s.pain_severity)} <strong>${escape(s.stakeholder || '')}:</strong> ${escape(s.how_affected || '')}</li>`).join('')}</ul>`;
              if (rest.length > 0) {
                s2 += `
                  <details class="sv-stakeholder-more">
                    <summary>Show ${rest.length} more</summary>
                    <ul class="compact-list sv-stakeholder-list">${rest.map(s => `<li>${severityBadge(s.pain_severity)} <strong>${escape(s.stakeholder || '')}:</strong> ${escape(s.how_affected || '')}</li>`).join('')}</ul>
                  </details>
                `;
              }
              s2 += `</div>`;
            }
          } else {
            // Fallback for old cached data without pain_severity / is_beachhead
            s2 += `
              <div class="evidence-item">
                <strong>Affected stakeholders:</strong>
                <ul class="compact-list">${stakeholders.map(s => `<li><strong>${escape(s.stakeholder || '')}:</strong> ${escape(s.how_affected || '')}</li>`).join('')}</ul>
              </div>
            `;
          }
        }
        s2 += '</div>';
        sections.push(s2);
      }
    }

    // SECTION 3: Magnitude of Benefit vs. Alternatives
    // SKIPPED when synthesis is present — the synthesis value-prop table
    // above takes ownership of this dimension fully.
    if (company && !hasSynthesisSV) {
      const benefits = sv.benefit_magnitude || [];
      const hasBenefitField = Array.isArray(sv.benefit_magnitude);
      if (sv.value_proposition || benefits.length > 0 || hasBenefitField) {
        let s3 = `
          <div class="evidence-subsection" data-section="magnitude">
            <h4>Magnitude of Benefit vs. Alternatives</h4>
            <div class="evidence-source-tag">Source: Company Analysis</div>
        `;
        if (sv.value_proposition) {
          s3 += `<div class="evidence-item"><strong>Value proposition:</strong> ${escape(sv.value_proposition)}</div>`;
        }
        if (benefits.length > 0) {
          s3 += `
            <div class="evidence-item">
              <strong>Quantified comparisons:</strong>
              <div class="sv-benefit-table-wrap">
                <table class="sv-benefit-table">
                  <thead>
                    <tr><th>Metric</th><th>vs. Baseline</th><th>Improvement</th><th>Source</th><th>Quality</th></tr>
                  </thead>
                  <tbody>
                    ${benefits.map(b => `
                      <tr class="sv-benefit-row sv-quality-row-${b.evidence_quality || 'unknown'}">
                        <td>${escape(b.metric || '')}</td>
                        <td>${escape(b.baseline || '')}</td>
                        <td>${escape(b.delta || '')}</td>
                        <td>${escape(b.evidence_source || '')}</td>
                        <td>${evidenceQualityBadge(b.evidence_quality)}</td>
                      </tr>
                    `).join('')}
                  </tbody>
                </table>
              </div>
            </div>
          `;
        } else if (hasBenefitField) {
          s3 += `<div class="evidence-item sv-empty-note">No quantified comparisons surfaced from source materials. Score conservatively per rubric.</div>`;
        }
        s3 += '</div>';
        sections.push(s3);
      }
    }

    // SECTION 3.5: Evidence vs. Incumbent Baseline
    // SKIPPED when synthesis is present — the synthesis value-prop table
    // owns this content fully (merged with the Magnitude of Benefit data).
    // Fed by the Scientific Evidence (Literature Review) flow. Surfaces:
    //   * The incumbent / status-quo approach the candidate is being compared against
    //   * Known limitations of that incumbent (from the published literature)
    //   * TPP-style comparison rows: each "inherent advantage" claim with its
    //     comparison baseline and evidence_quality (confirmed / inferred / aspirational)
    //   * Pathway maturity (whether a more advanced analog already exists)
    // This section is decorative/contextual. The Solution Value score is still
    // human-entered. For pharma ventures the incumbent is the standard of care;
    // for non-pharma ventures the same panel surfaces the "dominant approach /
    // performance frontier" with the same structure. Default-collapsed so the
    // SV tab does not grow visibly longer when literature data is present.
    const literature = this.data.literature;
    const litF = literature?.formatted;
    if (!hasSynthesisSV && litF && (litF.statusQuoSummary?.dominantApproach || litF.incumbentRows?.length > 0 || litF.incumbentLimitations?.length > 0)) {
      const sq = litF.statusQuoSummary || {};
      const limitations = (litF.incumbentLimitations || []).slice(0, 5);
      const rows = (litF.incumbentRows || []).slice(0, 5);
      const restRows = (litF.incumbentRows || []).slice(5);
      const pathway = litF.pathwayMaturity || {};

      const incumbentLabel = sq.dominantApproach || 'Not characterized';
      const advCount = litF.counts?.inherentAdvantages || rows.length;
      const headerSummary = `<span class="sv-header-summary">Incumbent: ${escape(incumbentLabel)}${advCount ? ` · ${advCount} inherent advantage${advCount === 1 ? '' : 's'}` : ''}${litF.confidence ? ` · confidence: ${escape(litF.confidence)}` : ''}</span>`;

      const mechanism = sq.mechanism || '';
      const mechShort = mechanism.length > 200 ? mechanism.slice(0, 200) + '…' : mechanism;
      const mechFull = mechanism.length > 200 ? mechanism : '';

      let s35 = `
        <div class="evidence-subsection sv-collapsed-default" data-section="incumbent-baseline">
          <h4>Evidence vs. Incumbent Baseline ${headerSummary}</h4>
          <div class="evidence-source-tag">Source: Scientific Evidence Analysis (PubMed / ClinicalTrials.gov)</div>
      `;
      if (incumbentLabel || mechanism) {
        s35 += `
          <div class="evidence-item">
            <strong>Incumbent baseline:</strong> ${escape(incumbentLabel)}
            ${mechShort ? `<p class="sv-sub">${escape(mechShort)}${mechFull ? ` <details class="sv-readmore"><summary>Read more</summary><p>${escape(mechFull)}</p></details>` : ''}</p>` : ''}
          </div>
        `;
      }
      if (limitations.length > 0) {
        s35 += `
          <div class="evidence-item">
            <strong>Known limitations of incumbent:</strong>
            <ul class="compact-list">${limitations.map(l => `<li>${escape(l)}</li>`).join('')}</ul>
          </div>
        `;
      }
      if (rows.length > 0) {
        s35 += `
          <div class="evidence-item">
            <strong>Inherent advantages claimed (vs. incumbent baseline):</strong>
            <div class="sv-benefit-table-wrap">
              <table class="sv-benefit-table sv-tpp-table">
                <thead>
                  <tr><th>Dimension</th><th>Claim</th><th>Comparison Baseline</th><th>Evidence Quality</th></tr>
                </thead>
                <tbody>
                  ${rows.map(r => `
                    <tr class="sv-benefit-row sv-quality-row-${r.evidenceQuality || 'unknown'}">
                      <td>${escape(r.dimension)}</td>
                      <td>${escape(r.claim)}</td>
                      <td>${escape(r.baseline)}</td>
                      <td>${evidenceQualityBadge(r.evidenceQuality)}</td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
            ${restRows.length > 0 ? `
              <details class="sv-readmore">
                <summary>Show ${restRows.length} more</summary>
                <div class="sv-benefit-table-wrap">
                  <table class="sv-benefit-table sv-tpp-table">
                    <tbody>
                      ${restRows.map(r => `
                        <tr class="sv-benefit-row sv-quality-row-${r.evidenceQuality || 'unknown'}">
                          <td>${escape(r.dimension)}</td>
                          <td>${escape(r.claim)}</td>
                          <td>${escape(r.baseline)}</td>
                          <td>${evidenceQualityBadge(r.evidenceQuality)}</td>
                        </tr>
                      `).join('')}
                    </tbody>
                  </table>
                </div>
              </details>
            ` : ''}
          </div>
        `;
      }
      if (pathway.moreAdvancedExists && pathway.analogName) {
        s35 += `
          <div class="evidence-item sv-pathway-callout">
            <span class="sv-pathway-badge">More advanced analog exists</span>
            <strong>${escape(pathway.analogName)}</strong>
            ${pathway.analogProgress ? `<p class="sv-sub">${escape(pathway.analogProgress)}</p>` : ''}
          </div>
        `;
      }
      if (litF.confidenceJustification) {
        s35 += `<p class="sv-evidence-caveat"><em>Confidence: ${escape(litF.confidence || 'Medium')} — ${escape(litF.confidenceJustification)}</em></p>`;
      }
      s35 += '</div>';
      sections.push(s35);
    }

    // SECTION 4: Related Evidence (collapsed by default)
    // SKIPPED when synthesis is present — the synthesis narrative subsumes
    // useful cross-references and the market/competitive gaps are already on
    // their own tabs.
    if (!hasSynthesisSV && (market || competitive)) {
      const mFormatted = market?.formatted || {};
      const mAnalysis = market?.analysis?.market_analysis || {};
      const unmetNeeds = (mFormatted.unmetNeeds || mAnalysis.unmet_needs || []).slice(0, 3);
      const mDifferentiation = mFormatted.differentiation || '';
      const mProblemStatement = mFormatted.problemStatement || '';

      const cAnalysis = competitive?.analysis || {};
      const cAssessment = competitive?.assessment || {};
      const cFormatted = competitive?.formatted || {};
      const marketGaps = (cAnalysis.market_gaps || cFormatted.marketGaps || []).slice(0, 3);
      const diffOpportunities = (cAssessment.differentiation_opportunities || cFormatted.opportunities || []).slice(0, 3);

      const hasMarket = unmetNeeds.length > 0 || mDifferentiation || mProblemStatement;
      const hasComp = marketGaps.length > 0 || diffOpportunities.length > 0;

      if (hasMarket || hasComp) {
        let s4 = `
          <div class="evidence-subsection sv-collapsed-default" data-section="related">
            <h4>Related Evidence</h4>
        `;
        if (hasMarket) {
          s4 += `
            <details class="sv-related-card">
              <summary><strong>Market needs</strong> &mdash; from Market Analysis</summary>
              <ul class="compact-list">
                ${mProblemStatement ? `<li><strong>Problem framing:</strong> ${escape(mProblemStatement)}</li>` : ''}
                ${unmetNeeds.map(n => `<li><strong>Unmet need:</strong> ${escape(typeof n === 'string' ? n : JSON.stringify(n))}</li>`).join('')}
                ${mDifferentiation ? `<li><strong>Differentiation:</strong> ${escape(mDifferentiation)}</li>` : ''}
              </ul>
              <p class="sv-related-link"><a href="#" data-tab-target="market">See Market tab for full analysis &rarr;</a></p>
            </details>
          `;
        }
        if (hasComp) {
          s4 += `
            <details class="sv-related-card">
              <summary><strong>Competitive gaps</strong> &mdash; from Competitive Analysis</summary>
              <ul class="compact-list">
                ${marketGaps.map(g => `<li><strong>Gap:</strong> ${escape(typeof g === 'string' ? g : JSON.stringify(g))}</li>`).join('')}
                ${diffOpportunities.map(o => `<li><strong>Opportunity:</strong> ${escape(typeof o === 'string' ? o : JSON.stringify(o))}</li>`).join('')}
              </ul>
              <p class="sv-related-link"><a href="#" data-tab-target="competitive">See Competitive tab for full analysis &rarr;</a></p>
            </details>
          `;
        }
        s4 += '</div>';
        // v04.2.1: Related Evidence (market gaps + competitive gaps) is
        // cross-references to other tabs — belongs on the Sources tab.
        sourcesSections.push(s4);
      }
    }

    // -------------------------------------------------------------------
    // SOURCES TAB content (synthesis-mode references list + confidence)
    // -------------------------------------------------------------------
    // Build a deduped list of evidence references from the synthesis
    // value_prop_rows + literature flow's key publications. Only renders
    // when there are actual refs (no empty section).
    if (hasSynthesisSV) {
      const refs = [];
      const seen = new Set();
      const pushRef = (label, url) => {
        if (!url) return;
        const key = url.toLowerCase();
        if (seen.has(key)) return;
        seen.add(key);
        refs.push({ label: label || url, url });
      };
      for (const r of (synFmt.valuePropRows || [])) {
        for (const e of (r.supporting_evidence || [])) {
          if (e && e.ref && /^https?:\/\//.test(e.ref)) {
            pushRef(`${r.dimension || 'Evidence'} — ${e.source || 'evidence'}${e.note ? ` (${e.note})` : ''}`, e.ref);
          }
        }
      }
      const litF = this.data.literature?.formatted;
      for (const pub of (litF?.keyPublications || [])) {
        const url = pub.link || (pub.doi ? `https://doi.org/${pub.doi}` : null);
        if (url) {
          const label = pub.title
            ? `${this.truncate(pub.title, 90)}${pub.year ? ` (${pub.year})` : ''}`
            : url;
          pushRef(label, url);
        }
      }
      for (const t of [...(litF?.trialCompetitors || []), ...(litF?.discontinuedSignals || [])]) {
        if (t.link) {
          pushRef(`${t.trialId || 'Trial'}${t.phase ? ` · ${t.phase}` : ''}${t.status ? ` · ${t.status}` : ''}`, t.link);
        }
      }
      if (refs.length > 0) {
        sourcesSections.push(`
          <div class="evidence-subsection" data-section="sources-refs">
            <h4>Supporting Evidence References</h4>
            <p class="evidence-source-tag">Deduped across synthesis value-prop rows + Scientific Evidence publications/trials</p>
            <ul class="source-list">
              ${refs.map(r => `<li><a href="${escape(r.url)}" target="_blank" rel="noopener">${escape(r.label)}</a></li>`).join('')}
            </ul>
          </div>
        `);
      }
      if (synFmt.svConfidenceJustification) {
        sourcesSections.push(`
          <div class="evidence-subsection" data-section="sources-confidence">
            <h4>Synthesis Confidence</h4>
            <p><strong>${escape(synFmt.svConfidence || 'Medium')}</strong></p>
            <p>${escape(synFmt.svConfidenceJustification)}</p>
          </div>
        `);
      }
    }

    // Render
    if (summarySections.length === 0 && detailedSections.length === 0 && sourcesSections.length === 0) {
      container.innerHTML = `
        <div class="evidence-pending-notice">
          <p>Evidence will populate as analyses complete. This section aggregates findings from the Company, Market, and Competitive analyses.</p>
        </div>
      `;
      container.dataset.summary = container.innerHTML;
      container.dataset.detailed = container.innerHTML;
      container.dataset.sources = container.innerHTML;
    } else {
      const pendingSources = [];
      if (!company) pendingSources.push('Company');
      if (!market) pendingSources.push('Market');
      if (!competitive) pendingSources.push('Competitive');
      if (!literature) pendingSources.push('Scientific Evidence');
      if (hasSynthesisSV === false && (this.data.synthesis === null || this.data.synthesis === undefined)) {
        pendingSources.push('Synthesis');
      }

      const pendingNotice = pendingSources.length > 0
        ? `<div class="evidence-partial-notice"><span class="notice-icon">&#9203;</span> Awaiting: ${pendingSources.join(', ')} analysis</div>`
        : '';

      // v04.2.1: Three independent HTML buckets so the view-toggles (Summary
      // / Detailed / Sources) can swap container.innerHTML between them.
      //
      // Fallback handling for the v04.1 layout (synthesis absent): all the
      // existing content gets bucketed into Detailed by default (because the
      // `sections` alias points there). Summary stays minimal (just the chips
      // header), Sources gets Section 4. That's intentional — without
      // synthesis there's no narrative lead to populate Summary with.
      const wrap = (items) => items.length > 0
        ? `<div class="evidence-content aggregated-evidence">${pendingNotice}${items.join('')}</div>`
        : `<div class="evidence-content aggregated-evidence">${pendingNotice}<p class="sv-tab-empty"><em>No content for this view. Try the other tabs above.</em></p></div>`;

      // When synthesis is absent the Summary tab needs *something* useful, so
      // surface a short orientation card pointing the advisor at the Detailed
      // tab (which has all the v04.1 layout content).
      const summaryItems = summarySections.slice();
      if (!hasSynthesisSV && summaryItems.length <= 1 && detailedSections.length > 0) {
        summaryItems.push(`
          <div class="evidence-subsection sv-summary-pointer">
            <p>Full source-extracted evidence is on the <strong>Detailed</strong> tab. Sources / cross-references on the <strong>Sources</strong> tab.</p>
          </div>
        `);
      }

      const summaryHTML  = wrap(summaryItems);
      const detailedHTML = wrap(detailedSections);
      const sourcesHTML  = wrap(sourcesSections);

      container.dataset.summary  = summaryHTML;
      container.dataset.detailed = detailedHTML;
      container.dataset.sources  = sourcesHTML;
      // Honor the user's currently-active SV view if they've already switched
      // tabs once; otherwise default to Summary on first render.
      const initialView = this.currentView?.solutionvalue || 'summary';
      container.innerHTML = container.dataset[initialView] || summaryHTML;

      // Wire the "See X tab" links in the legacy Section 4 (sourcesSections)
      // and any other dimension-tab pointers. Event delegation on the
      // container so the handler survives view-toggle innerHTML swaps.
      if (!container._svTabLinksWired) {
        container._svTabLinksWired = true;
        container.addEventListener('click', (e) => {
          const link = e.target.closest('[data-tab-target]');
          if (!link) return;
          e.preventDefault();
          const target = link.dataset.tabTarget;
          if (window.app?.tabManager?.activateTab) {
            window.app.tabManager.activateTab(target);
          } else {
            const btn = document.querySelector(`.tab-button[data-tab="${target}"]`);
            if (btn) btn.click();
          }
        });
      }
    }

    // Update the user score badge if score is submitted
    const badgeEl = document.getElementById('solutionvalue-user-score-badge');
    if (badgeEl && this.userScores.solutionvalue.submitted) {
      badgeEl.textContent = this.userScores.solutionvalue.score;
    }
  }

  getExportData() {
    const getDimensionExport = (dim) => {
      const userScore = this.userScores[dim];
      return {
        ...(this.data[dim] || {}),
        aiScore: this.aiScores[dim],
        userScore: userScore.submitted ? userScore.score : null,
        userJustification: (userScore.submitted && userScore.justification) ? userScore.justification : null,
        isSubmitted: userScore.submitted
      };
    };

    // Get final recommendation and venture-level decisions from state manager
    const sm = window.app?.stateManager;
    const finalRecommendation = sm?.getFinalRecommendation() || '';
    const ventureDecisions = sm ? {
      trackAssignment: sm.getTrackAssignment(),
      pathway:         sm.getPathway(),
      dualUse:         sm.getDualUse(),
      ecosystemNotes:  sm.getEcosystemNotes(),
      // v3.5
      institution:           sm.getInstitution(),
      verdict:               sm.getVerdict(),
      technologyDescription: sm.getTechnologyDescription(),
      technologyDomain:      sm.getTechnologyDomain()
    } : null;

    return {
      company: this.data.company,
      team: getDimensionExport('team'),
      funding: getDimensionExport('funding'),
      competitive: getDimensionExport('competitive'),
      market: getDimensionExport('market'),
      iprisk: getDimensionExport('iprisk'),
      solutionvalue: getDimensionExport('solutionvalue'),
      finalRecommendation: finalRecommendation || null,
      ventureDecisions
    };
  }

  // ========== UTILITY METHODS ==========
  
  escape(str) {
    if (!str) return '';
    // Comprehensive HTML entity escaping to prevent XSS
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#x27;')
      .replace(/\//g, '&#x2F;')
      .replace(/`/g, '&#x60;');
  }

  // Format rationale text - handle bullets and newlines
  formatRationale(text) {
    if (!text) return 'No rationale provided.';
    // Convert markdown-style bullets and newlines to HTML
    let formatted = this.escape(text);
    // Handle bullet points (- or •)
    formatted = formatted.replace(/^[-•]\s*/gm, '</p><p>• ');
    // Handle numbered lists
    formatted = formatted.replace(/^\d+\.\s*/gm, '</p><p>• ');
    // Handle newlines
    formatted = formatted.replace(/\\n/g, '</p><p>');
    formatted = formatted.replace(/\n/g, '</p><p>');
    // Clean up empty paragraphs
    formatted = formatted.replace(/<p><\/p>/g, '');
    formatted = formatted.replace(/^<\/p>/, '');
    return `<p>${formatted}</p>`.replace(/<p>\s*<\/p>/g, '');
  }

  capitalize(str) {
    if (!str) return '';
    return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
  }

  /**
   * Clean source URLs by removing citation reference suffixes like [%5E26563.0.0] or [^26563.0.0]
   * These appear at the end of some source URLs from the API
   * @param {string} url - The URL to clean
   * @returns {string} - Cleaned URL
   */
  cleanSourceUrl(url) {
    if (!url) return '';
    // Remove patterns like [%5E26563.0.0] or [^26563.0.0] or __[%5E8551.0.0]__ from end of URL
    // %5E is URL-encoded ^
    return String(url)
      .replace(/_*\[%5E[\d.]+\]_*$/i, '')
      .replace(/_*\[\^[\d.]+\]_*$/i, '')
      .replace(/\[%5E[\d.]+\]$/i, '')
      .replace(/\[\^[\d.]+\]$/i, '');
  }

  /**
   * Fix Google Patents links by stripping hyphens from patent IDs in URLs.
   * e.g., https://patents.google.com/patent/US12230784-B2 → .../US12230784B2
   */
  cleanPatentLink(url) {
    if (!url) return '';
    const cleaned = this.cleanSourceUrl(url);
    // Strip hyphens only from the patent ID portion of Google Patents URLs
    return cleaned.replace(/(patents\.google\.com\/patent\/)([A-Z0-9-]+)/i, (match, prefix, patentId) => {
      return prefix + patentId.replace(/-/g, '');
    });
  }

  displayUrl(url) {
    if (!url) return '';
    const cleanUrl = this.cleanSourceUrl(url);
    try {
      const parsed = new URL(cleanUrl);
      return parsed.hostname.replace('www.', '');
    } catch {
      return cleanUrl;
    }
  }

  truncateUrl(url) {
    if (!url) return '';
    const cleanUrl = this.cleanSourceUrl(url);
    try {
      const parsed = new URL(cleanUrl);
      const path = parsed.pathname.length > 30 ? parsed.pathname.slice(0, 30) + '...' : parsed.pathname;
      return parsed.hostname.replace('www.', '') + path;
    } catch {
      return cleanUrl.length > 50 ? cleanUrl.slice(0, 50) + '...' : cleanUrl;
    }
  }

  truncate(str, maxLen) {
    if (!str) return '';
    return str.length > maxLen ? str.slice(0, maxLen) + '...' : str;
  }

  formatDate(dateStr) {
    if (!dateStr) return '-';
    // Handle formats like "2024-02-28" or "2025-04"
    const parts = dateStr.split('-');
    if (parts.length >= 2) {
      const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      const month = months[parseInt(parts[1]) - 1] || parts[1];
      return `${month} ${parts[0]}`;
    }
    return dateStr;
  }

  formatCurrency(value) {
    if (!value && value !== 0) return '-';
    const num = typeof value === 'number' ? value : parseFloat(value);
    if (isNaN(num)) return value;
    
    if (num >= 1e12) return '$' + (num / 1e12).toFixed(1) + 'T';
    if (num >= 1e9) return '$' + (num / 1e9).toFixed(1) + 'B';
    if (num >= 1e6) return '$' + (num / 1e6).toFixed(1) + 'M';
    if (num >= 1e3) return '$' + (num / 1e3).toFixed(0) + 'K';
    return '$' + num.toFixed(0);
  }

  formatCurrencyWithCommas(valueInMillions, includeDecimals = true) {
    if (!valueInMillions && valueInMillions !== 0) return '-';
    const num = typeof valueInMillions === 'number' ? valueInMillions : parseFloat(valueInMillions);
    if (isNaN(num)) return String(valueInMillions);
    
    // If it's less than 1 million dollars (value < 1 when expressed in millions)
    // Display as actual dollar amount with commas
    if (num < 1 && num > 0) {
      const dollars = Math.round(num * 1000000);
      return '$' + dollars.toLocaleString('en-US');
    }
    
    // For values >= 1000 million (i.e., >= 1 billion)
    if (num >= 1000) {
      // Billions - remove trailing .0 if whole number
      const billionValue = num / 1000;
      if (billionValue % 1 === 0) {
        return '$' + billionValue.toFixed(0) + 'B';
      }
      return '$' + billionValue.toFixed(1) + 'B';
    } else if (num >= 1) {
      // Millions - remove trailing .0 if whole number
      if (num % 1 === 0) {
        return '$' + num.toFixed(0) + 'M';
      }
      const formatted = includeDecimals ? num.toFixed(1) : num.toFixed(0);
      return '$' + formatted + 'M';
    } else if (num === 0) {
      return '$0';
    }
    
    // Fallback for any edge cases
    return '$' + num.toFixed(1) + 'M';
  }

  /**
   * Parse a funding amount from various formats and return value in millions
   * Handles: numbers (assumed millions), strings like "$10M", "10 million", "1.5B", "$1,500,000"
   * @param {number|string} amount - The amount to parse
   * @returns {number|null} - Amount in millions, or null if unparseable
   */
  parseFundingAmount(amount) {
    if (amount === null || amount === undefined || amount === '' || 
        amount === 'undisclosed' || amount === 'Undisclosed' || amount === 'Unknown') {
      return null;
    }
    
    // If it's already a number, assume it's in millions (API convention)
    if (typeof amount === 'number') {
      return amount;
    }
    
    const amountStr = String(amount).toLowerCase().trim();
    
    // Extract numeric value
    const numMatch = amountStr.match(/[\d,.]+/);
    if (!numMatch) return null;
    
    const num = parseFloat(numMatch[0].replace(/,/g, ''));
    if (isNaN(num)) return null;
    
    // Determine the unit and convert to millions
    if (amountStr.includes('billion') || amountStr.includes('bn') || 
        (amountStr.includes('b') && !amountStr.includes('m'))) {
      return num * 1000; // Convert billions to millions
    } else if (amountStr.includes('million') || amountStr.includes('mn') || amountStr.includes('m')) {
      return num; // Already in millions
    } else if (amountStr.includes('thousand') || amountStr.includes('k')) {
      return num / 1000; // Convert thousands to millions
    } else if (num >= 1000000) {
      // Large number without unit - assume raw dollars
      return num / 1000000;
    } else if (num >= 1000) {
      // Could be thousands of dollars or raw millions - context dependent
      // If it has $ sign and is over 1000, likely raw dollars in thousands format
      if (amountStr.includes('$')) {
        return num / 1000000; // Treat as raw dollars
      }
      // Otherwise assume it's already in millions (API data)
      return num;
    } else {
      // Small number - assume already in millions
      return num;
    }
  }

  formatIntensity(value) {
    if (!value && value !== 0) return '-';
    const v = String(value).toLowerCase();
    if (v === 'high') return 'High';
    if (v === 'medium' || v === 'moderate') return 'Moderate';
    if (v === 'low') return 'Low';
    if (typeof value === 'number') {
      if (value <= 2) return 'Very Low';
      if (value <= 4) return 'Low';
      if (value <= 6) return 'Moderate';
      if (value <= 8) return 'High';
      return 'Very High';
    }
    return this.capitalize(value);
  }
}

window.AssessmentView = AssessmentView;
