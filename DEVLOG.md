## 2025-12-25

### Fix: LLM Router Now Runs Before Fast Paths

**Issue:** Bot was not following instructions - requests like "tell a story about cen's dreams" were being classified as CONVERSATION and routed to a fast path without tool access, even though they required content creation.

**Root Cause:** The keyword-based `requestClassifier` ran BEFORE the LLM router, and its fallback (line 275-284) defaulted unknown requests to `isConversation: true`. This triggered the conversation fast path, which bypassed the full agent with tools.

**Fix:** Moved `generateRoutingPlan()` to run FIRST (before fast path checks). The conversation fast path now only triggers if BOTH:
1. Router says `intent='chat'` with `confidence >= 0.6`
2. Classifier says `isConversation=true`

If the router identifies a non-chat intent (create, edit, build, etc.), the request goes to the full agent with tools regardless of what the keyword classifier says.

### Files Modified
- `index.js` - Moved router generation before while loop, added router gating for conversation fast path
- `CLAUDE.md` - Added CLI log queries, documented router flow
- `README.md` - Updated @ Mentions section to show router-first architecture
- `docs/BOT_OPERATION_FLOW.md` - Updated mermaid diagram and component breakdown

---

## 2025-12-24

### Feature: LLM-Based Intelligent Routing

Added a new routing layer that uses an LLM to generate structured routing plans before tool execution, replacing coarse-grained keyword classification with nuanced tool sequencing.

### Changes Made
- Created `services/llmRouter.js` with LLM-based routing plan generation
- Router outputs structured plans: intent, toolSequence, parameterHints, confidence, reasoning
- Integrated routing guidance injection into `getLLMResponse()` system prompt
- Added prerequisite enforcement (e.g., `file_exists` → `read_file` → `edit_file`)
- Graceful fallback to pattern matching if LLM routing fails

### Technical Details
- Router model: `google/gemma-3-12b-it` (best accuracy/speed tradeoff)
- Latency: ~2-4s per routing decision
- 100% LLM routing success rate in testing (4/4 test cases)
- Tool catalog with speed/cost metadata for intelligent sequencing

### Files Modified
- `services/llmRouter.js` (NEW - 490 lines)
- `index.js` (import router, inject guidance into LLM calls)

### Testing
- Tested edit, search, build, and chat routing scenarios
- Compared Kimi K2, GLM 4.5 Air, Gemma 3 12B, Gemma 3n E4B
- Gemma 3 12B selected for best accuracy with acceptable latency

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

