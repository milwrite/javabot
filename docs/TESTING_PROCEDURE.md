# Bot Sportello Testing Procedure

**Last Updated:** Dec 17, 2025
**Bot Version:** System-V1 with Multi-Agent Pipeline

This document provides a comprehensive testing procedure for Bot Sportello's features and functions. Use these tests to verify bot functionality after code changes or deployments.

---

## Quick Start

```bash
# Start bot with full logging and GUI dashboard
./run-bot.sh

# View real-time dashboard
open http://localhost:3001

# Alternative: Start without GUI
./run-bot.sh --no-gui

# Alternative: Run bot directly (less observability)
npm run dev
```

---

## 1. Environment & Startup Tests

### 1.1 Environment Validation
Verify all required environment variables are present:

| Variable | Purpose | Validation |
|----------|---------|------------|
| `DISCORD_TOKEN` | Bot authentication | Starts with valid prefix |
| `DISCORD_CLIENT_ID` | Application ID | 18-digit number |
| `GITHUB_TOKEN` | Repository access | Starts with `ghp_` or `github_pat_` |
| `GITHUB_REPO_OWNER` | Repository owner | Non-empty string |
| `GITHUB_REPO_NAME` | Repository name | Non-empty string |
| `GITHUB_REPO_URL` | Full repo URL | Valid GitHub URL |
| `OPENROUTER_API_KEY` | AI API access | Non-empty string |

**Expected:** Console shows `✅ All required environment variables loaded`

### 1.2 Startup Sequence
Monitor console for these startup events:

```
✅ All required environment variables loaded
🔐 GitHub token: ghp_xxxx...
📂 Repository: owner/repo
📊 GUI Dashboard available at http://localhost:3001
✅ Bot Sportello is online!
📋 Registered X slash commands
```

**Critical Check:** Discord shows bot as online with green status indicator.

---

## 2. Slash Command Tests

Execute each command in Discord and verify expected behavior.

### 2.1 `/status`
**Input:** `/status`
**Expected Output:**
- Embed with repository status
- Live site link: https://milwrite.github.io/javabot/
- Current branch name
- File count and modification status

### 2.2 `/chat <message>`
**Input:** `/chat Hey man, what's up?`
**Expected Output:**
- Response in Doc Sportello personality (laid-back, spacey)
- Uses conversation history from `agents.md`
- Response appears within 10 seconds

### 2.3 `/set-model <model>`
**Test Cases:**

| Input | Expected |
|-------|----------|
| `/set-model haiku` | Switches to Claude Haiku 4.5 |
| `/set-model sonnet` | Switches to Claude Sonnet 4.5 |
| `/set-model kimi` | Switches to Kimi K2 Thinking |
| `/set-model gemini` | Switches to Gemini 2.5 Pro |
| `/set-model glm` | Switches to GLM 4.6 |

**Verification:** Console logs model change, subsequent AI calls use new model.

### 2.4 `/search <query>`
**Input:** `/search latest JavaScript ES2024 features`
**Expected Output:**
- Web search results via Perplexity Sonar
- Formatted response with relevant information
- Source attribution (when available)

### 2.5 `/commit <message> [files]`
**Input:** `/commit test commit message`
**Expected Output:**
- Git add/commit/push sequence
- Success embed with commit hash
- Changes visible on GitHub

**Error Cases:**
- No changes to commit → Appropriate message
- Auth failure → Token error message with guidance

### 2.6 `/add-page <name> <description>`
**Input:** `/add-page test-page A simple test page with hello world`
**Expected Output:**
- Generates `src/test-page.html`
- Links to `page-theme.css`
- Includes home link
- Updates `projectmetadata.json`
- Shows live URL in embed

**Quality Checks:**
- [ ] DOCTYPE present
- [ ] Viewport meta tag
- [ ] Noir terminal colors (red, cyan, black)
- [ ] Courier Prime font
- [ ] Mobile responsive

### 2.7 `/add-feature <name> <description>`
**Input:** `/add-feature timer-util A countdown timer with start/stop buttons`
**Expected Output:**
- Generates `src/timer-util.js` (library)
- Generates `src/timer-util.html` (demo page)
- Demo page links to both JS file and theme CSS
- Updates metadata

