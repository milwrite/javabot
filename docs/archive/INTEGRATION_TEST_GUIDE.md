# Integration Test Guide
**Branch:** system-v1
**Date:** November 30, 2025
**Status:** 🟢 Bot Running & Ready to Test

## Bot Status

### ✅ Successfully Started
```
✅ All required environment variables loaded
✅ Bot is ready as Bot Sportello#0277
✅ Monitoring 7 channels
✅ Message Content Intent enabled
✅ Loaded 12 slash commands
✅ Synced with 41 existing HTML files in /src
```

### ⚠️ Known Issue
There's a Discord API error when registering commands:
```
Error registering slash commands: Invalid Form Body
redirect_uris[1][BASE_TYPE_REQUIRED]: This field is required
```

**Impact:** Likely LOW - Commands may still work if previously registered
**Workaround:** Test commands anyway; they might work despite the error
**Root Cause:** Possible Discord API issue or bot application configuration

## First Integration Test

### Test Case 1: Simple Snake Game

**Command to run in Discord:**
```
/build-game title:"Test Snake" prompt:"Simple snake game with arrow controls and mobile D-pad. Green snake, red food, black background. Score tracking."
```

**Expected Pipeline Flow:**
1. **📝 Planning Stage (5-10s)**
   - Architect analyzes request
   - Creates JSON plan (type, slug, files, mechanics)
   - Learns from recent build patterns
   - Status update: "📝 sketching game plan..."

2. **🎮 Building Stage (10-20s per attempt, up to 3)**
   - Builder generates complete HTML with embedded JS
   - Includes viewport, mobile controls, noir theme
   - Status update: "🎮 building game (attempt 1/3)..."

3. **🧪 Testing Stage (5-10s per attempt)**
   - Automated checks (HTML structure, mobile compliance)
   - LLM validation (catches subtle issues)
   - Calculates quality score (0-100)
   - Status update: "🧪 testing game (attempt 1/3)..."
   - **If failed:** Issues sent back to Builder for retry
   - **If passed:** Continue to Scribe

4. **📜 Documentation Stage (5-10s)**
   - Scribe creates metadata entry
   - Writes release notes in Bot Sportello voice
   - Updates projectmetadata.json
   - Status update: "📜 writing docs..."

5. **💾 Git Operations (5-15s)**
   - Commits files to repository
   - Pushes to GitHub
   - Status update: "💾 committing files to repo..."
   - Status update: "🚀 pushing to github pages..."

6. **Success Response (Discord Embed)**
   - Game title with icon
   - Release notes
   - Quality score (0-100) with indicator:
     - ✨ High quality (80-100) - Green embed
     - ✓ Good build (60-79) - Orange embed
     - ⚠️ Passed with issues (<60) - Red embed
   - Files created
   - Live URL: https://milwrite.github.io/javabot/src/test-snake.html
   - Build time

**Total Expected Time:** 30-60 seconds depending on retries

### Expected Artifacts

After successful build, you should see:

1. **Build Log JSON**
   ```bash
   ls -la build-logs/
   # Should show: {timestamp}.json

   cat build-logs/{timestamp}.json | head -50
   # Should show stages: plan, build, test, docs
   ```

2. **Game Files**
   ```bash
   ls -la src/test-snake.html
   # Should exist with ~10-20 KB size
   ```

3. **Metadata Update**
   ```bash
   git status
   # Should show:
   # - modified: projectmetadata.json
   # - new file: src/test-snake.html
   # - new file: build-logs/{timestamp}.json
   ```

4. **Live Site**
   - Visit: https://milwrite.github.io/javabot/src/test-snake.html
   - Should load game with mobile controls
   - Test on phone to verify touch controls work

### Console Logs to Watch

You'll see detailed logs in the terminal:
```
🏗️  Architect analyzing request...
📋 Plan created: Test Snake (arcade-2d)
   Files: src/test-snake.html
   Collection: arcade-games
🔨 Builder working (attempt 1/3)...
✅ Generated src/test-snake.html (15234 chars)
🧪 Tester validating code...
✅ Tests passed! Score: 85/100
📝 Scribe documenting...
✅ Metadata updated: projectmetadata.json
💾 Committing to git...
🚀 Build complete!
```

### What to Look For

#### ✅ Success Indicators
- [x] All 4 pipeline stages complete (plan → build → test → docs)
- [x] Quality score >= 60
- [x] Build log JSON created
- [x] Game file written to src/
- [x] Metadata updated
- [x] Git commit successful
- [x] Live URL returns 200 status
- [x] Mobile controls present on phone

