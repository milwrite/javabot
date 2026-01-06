/**
 * Analysis Loop
 * Manages the event buffer and triggers analysis cycles
 */

import type { PostgresListener } from '../services/postgresListener.js';
import type { MySQLStorage } from '../services/mysqlStorage.js';
import type { MasonDixonAgent } from './index.js';
import type { SportelloEvent, ToolCallEvent, NotifyPayload } from '../types/index.js';

export interface AnalysisLoopConfig {
    intervalMs: number;
    maxEventBuffer: number;
}

export class AnalysisLoop {
    private pgListener: PostgresListener;
    private mysql: MySQLStorage;
    private agent: MasonDixonAgent;
    private config: AnalysisLoopConfig;

    private eventBuffer: SportelloEvent[] = [];
    private toolCallBuffer: ToolCallEvent[] = [];
    private isAnalyzing: boolean = false;
    private intervalHandle: NodeJS.Timeout | null = null;
    private sessionId: string | null = null;

    constructor(
        pgListener: PostgresListener,
        mysql: MySQLStorage,
        agent: MasonDixonAgent,
        config: AnalysisLoopConfig
    ) {
        this.pgListener = pgListener;
        this.mysql = mysql;
        this.agent = agent;
        this.config = config;
    }

    /**
     * Start the analysis loop
     */
    async start(sessionId: string): Promise<void> {
        this.sessionId = sessionId;

        // Subscribe to PostgreSQL notifications
        this.pgListener.on('serena_logs', (payload: NotifyPayload) => {
            this.handleNotification(payload);
        });

        // Start periodic analysis
        this.intervalHandle = setInterval(() => {
            this.processBuffer();
        }, this.config.intervalMs);

        console.log(`[LOOP] Analysis loop started (interval: ${this.config.intervalMs}ms)`);
    }

    /**
     * Stop the analysis loop
     */
    stop(): void {
        if (this.intervalHandle) {
            clearInterval(this.intervalHandle);
            this.intervalHandle = null;
        }
        console.log('[LOOP] Analysis loop stopped');
    }

    /**
     * Handle incoming notification from PostgreSQL
     */
    private async handleNotification(payload: NotifyPayload): Promise<void> {
        try {
            // Fetch full event data
            const event = await this.pgListener.fetchEventById(payload.table, payload.id);

            if (!event) {
                return;
            }

            if (payload.table === 'tool_calls') {
                this.toolCallBuffer.push(event as ToolCallEvent);
            } else {
                this.eventBuffer.push(event as SportelloEvent);
            }

            // Trigger immediate processing if buffer is full
            if (this.eventBuffer.length + this.toolCallBuffer.length >= this.config.maxEventBuffer) {
                await this.processBuffer();
            }

        } catch (error) {
            console.error('[LOOP] Notification handling error:', error);
        }
    }

    /**
     * Process the event buffer
     */
    private async processBuffer(): Promise<void> {
        if (this.isAnalyzing) {
            return;
        }

        if (this.eventBuffer.length === 0 && this.toolCallBuffer.length === 0) {
            return;
        }

        if (!this.sessionId) {
            console.warn('[LOOP] No session ID, skipping analysis');
            return;
        }

        this.isAnalyzing = true;

        // Take current buffer contents
        const events = [...this.eventBuffer];
        const toolCalls = [...this.toolCallBuffer];
        this.eventBuffer = [];
        this.toolCallBuffer = [];

        console.log(`[LOOP] Processing ${events.length} events, ${toolCalls.length} tool calls`);

        try {
            // Update session event count
            await this.mysql.incrementSessionEvents(this.sessionId, events.length + toolCalls.length);

            // Run analysis
            await this.agent.analyzeEvents({
                events,
                toolCalls,
                sessionId: this.sessionId
            });

        } catch (error) {
            console.error('[LOOP] Analysis error:', error);
        } finally {
            this.isAnalyzing = false;
        }
    }

    /**
     * Force immediate processing
     */
    async forceProcess(): Promise<void> {
        await this.processBuffer();
    }

    /**
     * Get current buffer sizes
     */
    getBufferStats(): { events: number; toolCalls: number } {
        return {
            events: this.eventBuffer.length,
            toolCalls: this.toolCallBuffer.length
        };
    }
}
