**Architecture Review — Issues & Improvements**

This document highlights gaps observed during the README refactor and suggests targeted improvements to make Bot Sportello more reliable and maintainable.

**Tool API mismatches**
- `search_files` tool schema vs implementation:
  - Tool advertises `file_pattern` and `case_insensitive` (snake_case) but `searchFiles()` expects `filePattern` and `caseInsensitive` (camelCase). Calls from the LLM may silently ignore filters.
  - Fix: Align names in both the tool JSON and implementation. Prefer camelCase throughout for consistency.

**Style preset mismatch**
- Slash command `update-style` exposes `soft-arcade`, while `updateStyle()` understands `noir-terminal`, `neon-arcade`, `dark-minimal`, `retro-terminal`.
- Fix: Standardize choices; either map `soft-arcade` → `noir-terminal` or present the same set in both layers.

**Discord ready event**
- Code uses `client.once('clientReady', ...)` (intended for forward compatibility per CLAUDE.md), while discord.js v14 uses `'ready'`.
- Risk: In environments where `'clientReady'` is not emitted, slash commands won’t register.
- Fix: Use `'ready'` today and guard for future rename with a small compatibility shim.

**OpenRouter model references**
- Presets include `openai/gpt-5.1-codex`, `google/gemini-2.5-pro`, `moonshotai/kimi-k2-0905:exacto`, `z-ai/glm-4.6:exacto`.
- Risk: Availability varies by account; unknown models will 4xx. Set expectations in README (done) and add runtime validation with a user-facing error when a model is not accessible.

**Global MODEL leak in classifier**
- `services/requestClassifier.js` reads a free variable `MODEL` if available. In Node this won’t exist unless explicitly exported to `global`.
- Fix: Pass the model as an argument from callers or read a namespaced `process.env` default only.

**Remote URL + token handling**
- Code sets the `origin` URL with an embedded PAT before pushing. Works, but stores a token in `.git/config` unless overwritten later.
- Improvements:
  - Use ephemeral credential helper (e.g., environment-based `GIT_ASKPASS`) or set the tokenized remote only for push and immediately reset it back to the non-token URL.
  - Consider a GitHub App for scoped, revocable credentials.

**Duplication across edit vs normal loops**
- Separate edit loop (`getEditResponse`) and general loop (`getLLMResponse`) maintain similar tool specs and logic.
- Fix: Factor shared tool definitions into a single constant to avoid drift; keep “edit mode” as a constrained tool subset.

**Classifier fallback behavior**
- On LLM classification failure, fallback defaults to CONVERSATION except for obvious CREATE/READ phrases. That’s safe, but FUNCTIONALITY_FIX requests could get misrouted to a plain chat.
- Improvement: Add a light keyword set for fixes (e.g., `fix|css|button|responsive|mobile|style|broken`) to route more requests into tool-enabled flows when the LLM call fails.

**GUI server CORS**
- GUI allows `origin: "*"`. It’s a local tool, but unrestricted CORS can invite accidental cross-origin access.
- Fix: Restrict to `http://localhost:<port>` (configurable) and disable in headless or production environments.

**Index sync + metadata**
- `sync-index` backfills `projectmetadata.json` from `src/*.html`. If collection names change, backfill defaults to `unsorted`.
- Improvement: Provide `/sync-index --reflow` to re-balance collections by rules (or prompt the user via Discord with choices).

**Long responses and storage**
- Long messages are saved to `responses/` with a timestamp. Good for auditability, but the directory can grow unbounded.
- Improvement: Add rotation or a cleanup command, and emit a GUI metric for `responses/` size.

**DEVLOG watcher**
- `fs.watchFile` on `DEVLOG.md` regenerates `SITE_INVENTORY.md`. Works, but has no shutdown hook.
- Improvement: Expose a small lifecycle method to stop watchers cleanly; log error counts to GUI.

**Error loop tracker**
- Great safety feature (3 errors → 5‑minute cooldown). Consider exempting read-only operations from counting toward the cooldown window.

**Docs and onboarding**
- Document URL↔path mapping (done in README). Consider adding a small `/where <url>` command to print the local file path and open last commit.

**Testing & CI**
- No automated tests for the tool-calling layer. Add focused unit tests for:
  - `searchFiles()` options normalization and output formatting
  - `editFile()` exact replacement guardrails and error cases
  - Classifier fallback routing when OpenRouter is unavailable

**Minor polish**
- Some features reference Phaser or p5.js in copy; ensure pages include required script tags if those paths are used.
- Ensure all generated game pages include `.mobile-controls` (Tester already scans for this) and adopt consistent canvas max width.

—
These items are intentionally small and focused for incremental adoption. If you want, I can submit targeted patches for any of the above.

