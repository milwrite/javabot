# System V1: Modular Game Pipeline Architecture

**Branch**: `system-v1`
**Purpose**: Transform Bot Sportello into a reusable, agent-driven game development platform

This document describes the modular architecture implemented in the system-v1 branch, which introduces a specialized AI-driven pipeline for building mobile-first, noir-themed games and interactive pages.

---

## Architecture Overview

The system-v1 architecture separates concerns into distinct modules that work together in an autonomous pipeline:

```
User Request (slash command or @mention)
    ↓
Game Pipeline Orchestrator (gamePipeline.js)
    ↓
┌─────────────────────────────────────────────────────┐
│  PHASE 1: PLANNING                                  │
│  Agent: Architect (gameArchitect.js)                │
│  - Analyzes user request                            │
│  - Determines game type                             │
│  - Plans file structure                             │
│  - Considers recent build issues                    │
│  Output: JSON plan with metadata                    │
└─────────────────────────────────────────────────────┘
    ↓
┌─────────────────────────────────────────────────────┐
│  PHASE 2: BUILD-TEST LOOP (up to 3 attempts)        │
│                                                      │
│  Agent: Builder (gameBuilder.js)                    │
│  - Generates HTML/JS code                           │
│  - Injects mobile-first standards                   │
│  - Ensures noir theme consistency                   │
│  - Fixes issues from previous attempts              │
│  Output: Complete game files                        │
│                                                      │
│          ↓                                           │
│                                                      │
│  Agent: Tester (gameTester.js)                      │
│  - Validates HTML structure                         │
│  - Checks mobile responsiveness                     │
│  - Verifies touch controls                          │
│  - Scores code quality (0-100)                      │
│  Output: Test report with issues/warnings           │
│                                                      │
│          ↓                                           │
│                                                      │
│  ✓ Pass? → Continue to Phase 3                      │
│  ✗ Fail? → Loop back to Builder with issues         │
└─────────────────────────────────────────────────────┘
    ↓
┌─────────────────────────────────────────────────────┐
│  PHASE 3: DOCUMENTATION                             │
│  Agent: Scribe (gameScribe.js)                      │
│  - Generates metadata for projectmetadata.json     │
│  - Creates release notes in Bot Sportello voice    │
│  - Writes "How to Play" instructions               │
│  Output: Metadata and docs                          │
└─────────────────────────────────────────────────────┘
    ↓
Git Commit & Push → GitHub Pages Deployment → Live Game
```

---

## Module Structure

### `/services` - Core Infrastructure

#### **buildLogs.js**
Centralized build logging system that tracks every pipeline execution.

**Key Functions:**
- `writeBuildLog(buildId, entry)` - Append log entry to build history
- `getRecentBuilds(limit)` - Retrieve recent build metadata
- `getRecentIssues(limit)` - Extract test failures from recent builds
- `getRecentPatternsSummary(limit)` - Generate human-readable summary of common issues

**Build Log Structure:**
```json
[
  {
    "timestamp": "2025-11-30T...",
    "stage": "plan" | "build" | "test" | "scribe" | "complete" | "error",
    "...": "stage-specific data"
  }
]
```

**Purpose**: Build logs serve two critical functions:
1. **Debugging** - Complete audit trail of what went wrong
2. **Learning** - Pattern analysis feeds back into Architect to avoid repeating mistakes

#### **llmClient.js**
Unified interface for OpenRouter API calls with role-specific prompting.

**Key Functions:**
- `callSonnet({ role, messages, tools, model })` - Main API wrapper
- `extractJSON(content)` - Parse JSON from markdown-wrapped responses

**Role-Specific Prompts:**
- `architect` - Planning and game design
- `builder` - Code generation with standards enforcement
- `tester` - Validation and quality assurance
- `scribe` - Documentation and metadata generation

**Base Context**: All agents share common context about:
- Repository structure
- Noir terminal design system
- Mobile-first requirements
- URL structure
- Required page elements

#### **gamePipeline.js**
Main orchestrator that coordinates all agents and manages the build lifecycle.

**Key Functions:**
- `runGamePipeline(options)` - Execute full pipeline with progress callbacks
- `commitGameFiles(result)` - Git add/commit generated files
- `isGameRequest(prompt)` - Classify if user request is game-related

**Pipeline Options:**
```javascript
{
  userPrompt: string,           // User's game request
  triggerSource: {              // Source metadata
    kind: 'slash' | 'mention',
    userId: string,
    username: string
  },
  onStatusUpdate: async (msg) => {}, // Progress callback
  preferredType: 'auto' | 'arcade-2d' | ...
  maxAttempts: 3                // Build retry limit
}
```

