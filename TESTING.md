# System V1 Testing Checklist

## Pre-Testing Setup

- [ ] On `system-v1` branch
- [ ] All dependencies installed (`npm install`)
- [ ] `.env` file configured with all required vars
- [ ] Bot registered in Discord test server
- [ ] GitHub PAT has repo write permissions

## Module Unit Tests

### `/services/buildLogs.js`

- [ ] `ensureLogDir()` creates `/build-logs` directory
- [ ] `writeBuildLog()` creates new log file with timestamp
- [ ] `writeBuildLog()` appends to existing log file
- [ ] `getRecentBuilds()` returns builds sorted by mtime (newest first)
- [ ] `getRecentIssues()` extracts test failures correctly
- [ ] `getRecentPatternsSummary()` generates human-readable summary
- [ ] Handles missing `/build-logs` directory gracefully

### `/services/llmClient.js`

- [ ] `callSonnet()` with role='architect' uses correct system prompt
- [ ] `callSonnet()` with role='builder' uses correct system prompt
- [ ] `callSonnet()` with role='tester' uses correct system prompt
- [ ] `callSonnet()` with role='scribe' uses correct system prompt
- [ ] `extractJSON()` parses clean JSON
- [ ] `extractJSON()` parses markdown-wrapped JSON (```json)
- [ ] `extractJSON()` finds JSON object in mixed text
- [ ] API errors are caught and logged
- [ ] Retry logic works for 5xx errors

### `/agents/gameArchitect.js`

- [ ] `planGame()` returns valid JSON plan structure
- [ ] Plan includes: type, slug, files, metadata, mechanics, mobileControls, notes
- [ ] Slug is kebab-case (no spaces, lowercase)
- [ ] Files array includes proper paths (src/*.html)
- [ ] Recent patterns summary is incorporated into planning
- [ ] Different user prompts generate different plans
- [ ] Preferred type hint is respected

### `/agents/gameBuilder.js`

- [ ] `buildGame()` generates complete HTML (ends with `</html>`)
- [ ] HTML includes DOCTYPE, html, head, body tags
- [ ] Viewport meta tag is injected if missing
- [ ] page-theme.css link is injected if missing
- [ ] Home link is injected if missing
- [ ] Generated files are written to disk
- [ ] Separate JS file is created if plan includes .js file
- [ ] Retry attempts receive lastIssues parameter
- [ ] Markdown code blocks are cleaned from output

### `/agents/gameTester.js`

- [ ] `testGame()` validates HTML structure
- [ ] Missing `</html>` tag flagged as critical issue
- [ ] Missing viewport flagged as critical issue
- [ ] Missing mobile-controls (for games) flagged as critical issue
- [ ] Missing page-theme.css flagged as critical issue
- [ ] Mismatched script tags flagged as critical issue
- [ ] Markdown artifacts (```) flagged as critical issue
- [ ] Warnings don't fail validation (ok=true with warnings)
- [ ] Quality score decreases with issues/warnings
- [ ] LLM validation catches subtle issues
- [ ] Handles LLM validation failure gracefully (falls back to auto-checks)

### `/agents/gameScribe.js`

- [ ] `documentGame()` generates metadata JSON
- [ ] Metadata includes: title, icon, description, collection
- [ ] Description is 3-6 words (caption style)
- [ ] Release notes are in Bot Sportello's casual voice
- [ ] Optional howToPlay is included for games
- [ ] Falls back to plan metadata if LLM fails
- [ ] `updateProjectMetadata()` updates projectmetadata.json
- [ ] New project entry is added correctly
- [ ] Existing project entry is updated correctly

### `/services/gamePipeline.js`

- [ ] `runGamePipeline()` executes all 4 phases
- [ ] onStatusUpdate callback is called at each stage
- [ ] Build-test loop retries up to maxAttempts times
- [ ] Successful build exits loop early
- [ ] Failed build returns ok=false with error details
- [ ] Build logs are written at each stage
- [ ] Final result includes liveUrl
- [ ] `commitGameFiles()` stages and commits generated files
- [ ] `isGameRequest()` detects game-related keywords
- [ ] `isGameRequest()` returns false for non-game prompts

## Integration Tests

### `/build-game` Slash Command

- [ ] Command appears in Discord slash command list
- [ ] Required parameters: title, prompt
- [ ] Optional parameter: type (with choices)
- [ ] Bot defers reply immediately
- [ ] Progress updates appear in edited reply
- [ ] Successful build shows embed with:
  - Title, type, collection, quality score
  - Files generated
  - Live URL
  - Build time
  - Optional: How to Play
  - Optional: Minor warnings
- [ ] Failed build shows error embed with:
  - Build ID
  - Build log path
  - Top 5 issues
- [ ] Files are committed to git
- [ ] Files are pushed to GitHub
- [ ] GitHub Pages deployment succeeds (check live URL after 2 min)

### @Mention Game Routing

- [ ] "@Bot make a snake game" triggers game pipeline
- [ ] "@Bot create an arcade shooter" triggers game pipeline
- [ ] "@Bot can you help with JavaScript?" does NOT trigger pipeline (normal chat)
- [ ] Game request detection message appears
- [ ] Progress updates appear in edited thinking message
- [ ] Success message includes live URL, quality score, build time
- [ ] Failed build shows error with build log path
- [ ] Normal chat flow works if pipeline fails
- [ ] Conversation history is updated correctly

### index.js Integration

- [ ] Bot starts without errors
- [ ] Game pipeline modules are imported correctly
- [ ] /build-game command is registered on startup
- [ ] handleBuildGame function is called for /build-game
- [ ] handleMentionAsync includes game detection logic
- [ ] Error tracking still works for game commands
- [ ] Build logs directory is created automatically

