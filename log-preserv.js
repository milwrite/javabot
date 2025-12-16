#!/usr/bin/env node

/**
 * Bot Sportello Log Preservation System
 * 
 * Automatically captures and preserves all activity when running `node index.js`,
 * including successful operations and broken/failed processes.
 */

const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const { spawn, exec } = require('child_process');

class BotLogPreserver {
    constructor() {
        this.logDir = path.join(__dirname, 'session-logs');
        this.sessionId = this.generateSessionId();
        this.sessionStart = new Date();
        this.botProcess = null;
        this.guiProcess = null;
        this.logBuffer = [];
        this.isShuttingDown = false;
        this.activityCount = 0;
        this.lastActivity = null;
        this.errors = [];
        this.warnings = [];
        this.mentions = [];
        this.toolCalls = [];
        this.guiPort = 3001;
        
        this.setupDirectories();
        this.setupSignalHandlers();
    }
    
    generateSessionId() {
        const now = new Date();
        const timestamp = now.toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, -5);
        return `bot-session-${timestamp}`;
    }
    
    async setupDirectories() {
        try {
            await fs.mkdir(this.logDir, { recursive: true });
            console.log(`📁 Session logs directory: ${this.logDir}`);
        } catch (error) {
            console.error('Failed to create log directory:', error);
            process.exit(1);
        }
    }
    
    setupSignalHandlers() {
        process.on('SIGINT', () => this.gracefulShutdown('SIGINT'));
        process.on('SIGTERM', () => this.gracefulShutdown('SIGTERM'));
        process.on('SIGHUP', () => this.gracefulShutdown('SIGHUP'));
        process.on('uncaughtException', (error) => this.handleCrash('uncaughtException', error));
        process.on('unhandledRejection', (reason) => this.handleCrash('unhandledRejection', reason));
        
        process.on('exit', (code) => {
            if (!this.isShuttingDown) {
                this.saveSessionReport(code, 'unexpected-exit');
            }
        });
    }
    
    parseCommandLine() {
        const args = process.argv.slice(2);
        for (let i = 0; i < args.length; i++) {
            if (args[i] === '--gui-port' && i + 1 < args.length) {
                this.guiPort = parseInt(args[i + 1]);
                i++;
            }
        }
    }
    
    async startBot() {
        console.log(`🤖 Starting Bot Sportello with log preservation`);
        console.log(`📊 Session ID: ${this.sessionId}`);
        console.log(`🕐 Start time: ${this.sessionStart.toISOString()}\n`);
        
        await this.startGUIServer();
        
        this.botProcess = spawn('node', ['index.js'], {
            cwd: __dirname,
            stdio: ['pipe', 'pipe', 'pipe'],
            env: { 
                ...process.env, 
                GUI_PORT: this.guiPort.toString(),
                SESSION_ID: this.sessionId 
            }
        });
        
        console.log(`🚀 Bot process started (PID: ${this.botProcess.pid})\n`);
        
        this.setupOutputHandlers();
        this.startActivityMonitor();
        
        this.botProcess.on('error', (error) => {
            this.logError('Process spawn error', error);
        });
        
        this.botProcess.on('exit', (code, signal) => {
            this.handleBotExit(code, signal);
        });
        
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                this.logError('Bot startup timeout', new Error('Bot failed to start within 30 seconds'));
                this.gracefulShutdown('startup-timeout');
                reject(new Error('Startup timeout'));
            }, 30000);
            
            const readyPattern = /Bot is ready as Bot Sportello/;
            const checkReady = (data) => {
                if (readyPattern.test(data)) {
                    clearTimeout(timeout);
                    console.log('✅ Bot is ready and logging activity\n');
                    console.log('📊 GUI Dashboard: http://localhost:' + this.guiPort);
                    console.log('📋 Use Ctrl+C to stop and generate session report\n');
                    resolve();
                }
            };
            
            this.botProcess.stdout.on('data', checkReady);
            this.botProcess.stderr.on('data', checkReady);
        });
    }
    
    async startGUIServer() {
        const guiServerPath = path.join(__dirname, 'gui-server.js');
        try {
            await fs.access(guiServerPath);
            console.log(`🖥️  Starting GUI dashboard on port ${this.guiPort}...`);
            
            this.guiProcess = spawn('node', ['test-gui.js'], {
                cwd: __dirname,
                stdio: ['pipe', 'pipe', 'pipe'],
                env: { ...process.env, GUI_PORT: this.guiPort.toString() }
            });
            
            await new Promise(resolve => setTimeout(resolve, 2000));
            
        } catch (error) {
            console.log('ℹ️  GUI dashboard not available (gui-server.js not found)');
        }
    }
    
    setupOutputHandlers() {
        this.botProcess.stdout.on('data', (data) => {
            const output = data.toString();
            this.processOutput('stdout', output);
        });
        
        this.botProcess.stderr.on('data', (data) => {
            const output = data.toString();
            this.processOutput('stderr', output);
        });
        
        process.stdin.pipe(this.botProcess.stdin);
    }
    
    processOutput(stream, output) {
        const timestamp = new Date().toISOString();
        const lines = output.split('\n').filter(line => line.trim());
        
        lines.forEach(line => {
            this.logBuffer.push({ timestamp, stream, line });
            console.log(`[${timestamp}] ${line}`);
            this.analyzeLogLine(line, timestamp);
            this.lastActivity = timestamp;
            this.activityCount++;
        });
        
        if (this.logBuffer.length > 100) {
            this.flushLogBuffer();
        }
    }
    
    analyzeLogLine(line, timestamp) {
        // Track mentions
        if (line.includes('[MENTION DETECTED]') || line.includes('🔔 [MENTION DETECTED]')) {
            const match = line.match(/([\\w\\d]+) mentioned the bot in #([\\w\\-]+)/);
            if (match) {
                this.mentions.push({
                    timestamp,
                    user: match[1],
                    channel: match[2],
                    line
                });
            }
        }
        
        // Track tool calls
        if (line.includes('tool_calls') || line.match(/\\b(list_files|read_file|write_file|edit_file|create_page|commit_changes)\\b/)) {
            this.toolCalls.push({ timestamp, line });
        }
        
        // Track errors
        if (line.includes('ERROR') || line.includes('Error:') || line.includes('error') || line.match(/\\b(failed|failure|exception)\\b/i)) {
            this.errors.push({
                timestamp,
                line,
                severity: this.categorizeError(line)
            });
        }
        
        // Track warnings
        if (line.includes('WARN') || line.includes('Warning') || line.includes('⚠️')) {
            this.warnings.push({ timestamp, line });
        }
    }
    
    categorizeError(line) {
        if (line.match(/\\b(critical|fatal|crash)\\b/i)) return 'critical';
        if (line.match(/\\b(authentication|token|permission)\\b/i)) return 'auth';
        if (line.match(/\\b(network|timeout|connection)\\b/i)) return 'network';
        if (line.match(/\\b(git|push|commit)\\b/i)) return 'git';
        if (line.match(/\\b(discord|api|rate.?limit)\\b/i)) return 'discord';
        return 'general';
    }
    
    startActivityMonitor() {
        this.healthCheckInterval = setInterval(() => {
            if (this.botProcess && !this.botProcess.killed) {
                const now = Date.now();
                const lastActivityTime = this.lastActivity ? new Date(this.lastActivity).getTime() : this.sessionStart.getTime();
                const timeSinceActivity = now - lastActivityTime;
                
                console.log(`\\n🔍 Health Check: ${this.activityCount} events, last activity ${Math.round(timeSinceActivity/1000)}s ago`);
                
                if (timeSinceActivity > 300000) {
                    this.logWarning('Bot appears to be hanging', {
                        timeSinceActivity: `${Math.round(timeSinceActivity/1000)}s`,
                        activityCount: this.activityCount
                    });
                }
            }
        }, 30000);
    }
    
    async flushLogBuffer() {
        if (this.logBuffer.length === 0) return;
        
        try {
            const logFile = path.join(this.logDir, `${this.sessionId}-raw.log`);
            const logText = this.logBuffer.map(entry => 
                `${entry.timestamp} [${entry.stream.toUpperCase()}] ${entry.line}`
            ).join('\\n') + '\\n';
            
            await fs.appendFile(logFile, logText);
            this.logBuffer = [];
        } catch (error) {
            console.error('Failed to flush log buffer:', error);
        }
    }
    
    logError(message, error) {
        const timestamp = new Date().toISOString();
        const errorEntry = {
            timestamp,
            message,
            error: error.toString(),
            stack: error.stack
        };
        
        this.errors.push(errorEntry);
        console.error(`\\n❌ [${timestamp}] ${message}:`, error.toString());
    }
    
    logWarning(message, data = {}) {
        const timestamp = new Date().toISOString();
        const warningEntry = { timestamp, message, data };
        
        this.warnings.push(warningEntry);
        console.warn(`\\n⚠️  [${timestamp}] ${message}`);
        if (Object.keys(data).length > 0) {
            console.warn('    Data:', data);
        }
    }
    
    handleBotExit(code, signal) {
        const timestamp = new Date().toISOString();
        const exitReason = signal ? `signal ${signal}` : `code ${code}`;
        
        console.log(`\\n🛑 [${timestamp}] Bot process exited with ${exitReason}`);
        
        if (!this.isShuttingDown) {
            if (code !== 0 || signal) {
                this.logError('Bot process crashed unexpectedly', new Error(`Exit ${exitReason}`));
                this.saveSessionReport(code, signal || 'unexpected');
            }
        }
        
        clearInterval(this.healthCheckInterval);
    }
    
    async handleCrash(type, errorOrReason) {
        console.log(`\\n💥 [${new Date().toISOString()}] ${type}:`, errorOrReason);
        this.logError(`Process ${type}`, new Error(errorOrReason.toString()));
        await this.saveSessionReport(1, type);
        process.exit(1);
    }
    
    async gracefulShutdown(reason) {
        if (this.isShuttingDown) return;
        this.isShuttingDown = true;
        
        console.log(`\\n🔄 [${new Date().toISOString()}] Graceful shutdown initiated (${reason})`);
        
        await this.flushLogBuffer();
        
        if (this.botProcess && !this.botProcess.killed) {
            console.log('🛑 Stopping bot process...');
            this.botProcess.kill('SIGTERM');
            
            setTimeout(() => {
                if (!this.botProcess.killed) {
                    console.log('🔥 Force killing bot process...');
                    this.botProcess.kill('SIGKILL');
                }
            }, 5000);
        }
        
        if (this.guiProcess && !this.guiProcess.killed) {
            console.log('🖥️  Stopping GUI server...');
            this.guiProcess.kill('SIGTERM');
        }
        
        await this.saveSessionReport(0, reason);
        
        console.log('✅ Shutdown complete\\n');
        process.exit(0);
    }
    
    async saveSessionReport(exitCode, exitReason) {
        const sessionEnd = new Date();
        const duration = sessionEnd.getTime() - this.sessionStart.getTime();
        
        const report = {
            session: {
                id: this.sessionId,
                startTime: this.sessionStart.toISOString(),
                endTime: sessionEnd.toISOString(),
                duration: this.formatDuration(duration),
                exitCode,
                exitReason
            },
            activity: {
                totalEvents: this.activityCount,
                lastActivity: this.lastActivity,
                eventsPerMinute: Math.round(this.activityCount / (duration / 60000))
            },
            mentions: {
                total: this.mentions.length,
                events: this.mentions
            },
            toolCalls: {
                total: this.toolCalls.length,
                events: this.toolCalls.slice(-20)
            },
            errors: {
                total: this.errors.length,
                byCategory: this.categorizeErrors(),
                events: this.errors
            },
            warnings: {
                total: this.warnings.length,
                events: this.warnings
            },
            summary: this.generateSummary(exitCode, exitReason, duration)
        };
        
        try {
            const reportFile = path.join(this.logDir, `${this.sessionId}-report.json`);
            await fs.writeFile(reportFile, JSON.stringify(report, null, 2));
            
            const summaryFile = path.join(this.logDir, `${this.sessionId}-summary.md`);
            await fs.writeFile(summaryFile, this.generateMarkdownSummary(report));
            
            console.log(`\\n📊 Session report saved:`);
            console.log(`   JSON: ${reportFile}`);
            console.log(`   Summary: ${summaryFile}\\n`);
            
        } catch (error) {
            console.error('Failed to save session report:', error);
        }
    }
    
    categorizeErrors() {
        const categories = {};
        this.errors.forEach(error => {
            const category = error.severity || 'general';
            categories[category] = (categories[category] || 0) + 1;
        });
        return categories;
    }
    
    formatDuration(ms) {
        const seconds = Math.floor(ms / 1000);
        const minutes = Math.floor(seconds / 60);
        const hours = Math.floor(minutes / 60);
        
        if (hours > 0) return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
        if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
        return `${seconds}s`;
    }
    
    generateSummary(exitCode, exitReason, duration) {
        const status = exitCode === 0 ? 'SUCCESS' : 'FAILURE';
        const errorCount = this.errors.length;
        const mentionCount = this.mentions.length;
        const toolCallCount = this.toolCalls.length;
        
        let summary = `${status}: Bot session lasted ${this.formatDuration(duration)}`;
        
        if (mentionCount > 0) {
            summary += `, processed ${mentionCount} mention${mentionCount > 1 ? 's' : ''}`;
        }
        
        if (toolCallCount > 0) {
            summary += `, executed ${toolCallCount} tool call${toolCallCount > 1 ? 's' : ''}`;
        }
        
        if (errorCount > 0) {
            const criticalErrors = this.errors.filter(e => e.severity === 'critical').length;
            summary += `, encountered ${errorCount} error${errorCount > 1 ? 's' : ''}`;
            if (criticalErrors > 0) {
                summary += ` (${criticalErrors} critical)`;
            }
        }
        
        if (exitCode !== 0) {
            summary += `. Exit reason: ${exitReason}`;
        }
        
        return summary;
    }
    
    generateMarkdownSummary(report) {
        const { session, activity, mentions, toolCalls, errors, warnings } = report;
        
        const mentionList = mentions.events.slice(-10).map(m => 
            `- **${m.user}** in #${m.channel} at ${new Date(m.timestamp).toLocaleTimeString()}`
        ).join('\\n') || '- None';
        
        const toolCallList = toolCalls.events.slice(-10).map(t => 
            `- ${new Date(t.timestamp).toLocaleTimeString()}: ${t.line.substring(0, 100)}...`
        ).join('\\n') || '- None';
        
        const errorList = errors.events.slice(-5).map(e => 
            `- **${e.severity}** at ${new Date(e.timestamp).toLocaleTimeString()}: ${e.message}`
        ).join('\\n') || '- None';
        
        const warningList = warnings.events.slice(-5).map(w => 
            `- ${new Date(w.timestamp).toLocaleTimeString()}: ${w.message}`
        ).join('\\n') || '- None';
        
        return `# Bot Sportello Session Report

## Session Details
- **ID**: ${session.id}
- **Duration**: ${session.duration}
- **Status**: ${session.exitCode === 0 ? '✅ SUCCESS' : '❌ FAILURE'}
- **Exit Reason**: ${session.exitReason}
- **Start**: ${new Date(session.startTime).toLocaleString()}
- **End**: ${new Date(session.endTime).toLocaleString()}

## Activity Summary
- **Total Events**: ${activity.totalEvents}
- **Events/Minute**: ${activity.eventsPerMinute}
- **Last Activity**: ${activity.lastActivity ? new Date(activity.lastActivity).toLocaleString() : 'None'}

## Interactions
### Mentions (${mentions.total})
${mentionList}

### Tool Calls (${toolCalls.total})
${toolCallList}

## Issues
### Errors (${errors.total})
${errorList}

### Warnings (${warnings.total})
${warningList}

## Overall Summary
${report.summary}

---
*Generated by Bot Sportello Log Preservation System*
`;
    }
}

// Main execution
async function main() {
    const preserver = new BotLogPreserver();
    preserver.parseCommandLine();
    
    try {
        await preserver.startBot();
        process.stdin.resume();
        
    } catch (error) {
        console.error('Failed to start bot:', error);
        process.exit(1);
    }
}

if (require.main === module) {
    main().catch(error => {
        console.error('Unhandled error:', error);
        process.exit(1);
    });
}

module.exports = BotLogPreserver;