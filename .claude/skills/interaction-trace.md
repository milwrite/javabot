---
name: interaction-trace
description: >
  Trace Discord user interactions end-to-end to understand why the bot
  did or didn't respond, or why the response didn't match expectations.
  Use for missing responses, wrong channel behavior, or response quality issues.
when_to_use:
  - Bot didn't respond to an @mention at all
  - Bot responded in unexpected channel or ignored expected channel
  - Response content doesn't match what the user asked for
  - Suspecting message deduplication blocked a valid response
  - Slash command executed but produced wrong or no output
non_goals:
  - Debugging tool call failures during agentic loop (use agent-loop-trace)
  - Build pipeline stage failures (use pipeline-trace)
  - Railway deployment or infrastructure issues (use bot-sportello-debugger agent)
defaults:
  check_channel_filter: true
  verify_dedup: true
  include_response_path: true
sub_skills:
  - mention-flow: Trace @mention from Discord event to response
  - command-audit: Slash command execution success/failure patterns
  - response-quality: Compare user request to bot output
  - channel-filter: Debug CHANNEL_ID filtering issues
---

# Tracing User Interactions

## Prime directive: verify the message reached the handler

Before debugging response logic, confirm the interaction was received and processed. Many "no response" issues are channel filters or deduplication.

## System model (use this lens)

```
Discord Event (message/interaction)
           │
           ▼
    ┌──────────────┐
    │ Channel ID   │──── CHANNEL_ID env not matching ──► ignored (logged)
    │ filter check │
    └──────┬───────┘
           │ passes
           ▼
    ┌──────────────┐
    │ Deduplication│──── Message ID already processed ──► ignored
    │ check        │
    └──────┬───────┘
           │ passes
           ▼
    ┌──────────────┐
    │ Bot mention? │──── No mention ──► ignored
    │ check        │
    └──────┬───────┘
           │ is mention
           ▼
    handleMentionAsync()
           │
           ▼
    ┌──────────────┐
    │ Route & loop │──► (see agent-loop-trace)
    └──────┬───────┘
           │
           ▼
    ┌──────────────┐
    │ Response     │──► Discord reply
    │ formatting   │──► If >2000 chars: save to responses/
    └──────────────┘
```

## Diagnostic workflow

### Step 1: Check if mention was received

```bash
# Recent mentions in PostgreSQL
source .env && psql "$DATABASE_URL" -c "
SELECT
  to_char(timestamp, 'HH24:MI:SS') as time,
  payload->>'user' as user_name,
  payload->>'channel' as channel,
  SUBSTRING(payload->>'content' FROM 1 FOR 100) as content
FROM bot_events
WHERE event_type = 'mention'
  AND timestamp > NOW() - INTERVAL '1 hour'
ORDER BY timestamp DESC
LIMIT 15;
"
```

### Step 2: Check channel filter warnings

Look in console/Railway logs for:
```
⚠️ [CHANNEL_FILTER] Ignoring message in channel {id} - not in allowed list
```

If you see this, the `CHANNEL_ID` environment variable doesn't include that channel.

**Fix**: Update `.env` with comma-separated channel IDs:
```bash
CHANNEL_ID=123456789,987654321,555555555
```

### Step 3: Check for deduplication

The bot tracks processed message IDs to prevent duplicate responses. Look for:
```
[DEDUP] Skipping already processed message: {id}
```

This is normal for Discord's API occasionally sending duplicate events, but if it's blocking valid messages, the dedup cache may need clearing (bot restart).

### Step 4: Verify slash command registration

If slash commands aren't appearing or executing:

```bash
# List registered global commands
node -e "
require('dotenv').config();
const { REST, Routes } = require('discord.js');
const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
rest.get(Routes.applicationCommands(process.env.DISCORD_CLIENT_ID))
  .then(cmds => console.log('Commands:', cmds.map(c => '/' + c.name).join(', ')))
  .catch(console.error);
"
```

### Step 5: Check response path

If the bot responded but content seems truncated or wrong:

1. Check `responses/` directory for full output:
```bash
ls -la responses/ | tail -10
```

2. Read the most recent response file:
```bash
cat responses/$(ls -t responses/ | head -1)
```

3. Compare Discord message vs saved file - Discord truncates at 2000 chars.

## Failure patterns and fixes

### Pattern: Bot ignores all mentions in a channel

**Symptom**: Bot works in other channels but not this one
**Diagnosis**: Check `CHANNEL_ID` env var - is the channel ID included?
**Fix**: Add channel ID to comma-separated list, restart bot

### Pattern: Bot responds to some users but not others

**Symptom**: Inconsistent responses by user
**Diagnosis**: Check for permission issues or user-specific rate limiting
**Fix**: Verify bot has "Read Messages" permission, check error logs for that user

### Pattern: Response doesn't match the question

**Symptom**: Bot answers a different question than asked
**Diagnosis**: Check conversation context - is old context bleeding in?
**Fix**: Context is fetched fresh (60s cache). If stale, wait or restart bot.

### Pattern: Slash command shows "Application did not respond"

**Symptom**: Discord shows interaction failed
**Diagnosis**: Command took >3 seconds without `deferReply()`
**Fix**: All commands should call `deferReply()` immediately (except `/poll`)

### Pattern: Long responses truncated

**Symptom**: Response ends mid-sentence
**Diagnosis**: Normal - Discord limit is 2000 chars
**Fix**: Full response saved to `responses/` directory, path shown in message

## Key files to inspect

| File | What to look for |
|------|-----------------|
| `index.js` (messageCreate handler) | Channel filtering, dedup logic |
| `index.js:handleMentionAsync()` | Mention processing entry point |
| `index.js` (interactionCreate handler) | Slash command dispatch |
| `.env` | CHANNEL_ID configuration |
| `responses/*.txt` | Full long responses |

## PostgreSQL quick queries

```bash
# Mentions by channel (to spot ignored channels)
source .env && psql "$DATABASE_URL" -c "
SELECT
  payload->>'channel' as channel,
  COUNT(*) as mentions
FROM bot_events
WHERE event_type = 'mention'
  AND timestamp > NOW() - INTERVAL '24 hours'
GROUP BY payload->>'channel'
ORDER BY mentions DESC;
"

# Slash command usage
source .env && psql "$DATABASE_URL" -c "
SELECT
  payload->>'command' as command,
  COUNT(*) as uses,
  COUNT(*) FILTER (WHERE payload->>'success' = 'true') as successes
FROM bot_events
WHERE event_type = 'slash_command'
  AND timestamp > NOW() - INTERVAL '7 days'
GROUP BY payload->>'command'
ORDER BY uses DESC;
"

# Recent responses (to check what was sent)
source .env && psql "$DATABASE_URL" -c "
SELECT
  to_char(timestamp, 'MM-DD HH24:MI') as time,
  SUBSTRING(payload->>'response' FROM 1 FOR 150) as response_preview
FROM bot_events
WHERE event_type = 'response'
  AND timestamp > NOW() - INTERVAL '3 hours'
ORDER BY timestamp DESC
LIMIT 10;
"
```

## Session log analysis

Session logs in `session-logs/` contain interaction summaries:

```bash
# Find recent session reports
ls -la session-logs/*.json | tail -5

# Parse mention counts from a session
cat session-logs/bot-session-*.json | jq '.metrics.mentions'
```

## Gotcha

The `CHANNEL_ID` environment variable is comma-separated with NO spaces. If you add `123, 456` (with space), the second ID won't match. Always use `123,456` format. When empty, the bot monitors ALL channels - which may cause unexpected responses in unintended channels.
