# Bot Sportello Log Preservation System

Comprehensive activity tracking and failure documentation system for Bot Sportello, providing Claude Code-style monitoring and debugging capabilities.

## 🚀 Quick Start

Instead of running `node index.js` directly, use the log preservation wrapper:

```bash
# Recommended: Run with full monitoring
./run-bot.sh

# Custom GUI port
./run-bot.sh --gui-port 3001

# Without GUI dashboard  
./run-bot.sh --no-gui

# Direct log preservation (advanced)
node log-preserv.js --gui-port 3001
```

## 📊 What Gets Tracked

### Real-Time Activity
- **Discord Events**: Mentions, slash commands, message processing
- **AI Tool Calls**: Every function execution with args and results
- **File Operations**: Creates, edits, deletes, reads with content tracking
- **Agent Workflows**: Multi-step AI problem-solving iterations
- **Git Operations**: Commits, pushes, repository status checks
- **Health Metrics**: Process responsiveness, memory usage, activity frequency

### Error Documentation
- **Categorized Errors**: Auth, network, git, discord API, critical failures
- **Failure Sequences**: What tools were called before crashes
- **Exit Analysis**: Process codes, signals, unexpected terminations
- **Hanging Detection**: Identifies unresponsive bot states

## 📁 Log File Structure

When you run `./run-bot.sh`, logs are automatically saved to `session-logs/`:

```
session-logs/
├── bot-session-2025-12-15_14-30-00-raw.log      # Complete stdout/stderr
├── bot-session-2025-12-15_14-30-00-report.json  # Structured activity data  
└── bot-session-2025-12-15_14-30-00-summary.md   # Human-readable report
```

### Raw Log Format
```
2025-12-15T14:30:15.123Z [STDOUT] ✅ All required environment variables loaded
2025-12-15T14:30:16.456Z [STDOUT] Bot is ready as Bot Sportello#0277
2025-12-15T14:30:45.789Z [STDOUT] 🔔 [MENTION DETECTED] user123 mentioned bot in #chat
```

### JSON Report Structure  
```json
{
  "session": {
    "id": "bot-session-2025-12-15_14-30-00",
    "duration": "15m 23s", 
    "exitCode": 0,
    "exitReason": "SIGINT"
  },
  "activity": {
    "totalEvents": 127,
    "eventsPerMinute": 8.2,
    "lastActivity": "2025-12-15T14:45:23.456Z"
  },
  "mentions": [
    {
      "timestamp": "2025-12-15T14:30:45.789Z", 
      "user": "user123",
      "channel": "chat",
      "line": "🔔 [MENTION DETECTED] user123 mentioned bot in #chat"
    }
  ],
  "toolCalls": [
    {
      "timestamp": "2025-12-15T14:30:50.123Z",
      "line": "[LLM] Tool call: list_files {\"path\": \"./src\"}"
    }
  ],
  "errors": [
    {
      "timestamp": "2025-12-15T14:35:12.456Z",
      "message": "GitHub authentication failed",
      "severity": "auth"
    }
  ]
}
```

### Markdown Summary Example
```markdown
# Bot Sportello Session Report

## Session Details
- **Duration**: 15m 23s
- **Status**: ✅ SUCCESS  
- **Exit Reason**: SIGINT
- **Total Events**: 127

## Interactions
### Mentions (3)
- **user123** in #chat at 2:30:45 PM
- **developer** in #dev at 2:35:12 PM

### Tool Calls (15)  
- 2:30:50 PM: list_files {"path": "./src"}
- 2:31:05 PM: create_page {"name": "tic-tac-toe", "description": "..."}

## Issues
### Errors (1)
- **auth** at 2:35:12 PM: GitHub authentication failed

## Overall Summary
SUCCESS: Bot session lasted 15m 23s, processed 3 mentions, executed 15 tool calls, encountered 1 error
```

## 🖥️ Real-Time GUI Dashboard

The log preservation system includes a web-based monitoring dashboard:

- **URL**: http://localhost:3001 (auto-opens when using `./run-bot.sh`)
- **Live Updates**: WebSocket-powered real-time activity streaming  
- **Multiple Panels**: System logs, tool calls, file changes, agent loops
- **Visual Indicators**: Color-coded severity, success/failure status, progress animations

