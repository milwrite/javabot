---
name: pipeline-trace
description: >
  Trace failures in the multi-agent build pipeline (Architect → Builder → Tester → Scribe).
  Use when page/game creation fails, output quality is wrong, or metadata isn't updated.
when_to_use:
  - /build-game or page creation command fails partway through
  - Generated page doesn't match the requested design or functionality
  - Page builds but isn't added to projectmetadata.json
  - Tester rejects the build repeatedly (3 attempts exhausted)
  - Page doesn't follow noir terminal theme or mobile-first guidelines
non_goals:
  - Tool call failures in the regular agentic loop (use agent-loop-trace)
  - Discord interaction issues (use interaction-trace)
  - General code explanation (use explaining-code)
defaults:
  check_build_logs: true
  verify_metadata: true
  validate_theme: true
sub_skills:
  - stage-handoff: Analyze data passing between pipeline agents
  - plan-quality: Evaluate Architect output completeness
  - build-validation: Check Builder output against design system
  - metadata-sync: Verify Scribe updates to projectmetadata.json
---

# Tracing the Build Pipeline

## Prime directive: identify which stage failed

The pipeline has 4 sequential stages. Failures propagate - if Architect produces a bad plan, Builder can't recover. Find the first point of failure.

## System model (use this lens)

```
User request (via /build-game or @mention)
           │
           ▼
    ┌──────────────┐
    │  ARCHITECT   │──► Analyzes request, produces implementation plan
    │              │    Output: structured plan JSON
    └──────┬───────┘
           │
           ▼
    ┌──────────────┐
    │   BUILDER    │──► Creates HTML/CSS/JS from plan
    │              │    Enforces: noir theme, mobile-first, page-theme.css
    └──────┬───────┘
           │
           ▼
    ┌──────────────┐
    │   TESTER     │──► Validates output (up to 3 attempts)
    │              │    Checks: syntax, required elements, mobile controls
    └──────┬───────┘
           │ (if pass)
           ▼
    ┌──────────────┐
    │   SCRIBE     │──► Writes file, updates projectmetadata.json
    │              │    Commits and pushes to GitHub
    └──────────────┘
           │
           ▼
    Deployed page at bot.inference-arcade.com/src/{slug}.html
```

## Diagnostic workflow

### Step 1: Find the build log

Each build creates a log file in `build-logs/`:

```bash
# List recent build logs
ls -la build-logs/*.json | tail -10

# Read the most recent build log
cat build-logs/$(ls -t build-logs/ | head -1) | jq '.'
```

Build log structure:
```json
{
  "id": "build-abc123",
  "timestamp": "2024-12-15T10:30:00Z",
  "request": "create a snake game",
  "stages": {
    "architect": { "status": "success", "plan": {...} },
    "builder": { "status": "success", "output": "..." },
    "tester": { "status": "failed", "attempts": 3, "errors": [...] },
    "scribe": { "status": "skipped" }
  }
}
```

### Step 2: Check PostgreSQL for stage timing

```bash
source .env && psql "$DATABASE_URL" -c "
SELECT
  stage_name,
  to_char(started_at, 'HH24:MI:SS') as started,
  to_char(completed_at, 'HH24:MI:SS') as completed,
  status,
  SUBSTRING(error_message FROM 1 FOR 100) as error
FROM build_stages
WHERE build_id = (SELECT build_id FROM build_stages ORDER BY started_at DESC LIMIT 1)
ORDER BY started_at;
"
```

### Step 3: Analyze stage-specific failures

#### Architect failures

**Symptoms**: No plan generated, or plan is vague/incomplete
**Check**: Does the plan include all required sections?

Required plan sections:
- Page title and slug
- Core functionality description
- UI component list
- Mobile interaction pattern (D-pad vs direct touch)
- Data structures (if game)

**Common issues**:
- Request too vague → Architect can't produce specific plan
- Conflicting requirements → Architect produces ambiguous plan

#### Builder failures

**Symptoms**: HTML generated but doesn't work or look right
**Check**: Does output follow the design system?

