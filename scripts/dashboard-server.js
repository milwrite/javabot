// scripts/dashboard-server.js
// Lightweight dashboard server with SSE streaming from PostgreSQL NOTIFY
// Replaces: gui-server.js (437 lines) with ~150 lines

const express = require('express');
const path = require('path');

// Lazy-load serena to avoid circular dependency
let serena = null;
function getSerena() {
    if (!serena) {
        serena = require('../services/serenaLogs');
    }
    return serena;
}

class DashboardServer {
    constructor(port = 3001) {
        this.port = port;
        this.app = express();
        this.server = null;
        this.clients = new Set(); // SSE clients
        this.notifyClient = null;
    }

    /**
     * Start the dashboard server
     */
    async start() {
        this.setupRoutes();
        await this.setupNotifyListener();

        return new Promise((resolve, reject) => {
            this.server = this.app.listen(this.port, () => {
                console.log(`[DASHBOARD] Server running at http://localhost:${this.port}/dashboard`);
                resolve();
            });
            this.server.on('error', reject);
        });
    }

    /**
     * Setup Express routes
     */
    setupRoutes() {
        // Serve static files from project root (main site)
        this.app.use(express.static(path.join(__dirname, '..')));

        // Serve static files from gui/ directory
        this.app.use('/gui', express.static(path.join(__dirname, '../gui')));

        // Dashboard page at /dashboard
        this.app.get('/dashboard', (req, res) => {
            res.sendFile(path.join(__dirname, '../gui/dashboard.html'));
        });

        // SSE endpoint - real-time event stream
        this.app.get('/api/stream', (req, res) => {
            res.setHeader('Content-Type', 'text/event-stream');
            res.setHeader('Cache-Control', 'no-cache');
            res.setHeader('Connection', 'keep-alive');
            res.setHeader('Access-Control-Allow-Origin', '*');

            // Send initial connection event
            res.write('event: connected\ndata: {"status":"connected"}\n\n');

            this.clients.add(res);
            console.log(`[DASHBOARD] SSE client connected (${this.clients.size} total)`);

            req.on('close', () => {
                this.clients.delete(res);
                console.log(`[DASHBOARD] SSE client disconnected (${this.clients.size} total)`);
            });
        });

        // REST API - fetch historical data
        this.app.get('/api/logs', async (req, res) => {
            try {
                const type = req.query.type || 'all';
                const limit = Math.min(parseInt(req.query.limit) || 100, 500);
                const events = await getSerena().getRecentEvents(type, limit);
                res.json(events);
            } catch (error) {
                res.status(500).json({ error: error.message });
            }
        });

        this.app.get('/api/tools', async (req, res) => {
            try {
                const limit = Math.min(parseInt(req.query.limit) || 50, 200);
                const events = await getSerena().getRecentEvents('tool_call', limit);
                res.json(events);
            } catch (error) {
                res.status(500).json({ error: error.message });
            }
        });

        this.app.get('/api/sessions', async (req, res) => {
            try {
                const limit = Math.min(parseInt(req.query.limit) || 20, 100);
                const sessions = await getSerena().getSessionHistory(limit);
                res.json(sessions);
            } catch (error) {
                res.status(500).json({ error: error.message });
            }
        });

        this.app.get('/api/sessions/:id/events', async (req, res) => {
            try {
                const limit = Math.min(parseInt(req.query.limit) || 100, 500);
                const events = await getSerena().getSessionEvents(req.params.id, limit);
                res.json(events);
            } catch (error) {
                res.status(500).json({ error: error.message });
            }
        });

        this.app.get('/api/stats', async (req, res) => {
            try {
                const days = parseInt(req.query.days) || 7;
                const stats = await getSerena().getDailyStats(days);
                res.json(stats);
            } catch (error) {
                res.status(500).json({ error: error.message });
            }
        });

        this.app.get('/api/errors', async (req, res) => {
            try {
                const period = req.query.period || '24h';
                const stats = await getSerena().getErrorStats(period);
                res.json(stats);
            } catch (error) {
                res.status(500).json({ error: error.message });
            }
        });

        // Health check
        this.app.get('/api/health', (req, res) => {
            res.json({
                status: 'ok',
                clients: this.clients.size,
                dbConnected: getSerena().enabled(),
                sessionId: getSerena().getSessionId()
            });
        });
    }

    /**
     * Setup PostgreSQL LISTEN/NOTIFY for real-time streaming
     */
    async setupNotifyListener() {
        if (!getSerena().enabled()) {
            console.warn('[DASHBOARD] Database not connected, SSE will not stream live events');
            return;
        }

        this.notifyClient = await getSerena().setupNotifyListener(async (notification) => {
            // Fetch full event data
            const event = await getSerena().getEventById(notification.table, notification.id);
            if (event) {
                this.broadcast(notification.type, event);
            }
        });
    }

    /**
     * Broadcast event to all SSE clients
     * @param {string} eventType - Event type (mention, tool_call, file_change, etc.)
     * @param {Object} data - Event data
     */
    broadcast(eventType, data) {
        if (this.clients.size === 0) return;

        const message = `event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`;

        this.clients.forEach(client => {
            try {
                client.write(message);
            } catch (e) {
                // Client disconnected, will be cleaned up on 'close' event
            }
        });
    }

    /**
     * Stop the dashboard server
     */
    async stop() {
        // Close all SSE connections
        this.clients.forEach(client => {
            try {
                client.end();
            } catch (e) { /* ignore */ }
        });
        this.clients.clear();

        // Close HTTP server
        if (this.server) {
            return new Promise((resolve) => {
                this.server.close(() => {
                    console.log('[DASHBOARD] Server stopped');
                    resolve();
                });
            });
        }
    }
}

module.exports = DashboardServer;
