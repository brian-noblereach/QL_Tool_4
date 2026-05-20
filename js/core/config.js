// js/core/config.js
// Shared runtime config for the v04 SPA. Loaded first in index.html so every
// other script can reference window.AppConfig.* without import order pain.
//
// Why a single source: the v04 GAS proxy URL was previously hardcoded in
// three places (auth.js, smartsheet.js, stack-proxy-v2.js). CLAUDE.md called
// out the redeploy footgun explicitly — forgetting to update one breaks
// auth / queue / live-run independently.

window.AppConfig = {
  // v04 GAS Web App URL (deployed May 2026 — separate from v03's deployment).
  // After a fresh proxy deploy, update THIS line only.
  proxyUrl: 'https://script.google.com/macros/s/AKfycbz18i2bhdn48Tq8iIguPjau3pFWvyaEEf_n-cqNoY1u6fMYfYsugp3e0L2uA1oSe44s/exec'
};
