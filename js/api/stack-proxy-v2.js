// js/api/stack-proxy-v2.js - Direct Stack AI calls with proxy for config/auth only
// This approach avoids Google Apps Script timeout limits by calling Stack AI directly from browser

const StackProxy = {
  // Proxy URL is centralized in js/core/config.js — update there on redeploy.
  get proxyUrl() { return window.AppConfig.proxyUrl; },
  
  // Cached config from proxy
  config: null,
  configPromise: null,
  
  /**
   * Initialize - fetch config from proxy
   */
  async init() {
    if (this.config) return this.config;
    
    // Avoid multiple simultaneous config fetches
    if (this.configPromise) return this.configPromise;
    
    this.configPromise = this.fetchConfig();
    this.config = await this.configPromise;
    this.configPromise = null;
    
    Debug.log('[StackProxy] Initialized with workflows:', Object.keys(this.config.workflows || {}).length);
    return this.config;
  },
  
  /**
   * Fetch API config from proxy using JSONP to avoid CORS issues.
   * GAS web apps redirect cross-origin, making iframe reads unreliable.
   * JSONP works reliably because <script> tags follow redirects natively.
   */
  async fetchConfig() {
    return new Promise((resolve, reject) => {
      const timeoutMs = 15000;
      let completed = false;

      // Unique callback name for this request
      const callbackName = '_stackConfig_' + Date.now();

      // Register global callback
      window[callbackName] = (data) => {
        if (completed) return;
        completed = true;
        cleanup();

        if (data.success && data.config) {
          resolve(data.config);
        } else {
          reject(new Error(data.error || 'Invalid config response'));
        }
      };

      // Create script tag for JSONP
      const script = document.createElement('script');
      script.src = `${this.proxyUrl}?action=config&version=3&callback=${callbackName}`;

      script.onerror = () => {
        if (!completed) {
          Debug.error('[StackProxy] JSONP config fetch failed');
          completed = true;
          cleanup();
          reject(new Error('Unable to load API configuration. Please refresh and try again.'));
        }
      };

      const cleanup = () => {
        delete window[callbackName];
        if (script.parentNode) script.parentNode.removeChild(script);
      };

      // Timeout
      setTimeout(() => {
        if (!completed) {
          Debug.error('[StackProxy] Config fetch timeout');
          completed = true;
          cleanup();
          reject(new Error('API configuration timeout. Please check your connection and refresh.'));
        }
      }, timeoutMs);

      document.head.appendChild(script);
    });
  },

  /**
   * Call a Stack AI workflow directly (no proxy for inference)
   */
  async call(workflow, payload, abortSignal = null) {
    // Ensure config is loaded
    const config = await this.init();
    
    const workflowId = config.workflows[workflow];
    if (!workflowId) {
      throw new Error(`Unknown workflow: ${workflow}`);
    }
    
    const url = `${config.baseUrl}/${workflowId}`;
    
    Debug.log(`[StackProxy] Calling workflow: ${workflow}`);
    
    const startTime = Date.now();
    
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${config.publicKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload),
        signal: abortSignal
      });
      
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error(`[StackProxy] ${workflow} failed (${elapsed}s):`, response.status, errorText);
        throw new Error(`API error ${response.status}: ${errorText.slice(0, 200)}`);
      }
      
      const data = await response.json();
      Debug.log(`[StackProxy] ${workflow} completed (${elapsed}s)`);
      
      return data;
      
    } catch (error) {
      if (error.name === 'AbortError') {
        Debug.log(`[StackProxy] ${workflow} was cancelled`);
        throw error;
      }

      Debug.error(`[StackProxy] ${workflow} error:`, error.message);
      throw error;
    }
  },
  
  /**
   * Upload a single file via proxy, then call workflow directly (backward compat)
   */
  async callWithFile(workflow, file, websiteUrl = null, abortSignal = null) {
    return this.callWithFiles(workflow, [file], websiteUrl, abortSignal);
  },

  /**
   * Upload multiple files via proxy, then call workflow directly
   * Files are uploaded sequentially to the same doc-0 node
   * First upload clears existing files; subsequent uploads append
   */
  async callWithFiles(workflow, files, websiteUrl = null, abortSignal = null) {
    const config = await this.init();
    const userId = this.getUserId();

    Debug.log(`[StackProxy] Uploading ${files.length} file(s) for ${workflow}`);

    // Upload files sequentially
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const fileBase64 = await this.fileToBase64(file);

      const uploadData = {
        action: 'upload_file',
        workflow: workflow,
        userId: userId,
        fileName: file.name,
        fileBase64: fileBase64,
        mimeType: file.type || this.getMimeType(file.name),
        version: '3',
        clearFirst: i === 0  // Only clear existing files on first upload
      };

      Debug.log(`[StackProxy] Uploading file ${i + 1}/${files.length}: ${file.name} (${file.size} bytes)${i === 0 ? ' [clearing existing]' : ' [appending]'}`);

      const uploadResult = await this.postViaIframe(uploadData);

      if (!uploadResult.success) {
        throw new Error(`Upload failed for ${file.name}: ${uploadResult.error || 'Unknown error'}`);
      }

      Debug.log(`[StackProxy] File ${i + 1}/${files.length} uploaded successfully`);
    }

    // Wait for files to be processed
    await new Promise(resolve => setTimeout(resolve, 2000));

    Debug.log(`[StackProxy] All files uploaded, calling workflow...`);

    // Call the workflow directly (no proxy needed)
    const payload = {
      user_id: userId,
      'doc-0': null  // Indicates uploaded documents exist
    };

    // Add website URL if this is the "both" workflow
    if (websiteUrl && workflow === 'company_both') {
      payload['in-0'] = websiteUrl;
    }

    try {
      return await this.call(workflow, payload, abortSignal);
    } finally {
      // Delete the uploaded file(s) from Stack AI's document store immediately,
      // whether the workflow succeeded, errored, or was aborted. Downstream
      // phases use downstream_summary text only, not the file. Fire-and-forget
      // so cleanup runs in parallel with response processing in CompanyAPI.
      this.clearFiles(workflow, userId);
    }
  },

  /**
   * Delete uploaded files from Stack AI's document store for a given
   * workflow + user. Best-effort: errors are logged but never thrown,
   * so a failed cleanup does not break the user-facing analysis flow.
   */
  async clearFiles(workflow, userId) {
    try {
      const result = await this.postViaIframe({
        action: 'clear_files',
        workflow: workflow,
        userId: userId,
        version: '3'
      });
      Debug.log(`[StackProxy] Cleared ${result.cleared || 0} file(s) for ${workflow}`);
    } catch (err) {
      Debug.warn(`[StackProxy] clearFiles failed (non-fatal):`, err.message);
    }
  },

  /**
   * POST data via hidden iframe to avoid CORS issues with Google Apps Script
   */
  async postViaIframe(data) {
    return new Promise((resolve, reject) => {
      const timeoutMs = 60000; // 1 minute for file upload
      let completed = false;

      // Auto-inject auth token so the proxy's role gate sees who's calling.
      if (data && !data.token && window.Auth && Auth.token) {
        data = Object.assign({}, data, { token: Auth.token });
      }

      // Create hidden iframe
      const iframe = document.createElement('iframe');
      iframe.name = 'uploadFrame_' + Date.now();
      iframe.style.display = 'none';
      document.body.appendChild(iframe);

      // Create form
      const form = document.createElement('form');
      form.method = 'POST';
      form.action = this.proxyUrl;
      form.target = iframe.name;
      form.style.display = 'none';

      // Add data as hidden input
      const input = document.createElement('input');
      input.type = 'hidden';
      input.name = 'data';
      input.value = JSON.stringify(data);
      form.appendChild(input);

      document.body.appendChild(form);

      const cleanup = () => {
        if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
        if (form.parentNode) form.parentNode.removeChild(form);
      };

      // Handle iframe load
      iframe.onload = () => {
        if (completed) return;

        setTimeout(() => {
          if (completed) return;

          try {
            const doc = iframe.contentDocument || iframe.contentWindow?.document;
            if (doc && doc.body) {
              const text = doc.body.innerText || doc.body.textContent;
              if (text && text.trim()) {
                const result = JSON.parse(text.trim());
                completed = true;
                cleanup();
                resolve(result);
                return;
              }
            }
          } catch (e) {
            Debug.warn('[StackProxy] Error reading upload response:', e.message);
          }

          // If we can't read the response, assume success (file uploads don't return much)
          if (!completed) {
            completed = true;
            cleanup();
            resolve({ success: true, message: 'Upload completed (response unreadable)' });
          }
        }, 1000);
      };

      // Timeout
      setTimeout(() => {
        if (!completed) {
          completed = true;
          cleanup();
          reject(new Error('File upload timeout'));
        }
      }, timeoutMs);

      // Submit form
      Debug.log('[StackProxy] Submitting file upload via iframe...');
      form.submit();
    });
  },
  
  /**
   * Convert File to base64
   */
  async fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const base64 = reader.result.split(',')[1];
        resolve(base64);
      };
      reader.onerror = () => {
        const errName = reader.error?.name || 'unknown';
        const errMsg = reader.error?.message || '';
        const hint = (file.size > 0 && file.size < 8192)
          ? ' — file is unusually small; if it lives in a OneDrive/SharePoint folder, it may be a cloud-only placeholder. Right-click the file in Explorer and choose "Always keep on this device", then re-add it.'
          : '';
        reject(new Error(`Failed to read file "${file.name}" (${file.size} bytes, type=${file.type || 'unknown'}): ${errName}${errMsg ? ' — ' + errMsg : ''}${hint}`));
      };
      reader.readAsDataURL(file);
    });
  },
  
  /**
   * Get/generate user ID for file uploads
   */
  /**
   * Get sanitized advisor name tag for use in user IDs
   */
  getAdvisorTag() {
    const name = document.getElementById('sca-name')?.value?.trim()
      || localStorage.getItem('scaName')
      || 'anon';
    return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').substring(0, 20);
  },

  /**
   * Build a descriptive user ID for a specific workflow
   * Format: qual_{advisor}_{workflow}_{MMdd-HHmm}
   */
  buildUserId(workflow) {
    const tag = this.getAdvisorTag();
    const ts = new Date().toISOString().slice(5, 16).replace(/[-T:]/g, '');
    return `qual_${tag}_${workflow}_${ts}`;
  },

  getUserId() {
    let userId = sessionStorage.getItem('stack_user_id');
    if (!userId) {
      const tag = this.getAdvisorTag();
      const ts = new Date().toISOString().slice(5, 16).replace(/[-T:]/g, '');
      userId = `qual_${tag}_${ts}_${Math.random().toString(36).substring(2, 6)}`;
      sessionStorage.setItem('stack_user_id', userId);
    }
    return userId;
  },
  
  /**
   * Get MIME type from filename
   */
  getMimeType(fileName) {
    const ext = fileName.split('.').pop().toLowerCase();
    const mimeTypes = {
      'pdf': 'application/pdf',
      'doc': 'application/msword',
      'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    };
    return mimeTypes[ext] || 'application/octet-stream';
  }
};

// Make available globally
window.StackProxy = StackProxy;

// Initialize on load
document.addEventListener('DOMContentLoaded', () => {
  StackProxy.init().catch(err => {
    Debug.error('[StackProxy] Failed to initialize:', err.message);
  });
});
