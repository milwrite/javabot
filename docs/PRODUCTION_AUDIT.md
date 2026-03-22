# Production Audit — Bot Sportello

**Auditor:** Petrarch (Clawdbot)
**Date:** 2026-03-22
**Repo:** milwrite/javabot (bot.inference-arcade.com)
**Clone:** ~/clawd/sidequests/bot-sportello-prod

---

## Executive Summary

- **91 arcade pages** in `src/`, 97% passing verification (713/728)
- **38/38 tests pass** (responseHealing suite)
- **All JS syntax-checks clean** (node --check)
- **9 npm audit vulns** (all undici via discord.js — no fix without major version bump)
- **No leaked secrets** in committed code
- **Desktop checkout is cloud-stubbed** (iCloud "compressed,dataless") — 316 files throw EDEADLK. Clean clone from GitHub is the working copy.

---

## 🔴 Critical Issues

### 1. Desktop checkout is unusable (iCloud dehydration)
`~/Desktop/STUDIO/projects/bot-sportello` has `compressed,dataless` flags on most files. Reads fail with `EDEADLK` (error -11). **Cannot run bot from Desktop path.**
- **Fix:** Run from a non-iCloud path. Clone to `~/clawd/sidequests/bot-sportello-prod` (done).

### 2. `index.js` is 3,893 lines — monolith risk
All Discord orchestration, tool implementations, agent loop, command handlers, and git wiring live in one file. Any change risks cascading breakage.
- **Fix (non-urgent):** Continue Phase 2/3 extraction already in progress (filesystem, git, metadata already pulled out). Next targets: command handlers, agent loop, tool definitions.

---

## 🟡 Code Quality Issues

### 3. Two pages fail arcade verification
- `src/enlightenment-breathing.html` (4/8) — missing page-theme.css, missing home-link
- `src/grocery-run.html` (3/8) — missing page-theme.css, missing home-link, missing metadata entry
- **Fix:** Add theme CSS link, home-link nav, and projectmetadata.json entries.

### 4. `TODO.md` contains dissertation research kanban, not bot tasks
- Out of place in the bot repo. Confuses project scope.
- **Fix:** Move to a personal notes location or replace with actual bot TODOs.

### 5. `MEMORY.md` is stale JSON (last entry: 2026-02-22)
- Only one entry. Not being maintained.
- **Fix:** Either automate memory updates or remove the file.

### 6. Unused/stale files
- `javabot-backup-20251218-020318/` — entire backup directory in repo root (not gitignored)
- `mason-dixon/` — separate project living inside bot repo
- `src/examples/` — untracked directory (per git status)
- `.git/index 2.lock` — stale lock file in Desktop checkout
- **Fix:** gitignore or remove backup dir; consider separating mason-dixon.

### 7. `package.json` name is still `javabot`
- Repo name on GitHub is `javabot` but the project identity is "Bot Sportello"
- **Fix:** Rename in package.json to `bot-sportello` for clarity.

### 8. npm audit: 8 vulnerabilities (1 low, 4 moderate, 3 high)
- All in `undici` dependency chain via `discord.js`
- Fixing requires discord.js v13 (major version downgrade — not recommended)
- **Fix:** Accept risk. Monitor discord.js for v15 release with patched undici.

---

## 🟢 What's Working Well

- **responseHealing.js** — comprehensive JSON repair for malformed LLM output (38 test cases)
- **Modular personality system** — clean separation in `personality/` tree
- **Agent pipeline** — Architect → Builder → Tester → Scribe is well-structured
- **Site verification script** — `verify-arcade.sh` catches regressions
- **CNAME + GitHub Pages** — deployment surface is clean
- **Fallback API key logic** — OpenRouter key rotation on failure
- **Unified agent logging** — `services/agentLogging.js` replaces scattered logging

---

## Recommended Fix Order

1. ✅ Fix 2 failing arcade pages (enlightenment-breathing, grocery-run)
2. ✅ Clean up stale/unused files (backup dir, TODO.md)
3. Rename package.json
4. Consider extracting index.js handlers into separate modules
5. Set up proper .env on the clean clone for runtime testing
