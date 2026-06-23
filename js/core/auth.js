// js/core/auth.js — v04 access control with multi-role support.
//
// The v04 proxy returns { role, roles[], scope, label } where:
//   internal  → roles=['internal']
//   external  → roles=['external']        (read-only university lane; scope+label set)
//   associate → roles=['associate']
//   admin     → roles=['associate','internal','admin']
//
// Admin users get a sidebar role-switcher; everyone else lands on their single role's view.
// For external logins, `scope` (the university tag) is carried in the token and enforced
// server-side; `label` (e.g. "Georgetown") is shown in the external view header.

const Auth = {
  STORAGE_TOKEN:  'noblereach_v04_token',
  STORAGE_ROLES:  'noblereach_v04_roles',
  STORAGE_ACTIVE: 'noblereach_v04_active_role',
  // External (university) access scope + display label. Set only for external
  // logins; null/absent for every other role. Scope is enforced server-side via
  // the token — these are kept only so the external view can show "Georgetown".
  STORAGE_SCOPE:  'noblereach_v04_scope',
  STORAGE_LABEL:  'noblereach_v04_label',

  // Proxy URL is centralized in js/core/config.js — update there on redeploy.
  get proxyUrl() { return window.AppConfig.proxyUrl; },

  roles: [],
  activeRole: null,
  scope: null,

  // Current access token (or null). The SPA's proxy callers read this and pass
  // it as `data.token` so the proxy's role gate can verify the request.
  get token() { return localStorage.getItem(this.STORAGE_TOKEN); },

  // Display label for an external partner (e.g. "Georgetown"); '' for others.
  get scopeLabel() {
    return localStorage.getItem(this.STORAGE_LABEL) || this.scope || '';
  },

  async checkAccess() {
    const token = localStorage.getItem(this.STORAGE_TOKEN);
    if (!token) return false;
    try {
      const verify = await this._verify(token);
      if (verify.valid) {
        this.roles = verify.roles || (verify.role ? [verify.role] : []);
        localStorage.setItem(this.STORAGE_ROLES, JSON.stringify(this.roles));
        this._setScope(verify.scope, verify.label);
        const stored = localStorage.getItem(this.STORAGE_ACTIVE);
        this.activeRole = stored && this.roles.indexOf(stored) !== -1 ? stored : this.defaultActiveRole();
        if (this.activeRole) localStorage.setItem(this.STORAGE_ACTIVE, this.activeRole);
        return true;
      }
      this._clear();
      return false;
    } catch (e) {
      const cached = localStorage.getItem(this.STORAGE_ROLES);
      if (cached) {
        try { this.roles = JSON.parse(cached); } catch (_) { this.roles = []; }
        this.scope = localStorage.getItem(this.STORAGE_SCOPE) || null;
        this.activeRole = localStorage.getItem(this.STORAGE_ACTIVE) || this.defaultActiveRole();
      }
      return this.roles.length > 0;
    }
  },

  // 25 s is comfortably longer than a typical GAS cold start (~3-8 s) but short
  // enough that the user gets a real error instead of an indefinite "Verifying..."
  // when the proxy stalls.
  AUTH_FETCH_TIMEOUT_MS: 25000,

  _fetchWithTimeout(url, ms) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ms);
    return fetch(url, { signal: controller.signal })
      .finally(() => clearTimeout(timer));
  },

  async login(password) {
    try {
      const url = `${this.proxyUrl}?action=auth&password=${encodeURIComponent(password)}`;
      const r = await this._fetchWithTimeout(url, this.AUTH_FETCH_TIMEOUT_MS);
      const data = await r.json();
      if (data.success && data.token) {
        localStorage.setItem(this.STORAGE_TOKEN, data.token);
        this.roles = data.roles || (data.role ? [data.role] : []);
        localStorage.setItem(this.STORAGE_ROLES, JSON.stringify(this.roles));
        this._setScope(data.scope, data.label);
        this.activeRole = this.defaultActiveRole();
        if (this.activeRole) localStorage.setItem(this.STORAGE_ACTIVE, this.activeRole);
        return { success: true };
      }
      return { success: false, error: data.error || 'Invalid password' };
    } catch (e) {
      if (e && e.name === 'AbortError') {
        return { success: false, error: 'Connection timed out. Try again.' };
      }
      return { success: false, error: 'Unable to connect. Try again.' };
    }
  },

  async _verify(token) {
    const url = `${this.proxyUrl}?action=verify&token=${encodeURIComponent(token)}`;
    const r = await this._fetchWithTimeout(url, this.AUTH_FETCH_TIMEOUT_MS);
    return await r.json();
  },

  logout() { this._clear(); this.showLoginOverlay(); },

  _clear() {
    localStorage.removeItem(this.STORAGE_TOKEN);
    localStorage.removeItem(this.STORAGE_ROLES);
    localStorage.removeItem(this.STORAGE_ACTIVE);
    localStorage.removeItem(this.STORAGE_SCOPE);
    localStorage.removeItem(this.STORAGE_LABEL);
    this.roles = [];
    this.activeRole = null;
    this.scope = null;
  },

  // Persist (or clear) the external scope + label after login/verify.
  _setScope(scope, label) {
    this.scope = scope || null;
    if (scope) localStorage.setItem(this.STORAGE_SCOPE, scope);
    else localStorage.removeItem(this.STORAGE_SCOPE);
    if (label) localStorage.setItem(this.STORAGE_LABEL, label);
    else localStorage.removeItem(this.STORAGE_LABEL);
  },

  hasRole(name)  { return this.roles.indexOf(name) !== -1; },
  isAssociate()  { return this.hasRole('associate'); },
  isInternal()   { return this.hasRole('internal'); },
  isAdmin()      { return this.hasRole('admin'); },
  isExternal()   { return this.hasRole('external'); },

  defaultActiveRole() {
    if (this.isAdmin())     return 'associate';
    if (this.isAssociate()) return 'associate';
    if (this.isInternal())  return 'internal';
    if (this.isExternal())  return 'external';
    return null;
  },

  setActiveRole(role) {
    if (!this.hasRole(role)) return false;
    this.activeRole = role;
    localStorage.setItem(this.STORAGE_ACTIVE, role);
    return true;
  },

  showLoginOverlay() {
    const overlay = document.getElementById('auth-overlay');
    if (overlay) overlay.classList.add('active');
    const input = document.getElementById('auth-password');
    if (input) { input.value = ''; setTimeout(() => input.focus(), 100); }
    const err = document.getElementById('auth-error');
    if (err) err.textContent = '';
  },

  hideLoginOverlay() {
    const overlay = document.getElementById('auth-overlay');
    if (overlay) overlay.classList.remove('active');
  },

  initLoginForm() {
    const form  = document.getElementById('auth-form');
    const input = document.getElementById('auth-password');
    const btn   = document.getElementById('auth-submit');
    const err   = document.getElementById('auth-error');
    if (!form) return;
    const toggle = document.getElementById('auth-toggle-password');
    if (toggle && input) {
      toggle.addEventListener('click', () => { input.type = input.type === 'password' ? 'text' : 'password'; });
    }
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const password = input.value.trim();
      if (!password) return;
      btn.disabled = true; btn.textContent = 'Verifying...'; err.textContent = '';
      const result = await this.login(password);
      if (result.success) {
        this.hideLoginOverlay();
        // On first login of a session, window.app hasn't been created yet — the
        // DOMContentLoaded bootstrap only instantiates it when an existing token
        // is already valid. Create it here if missing so the views initialize.
        if (!window.app && typeof window.App === 'function') window.app = new window.App();
        if (window.app && typeof window.app.init === 'function') window.app.init();
      } else {
        err.textContent = result.error;
        btn.disabled = false; btn.textContent = 'Enter';
        input.select();
      }
    });
  }
};

window.Auth = Auth;
