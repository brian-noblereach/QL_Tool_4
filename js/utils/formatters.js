// js/utils/formatters.js - Data formatting utilities (V02)
// Copy from v01 - no changes needed

const Formatters = {
  currency(value) {
    if (value === null || value === undefined) return '-';
    const num = parseFloat(value);
    if (isNaN(num)) return '-';
    if (num >= 1e12) return `$${(num / 1e12).toFixed(2)}T`;
    if (num >= 1e9) return `$${(num / 1e9).toFixed(2)}B`;
    if (num >= 1e6) return `$${(num / 1e6).toFixed(2)}M`;
    if (num >= 1e3) return `$${(num / 1e3).toFixed(2)}K`;
    return `$${num.toFixed(2)}`;
  },

  percentage(value) {
    if (value === null || value === undefined) return '-';
    const num = parseFloat(value);
    if (isNaN(num)) return '-';
    return `${num.toFixed(1)}%`;
  },

  confidence(value) {
    if (value === null || value === undefined) return 'Not available';
    const num = parseFloat(value);
    if (isNaN(num)) return 'Not available';
    const normalized = Math.max(0, Math.min(1, num));
    const percentage = (normalized * 100).toFixed(0);
    let descriptor = 'Very Low';
    if (normalized >= 0.8) descriptor = 'High';
    else if (normalized >= 0.6) descriptor = 'Moderate';
    else if (normalized >= 0.4) descriptor = 'Low';
    return `${percentage}% (${descriptor})`;
  },

  duration(seconds) {
    if (seconds === null || seconds === undefined) return '0:00';
    const totalSeconds = Math.max(0, Math.floor(seconds));
    const minutes = Math.floor(totalSeconds / 60);
    const secs = Math.floor(totalSeconds % 60);
    return `${minutes}:${secs.toString().padStart(2, '0')}`;
  },

  date(dateString) {
    if (!dateString) return '-';
    try {
      const date = new Date(dateString);
      if (isNaN(date.getTime())) return '-';
      return date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
    } catch { return '-'; }
  },

  truncate(text, maxLength = 100) {
    if (!text) return '';
    const str = String(text).trim();
    if (str.length <= maxLength) return str;
    const truncated = str.substring(0, maxLength - 3);
    const lastSpace = truncated.lastIndexOf(' ');
    if (lastSpace > maxLength * 0.8) return truncated.substring(0, lastSpace) + '...';
    return truncated + '...';
  },

  competitiveIntensity(value) {
    if (!value) return '-';
    const intensity = String(value).toLowerCase().replace(/[_-]/g, ' ');
    const map = { 'very low': 'Very Low', 'low': 'Low', 'moderate': 'Moderate', 'high': 'High', 'very high': 'Very High' };
    return map[intensity] || this.titleCase(value);
  },

  scoreColor(score, type = 'competitive') {
    const num = parseInt(score);
    if (isNaN(num) || num < 1 || num > 9) return { color: 'var(--slate-500)', label: 'Invalid' };
    
    if (num <= 3) return { color: 'var(--score-low)', label: 'Low' };
    if (num <= 6) return { color: 'var(--score-medium)', label: 'Medium' };
    return { color: 'var(--score-high)', label: 'High' };
  },

  listToHTML(items, maxItems = null) {
    if (!items || !Array.isArray(items) || items.length === 0) {
      return '<li>No items available</li>';
    }
    const validItems = items.filter(item => item && String(item).trim());
    if (validItems.length === 0) return '<li>No items available</li>';
    const itemsToShow = maxItems ? validItems.slice(0, maxItems) : validItems;
    let html = itemsToShow.map(item => `<li>${this.escapeHTML(String(item))}</li>`).join('');
    if (maxItems && validItems.length > maxItems) {
      html += `<li class="more-items">+${validItems.length - maxItems} more</li>`;
    }
    return html;
  },

  escapeHTML(text) {
    if (text === null || text === undefined) return '';
    const str = String(text);
    const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
    return str.replace(/[&<>"']/g, char => map[char]);
  },

  tamCategory(value, tam) {
    if (!value && !tam) return '-';
    if (value) {
      const map = { 'under_500M': '<$500M', '500M_to_5B': '$500M-$5B', 'over_5B': '>$5B' };
      return map[value] || value;
    }
    const numTam = parseFloat(tam);
    if (isNaN(numTam)) return '-';
    if (numTam < 5e8) return '<$500M';
    if (numTam <= 5e9) return '$500M-$5B';
    return '>$5B';
  },

  competitorBreakdown(count) {
    if (!count || typeof count !== 'object') return 'No data available';
    const parts = [];
    if (count.large_companies) parts.push(`${count.large_companies} Large`);
    if (count.mid_size_companies) parts.push(`${count.mid_size_companies} Mid-size`);
    if (count.startups) parts.push(`${count.startups} Startups`);
    return parts.length > 0 ? parts.join(', ') : 'No competitors identified';
  },

  companySize(size) {
    if (!size) return 'Unknown';
    const map = { 'large': 'Large', 'mid-size': 'Mid-size', 'startup': 'Startup' };
    return map[String(size).toLowerCase()] || this.titleCase(size);
  },

  titleCase(str) {
    if (!str) return '';
    return String(str).toLowerCase().split(/[\s_-]+/).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
  },

  numberWithCommas(num) {
    if (num === null || num === undefined) return '-';
    const number = parseFloat(num);
    if (isNaN(number)) return '-';
    return number.toLocaleString('en-US');
  },

  employeeCount(count) {
    if (!count) return '-';
    if (String(count).includes('-')) return count;
    const num = parseInt(count);
    if (isNaN(num)) return count;
    if (num < 10) return '1-10';
    if (num < 50) return '11-50';
    if (num < 200) return '51-200';
    if (num < 500) return '201-500';
    return '500+';
  },

  companyStage(stage) {
    if (!stage) return 'Unknown';
    const map = { 'pre-seed': 'Pre-Seed', 'seed': 'Seed', 'series-a': 'Series A', 'series-b': 'Series B' };
    return map[String(stage).toLowerCase()] || this.titleCase(stage);
  },

  displayUrl(url) {
    if (!url) return '-';
    try {
      const urlObj = new URL(url);
      return urlObj.hostname.replace('www.', '');
    } catch { return url; }
  },

  pluralize(count, singular, plural = null) {
    const num = parseInt(count);
    if (isNaN(num)) return singular;
    if (num === 1) return `${num} ${singular}`;
    return `${num} ${plural || singular + 's'}`;
  }
};

window.Formatters = Formatters;
// Shared HTML-escape used by views that build innerHTML strings. Prior to
// centralizing this there were four near-identical copies (_esc, escapeHtml)
// across associate-view, advisor-queue-view, modal-manager, toast-manager.
window.escapeHtml = function escapeHtml(text) { return Formatters.escapeHTML(text); };
