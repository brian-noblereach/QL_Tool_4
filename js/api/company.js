// js/api/company.js - Company analysis API (Proxied)
// Supports three input modes: URL only, file only, or both
// Returns both full output (for display) and short output (for other APIs)
// Full output follows the venture-extraction-schema JSON schema
// Short output (downstream_summary) is extracted from the full JSON for passing to other APIs

const CompanyAPI = {
  config: {
    timeout: 900000 // 15 minutes — safety net for long-tail Stack AI runs
  },

  /**
   * Analyze a company using URL, file(s), or both
   *
   * @param {Object} options - Input options
   * @param {string} options.url - Company website URL (optional)
   * @param {File} options.file - Single uploaded document (backward compat, optional)
   * @param {File[]} options.files - Array of uploaded documents (optional)
   * @returns {Promise<Object>} - { full: {...}, short: "..." }
   */
  async analyze({ url, file, files } = {}, abortSignal = null) {
    // Support both single file and files array (backward compat)
    const fileArray = files || (file ? [file] : []);

    // Validate inputs - need at least one
    const hasUrl = url && typeof url === 'string' && url.trim().length > 0;
    const hasFile = fileArray.length > 0;

    if (!hasUrl && !hasFile) {
      throw new Error('Either a company URL or document is required');
    }

    // Determine which workflow to use
    let workflow;
    if (hasUrl && hasFile) {
      workflow = 'company_both';
    } else if (hasFile) {
      workflow = 'company_file';
    } else {
      workflow = 'company_url';
    }

    Debug.log(`[CompanyAPI] Using workflow: ${workflow}, files: ${fileArray.length}`);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.config.timeout);

    if (abortSignal) {
      abortSignal.addEventListener('abort', () => controller.abort());
    }

    try {
      let data;

      if (hasFile) {
        // Use file upload method (supports multiple files)
        data = await window.StackProxy.callWithFiles(
          workflow,
          fileArray,
          hasUrl ? url.trim() : null,
          controller.signal
        );
      } else {
        // URL-only workflow
        const payload = {
          'user_id': StackProxy.buildUserId('company'),
          'in-0': url.trim()
        };
        data = await window.StackProxy.call(workflow, payload, controller.signal);
      }
      
      clearTimeout(timeoutId);
      return this.processResponse(data);

    } catch (error) {
      clearTimeout(timeoutId);
      
      if (error.name === 'AbortError') {
        throw new Error('Company analysis timeout or cancelled');
      }
      
      throw error;
    }
  },

  /**
   * Process API response - extract full output and downstream_summary
   * out-0 = full output (JSON containing all venture data including downstream_summary)
   * Legacy fallback: out-6/out-7 for backward compatibility
   */
  processResponse(data) {
    const outputs = data?.outputs || {};

    Debug.log('[CompanyAPI] Processing response outputs');

    // Try new output key first, then legacy
    const rawOutput = outputs['out-0'] || outputs['out-6'];

    if (!rawOutput && !outputs['out-7']) {
      throw new Error('Company API did not return expected outputs');
    }

    // Parse the full output JSON
    const fullOutput = this.parseOutput(rawOutput, 'full company data');

    Debug.log('[CompanyAPI] Parsed full output');

    if (!fullOutput) {
      // Distinguish refusal/truncation from a generic parse failure so the
      // pipeline can auto-retry and the user gets an actionable message.
      const rawText = (typeof rawOutput === 'string')
        ? rawOutput
        : (rawOutput?.text || JSON.stringify(rawOutput || ''));
      if (this._looksLikeRefusalOrTruncation(rawText)) {
        const err = new Error('AI returned an incomplete response (likely a content-moderation interruption or truncation). Re-runs are usually successful since the model output varies.');
        err.code = 'incomplete_llm_response';
        throw err;
      }
      throw new Error('Failed to parse company data');
    }

    // Ensure required structure in full output (follows venture-extraction-schema)
    const full = this.ensureStructure(fullOutput);

    // Extract downstream_summary from the full JSON for passing to other APIs
    // Falls back to legacy out-7 text output if downstream_summary not present
    const short = full.company_overview?.downstream_summary
      || this.extractTextOutput(outputs['out-7'])
      || '';

    Debug.log('[CompanyAPI] Processing complete:', full.company_overview?.name || 'Unknown');

    return { full, short };
  },

  /**
   * Detect Stack AI / LLM responses where the model started producing valid
   * JSON and then either (a) tripped a content-moderation refusal mid-stream
   * or (b) was truncated. Both cases produce a malformed JSON string that
   * cannot be parsed. Re-running the workflow usually succeeds because the
   * model's output is non-deterministic.
   * @param {string} text - Raw response text after JSON.parse failed
   * @returns {boolean}
   */
  _looksLikeRefusalOrTruncation(text) {
    if (typeof text !== 'string' || !text.trim()) return false;
    const lower = text.toLowerCase();
    // Common assistant-refusal phrases that appear when content moderation
    // interrupts JSON generation.
    const REFUSAL_MARKERS = [
      "i'm sorry, but i cannot",
      'i cannot assist with that',
      "i can't assist with that",
      'i cannot help with that',
      "i can't help with that",
      'i am unable to provide',
      'i am not able to provide'
    ];
    if (REFUSAL_MARKERS.some(m => lower.includes(m))) return true;

    // Truncation heuristic: unterminated quote / unbalanced braces. Cheap
    // approximation — count quote chars (excluding escaped) and braces.
    const trimmed = text.trim();
    const opens = (trimmed.match(/\{/g) || []).length;
    const closes = (trimmed.match(/\}/g) || []).length;
    if (opens > 0 && opens > closes) return true;

    return false;
  },

  /**
   * Extract text output - keeps as string, does NOT parse as JSON
   * Used as fallback for legacy out-7 short output
   */
  extractTextOutput(rawOutput) {
    if (!rawOutput) return '';

    if (typeof rawOutput === 'object' && rawOutput.text) {
      return rawOutput.text;
    }

    if (typeof rawOutput === 'string') {
      return rawOutput;
    }

    if (typeof rawOutput === 'object') {
      return JSON.stringify(rawOutput);
    }

    return String(rawOutput);
  },

  /**
   * Parse output that may be string or object (for full output only)
   * Handles multiple wrapper structures from Stack AI
   */
  parseOutput(rawOutput, label = 'output') {
    if (!rawOutput) return null;

    Debug.log(`[CompanyAPI] parseOutput ${label}`);

    // Handle object with text property (Stack AI wrapper)
    if (typeof rawOutput === 'object' && rawOutput.text) {
      Debug.log(`[CompanyAPI] parseOutput ${label}: unwrapping`);
      return this.parseOutput(rawOutput.text, label);
    }

    // Already an object with expected schema properties
    if (typeof rawOutput === 'object') {
      // Check if it has the expected schema structure
      if (rawOutput.company_overview || rawOutput.technology || rawOutput.company_profile) {
        Debug.log(`[CompanyAPI] parseOutput ${label}: found schema structure`);
        return rawOutput;
      }
      // Otherwise might be wrapped differently
      Debug.log(`[CompanyAPI] parseOutput ${label}: non-standard structure`);
      return rawOutput;
    }

    // Parse string
    if (typeof rawOutput === 'string') {
      try {
        let cleaned = rawOutput.trim();
        
        // Remove markdown code blocks
        if (cleaned.startsWith('```json')) {
          cleaned = cleaned.slice(7);
        }
        if (cleaned.startsWith('```')) {
          cleaned = cleaned.slice(3);
        }
        if (cleaned.endsWith('```')) {
          cleaned = cleaned.slice(0, -3);
        }
        
        const parsed = JSON.parse(cleaned.trim());
        Debug.log(`[CompanyAPI] parseOutput ${label}: parsed JSON`);
        return parsed;
      } catch (error) {
        Debug.error(`[CompanyAPI] Failed to parse ${label}:`, error.message);
        return null;
      }
    }

    return null;
  },

  /**
   * Ensure full output has required structure for display
   * Normalizes to match venture-extraction-schema v3
   */
  ensureStructure(data) {
    // New v3 schema top-level sections:
    // company_overview, technology, products_services, team,
    // funding_and_investors, traction_and_metrics, recent_activity,
    // market_context, data_quality_assessment
    // Optional: solution_value

    // Handle legacy company_profile wrapper (v2 backward compat)
    if (data.company_profile && !data.company_overview) {
      const profile = data.company_profile;
      const basicInfo = profile.basic_information || {};
      const coreTech = profile.core_technology || data.core_technology || {};

      data.company_overview = {
        name: basicInfo.company_name || profile.name || '',
        website: basicInfo.website || profile.website || '',
        founded_year: String(basicInfo.founded || profile.founded_year || 'Unknown'),
        headquarters: basicInfo.headquarters ||
                      (typeof profile.headquarters === 'object' ? profile.headquarters?.address : profile.headquarters) || 'Unknown',
        company_stage: profile.company_stage?.stage || 'unknown',
        one_liner: profile.mission_statement || coreTech.problem_solved || '',
        detailed_description: coreTech.technology_description || profile.operating_status || '',
        downstream_summary: ''
      };

      data.technology = {
        core_technology: coreTech.technology_description || coreTech.technology_name || '',
        technology_readiness: 'unknown',
        key_differentiators: coreTech.key_technical_features?.map(f =>
          typeof f === 'object' ? `${f.feature}: ${f.description}` : f
        ) || [],
        patents: []
      };

      const techApps = profile.technology_applications || data.market_opportunity || {};
      data.products_services = {
        products: [],
        business_model: basicInfo.business_model || data.business_model_and_revenue?.revenue_model || '',
        target_industries: techApps.target_markets?.map(m => typeof m === 'object' ? m.market : m) ||
                          techApps.primary_markets || []
      };

      const teamData = profile.team_and_leadership || data.founders_and_leadership || {};
      data.team = {
        founders: (teamData.founders || []).filter(f => f.name).map(f => ({
          name: f.name || '',
          title: f.title || f.role || '',
          background: f.background || '',
          linkedin_url: f.linkedin || ''
        }))
      };

      const fundingData = profile.funding_and_investors || data.funding_history || {};
      data.funding_and_investors = {
        total_funding: String(fundingData.total_funding_disclosed || fundingData.total_funding || 'Unknown'),
        funding_rounds: (fundingData.funding_rounds || []).map(r => ({
          round_type: r.type || r.round_type || '',
          amount: String(r.amount_usd || r.amount || ''),
          date: r.date || '',
          lead_investors: r.lead_investor ? [r.lead_investor] : (r.lead_investors || []),
          note: ''
        })),
        government_grants: (fundingData.sbir_funding?.notable_projects || fundingData.government_grants || []).map(g => ({
          grant_type: g.type || 'Government',
          amount: String(g.award_amount_usd || g.amount || ''),
          agency: g.sponsor || g.source || '',
          year: g.date || '',
          note: ''
        })),
        notable_investors: []
      };

      const recentData = profile.recent_activities_and_milestones || data.recent_activities_and_milestones || {};
      data.traction_and_metrics = {
        customers: [],
        partnerships: (recentData.partnerships_and_collaborations || []).map(p => ({
          partner: p.partner || '',
          description: p.type || ''
        })),
        revenue_info: 'Unknown',
        key_milestones: recentData.recognition_and_awards?.map(a =>
          typeof a === 'object' ? a.award : a
        ) || []
      };

      data.recent_activity = {
        news_and_events: (recentData.recent_news_and_announcements || recentData.technology_milestones || []).map(n => ({
          headline: n.announcement || n.milestone || n.description || '',
          date: n.date || '',
          source_url: n.url || ''
        }))
      };

      const compLandscape = profile.competitive_landscape || data.competitive_landscape || {};
      data.market_context = {
        target_market: basicInfo.industry || compLandscape.market_position || ''
      };

      const qualityData = profile.data_quality_and_gaps || data.data_quality || {};
      data.data_quality_assessment = {
        overall_confidence: qualityData.information_completeness === 'high' ? 'High' : 'Medium',
        // Backward compat: legacy shape has no downstream-sufficiency verdict;
        // default to true so the insufficient-input gate never false-positives
        // on it. Only an explicit false from the v2+ flow halts the pipeline.
        sufficient_for_downstream: (typeof qualityData.sufficient_for_downstream === 'boolean')
          ? qualityData.sufficient_for_downstream : true,
        insufficiency_reason: qualityData.insufficiency_reason || '',
        information_gaps: qualityData.information_gaps || qualityData.critical_gaps || [],
        sources_used: qualityData.sources_used || []
      };
    }

    // Ensure all required top-level sections exist (per v3 schema)
    const requiredSections = [
      'company_overview',
      'technology',
      'products_services',
      'team',
      'funding_and_investors',
      'traction_and_metrics',
      'recent_activity',
      'market_context',
      'data_quality_assessment'
    ];

    for (const section of requiredSections) {
      if (!data[section]) {
        data[section] = this.getDefaultSection(section);
      }
    }

    // Also handle legacy key: products_and_applications → products_services
    if (data.products_and_applications && !data.products_services) {
      const old = data.products_and_applications;
      data.products_services = {
        products: (old.products || []).map(p => ({
          name: p.name || '',
          description: p.description || '',
          status: p.status || 'unknown',
          target_customers: p.target_market || ''
        })),
        business_model: old.business_model || '',
        target_industries: old.target_industries || []
      };
    }

    return data;
  },

  /**
   * Get default empty section following v3 schema
   */
  getDefaultSection(section) {
    const defaults = {
      company_overview: {
        name: '',
        website: 'Not available',
        founded_year: 'Unknown',
        headquarters: 'Unknown',
        company_stage: 'unknown',
        one_liner: '',
        detailed_description: '',
        downstream_summary: '',
        technology_domain: '',
        institution: ''
      },
      technology: {
        core_technology: '',
        technology_readiness: 'unknown',
        key_differentiators: [],
        patents: []
      },
      products_services: {
        products: [],
        business_model: '',
        target_industries: []
      },
      team: {
        founders: []
      },
      funding_and_investors: {
        total_funding: 'Unknown',
        funding_rounds: [],
        government_grants: [],
        notable_investors: []
      },
      traction_and_metrics: {
        customers: [],
        partnerships: [],
        revenue_info: 'Unknown',
        key_milestones: []
      },
      recent_activity: {
        news_and_events: []
      },
      market_context: {
        target_market: ''
      },
      data_quality_assessment: {
        overall_confidence: 'Low',
        sufficient_for_downstream: true,
        insufficiency_reason: '',
        information_gaps: [],
        sources_used: []
      }
    };

    return defaults[section] || {};
  },

  /**
   * Parse amount string to number
   */
  parseAmount(amountStr) {
    if (typeof amountStr === 'number') return amountStr;
    if (!amountStr || typeof amountStr !== 'string') return null;
    
    // Extract number from strings like "$3M+" or "$412K"
    const match = amountStr.match(/\$?([\d.]+)\s*(M|K|B)?/i);
    if (!match) return null;
    
    let value = parseFloat(match[1]);
    const suffix = (match[2] || '').toUpperCase();
    
    if (suffix === 'K') value *= 1000;
    if (suffix === 'M') value *= 1000000;
    if (suffix === 'B') value *= 1000000000;
    
    return value || null;
  },

  /**
   * Get display-ready company name from response
   */
  getCompanyName(companyData) {
    if (!companyData) return 'Unknown Company';
    
    const full = companyData.full || companyData;
    
    // Try company_overview.name (new schema)
    if (full.company_overview?.name) return full.company_overview.name;
    
    // Try legacy structures
    if (full.company_profile?.basic_information?.company_name) {
      return full.company_profile.basic_information.company_name;
    }
    if (full.company_profile?.name) return full.company_profile.name;
    if (full.company_name) return full.company_name;
    if (full.name) return full.name;
    
    return 'Unknown Company';
  },

  /**
   * Get short description for passing to other APIs
   * Returns downstream_summary as TEXT string
   */
  getShortDescription(companyData) {
    if (!companyData) return '';

    // Primary: downstream_summary extracted during processResponse
    if (companyData.short && typeof companyData.short === 'string' && companyData.short.length > 0) {
      return companyData.short;
    }

    // Fallback: try to extract from full data
    const full = companyData.full || companyData;
    if (full.company_overview?.downstream_summary) {
      return full.company_overview.downstream_summary;
    }

    // Last resort: stringify the full data
    return JSON.stringify(full);
  }
};

// Make available globally
window.CompanyAPI = CompanyAPI;