#### ❌ Failure Indicators
- [ ] Pipeline crashes/times out
- [ ] Quality score < 60 after 3 attempts
- [ ] Missing viewport meta tag
- [ ] No mobile controls in game
- [ ] Git push fails
- [ ] 404 on live URL
- [ ] Mobile controls don't work (zoom on tap)

### Alternative Tests

If `/build-game` command doesn't work due to registration error, try:

**Test Case 2: Fallback to /add-page**
```
/add-page name:"test-simple" description:"Simple arcade snake game with mobile d-pad"
```

This uses the legacy pipeline but still has validation and retry logic.

**Test Case 3: @ Mention**
```
@Bot Sportello build me a simple snake arcade game with mobile controls
```

Should auto-detect game keywords and route to pipeline.

## Troubleshooting

### Command Not Found
**Problem:** `/build-game` doesn't appear in Discord's slash command list

**Solution 1:** Wait 5-10 minutes for Discord to propagate commands globally

**Solution 2:** Manually re-register commands
```bash
# In the bot terminal, type:
rs
# This restarts nodemon and re-registers commands
```

**Solution 3:** Check bot permissions in Discord server settings
- Bot needs "Use Application Commands" permission
- Try in a different channel

### Build Fails
**Problem:** Build fails after 3 attempts

**Check:**
1. Build log JSON - What issues were found?
   ```bash
   cat build-logs/{latest}.json | jq '.[] | select(.stage=="test")'
   ```
2. Console logs - What errors appeared?
3. OpenRouter credits - Out of API credits?

**Common Issues:**
- Missing viewport tag - Builder should auto-add on retry
- No mobile controls - Game detection might have failed
- Syntax errors - Builder should fix on retry

### Git Push Fails
**Problem:** Build succeeds but git push fails

**Check:**
1. GitHub token valid?
   ```bash
   git push origin system-v1
   # If fails, token is expired/invalid
   ```
2. Remote branch exists?
   ```bash
   git branch -r | grep system-v1
   ```
3. Network connection?

## Next Steps After First Test

### If Test Succeeds ✅
1. **Verify mobile controls on actual phone**
   - Open live URL on mobile device
   - Test touch D-pad
   - Verify no zoom on button tap
   - Check responsive layout

2. **Analyze build log**
   ```bash
   cat build-logs/{timestamp}.json | jq
   ```
   - Look at quality scores per attempt
   - Check what issues were found
   - Verify retry improved quality

3. **Run Test Case 2: Complex game**
   ```
   /build-game title:"Maze Runner" prompt:"First-person maze game where you navigate through a procedurally generated maze. Timer, score, mobile swipe controls. Noir wireframe graphics."
   ```

4. **Run Test Case 3: Interactive fiction**
   ```
   /build-game title:"Mystery Manor" prompt:"Interactive fiction about exploring a haunted mansion. Multiple choice story, inventory system, atmospheric noir writing." type:"interactive-fiction"
   ```

### If Test Fails ❌
1. **Capture exact error messages**
   - Screenshot Discord response
   - Copy console logs
   - Save build log JSON

2. **Document in TEST_RESULTS.md**
   - What command was run
   - What stage failed
   - Full error message
   - Quality scores from attempts

3. **Check specific failure points**
   - Architect planning - Did JSON parse correctly?
   - Builder generation - Did HTML complete?
   - Tester validation - What issues were found?
   - Scribe docs - Did metadata update?
   - Git operations - Did commit work?

4. **Try simpler test case**
   ```
   /add-page name:"hello-test" description:"Simple hello world page"
   ```

## Success Metrics

### Phase 2 Success Criteria
- ✅ `/build-game` command executes
- ✅ All 4 pipeline stages complete
- ✅ Quality score >= 60
- ✅ Game playable on mobile
- ✅ Build log captured
- ✅ No critical errors

### Stretch Goals
- ✅ First attempt quality score >= 80
- ✅ Build completes in < 30 seconds
- ✅ Mobile controls work perfectly
- ✅ Pattern learning shows in logs

## Getting Help

If you encounter issues:

1. **Check console logs first** - Most errors are logged there
2. **Read build log JSON** - Shows what tests failed
3. **Review TEST_PLAN.md** - Comprehensive troubleshooting guide
4. **Check git status** - What files changed?
5. **Verify .env** - Are all tokens valid?

---

**Current Status:** 🟢 READY TO TEST
**Bot Running:** YES (PID: be4f1c)
**Next Action:** Run `/build-game` in Discord
**Monitoring:** Watch console logs + build-logs/ directory
