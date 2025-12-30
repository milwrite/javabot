## 2025-12-30

### Issue:
Game generation pipeline included D-pad arrow controls in ALL arcade games, even when inappropriate for the interaction pattern. Touch-based games (memory match, simon, clicker) received unused D-pad controls, while typing games got directional controls instead of keyboard listeners. This created confusing UX with non-functional controls.

### Root Causes
- Binary `isGame` check treated all arcade-game types identically, forcing D-pad on all games
- GAME_SCAFFOLD template hardcoded D-pad controls with comment "REQUIRED for all games"
- Builder agent used single control requirement for all games: "MUST include mobile controls"
- Tester validation used OR condition (`mobile-controls` OR `touch`) allowing D-pads in tap games
- No distinction between directional movement games and direct-touch interaction games

### Changes Made
Implemented 5-pattern taxonomy system for context-aware control selection:

**Pattern Taxonomy:**
- `directional-movement`: D-pad controls (snake, platformer, maze, frogger)
- `direct-touch`: Canvas/element touch or keyboard (memory match, clicker, typing games)
- `hybrid-controls`: D-pad + action buttons (tower defense, angry birds)
- `form-based`: Form inputs with localStorage (calculators, utilities)
- `passive-scroll`: No controls (stories, letters, recipes)

**Template System Refactor** ([config/templates.js](config/templates.js)):
- Added 5 modular `CONTROLS_*` component objects (html + js patterns)
- Created `buildGameTemplate(pattern, options)` function for pattern-aware assembly
- Added helpers: `getControlsForPattern()`, `getPatternDescription()`, `inferPatternFromContentType()`
- Marked old scaffolds (GAME_SCAFFOLD, etc.) as DEPRECATED
- Updated TEMPLATE_PROMPT with pattern-specific examples for LLM

**Agent Pipeline Updates:**
- Architect ([services/llmClient.js](services/llmClient.js)): Expanded prompt with pattern taxonomy, JSON schema requires `interactionPattern` field
- Builder ([agents/gameBuilder.js](agents/gameBuilder.js)): Pattern-aware prompts with control requirements per pattern
- Tester ([agents/gameTester.js](agents/gameTester.js)): Pattern-specific validation with critical error codes
  - `UNWANTED_DPAD`: Direct-touch pattern has D-pad (critical failure)
  - `MISSING_DPAD`: Directional-movement pattern missing D-pad (critical failure)
  - `MISSING_TOUCH_HANDLERS`: Direct-touch missing touch/click listeners
  - `UNWANTED_GAME_CONTROLS`: Passive content has game controls

**Validation Improvements** ([index.js](index.js)):
- Replaced binary `context.isGame` checks with pattern-specific validation
- Updated `validateHTMLContent()`: checks pattern-control alignment
- Updated `calculateQualityScore()`: awards +10 for correct controls, -15 penalty for mismatches
- System prompt ([personality/systemPrompt.js](personality/systemPrompt.js)): Pattern-based control guidance

### Testing
Built test suite verifying all 5 patterns:
- ✅ Snake game (directional-movement): Includes D-pad with handleDirection()
- ✅ Memory game (direct-touch): NO D-pad, has canvas touch handlers
- ✅ Tower defense (hybrid-controls): Has both D-pad AND action button
- ✅ Letter (passive-scroll): NO game controls at all
- ✅ Invalid pattern: Falls back to direct-touch safely

All tests passed. Template lengths: directional-movement (2314 chars), direct-touch (1974 chars), hybrid (2494 chars), passive (866 chars).

### Expected Outcomes
**Before:**
- Memory match: D-pad controls (unused) ❌
- Typing game: D-pad controls (wrong) ❌
- Snake: D-pad controls (correct) ✅

**After:**
- Memory match: `direct-touch` → no D-pad, canvas touch handlers ✅
- Typing game: `direct-touch` → no D-pad, keyboard listeners ✅
- Snake: `directional-movement` → D-pad with handleDirection() ✅
- Stories: `passive-scroll` → no controls at all ✅

### Files Modified
- `config/templates.js` (+389 lines: 5 control components, buildGameTemplate(), helpers, updated prompts)
- `services/llmClient.js` (Architect/Builder/Tester prompts with pattern taxonomy)
- `agents/gameBuilder.js` (pattern-aware control requirement mapping)
- `agents/gameTester.js` (pattern-specific validation with 5 critical error codes)
- `personality/systemPrompt.js` (pattern-based mobile controls guidance)
- `index.js` (pattern-aware validateHTMLContent() and calculateQualityScore())

### Migration Notes
- Backward compatible: existing games unaffected (static HTML files)
- Default fallback: `direct-touch` if pattern missing/invalid
- Old scaffolds marked DEPRECATED, kept for rollback safety
- Pattern logged in build metadata for debugging

---

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