**Pipeline Result:**
```javascript
{
  ok: boolean,
  buildId: string,
  plan: { ... },                // Architect's plan
  buildResult: { ... },         // Generated files
  testResult: { ... },          // Validation report
  docs: { ... },                // Metadata and notes
  duration: string,             // Build time
  liveUrl: string              // GitHub Pages URL
}
```

---

### `/agents` - Specialized AI Agents

Each agent is a thin wrapper around `llmClient.js` with role-specific logic.

#### **gameArchitect.js**
Plans game structure and implementation approach.

**Input:**
- User prompt
- Recent patterns summary (from build logs)
- Preferred type hint (optional)

**Output (JSON Plan):**
```json
{
  "type": "arcade-2d",
  "slug": "snake-noir",
  "files": ["src/snake-noir.html", "src/snake-noir.js"],
  "metadata": {
    "title": "Snake Noir",
    "icon": "🐍",
    "description": "retro snake arcade",
    "collection": "arcade-games"
  },
  "mechanics": ["arrow key movement", "collision detection", "score tracking"],
  "mobileControls": "d-pad",
  "notes": ["use standard D-pad pattern", "include CRT scanlines"]
}
```

**Strategy**: Architect considers recent build failures to avoid repeating mistakes. If mobile controls were missing in recent builds, it explicitly notes "MUST include mobile-controls" in the plan.

#### **gameBuilder.js**
Generates complete, working code from the Architect's plan.

**Key Features:**
- Generates HTML with embedded or linked JavaScript
- Automatically injects essential elements (viewport, home link, page-theme.css)
- Implements mobile controls using standard D-pad pattern
- On retry attempts, addresses specific issues from Tester

**Code Quality Standards:**
- No placeholders or TODO comments
- Complete implementations only
- Proper event handling (touchstart + click fallback)
- Responsive breakpoints (768px, 480px minimum)

**Retry Logic**: If Builder's first attempt fails testing, Tester's issues are fed back:
```javascript
buildGame({
  plan,
  attempt: 2,
  lastIssues: [
    { code: 'NO_MOBILE_CONTROLS', message: 'Missing mobile controls', severity: 'critical' },
    { code: 'MISSING_VIEWPORT', message: 'Missing viewport meta tag', severity: 'critical' }
  ]
})
```

Builder receives this as: "PREVIOUS ATTEMPT FAILED WITH THESE ISSUES: 1. [critical] Missing mobile controls..."

#### **gameTester.js**
Validates generated code against mobile-first and noir theme standards.

**Validation Strategy**: Two-phase approach
1. **Automated checks** (regex/string matching) - Fast, deterministic
2. **LLM validation** (Claude review) - Catches subtle issues

**Critical Checks (fail if missing):**
- HTML structure complete (`<!DOCTYPE>`, `<html>`, `<head>`, `<body>`, `</html>`)
- Viewport meta tag
- page-theme.css link
- For games: mobile-controls present
- For games: responsive breakpoints

**Mobile-Specific Checks:**
- `touch-action: manipulation` CSS
- Touchstart event handlers
- Min 44px touch targets
- No `overflow: hidden` on body
- @media queries present

**Output (Test Result):**
```json
{
  "ok": true,
  "issues": [],
  "warnings": [
    { "code": "NO_TOUCH_EVENTS", "message": "No touchstart handlers found", "severity": "warning" }
  ],
  "score": 95
}
```

**Scoring**: 100 base - (20 per critical issue) - (5 per warning)

#### **gameScribe.js**
Generates documentation and updates project metadata.

**Outputs:**
1. **Refined metadata** for `projectmetadata.json`
2. **Release notes** in Bot Sportello's casual voice
3. **"How to Play"** instructions (optional, for games)

**Metadata Entry:**
```json
{
  "title": "Snake Noir",
  "icon": "🐍",
  "description": "retro snake arcade",  // 3-6 words max
  "collection": "arcade-games",
  "hidden": false
}
```

**Caption Style Guide:**
- 3-6 words maximum
- Adjective + noun + type pattern
- Examples: "retro snake arcade", "cosmic maze crawler", "noir terminal planner"
- NOT: "A game where you...", "Interactive story about..."

**Release Notes Example:**
> "yeah built you a snake game with mobile d-pad controls and high score tracking - works smooth on phones, CRT scanlines for that arcade feel"

---

## Integration with Bot Sportello

### Slash Command: `/build-game`

**Parameters:**
- `title` (required) - Game title (e.g., "Snake", "Space Maze")
- `prompt` (required) - Description of mechanics, theme, features
- `type` (optional) - Game type hint or "Auto-detect"

**Choices for type:**
- Auto-detect (default)
- Arcade / 2D Game
- Interactive Fiction
- Infographic / Visual
- Utility / App

**Flow:**
1. User invokes `/build-game`
2. Bot defers reply
3. Pipeline runs with progress updates via `interaction.editReply()`
4. On success: Commits files, pushes to GitHub, shows embed with live URL
5. On failure: Shows error embed with build log path

