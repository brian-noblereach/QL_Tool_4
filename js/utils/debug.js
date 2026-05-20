// js/utils/debug.js
// Centralized debug logging utility
// Prevents sensitive information from being logged in production

const Debug = {
  // Set to true only during development
  enabled: false,

  /**
   * Log debug information (only when enabled)
   * Use for: API details, workflow IDs, request/response payloads, internal state
   */
  log(...args) {
    if (this.enabled) {
      console.log('[Debug]', ...args);
    }
  },

  /**
   * Log warnings (always shown)
   * Use for: Recoverable issues, deprecation notices, fallback behaviors
   */
  warn(...args) {
    console.warn('[Warning]', ...args);
  },

  /**
   * Log errors (always shown)
   * Use for: Failures, exceptions, critical issues
   */
  error(...args) {
    console.error('[Error]', ...args);
  },

  /**
   * Log informational messages (always shown)
   * Use for: Important state changes, user-facing events
   */
  info(...args) {
    console.info('[Info]', ...args);
  },

  /**
   * Enable debug mode
   * Can be called from browser console: Debug.enable()
   */
  enable() {
    this.enabled = true;
    console.log('[Debug] Debug mode enabled');
  },

  /**
   * Disable debug mode
   */
  disable() {
    this.enabled = false;
    console.log('[Debug] Debug mode disabled');
  }
};

// Export globally
window.Debug = Debug;