### 2.8 `/build-game <title> <prompt> [type]`
**Input:** `/build-game snake-test classic snake game`
**Expected Output:**
- Progress messages showing pipeline stages
- Architect → Builder → Tester → Scribe sequence
- Generated game in `src/`
- Build log in `build-logs/`
- Quality score displayed

**Pipeline Stage Verification:**
1. `📝 Planning architecture...` → Architect creates JSON plan
2. `🎮 Building content...` → Builder generates HTML
3. `🧪 Running quality tests...` → Tester validates
4. `📚 Documenting...` → Scribe updates metadata

### 2.9 `/poll <question>`
**Input:** `/poll Is this bot working correctly?`
**Expected Output:**
- Poll message with Yes/No reactions
- Auto-adds ✅ and ❌ reactions
- Does NOT defer reply (immediate response)

### 2.10 `/sync-index`
**Input:** `/sync-index`
**Expected Output:**
- Scans `src/*.html` files
- Updates `projectmetadata.json`
- Reports sync status

### 2.11 `/set-prompt <action> [content]`
**Test Cases:**

| Input | Expected |
|-------|----------|
| `/set-prompt view` | Shows current system prompt |
| `/set-prompt reset` | Resets to default Sportello personality |
| `/set-prompt add more chill` | Appends to system prompt |
| `/set-prompt replace You are helpful` | Replaces entire prompt |

### 2.12 `/update-style <preset> [description]`
**Test Cases:**

| Input | Expected |
|-------|----------|
| `/update-style noir-terminal` | Applies noir theme |
| `/update-style neon-arcade` | Applies neon theme |
| `/update-style custom "purple and gold"` | AI-generated custom CSS |

---

## 3. @Mention Tests

All slash command functionality should also work via @mentions.

### 3.1 Basic Conversation
**Input:** `@Bot Sportello hey what's going on`
**Expected:** Laid-back response with personality

### 3.2 File Operations via Mention
**Input:** `@Bot Sportello list the files in src`
**Expected:** Uses `list_files` tool, returns file listing

**Input:** `@Bot Sportello read src/index.html`
**Expected:** Uses `read_file` tool, shows file contents (truncated if long)

### 3.3 Create Content via Mention
**Input:** `@Bot Sportello create a page called mention-test with a simple countdown timer`
**Expected:**
- Triggers `CREATE_NEW` classification
- May route to System-V1 pipeline OR standard `create_page` tool
- Generates HTML file
- Updates metadata
- Prompts for commit

### 3.4 Edit Request via Mention
**Input:** `@Bot Sportello change the title on test-page.html to "Updated Title"`
**Expected:**
- Triggers `SIMPLE_EDIT` classification
- Uses `edit_file` tool with exact string replacement
- Shows edit confirmation

### 3.5 Fix Request via Mention
**Input:** `@Bot Sportello fix the CSS on the snake game, the buttons are too small on mobile`
**Expected:**
- Triggers `FUNCTIONALITY_FIX` classification
- Reads file → analyzes issue → applies fix
- Uses search/read/edit tools as needed

### 3.6 Read-Only Request via Mention
**Input:** `@Bot Sportello show me what files have games in them`
**Expected:**
- Triggers `READ_ONLY` classification
- Uses `search_files` tool
- Returns results without modifying files

### 3.7 Web Search via Mention
**Input:** `@Bot Sportello what are the latest CSS features in 2025`
**Expected:**
- Uses `web_search` tool
- Returns search results
- No file modifications

### 3.8 Model Switching via Mention
**Input:** `@Bot Sportello switch to sonnet model`
**Expected:**
- Uses `set_model` tool
- Confirms model change

---

## 4. Request Classifier Tests

The classifier routes requests to appropriate handlers. Test via @mentions and verify console logs.

### 4.1 Classification Categories

| Request | Expected Classification |
|---------|------------------------|
| "change title to X" | SIMPLE_EDIT |
| "fix the button CSS" | FUNCTIONALITY_FIX |
| "create a new game" | CREATE_NEW |
| "commit these changes" | COMMIT |
| "show me the files" | READ_ONLY |
| "hey how's it going" | CONVERSATION |

### 4.2 Classifier Console Output
**Look for:** `[CLASSIFIER] "prompt..." → CLASSIFICATION (Xms via llm:model)`