## End-to-End Tests

### Simple Arcade Game

**Prompt**: "Make a simple snake game with arrow key controls and score tracking"

- [ ] Architect plans arcade-2d type
- [ ] Builder generates HTML with canvas
- [ ] Mobile D-pad controls are included
- [ ] Tester validates successfully (score >= 60)
- [ ] Scribe generates appropriate metadata
- [ ] Files committed: src/snake-*.html, (optional src/snake-*.js)
- [ ] projectmetadata.json updated with new entry
- [ ] Live URL loads and game is playable
- [ ] Mobile controls work on phone (test via Discord mobile)
- [ ] Desktop arrow keys work
- [ ] Score tracking functional

### Interactive Fiction

**Prompt**: "Create a text adventure about exploring a noir detective office"

- [ ] Architect plans interactive-fiction type
- [ ] Builder generates HTML with text-based UI
- [ ] Choice buttons have 44px min height
- [ ] Tester validates successfully
- [ ] Collection is "stories-content"
- [ ] Story is playable and choices work
- [ ] Mobile-friendly layout (readable on phone)

### Build Retry Logic

**Prompt**: Intentionally vague to trigger validation failure
"Make a game"

- [ ] First build attempt fails validation
- [ ] Tester returns specific issues
- [ ] Second build attempt receives issues in prompt
- [ ] Builder addresses issues
- [ ] Second or third attempt passes
- [ ] Final result is valid

### Pattern Learning

**Setup**: Run 3 builds that all fail with "Missing mobile controls"

- [ ] Build logs capture all 3 failures
- [ ] `getRecentPatternsSummary()` identifies pattern
- [ ] Next build's Architect prompt includes warning about mobile controls
- [ ] Next build includes mobile controls (pattern avoided)

## Performance Tests

- [ ] Simple game builds in < 60 seconds
- [ ] Complex game builds in < 120 seconds
- [ ] Pipeline handles API rate limits gracefully
- [ ] No memory leaks after 10 consecutive builds
- [ ] Build logs don't grow unbounded (old logs can be manually cleaned)

## Error Handling Tests

### OpenRouter API Errors

- [ ] 500 error triggers retry (up to 3 attempts)
- [ ] Network timeout is caught and reported
- [ ] Invalid API key shows clear error message
- [ ] Quota exceeded error is handled gracefully

### Git Errors

- [ ] Merge conflict during push is caught
- [ ] Remote repository unavailable is handled
- [ ] Invalid GitHub token shows clear error
- [ ] Push timeout is caught and logged

### Discord Errors

- [ ] Bot offline during build shows error to user
- [ ] Message edit fails (interaction expired) is caught
- [ ] Invalid channel permissions are handled
- [ ] User deletes message mid-build (no crash)

### Validation Edge Cases

- [ ] Incomplete HTML (missing </html>) fails validation
- [ ] Empty HTML file fails validation
- [ ] HTML with only markdown (no actual HTML) fails validation
- [ ] HTML with mismatched tags is caught
- [ ] Extremely long HTML (>100KB) is handled

## Mobile Responsiveness Tests

On actual mobile device (or Chrome DevTools mobile emulation):

- [ ] Generated game loads on 320px width screen
- [ ] Generated game loads on 480px width screen
- [ ] Generated game loads on 768px width screen
- [ ] Touch controls are visible and sized >= 44px
- [ ] Tapping controls doesn't zoom page
- [ ] Touch events register correctly (no delays)
- [ ] Page scrolls without horizontal overflow
- [ ] Text is readable (min 14px)
- [ ] Buttons don't overlap
- [ ] Home link doesn't obscure content

## Accessibility Tests

- [ ] Touch targets >= 44px (W3C AAA criterion)
- [ ] Color contrast meets standards (light text on dark bg)
- [ ] Keyboard navigation works (for desktop users)
- [ ] Screen reader can access game instructions (if applicable)
- [ ] No hover-only interactions

## Regression Tests

Ensure new system doesn't break existing functionality:

- [ ] `/add-page` still works
- [ ] `/add-feature` still works
- [ ] `/commit` still works
- [ ] `/status` still works
- [ ] `/chat` still works
- [ ] `/search` still works
- [ ] `/set-model` still works
- [ ] `/poll` still works
- [ ] `/update-style` still works
- [ ] `/sync-index` still works
- [ ] `/set-prompt` still works
- [ ] @mentions for non-game requests still work
- [ ] Conversation history (agents.md) still updates
- [ ] Error tracking/cooldowns still work

## Documentation Tests

- [ ] SYSTEM_V1.md is accurate and comprehensive
- [ ] CLAUDE.md updated with system-v1 architecture
- [ ] Code comments are clear and helpful
- [ ] TESTING.md (this file) is complete

## Final Checks

- [ ] All tests passing
- [ ] No console errors during normal operation
- [ ] Build logs directory created and populated
- [ ] projectmetadata.json valid JSON after builds
- [ ] No uncommitted changes in git
- [ ] Ready to merge into main branch

---

## Test Results Log

**Date**: _____________
**Tester**: _____________
**Branch**: system-v1

### Summary

- Total Tests: ____ / ____
- Passed: ____
- Failed: ____
- Skipped: ____

### Failed Tests

1. _____________________________________________
   - Reason: __________________________________
   - Fix: _____________________________________

2. _____________________________________________
   - Reason: __________________________________
   - Fix: _____________________________________

### Notes

_____________________________________________
_____________________________________________
_____________________________________________