### Dashboard Features
- **System Logs Panel**: All bot events with timestamps and severity colors
- **Tool Calls Panel**: AI function executions with arguments and results
- **File Changes Panel**: Before/after content for edits, file operation tracking  
- **Agent Loops Panel**: Multi-step AI workflows with iteration progress

## 🔍 Debugging Failed Sessions

When Bot Sportello crashes or behaves unexpectedly:

### 1. Check Latest Session Report
```bash
# Find most recent session
ls -la session-logs/*.md | tail -1

# View summary
cat session-logs/bot-session-LATEST-summary.md

# Check detailed JSON
cat session-logs/bot-session-LATEST-report.json | jq '.errors'
```

### 2. Common Failure Patterns

**Authentication Errors**:
```
- Severity: auth
- Pattern: "GitHub authentication failed", "token expired"
- Solution: Update GITHUB_TOKEN in .env file
```

**Network Timeouts**:
```  
- Severity: network
- Pattern: "timeout", "connection refused", "ENOTFOUND"
- Solution: Check internet connection, API rate limits
```

**Discord API Issues**:
```
- Severity: discord  
- Pattern: "Missing Access", "rate limit", "Unknown Interaction"
- Solution: Verify bot permissions, check Discord status
```

**Process Hanging**:
```
- Warning: "Bot appears to be hanging"
- Pattern: No activity for >5 minutes
- Solution: Check for infinite loops in tool calls
```

### 3. Tool Call Analysis

Failed sessions often have problematic tool call sequences:

```json
"toolCalls": [
  {"timestamp": "14:30:50", "line": "list_files ./src"},
  {"timestamp": "14:30:52", "line": "edit_file src/game.html"},
  {"timestamp": "14:30:55", "line": "commit_changes 'update game'"},
  {"timestamp": "14:30:58", "line": "ERROR: Authentication failed"}
]
```

This shows the bot successfully listed files and edited content, but failed during the git commit due to authentication.

## ⚙️ Configuration

### Environment Variables
```bash
# Disable log preservation  
export NO_LOG_PRESERVATION=true

# Custom session log directory
export SESSION_LOG_DIR=/custom/path/logs

# Disable GUI dashboard
export NO_GUI=true

# Custom GUI port
export GUI_PORT=3002
```

### Log Retention
- **Default**: Logs preserved indefinitely
- **Cleanup**: Manually delete old session directories
- **Size**: Typical session ~1-5MB depending on activity

## 🛠️ Advanced Usage

### Programmatic Access
```javascript
const BotLogPreserver = require('./log-preserv.js');

const preserver = new BotLogPreserver();
preserver.logError('Custom error', new Error('Something failed'));
preserver.logWarning('Custom warning', {data: 'extra context'});
```

### Custom Analysis Scripts
```bash
# Count mentions per user across all sessions
find session-logs -name "*.json" | xargs jq -r '.mentions[]?.user' | sort | uniq -c

# Find all authentication errors
grep -r "auth.*error" session-logs/

# Analyze tool call patterns before failures
jq '.toolCalls[-5:]' session-logs/*-report.json
```

## 📈 Performance Impact

- **CPU Overhead**: <2% additional CPU usage
- **Memory**: ~10MB for log buffering
- **Disk I/O**: Batched writes every 100 events or 30 seconds
- **Network**: GUI dashboard uses minimal WebSocket traffic

## 🔧 Troubleshooting

**Log Preservation Not Working**:
1. Ensure `log-preserv.js` exists and is executable
2. Check that `run-bot.sh` has execute permissions: `chmod +x run-bot.sh`
3. Verify Node.js can spawn child processes

**GUI Dashboard Not Loading**:
1. Check port availability: `lsof -i :3001`
2. Verify `express` and `socket.io` dependencies: `npm list express socket.io`
3. Try custom port: `./run-bot.sh --gui-port 3002`

**Missing Session Reports**:
1. Check write permissions in project directory
2. Verify `session-logs/` directory creation
3. Look for permission errors in console output

---

The log preservation system transforms Bot Sportello from a black-box process into a fully observable and debuggable system, providing the visibility needed to optimize agentic workflows and resolve failure modes quickly.