### 4.3 Fallback Behavior
Test with OpenRouter unavailable:
1. Set invalid `OPENROUTER_API_KEY` temporarily
2. Send @mention request
3. Verify fallback classification works
4. Restore valid API key

---

## 5. System-V1 Pipeline Tests

### 5.1 Architect Stage
**Verify Plan Contains:**
- Content type (arcade-game, letter, recipe, etc.)
- Slug (URL-safe filename)
- Files to generate
- Features/mechanics list
- Metadata (title, icon, description)
- Collection assignment

### 5.2 Builder Stage
**Verify Generated HTML:**
- [ ] Complete document (`<!DOCTYPE html>` to `</html>`)
- [ ] Viewport meta tag present
- [ ] Links to `../page-theme.css`
- [ ] Home link with correct path
- [ ] Noir terminal color scheme
- [ ] Mobile responsive breakpoints (@768px, @480px)

**For Games Specifically:**
- [ ] Canvas element present
- [ ] Mobile controls (d-pad or buttons)
- [ ] `touch-action: manipulation` CSS
- [ ] `touchstart` event handlers
- [ ] 44px+ touch targets

### 5.3 Tester Stage
**Automated Checks (runAutomatedChecks):**
- INCOMPLETE_HTML → Missing `</html>`
- MISSING_DOCTYPE → No DOCTYPE declaration
- MISSING_VIEWPORT → No viewport meta
- MISSING_THEME → No page-theme.css link
- NO_MOBILE_CONTROLS → Game missing controls (critical for games)
- NO_RESPONSIVE → Missing @media breakpoints
- MISMATCHED_SCRIPT_TAGS → Script tag mismatch
- MARKDOWN_ARTIFACTS → Contains ``` markers

**LLM Validation:**
- Semantic review of functionality
- Performance concerns
- Mobile UX issues

**Score Calculation:**
- Starts at 100
- -20 per critical issue
- -5 per warning
- Passing score: 100 (no issues)

### 5.4 Scribe Stage
**Verify Documentation:**
- `projectmetadata.json` updated with new entry
- Collection assignment (defaults to `unsorted`)
- Icon auto-selected based on description
- Caption generated (3-6 words)

### 5.5 Build Retry Loop
**Test Failure Recovery:**
1. Request something that might fail initial validation
2. Verify Builder receives failure feedback
3. Confirm retry attempt (up to 3 total)
4. Check build log captures all attempts

---

## 6. Tool Function Tests

### 6.1 Filesystem Tools

| Tool | Test Input | Expected |
|------|------------|----------|
| `list_files` | `./src` | Categorized file listing |
| `read_file` | `./src/index.html` | File contents (5000 char limit) |
| `write_file` | Create new file | File created successfully |
| `edit_file` (exact) | Provide old/new strings | Fast replacement (~0.1s) |
| `edit_file` (AI) | Provide instructions | AI-assisted edit (~3-5s) |
| `search_files` | Pattern search | Matching results |

### 6.2 Content Creation Tools

| Tool | Test | Verification |
|------|------|--------------|
| `create_page` | New page request | HTML in src/, metadata updated |
| `create_feature` | New feature request | JS + demo HTML created |
| `build_game` | Game request | Full pipeline execution |

### 6.3 Repository Tools

| Tool | Test | Verification |
|------|------|--------------|
| `commit_changes` | Stage and commit | Git log shows new commit |
| `get_repo_status` | Check status | Returns branch and file status |

### 6.4 Configuration Tools

| Tool | Test | Verification |
|------|------|--------------|
| `set_model` | Switch models | Console confirms change |
| `update_style` | Apply preset | CSS updated in index.html |

### 6.5 Web Search Tool

| Tool | Test | Verification |
|------|------|--------------|
| `web_search` | Current events query | Returns Perplexity results |

---

## 7. GUI Dashboard Tests

### 7.1 Panel Functionality
Access http://localhost:3001 and verify:

| Panel | Content |
|-------|---------|
| System Logs | Color-coded events (error/warn/info/debug) |
| Tool Calls | AI function executions with args/results |
| File Changes | Create/edit/delete/read operations |
| Agent Loops | Multi-step workflow progress |

### 7.2 Real-Time Updates
1. Trigger slash command or @mention
2. Verify events appear in dashboard within 1-2 seconds
3. Check WebSocket connection status

### 7.3 Log Management
- Verify logs cap at 1000 entries per panel
- Test clear function for each panel
- Confirm auto-scroll toggle works

---

## 8. Error Handling Tests

### 8.1 Error Loop Prevention
1. Trigger same error 3 times within 5 minutes
2. Verify cooldown message appears
3. Wait 5 minutes, confirm cooldown clears

### 8.2 Discord Interaction Errors
- Test with expired interaction (>15 min delay)
- Verify graceful fallback if reply already sent
- Check error tracker cleans up old entries

### 8.3 Git Authentication Errors
**Test Scenarios:**
- Invalid token format
- Expired token
- Missing repository permissions

**Expected:** Clear error message with guidance

### 8.4 OpenRouter API Errors
**Test Scenarios:**
- 402 error (low credits) → Reduces max_tokens automatically
- 500 error → Falls back to alternate ZDR model after 2 failures
- Timeout → Returns timeout message

### 8.5 Long Response Handling
1. Request something that generates >2000 chars
2. Verify response saved to `responses/` directory
3. Confirm Discord shows truncated version with file path

---

## 9. Integration Tests

### 9.1 Full Content Creation Flow
```
1. @Bot Sportello create a memory matching game called test-memory
2. Verify pipeline completes (all 4 stages)
3. Check src/test-memory.html exists and is valid
4. Verify projectmetadata.json updated
5. @Bot Sportello commit test game creation
6. Verify commit appears on GitHub
7. Check live site shows new page
```

### 9.2 Edit and Fix Flow
```
1. @Bot Sportello read src/test-memory.html
2. @Bot Sportello change the title to "Memory Master"
3. Verify edit applied correctly
4. @Bot Sportello fix the mobile controls, make buttons bigger
5. Verify CSS changes applied
6. Commit and verify
```

### 9.3 Multi-Tool Agentic Flow
```
1. @Bot Sportello find all games that use canvas, read them, and tell me which ones have mobile controls
2. Verify:
   - Uses search_files to find canvas references
   - Uses read_file on matching files
   - Synthesizes response about mobile controls
   - Completes within 10 iterations
