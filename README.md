# NobleReach Venture Assessment Platform — v04

The NobleReach Foundation's Science-to-Venture (S2V) **Qualification Tool**, redesigned to **decouple analysis from review**. Where v03 ran the full ~7-minute Stack AI analysis live in the advisor's browser, v04 has Associates pre-load a cohort of ventures, a background runner works through them over hours or days, and advisors log in when ready to score on their own schedule.

Used internally by Senior Commercialization Advisors (SCAs) to evaluate ventures coming out of research institutions across NobleReach's funded portfolios.

This repository contains only the **frontend SPA**. The backend components — a Google Apps Script proxy, a PowerShell runner on a NobleReach VM, two Smartsheet sheets — are organizationally specific and not published here. See [Standing up your own backend](#standing-up-your-own-backend) below if you want to fork this.

---

## What v04 changes vs. v03

| Aspect | v03 | v04 |
|---|---|---|
| When the AI analysis runs | Live in the advisor's browser (~7 min wait per venture) | Background, on a runner over hours/days. Advisor sees only the finished result. |
| Who triggers it | Advisor (one venture at a time) | Associate (cohort pre-load); runner picks up automatically. Advisor can also trigger a live re-run from the modal if needed. |
| Cohort throughput | Bound by advisor availability and end-of-deadline crunch | ~3 ventures/day cap (token budget, with the Literature Review phase enabled — was ~7 before v04.1); spreads naturally across days |
| Where AI evidence lives | In-browser state, optionally cached in localStorage | Smartsheet row attachment — accessible from any browser/device |
| Advisor's queue | The "Load Previous" modal, often confused with localStorage cache | First-class **My Queue** view backed by Smartsheet |
| Multi-file inputs | One file per venture | Pitch deck + invention disclosure + … (multiple SharePoint URLs per row, or direct upload in the live-run modal) |
| Scoring / submit / PDF export | Unchanged | Unchanged — the assessment view is reused verbatim |

---

## Architecture

```
┌─────────────────────────┐
│  Associate browser      │   1. Associate opens Queue Management,
│  (role=associate)       │      pastes Venture URL + SharePoint
└──────────┬──────────────┘      file URLs + advisor name.
           ▼
┌─────────────────────────┐
│  GAS proxy (Web App)    │   2. Browser → proxy via JSONP, proxy
│  validates, writes row  │      writes to the v04 queue sheet.
└──────────┬──────────────┘
           ▼
┌─────────────────────────┐
│  v04 Queue sheet        │   3. Smartsheet Gov (FedRAMP Moderate)
│  (Smartsheet Gov)       │      holds queue rows + AI evidence
└──────────┬──────────────┘      attachments.
           ▼
┌─────────────────────────┐
│  PowerShell runner      │   4. Runs every 5 min via Task Scheduler.
│  (on a NobleReach VM)   │      Picks up Queued rows, calls Stack AI
│  every 5 min            │      (Venture Info → 6 downstream phases in
│                         │      parallel, incl. Scientific Evidence →
│                         │      sequential Synthesis phase that fuses
│                         │      Competitive + Literature + SV into one
│                         │      cohesive view), persists each phase's
│                         │      output for cheap retries, attaches final
│                         │      JSON to the row, flips to Ready.
└──────────┬──────────────┘
           ▼
┌─────────────────────────┐
│  Advisor browser        │   5. Advisor logs in, picks their name,
│  (role=internal)        │      sees their queue. Four sections:
│                         │      In Progress / Needs Attention /
│                         │      To Review / Completed.
└──────────┬──────────────┘
           ▼
┌─────────────────────────┐   6. Click Open → assessment view loads
│  Assessment view        │      with all six dimensions populated.
│  (reused from v03)      │      Advisor scores 1–9, adds rationale,
│                         │      picks a verdict, submits.
└──────────┬──────────────┘
           ▼
┌─────────────────────────┐
│  v03 scores sheet       │   7. Scores land in the long-standing v03
│  (Smartsheet Gov)       │      scores Smartsheet; queue row flips
└─────────────────────────┘      to Reviewed.
```

---

## Repository layout

This is what lives in the public repo:

```
.
├── README.md                          ← This file
├── CLAUDE.md                          ← Developer reference (architecture, conventions, future work)
├── .gitignore
├── index.html                         ← SPA entry point
├── assets/                            ← Brand logos / favicon
├── css/
│   └── styles.css                     ← Brand styling
└── js/
    ├── core/
    │   ├── app.js                     ← Application controller, role-based routing
    │   ├── auth.js                    ← Token + role auth via GAS proxy
    │   ├── state-manager.js           ← Draft-only localStorage layer
    │   └── pipeline.js                ← Live Stack AI orchestrator (used by "Run new analysis" modal)
    ├── components/
    │   ├── assessment-view.js         ← Tab-based assessment rendering + scoring
    │   ├── assessment-loader.js       ← Shared "render a queue row's evidence into the assessment view" core (used by My Queue + External views)
    │   ├── associate-view.js          ← Queue Management UI for Associates (+ admin-only external share-tag picker)
    │   ├── advisor-queue-view.js      ← "My Queue" view for Advisors
    │   ├── external-view.js           ← Read-only "Shared Analyses" view for university partners (e.g. Georgetown)
    │   ├── summary-view.js
    │   ├── tab-manager.js
    │   ├── toast-manager.js
    │   └── modal-manager.js
    ├── api/                           ← Per-dimension response shapers + Stack AI HTTP helper
    │   ├── stack-proxy-v2.js
    │   ├── company.js / team.js / funding.js / competitive.js / market.js / iprisk.js
    │   ├── literature.js              ← Scientific Evidence (Literature Review) shaper — not a scored dimension; fuses into Competitive + Solution Value
    │   └── synthesis.js               ← Unified Synthesis shaper (v04.2) — consolidates Competitive + Literature + SV into a unified competitor grid and merged value-prop table
    └── utils/                         ← validators, confidence, formatters, export, smartsheet, …
```

Backend components (Google Apps Script proxy, PowerShell runner, Smartsheet schemas, prompt + schema docs) live alongside the maintainer's working copy but are intentionally not published.

---

## How the tool is used

### As an Associate

1. Log in with the `associate` password. Land on **Queue Management**.
2. Click **Add Venture**. Fill in:
   - Venture Name (required)
   - Advisor (dropdown of known advisors — assigned to whoever will score the result)
   - Associate (dropdown — who is queueing this)
   - Portfolio
   - Venture URL **and / or** SharePoint input-file URL(s) — one URL per line; commonly a pitch deck plus an invention disclosure. Files must already be uploaded to the SharePoint `queue-inputs/` folder.
   - Optional: Institution, Pre-load notes
3. Submit. The row appears in the queue with status `Queued`. Within 5 minutes the runner picks it up, status flips to `Running`, then `Ready` when the AI analysis finishes (typically ~8 min). If the submitted materials are too thin to assess the venture, the runner halts before scoring and marks the row `Failed` with an `INSUFFICIENT_INPUT:` reason — add more source material (pitch deck / invention disclosure / working URL) and re-queue.

### As an Advisor

1. Log in with the `internal` password. Land on **My Queue**.
2. Pick your name from the dropdown.
3. You'll see up to four sections, each with a count badge:
   - **In Progress** — ventures the runner is currently working on, or queued behind it. No action — the page auto-refreshes every 30 seconds, so they slide into the next section when ready.
   - **Needs Attention** — ventures whose AI analysis failed. The tooltip on the FAILED pill shows the last error; ping the Associate to retry. This also includes ventures the tool **halted for insufficient input** (error starts with `INSUFFICIENT_INPUT:`): the submitted materials didn't contain enough to assess the venture, so no scores were produced. These need *better input* (a pitch deck, invention disclosure, or working URL) — re-queueing without adding material will halt again.
   - **To Review** — ventures ready for your scoring.
   - **Completed** — ventures you've already submitted. Click Open to revise; the form re-populates your prior scores and shows an "Updating existing scores" banner.
4. Click **Open** on a To Review venture. The assessment view loads with all six dimensions populated (Researcher Aptitude, Sector Funding, Competitive Winnability, Market Opportunity, IP Landscape, Solution Value). Score each on a 1–9 scale with rationale, then submit your final recommendation. Status flips to `Reviewed`.

**v04.9 — Sector Funding grant coverage (current).** The Sector Funding tab now tells you when its grant search came back empty *because the search failed*, rather than because the sector has no money in it. Those two situations used to look identical — and the tool reported the more damaging one with full confidence: one venture scored **1 / "No Sector Activity"** on a landscape that actually contains relevant NIH and SBIR device grants, because five of the six search phrases it generated matched nothing at all and the sixth was filtered out. Three changes you'll notice:

- **An amber caveat at the top of the tab** when grant search coverage was incomplete, stating plainly that a low score is not a verified finding. If the cause is a configuration problem rather than anything about the venture, the banner says so — that one is worth reporting rather than working around.
- **The AI can no longer score 1 or 2 on a search it can't vouch for.** Those two levels assert that activity is verifiably absent. Under caveat the score is floored and flagged for human review, and the AI is barred from writing that the sector has no funding. Note this is the *opposite* direction from the v04.8 IP guard below, and deliberately so: on IP an incomplete search makes a reassuring answer dangerous, so the score is capped; on funding it makes a discouraging answer dangerous, so the score is floored.
- **Better grant retrieval generally.** Grants are now found by relevance rather than by award size. Previously any sufficiently broad search returned the largest federal awards in the country — national-lab operating contracts, LIGO operations — which are irrelevant to every venture and counted for nothing, so the sector looked empty. Ventures analyzed before v04.9 show no caveat either way, since the older runs didn't record coverage.

Also fixed: the Solution Value tab no longer shows a permanent "⏳ Awaiting: Synthesis analysis" notice on a finished venture. The evidence below it was always complete — only the notice was wrong, and it was waiting on something that had already failed and would never arrive.

**v04.8 — IP search coverage.** The IP Landscape tab can now tell you when it *couldn't search thoroughly enough for its own answer to mean anything*. Previously a thin patent search and a genuinely clear patent landscape looked identical — both showed a green "0 active core blockers" badge — which is the most dangerous way for a diligence tool to be wrong. Now, when retrieval coverage is incomplete, you get an amber caveat at the top of the tab, that badge goes neutral instead of green, a "Patent Search Coverage" section appears on the Sources tab, and the caveat carries into the PDF. The AI is also barred from calling freedom-to-operate "favorable" on a thin search, and the IP score is capped at 6 — **that ceiling reflects an incomplete search, not discovered blocking patents**, and the score justification says so. Practically: if you see this caveat, treat the IP score as a ceiling rather than a finding, and don't read "no blockers found" as "free to operate." Ventures analyzed before v04.8 show no caveat either way, since the older runs didn't record coverage.

**v04.7 — funding amounts.** Every money column in the Sector Funding tab (Sector VC Deals, Federal Grants, and the venture's own funding panel) reads as a compact dollar figure — `$1.2M`, `$275K`, `$274.8K`, `$850M` — and amounts the source didn't disclose read `Undisclosed`. Before v04.7 these were rendered ~1000x high with a stray "B" suffix (a $1.2M NSF award showed as "$1200B"). The fix is in how the page renders the stored figures, not in the stored figures themselves, so **it applies retroactively** — re-open any earlier venture and the amounts are now correct with no re-run needed.

**v04.2 — Unified Synthesis.** Two of the six dimensions are now driven by a synthesis layer that fuses the Competitive flow output, the Literature Review output, and the company's Solution Value data into one cohesive presentation. The rubric is unchanged — these are evidence panels, not new scoring inputs:

- **Competitive Winnability → Detailed tab.** One unified competitor grid replaces the v04.1 two-panel layout. Each card has source badges (Company / Trial / Academic Lab / Discontinued — synthesis dedupes entities that show up in multiple sources). Where available, Reranker per-competitor scores show as clickable badges (relevance 0-10, threat 0-10, winnability_vs color badge); clicking expands the rationale. The Summary tab shows a `winnability_summary` color badge and the Reranker's `effective_competitor_count` alongside the existing metrics; the AI Assessment Rationale is replaced by the synthesis-written 2-3 paragraph narrative.
- **Solution Value → synthesis-led layout.** Lead block at the top: severity/gap chips + a synthesis-written narrative that ties unmet need + who feels it + value proposition into one cohesive story + an unmet-need framing paragraph. Primary table: "Value Proposition vs. Incumbent Baseline" — one row per claim with Dimension / Venture Claim / Incumbent Baseline / Improvement / Evidence (source-tagged) / Strength (confirmed / partial / aspirational). The Solution Value score remains human-entered. "The Unmet Need" (raw company-extracted fields) demotes to a "Source-material detail" panel default-collapsed; "Related Evidence" (cross-tab market gaps + competitive gaps) is retired.
- **Graceful fallback.** When synthesis is absent (older ventures from v04.1, or the synthesis call failed), both sections render with the v04.1 layout — separate Company Competitors grid + Scientific Evidence Competitors collapsed panel, and the SV tab's Section 3 (Magnitude of Benefit) + Section 3.5 (Evidence vs. Incumbent Baseline) tables side by side.

**Scope boundary.** This stage of qualification is driven by externally observable evidence delivered by tech-transfer offices (pitch decks, invention disclosures, papers, patents, public trial records). It does *not* incorporate PI-conversation insights — readiness/maturity judgments that depend on direct conversations belong in the separate Business Readiness Level tool.

### Optional: Live run

Advisors can click **+ Run new analysis** at the top of My Queue to trigger a v03-style live analysis directly from the browser, bypassing the queue. This is intended for ad-hoc evaluations where the venture isn't in the standard cohort. Files can be uploaded directly (up to 50 MB total) — they go to Stack AI for the duration of the analysis and are deleted immediately after. The run is ephemeral; if the tab closes, the AI evidence is gone, but any scores submitted along the way are saved.

### As Admin

The `admin` password unlocks both views. A sidebar role switcher lets you flip between Associate and Advisor without re-logging in. Admin is also the only role that sees the **Share externally with** picker on the Queue Management form — use it to tag a venture for a university partner (see below).

### As a university partner (read-only)

A university partner (e.g. Georgetown) gets a **custom password** that lands them on a read-only **Shared Analyses** view. They see only the ventures you pre-loaded and tagged for them whose analysis is complete (`Ready` or `Reviewed`) — nothing else in the queue, and no other university's ventures. They can open each assessment and read the full AI analysis, and may move the scoring sliders / type justifications / set a verdict to record their own opinion. **Nothing they enter is ever sent to NobleReach or saved to the shared system** — it's kept only in their own browser (so they can review a venture across multiple sittings and pick up where they left off), and they can export a PDF. They cannot run analyses or reach any management screen.

To give a partner access (admin/maintainer):
1. Add an entry to `EXTERNAL_ACCESS` in the proxy (`{ key, propKey, scope, label, expiresAt }`), with an optional `expiresAt` cutoff date.
2. In the GAS editor, run `setExternalUniversityPassword('EXTERNAL_PW_<NAME>', '<their password>')` (this does **not** log out staff sessions).
3. When you queue each of their ventures in Queue Management, set **Share externally with** to that partner.

To end access, delete or rotate their password (`deleteExternalUniversityPassword(...)`) or set their `expiresAt` to a past date — access lapses on their next request.

---

## Standing up your own backend

This repo is open for transparency and for forks that want to adapt the frontend to their own venture-evaluation pipeline. The frontend is just a static site, but it depends on three backend pieces that you'd need to provide yourself:

1. **A Google Apps Script Web App** that proxies Smartsheet and Stack AI calls. It must implement the JSONP / iframe action protocol the frontend uses (`auth`, `verify`, `config`, `queue_*`, `queue_*_external`, `smartsheet*`, `upload_file`, `clear_files`). The maintainer's version is roughly 1,000 lines; the contract is documented in CLAUDE.md.
2. **A PowerShell runner (or equivalent)** on a machine that has access to your file store. Polls Smartsheet for `Queued` rows, calls Stack AI, attaches the resulting JSON. The maintainer's runner uses Windows Task Scheduler under a user account (no admin rights required); see `runner-vm/README.md` in the maintainer's tree for installation.
3. **Two Smartsheet sheets** — a queue sheet (22 columns, schema in the maintainer's `docs/smartsheet-queue-template.csv`) and a scores sheet (inherited from v03's design).

The frontend talks to the proxy through three hard-coded URLs in `js/core/auth.js`, `js/utils/smartsheet.js`, and `js/api/stack-proxy-v2.js`. Update all three to point at your own deployment.

---

## Status

PoC, in active internal use as of May 2026. Daily token cap defaults to ~6 ventures/day on the runner with all v04.2 phases enabled (Scientific Evidence + Unified Synthesis). Earlier estimates of ~3/day were too conservative — the actual measured per-venture cost is ~2M tokens, not the originally-projected ~4M. A 20-venture cohort processes comfortably across 3-4 days.

---

## License

Internal NobleReach Foundation tooling. The code is published here for transparency; it is not a turnkey project, and there is no support obligation.
