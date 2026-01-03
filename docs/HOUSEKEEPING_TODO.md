# Arcade Housekeeping TODO

A focused, high‑impact checklist to improve organization, consistency, and maintainability across the arcade. Grouped by area with clear actions.

## Homepage (index.html)
- [x] Add collapsible collections with per‑section toggle buttons.
- [x] Add Expand All / Collapse All controls with localStorage state.
- [ ] Add quick filter (client‑side search by title/description) above collections.
- [ ] Add optional “Recent” collection at top (see Metadata section for date fields).
- [ ] Persist user sort/filter preferences in localStorage.
- [ ] Add keyboard shortcuts: “E” expand all, “C” collapse all, “/” focus search.
- [ ] Add aria attributes for toggles and ensure collapsible state is screen‑reader friendly.

## Metadata (projectmetadata.json + index sync)
- [ ] Extend metadata entries with `createdAt` (ISO string) when added by `updateIndexWithPage()`.
- [ ] Add `updatedAt` on subsequent content edits (safe default: preserve createdAt, set updatedAt on metadata changes).
- [ ] Teach `/sync-index` to backfill missing `createdAt` using git history or file mtimes (best effort).
- [ ] Update homepage to optionally render a “Recent” section using `updatedAt || createdAt` sort.
- [ ] Add validation script to check metadata schema and fix obvious issues (missing fields, wrong collection).

## Story Pages (noir narrative templates)
- [x] Align `krispy-peaks-affair.html` to Peanut City structure (home link, progress bar, reveal, narration).
- [ ] Audit all story pages for the following:
  - [ ] Include `../page-theme.css` and `home-link` arrow.
  - [ ] Use `body.story-page` + `.story-container` layout.
  - [ ] Use standardized classes: `.chapter`, `.chapter-number`, `.chapter-title`, `.paragraph`, `.whisper`, `.emphasis`.
  - [ ] Add progress indicator and scroll‑reveal.
  - [ ] Add optional voice narration (graceful fallback if unsupported).
- [ ] Extract shared narration and reveal logic to `src/story-utils.js` and import where needed.
- [ ] Normalize accent usage (primary red, optional warm orange vs cyan) while keeping page identity.

## Assets & Styling
- [ ] Centralize repeated inline styles into reusable classes in `page-theme.css`.
- [ ] Verify `home-link` present on all pages; ensure consistent placement and hover/focus states.
- [ ] Optimize star background usage: include only on pages that benefit; lazy load `stars.js`.
- [ ] Audit color contrast for accessibility; ensure sufficient contrast for text and controls.

## File/Slug Hygiene
- [ ] Rename `src/weekend planner.html` -> `src/weekend-planner.html` and update metadata + links.
- [ ] Scan for any non‑kebab slugs or spaces and normalize.
- [ ] Ensure titles (`<title>`) reflect metadata titles; add if missing.
- [ ] Verify all pages have valid closing tags and pass a basic HTML check.

## Navigation & IA
- [ ] Add lightweight global nav fragment (optional) to pages for “← Back • Home • Random • Next”.
- [ ] Add category chips/tags on the homepage cards for quick scanning.
- [ ] Add optional pinned “Featured” items logic with explicit order in metadata.

## Performance
- [ ] Defer non‑critical scripts; move inline heavy logic to shared files and load `defer`.
- [ ] Consider CSS minification pass during deploy (keep source unminified in repo).
- [ ] Use `prefetch` for trending pages.

## Testing & Tooling
- [ ] Add `tests/metadata-validate.test.js` to check `projectmetadata.json` schema and duplicates.
- [ ] Add `tests/page-health.test.js` to sanity‑check `src/*.html` for closing tags and required includes.
- [ ] Add smoke test for homepage toggle persistence across reloads.

## Content Pipeline
- [ ] Update scribe/metadata flow to capture `createdAt`/`updatedAt` when generating new pages.
- [ ] Add `/sync-index --reflow` mode that re‑balances collections with rules (see docs/ARCHITECTURE_REVIEW.md).
- [ ] Add “New Page” template that already includes story scaffolding and home link.

## Accessibility
- [ ] Add `aria-live` updates for narration status.
- [ ] Ensure toggle buttons announce expanded/collapsed state.
- [ ] Provide reduced motion option to disable reveal animations (respect prefers‑reduced‑motion).

## Cleanups Found During Review
- [x] `src/krispy-peaks-affair.html` was truncated; rebuilt with complete HTML and improved structure.
- [ ] Run a pass to find any other truncated HTML files.
- [ ] Normalize heading levels within chapters (h1/h2/h3 consistency).

---

Notes
- Keep changes focused and incremental; avoid mass refactors in a single PR.
- Prefer extraction to shared utilities over copy‑pasting JS across pages.
- When adding metadata fields, make homepage resilient to missing values.
