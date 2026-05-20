// js/components/toast-manager.js
// Toast Notification Component
//
// Provides non-intrusive notifications when:
// - Analysis phases complete
// - Errors occur
// - Export completes

/**
 * Toast Manager Class
 * Manages toast notifications in the application
 */
class ToastManager {
  constructor() {
    this.container = null;
    this.defaultDuration = 5000; // 5 seconds
    this.toasts = [];
  }

  /**
   * Initialize toast manager
   */
  init() {
    // Get or create toast container
    this.container = document.getElementById('toast-container');
    if (!this.container) {
      this.container = document.createElement('div');
      this.container.id = 'toast-container';
      this.container.className = 'toast-container';
      this.container.setAttribute('aria-live', 'polite');
      this.container.setAttribute('aria-atomic', 'true');
      document.body.appendChild(this.container);
    }
    
    console.log('ToastManager initialized');
  }

  /**
   * Show a toast notification
   * @param {string} message - Message to display
   * @param {Object} options - Toast options
   * @returns {HTMLElement} The toast element
   */
  show(message, options = {}) {
    const {
      type = 'info',
      actionText = null,
      onAction = null,
      duration = this.defaultDuration
    } = options;

    // Create toast element
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.setAttribute('role', 'alert');
    
    // Icon based on type
    const iconSvg = this.getIcon(type);
    
    // Build toast content
    toast.innerHTML = `
      <span class="toast-icon">${iconSvg}</span>
      <span class="toast-message">${this.escapeHtml(message)}</span>
      ${actionText ? `<button class="toast-action">${this.escapeHtml(actionText)}</button>` : ''}
      <button class="toast-close" aria-label="Dismiss">&times;</button>
    `;
    
    // Add action handler
    if (actionText && onAction) {
      const actionBtn = toast.querySelector('.toast-action');
      actionBtn.addEventListener('click', () => {
        onAction();
        this.dismiss(toast);
      });
    }
    
    // Add close handler
    const closeBtn = toast.querySelector('.toast-close');
    closeBtn.addEventListener('click', () => this.dismiss(toast));
    
    // Add to container
    this.container.appendChild(toast);
    this.toasts.push(toast);
    
    // Auto-dismiss if duration > 0
    if (duration > 0) {
      setTimeout(() => {
        if (toast.parentElement) {
          this.dismiss(toast);
        }
      }, duration);
    }
    
    return toast;
  }

  /**
   * Get icon SVG for toast type
   * @param {string} type - Toast type
   * @returns {string} SVG markup
   */
  getIcon(type) {
    switch (type) {
      case 'success':
        return `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
          <polyline points="22 4 12 14.01 9 11.01"/>
        </svg>`;
      case 'error':
        return `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="10"/>
          <line x1="15" y1="9" x2="9" y2="15"/>
          <line x1="9" y1="9" x2="15" y2="15"/>
        </svg>`;
      case 'warning':
        return `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
          <line x1="12" y1="9" x2="12" y2="13"/>
          <line x1="12" y1="17" x2="12.01" y2="17"/>
        </svg>`;
      default: // info
        return `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="10"/>
          <line x1="12" y1="16" x2="12" y2="12"/>
          <line x1="12" y1="8" x2="12.01" y2="8"/>
        </svg>`;
    }
  }

  /**
   * Escape HTML to prevent XSS
   * @param {string} text - Text to escape
   * @returns {string} Escaped text
   */
  escapeHtml(text) {
    // Thin shim — actual escape lives in js/utils/formatters.js as escapeHtml.
    return window.escapeHtml(text);
  }

  /**
   * Show success toast
   * @param {string} message - Message to display
   * @param {Object} options - Additional options
   */
  success(message, options = {}) {
    return this.show(message, { ...options, type: 'success' });
  }

  /**
   * Show error toast
   * @param {string} message - Message to display
   * @param {Object} options - Additional options
   */
  error(message, options = {}) {
    return this.show(message, { ...options, type: 'error', duration: 0 });
  }

  /**
   * Show warning toast
   * @param {string} message - Message to display
   * @param {Object} options - Additional options
   */
  warning(message, options = {}) {
    return this.show(message, { ...options, type: 'warning' });
  }

  /**
   * Show info toast
   * @param {string} message - Message to display
   * @param {Object} options - Additional options
   */
  info(message, options = {}) {
    return this.show(message, { ...options, type: 'info' });
  }

  /**
   * Show phase complete toast with "View" action
   * @param {string} phaseName - Name of completed phase
   * @param {Function} onView - Callback when "View" is clicked
   */
  phaseComplete(phaseName, onView) {
    return this.show(`${phaseName} analysis ready`, {
      type: 'success',
      actionText: 'View',
      onAction: onView,
      duration: 5000
    });
  }

  /**
   * Show phase error toast with "Retry" action
   * @param {string} phaseName - Name of failed phase
   * @param {Function} onRetry - Callback when "Retry" is clicked
   */
  phaseError(phaseName, onRetry) {
    return this.show(`${phaseName} analysis failed`, {
      type: 'error',
      actionText: 'Retry',
      onAction: onRetry,
      duration: 0
    });
  }

  /**
   * Dismiss a specific toast
   * @param {HTMLElement} toast - Toast element to dismiss
   */
  dismiss(toast) {
    if (!toast || !toast.parentElement) return;
    
    // Add fade-out animation
    toast.classList.add('fade-out');
    
    // Remove after animation
    setTimeout(() => {
      if (toast.parentElement) {
        toast.remove();
      }
      // Remove from array
      const index = this.toasts.indexOf(toast);
      if (index > -1) {
        this.toasts.splice(index, 1);
      }
    }, 300);
  }

  /**
   * Dismiss all toasts
   */
  dismissAll() {
    [...this.toasts].forEach(toast => this.dismiss(toast));
  }
}

// Export for use in other modules
window.ToastManager = ToastManager;