**Success Embed Fields:**
- Type, Collection, Quality Score
- Files generated
- Live URL
- Build time
- Optional: "How to Play"
- Optional: Minor warnings

### @Mention Auto-Detection

The mention handler now includes game request classification:

```javascript
if (isGameRequest(content)) {
  // Route to game pipeline instead of normal chat
  await runGamePipeline({ ... });
  // Skip normal AI response flow
  return;
}
```

**Detection Keywords**: game, arcade, play, platformer, puzzle, snake, tetris, pong, maze, shooter, adventure, interactive, score, highscore, controls, d-pad, etc.

**Example User Messages That Trigger Pipeline:**
- "@Bot Sportello make a snake game"
- "@Bot Sportello can you build an arcade maze game?"
- "@Bot Sportello create a puzzle with mobile controls"

**Fallback**: If game pipeline fails mid-execution, bot falls back to normal chat flow with error context.

---

## Learning from Build History

### Pattern Summarization

The `getRecentPatternsSummary()` function analyzes the last 10 builds and identifies recurring issues:

```javascript
const summary = await getRecentPatternsSummary(10);
// Returns:
// "Recent recurrent issues:
//  - Missing mobile controls (seen 3 times)
//  - No responsive breakpoints (seen 2 times)
//  - Missing touch-action CSS (seen 2 times)
//  Please avoid repeating them."
```

This summary is injected into the Architect's prompt on every new build, creating a feedback loop that improves quality over time.

### No Fine-Tuning Required

The system achieves "learning" through:
1. Explicit pattern summaries in prompts
2. Automated test criteria enforced by Tester
3. Iterative retry logic with specific issue feedback

No model fine-tuning or embeddings required - just stateless prompting with context from build logs.

---

## Mobile-First Standards Enforcement

### Required Mobile Elements

All generated games/pages MUST include:

1. **Viewport Meta Tag**
```html
<meta name="viewport" content="width=device-width, initial-scale=1.0">
```

2. **Responsive Breakpoints**
```css
@media (max-width: 768px) { /* Tablet/mobile landscape */ }
@media (max-width: 480px) { /* Mobile portrait */ }
```

3. **Touch-Friendly Controls** (for games)
```css
.dpad-btn {
  touch-action: manipulation;
  -webkit-tap-highlight-color: transparent;
  min-height: 44px;
  min-width: 44px;
}
```

4. **Touch Event Handlers**
```javascript
btn.addEventListener('touchstart', (e) => {
  e.preventDefault();  // Prevent zoom
  handleInput();
}, { passive: false });
btn.addEventListener('click', handleInput); // Desktop fallback
```

5. **Standard D-Pad Pattern** (directional games)
```html
<div class="mobile-controls-label">Tap arrows to move →</div>
<div class="mobile-controls" id="mobileControls">
  <button class="dpad-btn dpad-up" data-direction="up">▲</button>
  <button class="dpad-btn dpad-left" data-direction="left">◄</button>
  <button class="dpad-btn dpad-center" disabled>●</button>
  <button class="dpad-btn dpad-right" data-direction="right">►</button>
  <button class="dpad-btn dpad-down" data-direction="down">▼</button>
</div>
```

### Why These Standards Matter

**Context**: Discord is mobile-forward. Most users view Bot Sportello's creations on phones.

**44px Touch Targets**: W3C accessibility guideline (AAA criterion) ensures users can tap buttons without frustration ￼.

**touch-action: manipulation**: Prevents mobile browser zoom-on-tap, which breaks game UX.

**preventDefault() on touchstart**: Critical for smooth mobile gameplay - prevents scroll/zoom during interaction.

---

## Noir Terminal Design System

### Color Palette
- **Primary**: `#7ec8e3` (sky blue) - main accent
- **Red**: `#ff0000` - buttons, highlights, warnings
- **Cyan**: `#00ffff` - secondary text, headings
- **Background**: `#0a0a0a` (near-black)
- **Font**: `'Courier Prime'` monospace

### Required Page Elements
1. Link to `../page-theme.css`
2. `.home-link` navigation (`← HOME`)
3. Body padding-top: 80px (space for home button)
4. CRT scanlines and flicker effects (via CSS)

### Theme Consistency
Both `index.html` (embedded CSS) and individual pages (`page-theme.css`) use matching palette. The Scribe agent ensures new games land in appropriate collections (arcade-games, utilities-apps, etc.) in `projectmetadata.json`.

---

## Reusability Across Bots

The modular structure makes these components reusable:

### Portable Modules
- `/services/llmClient.js` - Works with any OpenRouter-compatible AI
- `/services/buildLogs.js` - Generic build logging (no Discord dependencies)
- `/agents/*` - Stateless functions, easily adaptable

