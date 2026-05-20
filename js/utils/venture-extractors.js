// js/utils/venture-extractors.js
// Helpers that derive venture-level fields (Institution, Technology Description,
// Technology Domain) from the AI-extracted company JSON and the input URL.
// Pure functions — no DOM access, no global state writes.

// Synonyms used by the institution detector so a candidate like 'UKY' can be
// matched even when the AI text writes 'University of Kentucky'. The candidate
// (the canonical name shown in the dropdown) is the key. Each entry's terms are
// case-insensitively substring-matched against the AI text. Lowercase only.
const INSTITUTION_ALIASES = {
  'UKY':          ['university of kentucky', 'uky'],
  'Vandy':        ['vanderbilt'],
  'UoL':          ['university of louisville', 'u of l', 'uofl'],
  'UTK':          ['university of tennessee', 'utk'],
  'UCF':          ['university of central florida', 'ucf'],
  'UF':           ['university of florida'],
  'USF':          ['university of south florida', 'usf'],
  'Embry Riddle': ['embry riddle', 'embry-riddle']
};

const VentureExtractors = {
  /**
   * Identify the source institution. Strategy (first hit wins):
   *   1. AI's structured `company_overview.institution` field — works for any portfolio
   *      (requires Stack AI redeploy of the v3.5 Venture Info schema/prompt).
   *   2. URL-domain map (uky.edu, vanderbilt.edu, etc.) when the URL matches a known
   *      academic domain; URL hit is normalized to the canonical candidate spelling
   *      when the candidate list contains it.
   *   3. Substring scan of team affiliations / headquarters / downstream_summary against
   *      each candidate plus its aliases (so "UKY" can match "University of Kentucky").
   *
   * Returns '' when nothing fires.
   *
   * @param {string} url - Venture URL (may be empty for file-only runs)
   * @param {Object} companyData - The AI-extracted company JSON (full output)
   * @param {string[]} candidates - Allowed institution names for the venture's portfolio (may be empty)
   * @returns {string}
   */
  detectInstitution(url, companyData, candidates) {
    candidates = Array.isArray(candidates) ? candidates : [];
    const candidateMap = new Map(candidates.map(c => [c.toLowerCase(), c]));

    // 1. Trust the AI-extracted structured field (any portfolio).
    if (companyData && typeof companyData === 'object') {
      const aiInstitution = companyData.company_overview?.institution;
      if (typeof aiInstitution === 'string' && aiInstitution.trim()) {
        const trimmed = aiInstitution.trim();
        // If the AI value matches a candidate by alias, snap to the canonical spelling.
        const lower = trimmed.toLowerCase();
        const direct = candidateMap.get(lower);
        if (direct) return direct;
        for (const c of candidates) {
          const aliases = INSTITUTION_ALIASES[c] || [];
          if (aliases.some(a => lower.includes(a))) return c;
        }
        return trimmed;
      }
    }

    // 2. URL-domain fallback. Recognized academic domains map to a canonical name.
    const URL_DOMAIN_MAP = {
      'uky.edu':          'UKY',
      'vanderbilt.edu':   'Vandy',
      'louisville.edu':   'UoL',
      'utk.edu':          'UTK',
      'ucf.edu':          'UCF',
      'ufl.edu':          'UF',
      'usf.edu':          'USF',
      'erau.edu':         'Embry Riddle',
      'psu.edu':          'Pennsylvania State University',
      'northeastern.edu': 'Northeastern University',
      'mit.edu':          'Massachusetts Institute of Technology',
      'stanford.edu':     'Stanford University',
      'berkeley.edu':     'University of California, Berkeley',
      'harvard.edu':      'Harvard University',
      'cmu.edu':          'Carnegie Mellon University'
    };

    if (url) {
      const lower = url.toLowerCase();
      for (const [domain, name] of Object.entries(URL_DOMAIN_MAP)) {
        if (lower.includes(domain)) {
          // Prefer canonical spelling from candidate list when available
          return candidateMap.get(name.toLowerCase()) || name;
        }
      }
    }

    // 3. Substring scan against the portfolio candidate list (alias-aware).
    if (candidates.length > 0 && companyData && typeof companyData === 'object') {
      const haystack = [
        companyData.company_overview?.downstream_summary || '',
        companyData.company_overview?.detailed_description || '',
        companyData.company_overview?.headquarters || '',
        companyData.company_overview?.one_liner || '',
        ...(companyData.team?.founders || []).map(f => `${f.background || ''} ${f.title || ''}`)
      ].join(' ').toLowerCase();

      if (haystack) {
        for (const c of candidates) {
          // Try the canonical name itself first, then each alias.
          const terms = [c.toLowerCase(), ...(INSTITUTION_ALIASES[c] || [])];
          if (terms.some(t => haystack.includes(t))) return c;
        }
      }
    }

    return '';
  },

  /**
   * Pick the best free-text technology description from the company JSON.
   * Falls back through the most-specific to least-specific fields.
   * @param {Object} companyData
   * @returns {string}
   */
  deriveTechnologyDescription(companyData) {
    if (!companyData || typeof companyData !== 'object') return '';
    const tech = companyData.technology?.core_technology;
    if (typeof tech === 'string' && tech.trim()) return tech.trim();
    const detailed = companyData.company_overview?.detailed_description;
    if (typeof detailed === 'string' && detailed.trim()) return detailed.trim();
    const summary = companyData.company_overview?.downstream_summary;
    if (typeof summary === 'string' && summary.trim()) return summary.trim().slice(0, 500);
    const oneLiner = companyData.company_overview?.one_liner;
    if (typeof oneLiner === 'string' && oneLiner.trim()) return oneLiner.trim();
    return '';
  },

  /**
   * Extract the AI-classified technology domain. Returns '' if missing or 'unknown'.
   * Schema location is at `company_overview.technology_domain` (see Venture Info
   * agent prompt + schema). Tolerant of either top-level or nested placement
   * for forward/backward compatibility.
   * @param {Object} companyData
   * @returns {string}
   */
  extractTechnologyDomain(companyData) {
    if (!companyData || typeof companyData !== 'object') return '';
    const candidates = [
      companyData.company_overview?.technology_domain,
      companyData.technology?.technology_domain,
      companyData.technology_domain
    ];
    for (const v of candidates) {
      if (typeof v === 'string') {
        const trimmed = v.trim();
        if (trimmed && trimmed.toLowerCase() !== 'unknown') return trimmed;
      }
    }
    return '';
  }
};

window.VentureExtractors = VentureExtractors;
