const express = require('express');
const { Server } = require('socket.io');
const http = require('http');
const path = require('path');
const fs = require('fs');

class BotGUIServer {
    constructor(port = 3001) {
        this.port = port;
        this.app = express();
        this.server = http.createServer(this.app);
        this.io = new Server(this.server, {
            cors: {
                origin: "*",
                methods: ["GET", "POST"]
            }
        });
        
        this.logs = [];
        this.maxLogs = 1000;
        this.toolCalls = [];
        this.fileChanges = [];
        this.agentLoops = [];
        this.currentAgentLoop = null;
        this.isRunning = false;
        
        // Run-based persistence
        this.currentRunId = this.generateRunId();
        this.runBasedLogsDir = path.join(__dirname, 'gui-run-logs');
        this.ensureRunLogsDirectory();
        
        this.setupRoutes();
        this.setupSocketHandlers();
    }
    
    setupRoutes() {
        // Serve static files
        this.app.use(express.static(path.join(__dirname, 'gui')));
        
        // Main dashboard
        this.app.get('/', (req, res) => {
            res.sendFile(path.join(__dirname, 'gui', 'dashboard.html'));
        });
        
        // API endpoints
        this.app.get('/api/status', (req, res) => {
            res.json({
                running: this.isRunning,
                logsCount: this.logs.length,
                toolCallsCount: this.toolCalls.length,
                fileChangesCount: this.fileChanges.length,
                currentLoop: this.currentAgentLoop
            });
        });
        
        this.app.get('/api/logs', (req, res) => {
            const limit = parseInt(req.query.limit) || 100;
            res.json(this.logs.slice(-limit));
        });
        
        this.app.get('/api/tools', (req, res) => {
            const limit = parseInt(req.query.limit) || 50;
            res.json(this.toolCalls.slice(-limit));
        });
        
        this.app.get('/api/files', (req, res) => {
            const limit = parseInt(req.query.limit) || 50;
            res.json(this.fileChanges.slice(-limit));
        });
        
        this.app.get('/api/agent-loops', (req, res) => {
            const limit = parseInt(req.query.limit) || 10;
            res.json(this.agentLoops.slice(-limit));
        });
        
        // Persistent run-based logs API
        this.app.get('/api/runs', (req, res) => {
            try {
                const runs = this.getAvailableRuns();
                res.json(runs);
            } catch (error) {
                res.status(500).json({ error: 'Failed to fetch runs' });
            }
        });
        
        this.app.get('/api/runs/:runId', (req, res) => {
            try {
                const runData = this.loadRunData(req.params.runId);
                res.json(runData);
            } catch (error) {
                res.status(404).json({ error: 'Run not found' });
            }
        });
        
        this.app.post('/api/new-run', (req, res) => {
            try {
                this.startNewRun();
                res.json({ 
                    success: true, 
                    runId: this.currentRunId,
                    message: `Started new run: ${this.currentRunId}` 
                });
            } catch (error) {
                res.status(500).json({ error: 'Failed to start new run' });
            }
        });
    }
    
    setupSocketHandlers() {
        this.io.on('connection', (socket) => {
            console.log('GUI client connected');
            
            // Send initial state
            socket.emit('initial-state', {
                logs: this.logs.slice(-100),
                toolCalls: this.toolCalls.slice(-50),
                fileChanges: this.fileChanges.slice(-50),
                agentLoops: this.agentLoops.slice(-10),
                currentLoop: this.currentAgentLoop
            });
            
            socket.on('clear-logs', () => {
                this.logs = [];
                this.io.emit('logs-cleared');
            });
            
            socket.on('clear-tools', () => {
                this.toolCalls = [];
                this.io.emit('tools-cleared');
            });
            
            socket.on('clear-files', () => {
                this.fileChanges = [];
                this.io.emit('files-cleared');
            });
            
            socket.on('disconnect', () => {
                console.log('GUI client disconnected');
            });
        });
    }
    
