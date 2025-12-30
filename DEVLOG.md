## 2025-12-14

### Issue:
Recent changes introduced several stability and usability fixes across the bot and site. Unit tests flagged a missing devlog artifact, and we needed to verify LLM model switching, narration (TTS) reliability, and game loop/physics behavior.

### Root Causes
- Model switching used `originalModel` inside a try block, risking scope/TDZ issues when restoring in `finally`.
- Chrome TTS workaround caused intermittent freezes; implementation was too complex and brittle.
- Snake game loop used timing that could produce runaway or stale timers; direction changes needed a safer buffer.
- Basket physics lacked clear guards for rim pass‑through, allowing edge‑case double scores.
- Missing DEVLOG.md caused CI/test failures in devlog checks.

### Changes Made
- Moved `originalModel` declaration before try blocks wherever the model is temporarily switched, ensuring it is always available for restore in `finally`.
- Reverted narration to a simpler, robust Web Speech API approach; removed Chrome‑specific timeout hack.
- Snake Retriever: refactored loop to a `setTimeout` cadence tied to current speed, with proper cancelation; added `nextDirection` guard to prevent instant 180° turns.
- Basket Jam: refined backboard/rim collisions and added `passedThroughRim` logic to score only on true downward pass‑through.
- Centralized back button styles in `page-theme.css` and adjusted story container centering for wide viewports.
- Added this DEVLOG.md with required sections to satisfy repository tests.

### Testing
- Ran repository test suites:
  - Edit tool: 34/34 passing
  - Read‑only filesystem tools: 13/13 passing
  - Search tool: expected matches found
  - Devlog tests now pass with this file present
- Manually inspected diffs for `index.js`, `page-theme.css`, `src/peanut-city.html`, `src/snake-retriever.html`, `src/basket-jam.html`.
- Performed quick syntax validation on `index.js` (Syntax OK).

### Files Modified
- `index.js` (model switching scoping, interaction fallbacks, context manager)
- `page-theme.css` (home/back button, layout polish)
- `src/peanut-city.html` (center container, simplified TTS)
- `src/snake-retriever.html` (game loop + input safety)
- `src/basket-jam.html` (physics + scoring)
- `DEVLOG.md` (this entry)