### Bot-Specific Adapters
- `/services/gamePipeline.js` - Orchestrator with simple-git dependency
- `index.js` - Discord-specific command handlers

### How to Reuse in Another Bot

1. **Copy modules**: `/services` and `/agents` directories
2. **Configure**: Update `llmClient.js` base context for your project
3. **Wire triggers**: Replace Discord slash command with your bot's command system
4. **Adapt orchestrator**: Modify `gamePipeline.js` if using different VCS or deployment

**Example for Slack Bot:**
```javascript
// Slack command handler
app.command('/build-game', async ({ command, ack, say }) => {
  await ack();

  const result = await runGamePipeline({
    userPrompt: command.text,
    triggerSource: { kind: 'slack', userId: command.user_id },
    onStatusUpdate: async (msg) => {
      await say(msg);
    }
  });

  await say(result.ok ? `Game ready: ${result.liveUrl}` : `Build failed: ${result.error}`);
});
```

---

## Development Workflow

### Making Changes

1. **Agents**: Edit role-specific prompts in `llmClient.js` (ROLE_PROMPTS object)
2. **Validation**: Update test criteria in `gameTester.js` (runAutomatedChecks function)
3. **Standards**: Modify `BASE_SYSTEM_CONTEXT` in `llmClient.js` to change design requirements
4. **Pipeline**: Adjust retry logic or max attempts in `gamePipeline.js`

### Testing Locally

```bash
# Install dependencies (if not already done)
npm install

# Run in development mode with auto-restart
npm run dev

# Trigger a build
# Use /build-game in Discord or @mention with "make a snake game"
```

### Debugging Build Failures

1. Check `build-logs/{buildId}.json` for full pipeline trace
2. Look at `stage: 'test'` entries for validation failures
3. Review Builder's output in `stage: 'build'` entries
4. Check console for LLM API errors

**Common Issues:**
- **Architect returns invalid JSON**: Check `extractJSON()` function, may need better parsing
- **Builder generates incomplete HTML**: Increase `maxTokens` in `gameBuilder.js`
- **Tester too strict**: Adjust scoring in `gameTester.js` or make certain checks warnings instead of errors

---

## Future Enhancements

### Potential Improvements

1. **Visual Testing**: Integrate headless browser (Playwright/Puppeteer) to screenshot games and verify rendering
2. **Performance Metrics**: Add page load time, bundle size checks to Tester
3. **A/B Variations**: Have Builder generate 2-3 variations, let user choose
4. **Automated Playtesting**: Simulate gameplay to catch logic bugs (e.g., snake can move through walls)
5. **Style Variants**: Allow users to request "neon" or "minimal" themes per-game
6. **Multiplayer Support**: Expand Builder's capabilities to include WebSocket-based multiplayer games

### Scaling Considerations

- **Rate Limiting**: Current implementation has no OpenRouter rate limit handling - add exponential backoff
- **Parallel Builds**: Pipeline is single-threaded - could parallelize multiple user requests with queue system
- **Caching**: Cache Architect plans for similar prompts to reduce API calls
- **Build Artifacts**: Store generated HTML/JS in build logs for easy rollback

---

## Commit Message Convention

Per repository standards:
- **Format**: Short, lowercase, no sign-off
- **Examples**:
  - `add system-v1 game pipeline modules`
  - `enhance mention handler with game routing`
  - `fix tester validation for mobile controls`

---

## Key Files Added/Modified

### New Files (system-v1 branch)
```
/services/
  buildLogs.js         - Build logging and pattern analysis
  llmClient.js         - Unified LLM API client
  gamePipeline.js      - Pipeline orchestrator

/agents/
  gameArchitect.js     - Game planning agent
  gameBuilder.js       - Code generation agent
  gameTester.js        - Validation agent
  gameScribe.js        - Documentation agent

/build-logs/           - Directory for build history (created on first run)
  {timestamp}.json     - Per-build log files

SYSTEM_V1.md           - This documentation file
```

### Modified Files
```
index.js               - Added /build-game command, enhanced @mention handler
```

---

## Conclusion

System V1 transforms Bot Sportello from a single-file monolith into a modular, agent-driven platform. The architecture is:

✅ **Reusable** - Core modules work across different bot frameworks
✅ **Testable** - Clear separation of concerns, automated validation
✅ **Self-improving** - Learn from build history without fine-tuning
✅ **Mobile-first** - Enforces accessibility and responsive design
✅ **Noir-themed** - Maintains consistent aesthetic automatically

By separating planning, building, testing, and documentation into distinct agents, the system achieves high code quality while remaining flexible and maintainable.

The pipeline can generate complete, working games from a single sentence prompt - and they'll be playable on mobile devices right out of the gate.

---

**Last Updated**: 2025-11-30
**Branch**: system-v1
**Status**: Ready for testing
