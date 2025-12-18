# System-V1 Test Plan
**Branch:** `system-v1`
**Date:** November 30, 2025
**Status:** 🚀 Ready for Testing

## Overview

This document outlines the comprehensive testing strategy for the system-v1 branch, which introduces:
1. **Modular Game Pipeline** - Architect → Builder → Tester → Scribe agents
2. **Content Validation System** - Quality scoring and iterative retry logic
3. **Build Logging** - Pattern learning from build history
4. **Mobile-First Enforcement** - Automatic viewport, controls, responsive design

## Architecture Components

### Core Services
- `services/gamePipeline.js` - Main orchestrator
- `services/llmClient.js` - Unified OpenRouter API client
- `services/buildLogs.js` - Build logging and pattern analysis

### Agent Modules
- `agents/gameArchitect.js` - Plans game structure from user prompt
- `agents/gameBuilder.js` - Generates HTML/JS code with mobile-first standards
- `agents/gameTester.js` - Validates code quality and responsiveness
- `agents/gameScribe.js` - Creates metadata and documentation

### Validation Functions (index.js)
- `validateHTMLContent()` - Lines 418-490
- `validateJSContent()` - Lines 492-529
- `calculateQualityScore()` - Lines 531-552
- `buildValidationFeedback()` - Lines 554-569

## Test Categories

### 1. Unit Tests (Manual Verification)

#### 1.1 HTML Validation
- [ ] **Complete HTML** - Valid HTML passes all checks
- [ ] **Missing DOCTYPE** - Should warn but not fail
- [ ] **Missing viewport** - Should FAIL (critical for mobile)
- [ ] **Missing closing tags** - Should detect mismatched tags
- [ ] **Game without mobile controls** - Should FAIL for games
- [ ] **Game without @media** - Should FAIL for games
- [ ] **Missing touch-action** - Should warn for games
- [ ] **Scoring accuracy** - Verify 0-100 range with proper bonuses/penalties

