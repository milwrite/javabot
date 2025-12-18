# Bot Sportello GUI Dashboard

A real-time verbose logging dashboard for Bot Sportello that provides Claude Code-style visibility into the bot's operations, tool calls, file changes, and agentic workflows.

## Features

- **Real-time Monitoring**: WebSocket-based live updates as the bot operates
- **Multi-Panel Interface**: 
  - System Logs: All bot events and debug information
  - Tool Calls: Track every AI tool invocation with args and results
  - File Changes: Monitor file reads, writes, edits, and creations
  - Agent Loops: Visualize the AI's iterative problem-solving process
- **Noir Terminal Aesthetic**: Matches the bot's visual theme with CRT effects
- **Connection Status**: Live indicator showing server connection state
- **Auto-scroll**: Automatically follows new logs (toggleable)
- **Clear Functions**: Clean up logs per category as needed

## Starting the GUI

The GUI automatically starts when you run the bot:

```bash
node index.js
```

The dashboard will be available at: **http://localhost:3001**

To disable the GUI, set the environment variable:
```bash
NO_GUI=true node index.js
```

To use a custom port:
```bash
GUI_PORT=3000 node index.js
```

## Testing the GUI

Run the test script to see the GUI with simulated data:

```bash
node test-gui.js
```

## Understanding the Panels

### System Logs Panel
- Shows all `logEvent()` calls from the bot
- Color-coded by severity: ERROR (red), WARN (orange), INFO (cyan), DEBUG (gray)
- Includes timestamps and structured data

### Tool Calls Panel
- Tracks every AI tool invocation
- Shows tool name, arguments, results, and errors
- Indicates which agent loop iteration triggered the call
- Success/failure status with visual indicators

### File Changes Panel
- Monitors all file system operations
- Shows CREATE, EDIT, DELETE, and READ operations
- Displays before/after content for edits
- Tracks which files are being modified during agent loops

### Agent Loops Panel
- Visualizes the AI's multi-step problem-solving
- Shows iteration count, tools used per iteration
- Tracks duration and final outcomes
- Running loops pulse with animation
- Completed/error states clearly indicated

## Integration Points

The GUI integrates with `index.js` through these hooks:

```javascript
// Logging functions available globally
logToGUI(level, message, data)           // General logging
logToolCall(tool, args, result, error)   // Tool execution tracking
logFileChange(action, path, content, old)// File operation tracking
startAgentLoop(command, user, channel)   // Begin agent workflow
updateAgentLoop(iteration, tools)        // Update progress
endAgentLoop(result, error)              // Complete workflow
```

## Architecture

```
gui-server.js       - Express + Socket.IO server, logging API
gui/dashboard.html  - Single-page application with real-time updates
gui-patches.js      - Optional wrapper functions for cleaner integration
test-gui.js         - Standalone test script with simulated data
```

## Performance Considerations

- Logs are capped at 1000 entries per category
- Tool results and file contents are truncated for display
- WebSocket compression enabled for efficient updates
- Client-side virtual scrolling for large log volumes

## Troubleshooting

**Port already in use**: Change the GUI port with `GUI_PORT=3002`

**Connection refused**: Ensure the bot is running and check firewall settings

**No logs appearing**: Verify WebSocket connection in browser console

**High memory usage**: Clear old logs periodically using panel clear buttons

## Future Enhancements

- Export logs to JSON/CSV
- Search and filter capabilities
- Metrics and performance graphs
- Persistent log storage
- Multiple bot instance support
- Dark/light theme toggle