    start() {
        return new Promise((resolve) => {
            this.server.listen(this.port, () => {
                this.isRunning = true;
                this.startTime = new Date().toISOString();
                console.log(`\n🖥️  Bot Sportello GUI Dashboard`);
                console.log(`📊 Open http://localhost:${this.port} to view verbose logging`);
                console.log(`✨ Real-time updates via WebSocket`);
                console.log(`🆕 Current run: ${this.currentRunId}\n`);
                resolve();
            });
        });
    }
    
    stop() {
        return new Promise((resolve) => {
            // Save current run before stopping
            if (this.logs.length > 0 || this.toolCalls.length > 0 || this.fileChanges.length > 0 || this.agentLoops.length > 0) {
                this.saveCurrentRun();
            }
            
            this.server.close(() => {
                this.isRunning = false;
                console.log('GUI server stopped');
                resolve();
            });
        });
    }
    
    // Logging methods to be called from index.js
    
    log(level, message, data = {}) {
        const entry = {
            timestamp: new Date().toISOString(),
            level,
            message,
            data,
            id: Date.now() + Math.random()
        };
        
        this.logs.push(entry);
        if (this.logs.length > this.maxLogs) {
            this.logs.shift();
        }
        
        this.io.emit('new-log', entry);
        return entry;
    }
    
    logToolCall(toolName, args, result, error = null) {
        const entry = {
            timestamp: new Date().toISOString(),
            tool: toolName,
            args,
            result: result ? this.truncateResult(result) : null,
            error,
            success: !error,
            id: Date.now() + Math.random(),
            loopIteration: this.currentAgentLoop?.iteration || null
        };
        
        this.toolCalls.push(entry);
        if (this.toolCalls.length > this.maxLogs) {
            this.toolCalls.shift();
        }
        
        this.io.emit('new-tool-call', entry);
        return entry;
    }
    
    logFileChange(action, path, content = null, oldContent = null) {
        const entry = {
            timestamp: new Date().toISOString(),
            action, // 'create', 'edit', 'delete', 'read'
            path,
            content: content ? this.truncateContent(content) : null,
            oldContent: oldContent ? this.truncateContent(oldContent) : null,
            id: Date.now() + Math.random(),
            loopIteration: this.currentAgentLoop?.iteration || null
        };
        
        this.fileChanges.push(entry);
        if (this.fileChanges.length > this.maxLogs) {
            this.fileChanges.shift();
        }
        
        this.io.emit('new-file-change', entry);
        return entry;
    }
    
    startAgentLoop(command, user, channel) {
        const loop = {
            id: Date.now() + Math.random(),
            command,
            user,
            channel,
            startTime: new Date().toISOString(),
            iteration: 0,
            tools: [],
            status: 'running',
            finalResult: null
        };
        
        this.currentAgentLoop = loop;
        this.agentLoops.push(loop);
        if (this.agentLoops.length > 50) {
            this.agentLoops.shift();
        }
        
        this.io.emit('agent-loop-start', loop);
        return loop;
    }
    
    updateAgentLoop(iteration, toolsUsed, thinking = null) {
        if (!this.currentAgentLoop) return;
        
        this.currentAgentLoop.iteration = iteration;
        this.currentAgentLoop.lastUpdate = new Date().toISOString();
        if (toolsUsed) {
            this.currentAgentLoop.tools.push(...toolsUsed);
        }
        if (thinking) {
            this.currentAgentLoop.lastThinking = thinking;
        }
        
        this.io.emit('agent-loop-update', this.currentAgentLoop);
    }
    
    endAgentLoop(result, error = null) {
        if (!this.currentAgentLoop) return;
        
        this.currentAgentLoop.endTime = new Date().toISOString();
        this.currentAgentLoop.status = error ? 'error' : 'completed';
        this.currentAgentLoop.finalResult = result;
        this.currentAgentLoop.error = error;
        
        const duration = new Date(this.currentAgentLoop.endTime) - new Date(this.currentAgentLoop.startTime);
        this.currentAgentLoop.duration = duration;
        
        this.io.emit('agent-loop-end', this.currentAgentLoop);
        this.currentAgentLoop = null;
    }
    
