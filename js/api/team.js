// js/api/team.js - Team capability analysis API (Proxied)
// Now uses company description as input instead of website URL

const TeamAPI = {
  config: {
    timeout: 600000 // 10 minutes
  },

  /**
   * Analyze founding team using company description
   * 
   * @param {string} companyDescription - Short company description JSON from CompanyAPI
   * @param {AbortSignal} abortSignal - Optional abort signal
   */
  async analyze(companyDescription, abortSignal = null) {
    if (!companyDescription || typeof companyDescription !== 'string') {
      throw new Error('Company description is required for team analysis');
    }

    // Ensure it's valid JSON or at least substantial text
    if (companyDescription.trim().length < 20) {
      throw new Error('Company description too short for team analysis');
    }

    const payload = {
      'user_id': StackProxy.buildUserId('team'),
      'in-0': companyDescription.trim()
    };

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.config.timeout);

    if (abortSignal) {
      abortSignal.addEventListener('abort', () => controller.abort());
    }

    try {
      // Use proxy to call team workflow
      const data = await window.StackProxy.call('team', payload, controller.signal);
      
      clearTimeout(timeoutId);
      return this.processResponse(data);
      
    } catch (error) {
      clearTimeout(timeoutId);

      if (error.name === 'AbortError') {
        throw new Error('Team analysis timeout or cancelled');
      }

      throw error;
    }
  },

  /**
   * Process API response (out-0 = team roster, out-1 = team score)
   */
  processResponse(data) {
    const validation = Validators.validateApiResponse(data, ['out-0', 'out-1']);
    if (!validation.valid) {
      throw new Error(validation.error);
    }

    const teamRaw = data.outputs['out-0'];
    const scoringRaw = data.outputs['out-1'];

    const team = this.parseOutput(teamRaw, 'team roster');
    const scoring = this.parseOutput(scoringRaw, 'team scoring');

    if (!team || typeof team !== 'object') {
      throw new Error('Invalid team roster format');
    }

    if (!scoring || typeof scoring !== 'object') {
      throw new Error('Invalid team scoring format');
    }

    this.ensureRequiredFields(team, scoring);

    const score = this.normalizeScore(scoring.score);
    if (score === null) {
      throw new Error(`Invalid team score: ${scoring.score}`);
    }

    const result = {
      team,
      scoring: {
        ...scoring,
        score
      },
      score,
      rubricDescription: scoring.rubric_match_explanation || null,
      formatted: this.formatForDisplay(team, scoring, score)
    };

    return result;
  },

  /**
   * Parse JSON safely, handling wrapped text outputs
   */
  parseOutput(rawOutput, label) {
    if (!rawOutput) return null;

    if (typeof rawOutput === 'object') {
      if (rawOutput.text && typeof rawOutput.text === 'string') {
        return this.parseOutput(rawOutput.text, label);
      }
      return rawOutput;
    }

    if (typeof rawOutput !== 'string') {
      return null;
    }

    let trimmed = rawOutput.trim();
    if (!trimmed) return null;

    // Clean up markdown code blocks
    if (trimmed.startsWith('```json')) {
      trimmed = trimmed.slice(7);
    }
    if (trimmed.startsWith('```')) {
      trimmed = trimmed.slice(3);
    }
    if (trimmed.endsWith('```')) {
      trimmed = trimmed.slice(0, -3);
    }
    trimmed = trimmed.trim();

    const tryParse = (text) => {
      try {
        return JSON.parse(text);
      } catch {
        return null;
      }
    };

    let parsed = tryParse(trimmed);
    if (parsed) return parsed;

    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start !== -1 && end !== -1 && end > start) {
      parsed = tryParse(trimmed.slice(start, end + 1));
      if (parsed) return parsed;
    }

    console.error(`Failed to parse ${label}:`, trimmed);
    return null;
  },

  /**
   * Normalize score to integer 1-9
   */
  normalizeScore(rawScore) {
    if (typeof rawScore === 'number' && Number.isInteger(rawScore)) {
      return rawScore >= 1 && rawScore <= 9 ? rawScore : null;
    }

    if (typeof rawScore === 'string') {
      const match = rawScore.match(/\d+/);
      if (match) {
        const parsed = parseInt(match[0], 10);
        if (parsed >= 1 && parsed <= 9) {
          return parsed;
        }
      }
    }

    return null;
  },

  /**
   * Ensure team and scoring structures have required defaults (v3 schema)
   */
  ensureRequiredFields(team, scoring) {
    team.team_members = Array.isArray(team.team_members) ? team.team_members : [];
    team.trusted_sources = Array.isArray(team.trusted_sources) ? team.trusted_sources : [];

    // Confidence fields at top level of team data
    if (!team.data_confidence) {
      team.data_confidence = ConfidenceUtil.extractFromResponse(team, scoring);
    }
    if (!team.confidence_justification) {
      team.confidence_justification = ConfidenceUtil.extractJustificationFromResponse(team, scoring);
    }

    team.team_members = team.team_members.map(member => ({
      name: member?.name || 'Unknown',
      role_at_venture: member?.role_at_venture || 'Team Member',
      work_history: Array.isArray(member?.work_history) ? member.work_history : [],
      education_history: Array.isArray(member?.education_history) ? member.education_history : [],
      papers_publications: Array.isArray(member?.papers_publications) ? member.papers_publications : [],
      commercialization_experience: Array.isArray(member?.commercialization_experience)
        ? member.commercialization_experience
        : [],
      awards_recognition: Array.isArray(member?.awards_recognition) ? member.awards_recognition : []
    }));

    // v3: evaluation_steps in scoring
    if (!scoring.evaluation_steps || typeof scoring.evaluation_steps !== 'object') {
      scoring.evaluation_steps = {
        credibility_baseline: '',
        baseline_range: 'moderate_4_6',
        commercialization_signals_found: [],
        commercialization_adjustment: '',
        team_composition_check: ''
      };
    }
    if (!Array.isArray(scoring.evaluation_steps.commercialization_signals_found)) {
      scoring.evaluation_steps.commercialization_signals_found = [];
    }

    scoring.key_strengths = Array.isArray(scoring.key_strengths) ? scoring.key_strengths : [];
    scoring.key_gaps = Array.isArray(scoring.key_gaps) ? scoring.key_gaps : [];
    // v3: team_composition has total_members, technical_experts, business_experts (no domain_experts)
    scoring.team_composition = scoring.team_composition || {};
    scoring.score_justification = scoring.score_justification || '';
    scoring.data_confidence_impact = scoring.data_confidence_impact || '';
  },

  /**
   * Build formatted display payload (v3 schema)
   */
  formatForDisplay(team, scoring, score) {
    return {
      score,
      ventureName: team.venture_name || '-',
      justification: scoring.score_justification || '',
      confidence: team.data_confidence,
      confidenceJustification: team.confidence_justification || '',
      teamComposition: {
        total: scoring.team_composition.total_members || team.team_members.length,
        technical: scoring.team_composition.technical_experts || 0,
        business: scoring.team_composition.business_experts || 0
      },
      strengths: scoring.key_strengths,
      gaps: scoring.key_gaps,
      evaluationSteps: scoring.evaluation_steps || {},
      dataConfidenceImpact: scoring.data_confidence_impact || '',
      rubric: scoring.rubric_match_explanation || '',
      members: team.team_members,
      sources: team.trusted_sources
    };
  },

  /**
   * Provide rubric description for summary card
   */
  getRubricDescription(score) {
    const rubric = {
      1: 'No credible signals of research quality or translation interest. Limited track record; no relevant highlights.',
      2: 'Limited credibility signals and no translation indicators. Early work exists but little evidence of momentum or fit.',
      3: 'Some credible academic signals (for stage) but translation orientation unclear. Limited evidence of impact or applied interest.',
      4: 'Credible academic profile relative to career stage. Translation orientation unclear; no clear applied/commercial signals.',
      5: 'Solid credibility for stage with at least one applied/industry or tech-transfer indicator. Translation interest plausible but unproven.',
      6: 'Strong credibility for stage with standout signals (awards, high-impact work, key role) and signs of passion/drive. Translation orientation limited but promising.',
      7: 'Strong credibility plus clear translation orientation (industry collabs, licensing/SBIR, startup/advisory). Likely to engage in spinout activities.',
      8: 'Excellent credibility and repeated translation signals with demonstrated execution (multiple partnerships, successful tech transfer, startup leadership/advisory).',
      9: 'Field-leading credibility with exceptional translation track record and leadership. High confidence in sustained engagement and ability to drive commercialization.'
    };

    return rubric[score] || 'No rubric description available';
  }
};

// Make available globally
window.TeamAPI = TeamAPI;
