**Architecture Review — Issues & Improvements**

**Last Updated:** Dec 17, 2025
**Status:** Ongoing - Some items resolved, others pending

This document highlights gaps observed during the README refactor and suggests targeted improvements to make Bot Sportello more reliable and maintainable. Items marked with ✅ RESOLVED have been implemented; items marked with 🔄 IN PROGRESS are being worked on; items marked with ⏳ PENDING are recommended for future implementation.

**⏳ PENDING: Tool API mismatches**
- `search_files` tool schema vs implementation:
  - Tool advertises `file_pattern` and `case_insensitive` (snake_case) but `searchFiles()` expects `filePattern` and `caseInsensitive` (camelCase). Calls from the LLM may silently ignore filters.
  - Fix: Align names in both the tool JSON and implementation. Prefer camelCase throughout for consistency.

**⏳ PENDING: Style preset mismatch**
- Slash command `update-style` exposes `soft-arcade`, while `updateStyle()` understands `noir-terminal`, `neon-arcade`, `dark-minimal`, `retro-terminal`.
- Fix: Standardize choices; either map `soft-arcade` → `noir-terminal` or present the same set in both layers.

**🔄 IN PROGRESS: Discord ready event**
- Code uses `client.once('clientReady', ...)` (intended for forward compatibility per CLAUDE.md), while discord.js v14 uses `'ready'`.
- Note: Per CLAUDE.md, this is intentional for v15 forward compatibility; using 'ready' would trigger deprecation warnings.
- Status: Working as designed; monitor for discord.js v15 release.

**🔄 IN PROGRESS: OpenRouter model references**
- Presets include multiple 2025 models with varying availability.
- Documented in CLAUDE.md with user expectations; runtime validation on access.
- Status: Acceptable; errors handled gracefully with user-facing messages.

**⏳ PENDING: Global MODEL leak in classifier**
- Legacy concern; `requestClassifier.js` reads free variable `MODEL` if available.
- Priority: Low (already constrained to fallback usage).
- Fix: Pass model as argument or use `process.env` default only.

**🔄 IN PROGRESS: Remote URL + token handling**
- Per CLAUDE.md (Dec 17 update): Uses `getEncodedRemoteUrl()` for secure token formatting.
- Token embedded only during push operations, then cleared afterward.
- Status: Improved; documents proper cleanup procedure.

**⏳ PENDING: Duplication across edit vs normal loops**
- Separate edit loop (`getEditResponse`) and general loop (`getLLMResponse`) maintain similar tool specs and logic.
- Fix: Factor shared tool definitions into a single constant to avoid drift; keep "edit mode" as a constrained tool subset.

**✅ RESOLVED: Classifier fallback behavior**
- Per DEVLOG.md (Dec 14): Added read-only verb detection to `isEditRequest()` and improved `isContentRequest()`.
- System properly routes list/show/search/find queries to main LLM loop with full tool access.
- Added context-aware thinking messages for better UX.

**⏳ PENDING: GUI server CORS**
- GUI allows `origin: "*"`. It's a local tool, but unrestricted CORS can invite accidental cross-origin access.
- Fix: Restrict to `http://localhost:<port>` (configurable) and disable in headless or production environments.

**⏳ PENDING: Index sync + metadata**
- `sync-index` backfills `projectmetadata.json` from `src/*.html`. If collection names change, backfill defaults to `unsorted`.
- Improvement: Provide `/sync-index --reflow` to re-balance collections by rules (or prompt the user via Discord with choices).

**⏳ PENDING: Long responses and storage**
- Long messages are saved to `responses/` with a timestamp. Good for auditability, but the directory can grow unbounded.
- Improvement: Add rotation or a cleanup command, and emit a GUI metric for `responses/` size.

**⏳ PENDING: DEVLOG watcher**
- `fs.watchFile` on `DEVLOG.md` regenerates `SITE_INVENTORY.md`. Works, but has no shutdown hook.
- Improvement: Expose a small lifecycle method to stop watchers cleanly; log error counts to GUI.

**🔄 IN PROGRESS: Error loop tracker**
- Great safety feature (3 errors → 5‑minute cooldown).
- Per CLAUDE.md: Consider exempting read-only operations from counting toward cooldown (future refinement).
- Status: Working as designed; minimal user impact.

**⏳ PENDING: Docs and onboarding**
- Document URL↔path mapping (done in README). Consider adding a small `/where <url>` command to print the local file path and open last commit.

**⏳ PENDING: Testing & CI**
- No automated tests for the tool-calling layer. Add focused unit tests for:
  - `searchFiles()` options normalization and output formatting
  - `editFile()` exact replacement guardrails and error cases
  - Classifier fallback routing when OpenRouter is unavailable

**✅ RESOLVED: Mobile-first design enforcement**
- Per CLAUDE.md (Dec 17 updated): All 45 HTML pages unified to noir terminal aesthetic.
- Mandatory responsive breakpoints (@768px, @480px), 44px+ touch targets, mobile-first layout hierarchy.
- All generated pages include `.mobile-controls` and proper CSS structure.

**⏳ PENDING: Minor polish (framework script inclusion)**
- Some features reference Phaser or p5.js in copy; ensure pages include required script tags if those paths are used.
- Ensure all generated game pages have consistent canvas max width (currently enforced in templates).

## Summary

**Total Items:** 16
- ✅ **RESOLVED:** 2 items (Classifier fallback, Mobile-first design)
- 🔄 **IN PROGRESS:** 4 items (Discord ready event, OpenRouter models, Remote URL handling, Error loop tracker)
- ⏳ **PENDING:** 10 items (Tool API mismatch, Style presets, Global MODEL leak, Duplication, CORS, Index sync, Long responses, DEVLOG watcher, Docs, Testing/CI)

**Priority Order for Next Sprint:**
1. Tool API mismatches (affects all searches)
2. Duplication across edit vs normal loops (technical debt)
3. Testing & CI (improves reliability)
4. Long response storage rotation (prevents unbounded growth)

These items are intentionally small and focused for incremental adoption. Tackle items by priority or availability.