```

---

## 10. Session Log Analysis

After testing, review session logs in `session-logs/`:

### 10.1 Success Session
**Check for:**
- Duration and exit status
- Mention count and success rate
- Tool call success rate
- No critical errors

### 10.2 Failure Session
**Analyze:**
- Exit reason (auth-error, network-error, etc.)
- Last successful operation before failure
- Error categorization patterns
- Health check warnings

---

## 11. Performance Benchmarks

| Operation | Expected Time |
|-----------|---------------|
| Slash command response | < 5 seconds |
| @mention response | < 10 seconds |
| File read | < 0.5 seconds |
| Exact edit | < 0.5 seconds |
| AI-assisted edit | 3-5 seconds |
| Full game pipeline | 30-90 seconds |
| Git commit + push | < 15 seconds |
| Web search | 3-8 seconds |

---

## 12. Cleanup After Testing

```bash
# Remove test files
rm -f src/test-*.html src/test-*.js

# Revert projectmetadata.json if needed
git checkout projectmetadata.json

# Clear test responses
rm -f responses/test-*.txt

# Review and clean session logs
ls -la session-logs/
```

---

## Common Issues & Solutions

| Issue | Likely Cause | Solution |
|-------|--------------|----------|
| Bot not responding | Wrong channel ID | Check CHANNEL_ID in .env |
| Auth errors on push | Token expired | Regenerate GitHub PAT |
| Slow responses | Model overloaded | Try different model via /set-model |
| Missing mobile controls | Builder missed requirement | Check Tester feedback in build log |
| Duplicate responses | Discord API glitch | Message deduplication handles this |
| GUI not loading | Port conflict | Use --gui-port flag |

---

## Appendix: Build Log Analysis

Build logs in `build-logs/` contain pipeline execution details:

```json
{
  "buildId": "1765945113746",
  "stages": [
    { "stage": "plan", "plan": {...} },
    { "stage": "build", "attempt": 1, "files": [...] },
    { "stage": "test", "score": 85, "issues": [...] },
    { "stage": "build", "attempt": 2, "files": [...] },
    { "stage": "test", "score": 100, "issues": [] },
    { "stage": "document", "metadata": {...} }
  ]
}
```

Use `getRecentPatternsSummary()` to analyze recurring issues across builds.
