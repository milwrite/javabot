---
name: agent-loop-trace
description: >
  Diagnose failures in Bot Sportello's agentic loop by tracing the path from
  user request → classifier decision → tool iterations → final response.
  Use when tool calls fail, the bot picks the wrong path, or iterations stall.
when_to_use:
  - The bot responded but used wrong tools or skipped expected tool calls
  - Tool loop hit iteration limits without completing the task
  - Classifier routed to CONVERSATION when it should have used tools (or vice versa)
  - A specific tool call (file_exists, edit_file, commit) failed or returned unexpected results
  - You need to understand why the LLM made a particular decision during the loop
non_goals:
  - General Discord connectivity issues (use interaction-trace)
  - Build pipeline failures for new pages (use pipeline-trace)
  - Explaining how the system works conceptually (use explaining-code)
defaults:
  start_with_logs: true
  include_iteration_count: true
  show_tool_sequence: true
sub_skills:
  - classifier-trace: Analyze llmRouter + requestClassifier decisions
  - iteration-audit: Track tool call sequences across loop iterations
  - tool-failure: Diagnose individual tool call failures (file ops, git, search)
  - context-drift: Detect when conversation context causes misrouting
---

# Tracing the Agentic Loop

## Prime directive: trace before theorizing

Always gather concrete evidence from logs, database, and code before hypothesizing about failures. The agentic loop has multiple decision points - find which one broke.

## System model (use this lens)

```
Discord mention
      │
      ▼
generateRoutingPlan() ─────► {intent, toolSequence, confidence}
      │                           │
      ▼                           ▼
requestClassifier ◄───────── greeting check (≤30 chars only)
      │
      ├─ CONVERSATION (short greeting + router agrees) ─► chat response
      │
      └─ TOOL_CALLING (everything else) ─► agentic loop
                                                │
                                                ▼
                                    ┌─────────────────────┐
                                    │  Iteration 1..6    │
                                    │  ┌─────────────┐   │
                                    │  │ LLM decides │   │
                                    │  │ tool calls  │   │
                                    │  └─────┬───────┘   │
                                    │        ▼           │
                                    │  Execute tools     │
                                    │        │           │
                                    │        ▼           │
                                    │  Feed results      │
                                    │  back to LLM       │
                                    └─────────┬──────────┘
                                              ▼
                                    Final response to Discord
```

## Diagnostic workflow

### Step 1: Get recent tool calls from PostgreSQL

```bash
source .env && psql "$DATABASE_URL" -c "
SELECT
  tool_name,
  to_char(timestamp, 'HH24:MI:SS') as time,
  SUBSTRING(arguments::text FROM 1 FOR 150) as args,
  success,
  SUBSTRING(result::text FROM 1 FOR 100) as result
FROM tool_calls
WHERE timestamp > NOW() - INTERVAL '1 hour'
ORDER BY timestamp DESC
LIMIT 20;
"
```

### Step 2: Check for iteration markers in logs

Look for console output patterns:
- `[ITERATION 1]`, `[ITERATION 2]`, etc. - Shows loop progression
- `Tool calls in iteration X: [...]` - What tools were called
- `MAX_ITERATIONS reached` - Loop hit safety limit
- `MAX_READONLY_ITERATIONS reached` - Read-only loop exhausted

### Step 3: Trace classifier decision

```bash
# Check recent routing decisions
source .env && psql "$DATABASE_URL" -c "
SELECT
  to_char(timestamp, 'HH24:MI:SS') as time,
  payload->>'intent' as intent,
  payload->>'confidence' as confidence,
  SUBSTRING(payload->>'content' FROM 1 FOR 80) as content
FROM bot_events
WHERE event_type = 'routing_decision'
  AND timestamp > NOW() - INTERVAL '30 minutes'
ORDER BY timestamp DESC
LIMIT 10;
"
```

### Step 4: Identify the failing tool

Common tool failure patterns:

| Tool | Failure Signature | Likely Cause |
|------|------------------|--------------|
| `file_exists` | Returns false for existing file | Path typo, URL not parsed |
| `read_file` | Empty or truncated | File >5000 chars, path issue |
| `edit_file` | "old_string not found" | Exact match failed, whitespace |
| `write_file` | Git push error | Token auth, remote URL |
| `commit_changes` | "nothing to commit" | Files not staged |
| `web_search` | Timeout or empty | Perplexity API issue |

### Step 5: Check for context drift

The LLM may misroute due to conversation history. Look for:
- Previous messages about different topics bleeding into current request
- Pronouns ("it", "that") resolving to wrong referents
- User's multi-part requests being partially fulfilled

## Failure patterns and fixes

### Pattern: Wrong path selection

**Symptom**: User asks to edit a file, bot just chats about it
**Diagnosis**: Check `generateRoutingPlan()` output - did it return `intent: 'chat'`?
**Fix**: User message may be too conversational. Suggest more direct phrasing.

### Pattern: Tool loop stalls

**Symptom**: Bot keeps reading files but never edits
**Diagnosis**: Count iterations, check if `MAX_READONLY_ITERATIONS=5` was hit
**Fix**: Check if LLM is stuck in analysis paralysis. Review prompt for clarity.

### Pattern: Edit fails repeatedly

**Symptom**: `edit_file` returns "old_string not found"
**Diagnosis**: Compare `old_string` argument with actual file contents
**Fix**: Exact string match required - check whitespace, indentation, encoding

### Pattern: Iteration limit reached

**Symptom**: `MAX_ITERATIONS=6` hit without task completion
**Diagnosis**: Task may be too complex for single conversation
**Fix**: Break into smaller requests, or check if tool results aren't being processed

## Key files to inspect

| File | What to look for |
|------|-----------------|
| `index.js:handleMentionAsync()` | Entry point, iteration loop logic |
| `services/llmRouter.js` | Intent classification logic |
| `services/requestClassifier.js` | Greeting detection (≤30 chars) |
| `personality/core/explorationRules.js` | Anti-hallucination prompts |
| `personality/tools/toolCatalog.js` | Tool definitions and schemas |

## PostgreSQL quick queries

```bash
# Tool success rate by name
source .env && psql "$DATABASE_URL" -c "
SELECT tool_name,
       COUNT(*) as calls,
       SUM(CASE WHEN success THEN 1 ELSE 0 END) as successes,
       ROUND(100.0 * SUM(CASE WHEN success THEN 1 ELSE 0 END) / COUNT(*), 1) as success_pct
FROM tool_calls
WHERE timestamp > NOW() - INTERVAL '24 hours'
GROUP BY tool_name
ORDER BY calls DESC;
"

# Recent errors in agentic loop
source .env && psql "$DATABASE_URL" -c "
SELECT to_char(timestamp, 'HH24:MI:SS') as time,
       payload->>'category' as category,
       SUBSTRING(payload->>'message' FROM 1 FOR 200) as message
FROM bot_events
WHERE event_type = 'error'
  AND timestamp > NOW() - INTERVAL '2 hours'
ORDER BY timestamp DESC
LIMIT 15;
"
```

## Gotcha

The classifier uses TWO systems in sequence: `llmRouter.js` runs FIRST (LLM-based, returns intent + toolSequence), then `requestClassifier.js` checks for short greetings. The router is **suggestive** - it provides guidance but doesn't force tool selection. If you see unexpected tool choices, trace both systems.