#### 1.2 JavaScript Validation
- [ ] **Valid JS** - Clean code passes
- [ ] **Markdown artifacts** - Detects ```js blocks
- [ ] **Too short** - Flags files < 100 chars
- [ ] **Mismatched braces** - Detects { } imbalance
- [ ] **Mismatched parens** - Detects ( ) imbalance
- [ ] **TODO comments** - Warns about placeholders

### 2. Integration Tests

#### 2.1 Game Pipeline Flow
- [ ] **Full pipeline success** - Architect → Builder → Tester → Scribe completes
- [ ] **Build retry on failure** - Failed test triggers Builder retry (up to 3 attempts)
- [ ] **Build log creation** - JSON log written to `build-logs/{timestamp}.json`
- [ ] **Pattern learning** - Recent failures inform next Architect plan
- [ ] **Metadata update** - `projectmetadata.json` updated with new game
- [ ] **File writing** - Game files written to `src/` directory
- [ ] **Git operations** - Files added, committed, pushed to GitHub

#### 2.2 Slash Command Integration
- [ ] **`/build-game`** - Triggers pipeline with title + prompt + optional type
- [ ] **`/add-page`** - Uses validation system + retry logic
- [ ] **`/add-feature`** - Validates both JS + HTML demo
- [ ] **Quality scores in embeds** - Discord shows 0-100 score with color coding
- [ ] **Status updates** - Real-time progress via edited replies

#### 2.3 @ Mention Integration
- [ ] **Game keyword detection** - "game", "arcade", "puzzle" trigger pipeline
- [ ] **Fallback to chat** - Non-game mentions use normal AI response
- [ ] **Tool calling** - Mention can create pages/features with validation
- [ ] **Deduplication** - No duplicate responses from duplicate events

### 3. Quality Assurance Tests

#### 3.1 Mobile-First Compliance
- [ ] **Viewport enforcement** - All pages have viewport meta tag
- [ ] **Touch controls** - Games have `.mobile-controls` with D-pad pattern
- [ ] **Responsive breakpoints** - @media (max-width: 768px) and (max-width: 480px)
- [ ] **Touch-action CSS** - Buttons have `touch-action: manipulation`
- [ ] **44px touch targets** - Minimum size for accessibility
- [ ] **Prevent zoom** - touchstart + preventDefault on controls

#### 3.2 Retry Logic
- [ ] **First attempt pass** - High quality content passes immediately
- [ ] **Second attempt pass** - Medium quality retries once and passes
- [ ] **Third attempt graceful fail** - Poor quality saves after 3 attempts with warnings
- [ ] **Feedback injection** - Validation issues passed to subsequent prompts
- [ ] **Score improvement** - Scores increase from attempt 1 → 2 → 3

#### 3.3 Build Logging
- [ ] **Log file creation** - `build-logs/{buildId}.json` created
- [ ] **Stage tracking** - plan, build (attempts 1-3), test (attempts 1-3), docs
- [ ] **Error capture** - Failed builds logged with full error details
- [ ] **Pattern analysis** - `getRecentPatternsSummary()` identifies common failures
- [ ] **Log retention** - Last 10 builds analyzed for patterns

### 4. End-to-End Tests

#### 4.1 Simple Game Build
**Test Case:** Create a basic Snake game
```
/build-game title:"Classic Snake" prompt:"Simple snake game with arrow key controls and mobile D-pad. Green snake, red food, black background."
```

**Expected Outcome:**
- Architect plans arcade-type game with mobile controls
- Builder generates HTML with embedded JS
- Tester validates mobile compliance (viewport, controls, @media)
- Scribe creates metadata entry in `projectmetadata.json`
- Files committed and pushed to GitHub
- Quality score 80-100
- Live URL returned in Discord embed

#### 4.2 Complex Interactive Fiction
**Test Case:** Create a story-based game
```
/build-game title:"Mystery Mansion" prompt:"Interactive fiction game where you explore a haunted mansion. Multiple choices, inventory system, atmospheric noir theme." type:"if"
```

**Expected Outcome:**
- Architect plans "if" type with state management
- Builder creates story engine with choice buttons
- Tester validates mobile-friendly buttons (44px min)
- Quality score 70-90
- Build logs show planning decisions

#### 4.3 Intentionally Challenging Request
**Test Case:** Request with incomplete description
```
/build-game title:"Game" prompt:"Make a game"
```

**Expected Outcome:**
- Architect makes reasonable assumptions (default to simple arcade)
- Builder fills in gaps with best practices
- May require 2-3 attempts to pass tests
- Quality score 60-80
- No critical failures

#### 4.4 Mobile Control Validation
**Test Case:** Game that should trigger mobile requirements
```
/add-page name:"frog-jump" description:"Frogger-style game where you jump across traffic"
```

**Expected Outcome:**
- Game detection via "game" keyword
- Validation requires `.mobile-controls` class
- Validation requires `@media` breakpoints
- Validation requires viewport meta tag
- First attempt may fail, retry should fix
- Final score 75+

### 5. Error Handling Tests

#### 5.1 OpenRouter API Failures
- [ ] **Rate limiting** - Graceful backoff and retry
- [ ] **Timeout** - Falls back after 60s timeout
- [ ] **Invalid response** - Catches JSON parsing errors
- [ ] **Model unavailable** - Uses fallback model

#### 5.2 Git Operation Failures
- [ ] **No git remote** - Detects and reports error
- [ ] **Push conflict** - Detects remote changes
- [ ] **Authentication failure** - Clear error message
- [ ] **Timeout protection** - 30s limit on git operations

#### 5.3 Filesystem Failures
- [ ] **Permission denied** - Catches write errors
- [ ] **Disk full** - Handles ENOSPC gracefully
- [ ] **Directory not found** - Creates directories recursively

### 6. Performance Tests

#### 6.1 Build Time Benchmarks
- [ ] **Simple page** - < 15 seconds (1 attempt)
- [ ] **Game with retry** - < 45 seconds (3 attempts)
- [ ] **Feature (JS + HTML)** - < 30 seconds (2 attempts)

#### 6.2 Token Usage
- [ ] **Architect** - ~2,000 tokens per plan
- [ ] **Builder** - ~5,000 tokens per build
- [ ] **Tester** - ~3,000 tokens per test
- [ ] **Scribe** - ~1,000 tokens per doc
- [ ] **Total worst case** - ~33,000 tokens (3 build attempts)

#### 6.3 Memory Usage
- [ ] **Build log cleanup** - Old logs deleted after 50+ builds
- [ ] **Message history pruning** - agents.md limited to 100 messages
- [ ] **No memory leaks** - Long-running bot stable

### 7. Regression Tests

#### 7.1 Existing Features Still Work
- [ ] **`/commit`** - Git operations unchanged
- [ ] **`/chat`** - AI conversations work
- [ ] **`/search`** - Web search functional
- [ ] **`/status`** - Shows repo status
- [ ] **`/set-model`** - Model switching works
- [ ] **`/update-style`** - Styling updates work
- [ ] **`/poll`** - Polls still work

#### 7.2 No Breaking Changes
- [ ] **Old pages still load** - Existing src/ files unchanged
- [ ] **Metadata intact** - projectmetadata.json not corrupted
- [ ] **Styling consistent** - page-theme.css still works
- [ ] **Main index works** - index.html unchanged

## Test Execution Plan

### Phase 1: Manual Unit Tests (30 min)
1. Test validation functions with crafted inputs
2. Verify scoring algorithm accuracy
3. Test edge cases (empty files, malformed HTML)

### Phase 2: Integration Tests (1 hour)
1. Run `/build-game` with simple request
2. Monitor logs for each pipeline stage
3. Verify build log JSON structure
4. Check metadata update
5. Verify live site deployment

### Phase 3: Quality Validation (45 min)
1. Create game without mobile controls (should retry)
2. Create page without viewport (should retry)
3. Verify quality scores match expectations
4. Test Discord embed color coding

### Phase 4: Error Scenarios (30 min)
1. Simulate git failure (disconnect network)
2. Test with invalid OpenRouter key
3. Request impossible game (should degrade gracefully)

### Phase 5: End-to-End Scenarios (1 hour)
1. Build 5 different game types:
   - Arcade (Snake)
   - Puzzle (Sudoku)
   - Interactive Fiction (Mystery story)
   - Infographic (Data visualization)
   - Utility (Calculator)
2. Verify all pass quality checks
3. Verify live URLs work on mobile devices
4. Test actual touch controls on phone

### Phase 6: Regression Testing (30 min)
1. Run all existing slash commands
2. Verify old pages still load
3. Check metadata file integrity
4. Test @ mention functionality

## Success Criteria

### Must Pass
- ✅ All critical validation checks work
- ✅ Game pipeline completes successfully
- ✅ Build logs created with correct structure
- ✅ Quality scores accurate (0-100 range)
- ✅ Mobile-first requirements enforced
- ✅ Retry logic improves quality over attempts
- ✅ No regression in existing features

### Should Pass
- ✅ 80%+ of builds pass on first attempt
- ✅ 95%+ of builds pass within 3 attempts
- ✅ Average build time < 30 seconds
- ✅ All games playable on mobile
- ✅ Touch controls work without zoom

### Nice to Have
- ✅ Build pattern learning shows measurable improvement
- ✅ Quality scores correlate with user satisfaction
- ✅ Build logs useful for debugging
- ✅ Discord embeds informative and attractive

## Known Issues & Limitations

### Current Limitations
1. **No automated tests** - All testing is manual
2. **Subjective quality** - Scoring algorithm is heuristic-based
3. **Single model** - No A/B testing across models
4. **No user feedback loop** - Can't learn from user reactions
5. **Limited game types** - Focused on canvas/DOM games

### Future Improvements
1. **Automated test suite** - Jest/Mocha for validation functions
2. **Quality metrics tracking** - Store scores in database
3. **User rating system** - Discord reactions for feedback
4. **Model experimentation** - Try different models per agent
5. **Template library** - Common game patterns for faster builds

## Testing Environment

### Required Setup
- Discord bot running with system-v1 branch
- OpenRouter API key with credits
- GitHub token with push permissions
- Test Discord server with channels
- Mobile device for touch testing

### Test Data
- Variety of game prompts (simple → complex)
- Edge case inputs (empty, malformed, vague)
- Different game types (arcade, if, infographic)

### Monitoring Tools
- Console logs (detailed pipeline output)
- Build logs JSON files
- Discord embeds (quality scores)
- GitHub commit history
- Live site testing (mobile + desktop)

## Rollback Plan

If critical issues discovered:
1. Stop accepting `/build-game` commands
2. Merge `main` branch hotfix if needed
3. Document specific failures in GitHub issues
4. Fix issues in separate feature branch
5. Re-test before re-enabling

## Sign-Off

- [ ] All critical tests passed
- [ ] Performance acceptable
- [ ] No major regressions
- [ ] Documentation updated
- [ ] Ready for merge to main

---

**Tester:** _________________________
**Date:** _________________________
**Build ID:** _________________________
**Notes:**