    // Helper methods
    
    truncateResult(result) {
        const str = typeof result === 'string' ? result : JSON.stringify(result);
        return str.length > 500 ? str.substring(0, 500) + '...' : str;
    }
    
    truncateContent(content) {
        return content.length > 1000 ? content.substring(0, 1000) + '...' : content;
    }
    
    // Discord event logging
    
    logDiscordEvent(eventType, data) {
        this.log('discord', `Discord ${eventType}`, data);
    }
    
    logGitOperation(operation, details) {
        this.log('git', `Git ${operation}`, details);
    }
    
    logAIResponse(model, prompt, response, tokens) {
        this.log('ai', `AI Response from ${model}`, {
            promptLength: prompt.length,
            responseLength: response.length,
            tokens,
            model
        });
    }
    
    // Run-based persistence methods
    
    generateRunId() {
        const now = new Date();
        const timestamp = now.toISOString().replace(/[:.]/g, '-').slice(0, -5);
        return `run-${timestamp}`;
    }
    
    ensureRunLogsDirectory() {
        if (!fs.existsSync(this.runBasedLogsDir)) {
            fs.mkdirSync(this.runBasedLogsDir, { recursive: true });
        }
    }
    
    saveCurrentRun() {
        const runData = {
            id: this.currentRunId,
            timestamp: new Date().toISOString(),
            startTime: this.startTime,
            endTime: new Date().toISOString(),
            logs: this.logs,
            toolCalls: this.toolCalls,
            fileChanges: this.fileChanges,
            agentLoops: this.agentLoops,
            summary: {
                totalLogs: this.logs.length,
                totalToolCalls: this.toolCalls.length,
                totalFileChanges: this.fileChanges.length,
                totalAgentLoops: this.agentLoops.length
            }
        };
        
        const filePath = path.join(this.runBasedLogsDir, `${this.currentRunId}.json`);
        fs.writeFileSync(filePath, JSON.stringify(runData, null, 2));
        console.log(`📄 Saved run data: ${filePath}`);
    }
    
    getAvailableRuns() {
        if (!fs.existsSync(this.runBasedLogsDir)) {
            return [];
        }
        
        const files = fs.readdirSync(this.runBasedLogsDir)
            .filter(file => file.endsWith('.json'))
            .map(file => {
                const filePath = path.join(this.runBasedLogsDir, file);
                const stats = fs.statSync(filePath);
                const runId = file.replace('.json', '');
                
                try {
                    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
                    return {
                        id: runId,
                        timestamp: data.timestamp || stats.ctime.toISOString(),
                        startTime: data.startTime,
                        endTime: data.endTime,
                        summary: data.summary || {
                            totalLogs: 0,
                            totalToolCalls: 0,
                            totalFileChanges: 0,
                            totalAgentLoops: 0
                        }
                    };
                } catch (error) {
                    console.warn(`Failed to parse run file: ${file}`, error);
                    return null;
                }
            })
            .filter(run => run !== null)
            .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp)); // Latest to oldest
        
        return files;
    }
    
    loadRunData(runId) {
        const filePath = path.join(this.runBasedLogsDir, `${runId}.json`);
        if (!fs.existsSync(filePath)) {
            throw new Error(`Run ${runId} not found`);
        }
        
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    }
    
    startNewRun() {
        // Save current run if it has data
        if (this.logs.length > 0 || this.toolCalls.length > 0 || this.fileChanges.length > 0 || this.agentLoops.length > 0) {
            this.saveCurrentRun();
        }
        
        // Start new run
        this.currentRunId = this.generateRunId();
        this.startTime = new Date().toISOString();
        this.logs = [];
        this.toolCalls = [];
        this.fileChanges = [];
        this.agentLoops = [];
        this.currentAgentLoop = null;
        
        console.log(`🆕 Started new run: ${this.currentRunId}`);
    }
}

module.exports = BotGUIServer;