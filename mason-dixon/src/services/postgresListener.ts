/**
 * PostgreSQL NOTIFY/LISTEN Service
 * Connects to Sportello's PostgreSQL and listens for real-time events
 */

import pg from 'pg';
import { EventEmitter } from 'events';
import type { NotifyPayload, SportelloEvent, ToolCallEvent } from '../types/index.js';

const { Client } = pg;

export class PostgresListener extends EventEmitter {
    private client: pg.Client;
    private connectionString: string;
    private reconnectAttempts: number = 0;
    private maxReconnectAttempts: number = 10;
    private reconnectDelay: number = 5000;
    private isConnected: boolean = false;

    constructor(connectionString: string) {
        super();
        this.connectionString = connectionString;
        this.client = this.createClient();
    }

    private createClient(): pg.Client {
        return new Client({
            connectionString: this.connectionString,
            ssl: { rejectUnauthorized: false }
        });
    }

    async connect(): Promise<void> {
        try {
            await this.client.connect();
            this.isConnected = true;

            // Subscribe to Sportello's NOTIFY channel
            await this.client.query('LISTEN serena_logs');

            this.client.on('notification', (msg) => {
                this.handleNotification(msg);
            });

            this.client.on('error', async (err) => {
                console.error('[PG-LISTENER] Connection error:', err.message);
                this.isConnected = false;
                await this.reconnect();
            });

            this.client.on('end', async () => {
                console.warn('[PG-LISTENER] Connection ended');
                this.isConnected = false;
                await this.reconnect();
            });

            this.reconnectAttempts = 0;
            console.log('[PG-LISTENER] Connected to Sportello PostgreSQL, listening on serena_logs');

        } catch (error) {
            console.error('[PG-LISTENER] Connection failed:', error);
            await this.reconnect();
        }
    }

    private handleNotification(msg: pg.Notification): void {
        try {
            const payload = JSON.parse(msg.payload || '{}') as NotifyPayload;

            // Emit the notification for processing
            this.emit('serena_logs', payload);

            // Also emit typed events
            this.emit(`event:${payload.table}`, payload);

        } catch (e) {
            console.error('[PG-LISTENER] Parse error:', e);
        }
    }

    private async reconnect(): Promise<void> {
        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
            console.error('[PG-LISTENER] Max reconnection attempts reached');
            this.emit('fatal_error', new Error('Max reconnection attempts reached'));
            return;
        }

        this.reconnectAttempts++;
        const delay = this.reconnectDelay * Math.pow(1.5, this.reconnectAttempts - 1);

        console.log(`[PG-LISTENER] Reconnecting in ${(delay / 1000).toFixed(1)}s (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`);

        await new Promise(resolve => setTimeout(resolve, delay));

        // Create new client for reconnection
        try {
            await this.client.end();
        } catch {
            // Ignore disconnect errors
        }

        this.client = this.createClient();
        await this.connect();
    }

    async disconnect(): Promise<void> {
        try {
            this.isConnected = false;
            await this.client.end();
            console.log('[PG-LISTENER] Disconnected');
        } catch {
            // Ignore disconnect errors
        }
    }

    /**
     * Fetch full event data from Sportello's database by ID
     */
    async fetchEventById(table: string, id: number): Promise<SportelloEvent | ToolCallEvent | null> {
        const validTables = ['bot_events', 'tool_calls', 'build_stages'];
        if (!validTables.includes(table)) {
            throw new Error(`Invalid table: ${table}`);
        }

        try {
            const result = await this.client.query(
                `SELECT * FROM ${table} WHERE id = $1`,
                [id]
            );
            return result.rows[0] ?? null;
        } catch (error) {
            console.error(`[PG-LISTENER] Error fetching ${table}:${id}:`, error);
            return null;
        }
    }

    /**
     * Query recent events for backfill or analysis
     */
    async queryRecentEvents(hours: number = 24, limit: number = 1000): Promise<SportelloEvent[]> {
        try {
            const result = await this.client.query(`
                SELECT * FROM bot_events
                WHERE timestamp > NOW() - INTERVAL '${hours} hours'
                ORDER BY timestamp DESC
                LIMIT $1
            `, [limit]);
            return result.rows as SportelloEvent[];
        } catch (error) {
            console.error('[PG-LISTENER] Error querying recent events:', error);
            return [];
        }
    }

    /**
     * Query recent tool calls
     */
    async queryRecentToolCalls(hours: number = 24, limit: number = 500): Promise<ToolCallEvent[]> {
        try {
            const result = await this.client.query(`
                SELECT * FROM tool_calls
                WHERE timestamp > NOW() - INTERVAL '${hours} hours'
                ORDER BY timestamp DESC
                LIMIT $1
            `, [limit]);
            return result.rows as ToolCallEvent[];
        } catch (error) {
            console.error('[PG-LISTENER] Error querying recent tool calls:', error);
            return [];
        }
    }

    /**
     * Get error statistics from Sportello's database
     */
    async getErrorStats(hours: number = 24): Promise<Record<string, number>> {
        try {
            const result = await this.client.query(`
                SELECT
                    COALESCE(error_category, 'unknown') as category,
                    COUNT(*) as count
                FROM bot_events
                WHERE event_type = 'error'
                  AND timestamp > NOW() - INTERVAL '${hours} hours'
                GROUP BY error_category
                ORDER BY count DESC
            `);

            const stats: Record<string, number> = {};
            for (const row of result.rows) {
                stats[row.category] = parseInt(row.count, 10);
            }
            return stats;
        } catch (error) {
            console.error('[PG-LISTENER] Error getting error stats:', error);
            return {};
        }
    }

    /**
     * Get current Sportello session ID
     */
    async getCurrentSportelloSession(): Promise<string | null> {
        try {
            const result = await this.client.query(`
                SELECT id FROM bot_sessions
                WHERE status = 'active'
                ORDER BY started_at DESC
                LIMIT 1
            `);
            return result.rows[0]?.id ?? null;
        } catch (error) {
            console.error('[PG-LISTENER] Error getting current session:', error);
            return null;
        }
    }

    get connected(): boolean {
        return this.isConnected;
    }
}