Builder checklist:
- [ ] Links to `../page-theme.css`
- [ ] Has `.home-link` back button (empty content, CSS shows arrow)
- [ ] Mobile breakpoints (768px, 480px)
- [ ] Touch targets ≥44px
- [ ] Movement games have D-pad controls
- [ ] Noir color palette (#00ff41, #ff0000, #00ffff, #0a0a0a)

```bash
# Quick theme check on a page
grep -E "(page-theme\.css|home-link|@media.*768|touch-action)" src/your-page.html
```

#### Tester failures

**Symptoms**: Build rejected after 3 attempts
**Check**: What errors did the Tester report?

```bash
# From build log
cat build-logs/build-*.json | jq '.stages.tester.errors'
```

Common Tester rejections:
- Missing `page-theme.css` link
- No mobile controls for movement game
- JavaScript syntax errors
- Missing back button
- Canvas not responsive

#### Scribe failures

**Symptoms**: Page built but not in metadata or not committed
**Check**: Did `projectmetadata.json` get updated?

```bash
# Check if page is in metadata
cat projectmetadata.json | jq '.projects["your-page"]'

# Check git status for uncommitted changes
git status
```

### Step 4: Validate the output manually

For a built page at `src/example.html`:

```bash
# Check for required elements
echo "=== Theme link ===" && grep "page-theme.css" src/example.html
echo "=== Back button ===" && grep "home-link" src/example.html
echo "=== Mobile meta ===" && grep "viewport" src/example.html
echo "=== Touch targets ===" && grep -E "min-.*44px|touch-action" src/example.html
```

## Failure patterns and fixes

### Pattern: Architect produces off-topic plan

**Symptom**: Plan describes something different from request
**Diagnosis**: Check if request was ambiguous or misinterpreted
**Fix**: Retry with more specific request; check Architect prompt for clarity

### Pattern: Builder ignores theme guidelines

**Symptom**: Page has wrong colors, fonts, or missing CSS link
**Diagnosis**: Check `personality/content/designSystem.js` for current guidelines
**Fix**: Update Builder prompt if guidelines changed; file bug if consistent issue

### Pattern: Tester rejects valid output

**Symptom**: Page looks fine but Tester fails it
**Diagnosis**: Check Tester criteria in build log - may be too strict
**Fix**: Review `personality/specialized/agentRoles.js` for Tester rules

### Pattern: Metadata not updated

**Symptom**: Page exists but not on homepage
**Diagnosis**: Scribe may have failed or been skipped
**Fix**: Run `/sync-index` command or manually update `projectmetadata.json`

### Pattern: D-pad on non-movement game

**Symptom**: Touch game (like memory match) has unnecessary D-pad
**Diagnosis**: Architect classified wrong interaction pattern
**Fix**: Check `personality/content/mobilePatterns.js` for classification rules

## Key files to inspect

| File | What to look for |
|------|-----------------|
| `services/gamePipeline.js` | Pipeline orchestration, stage calls |
| `build-logs/*.json` | Per-build execution history |
| `personality/specialized/agentRoles.js` | Agent role definitions |
| `personality/content/designSystem.js` | Noir theme specification |
| `personality/content/mobilePatterns.js` | D-pad vs touch classification |
| `projectmetadata.json` | Page registry |

## PostgreSQL quick queries

```bash
# Recent build success rates
source .env && psql "$DATABASE_URL" -c "
SELECT
  DATE(started_at) as date,
  COUNT(DISTINCT build_id) as builds,
  COUNT(*) FILTER (WHERE status = 'success') as successes,
  COUNT(*) FILTER (WHERE status = 'failed') as failures
FROM build_stages
WHERE started_at > NOW() - INTERVAL '7 days'
GROUP BY DATE(started_at)
ORDER BY date DESC;
"

# Stage failure frequency
source .env && psql "$DATABASE_URL" -c "
SELECT
  stage_name,
  COUNT(*) as total,
  COUNT(*) FILTER (WHERE status = 'failed') as failures,
  ROUND(100.0 * COUNT(*) FILTER (WHERE status = 'failed') / COUNT(*), 1) as fail_pct
FROM build_stages
WHERE started_at > NOW() - INTERVAL '30 days'
GROUP BY stage_name
ORDER BY fail_pct DESC;
"

# Recent Tester rejections
source .env && psql "$DATABASE_URL" -c "
SELECT
  to_char(started_at, 'MM-DD HH24:MI') as time,
  build_id,
  SUBSTRING(error_message FROM 1 FOR 200) as error
FROM build_stages
WHERE stage_name = 'tester'
  AND status = 'failed'
  AND started_at > NOW() - INTERVAL '7 days'
ORDER BY started_at DESC
LIMIT 10;
"
```

## Content quality checklist

When reviewing a built page:

```
STRUCTURE
[ ] Links to page-theme.css (not embedded noir CSS)
[ ] Has <a class="home-link" href="../index.html"></a> (empty)
[ ] Has viewport meta tag
[ ] Title matches request

MOBILE
[ ] Breakpoints at 768px and 480px
[ ] Touch targets ≥ 44px
[ ] D-pad ONLY for movement games (snake, maze, platformer)
[ ] Touch games use direct interaction (no D-pad)

THEME
[ ] Uses noir palette (#00ff41, #ff0000, #00ffff, #0a0a0a)
[ ] Courier Prime font (monospace)
[ ] Dark background, light text

FUNCTIONALITY
[ ] Core feature works
[ ] No console errors
[ ] Responsive at mobile sizes
```

## Gotcha

The Tester has a 3-attempt limit. If all 3 fail, the build is abandoned and Scribe never runs. When debugging "page not appearing", always check if the build completed at all - look for the Scribe stage status in the build log. If Scribe shows "skipped", the Tester rejected the build.
