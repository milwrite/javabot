// services/agentLogging.js
// Unified Agent Logging service - PostgreSQL persistence with real-time NOTIFY streaming
// Replaces: postgres.js, gui-server.js in-memory storage, log-preserv.js session tracking

const { Pool } = require('pg');
const crypto = require('crypto');
const os = require('os');

// Connection pool (lazy init)
let pool = null;
let notifyClient = null;
let sessionId = null;
let isEnabled = false;

const DEFAULTS = {
    MAX_POOL_SIZE: 5,
    IDLE_TIMEOUT: 30000,
    CONNECTION_TIMEOUT: 10000
};

// ============ INITIALIZATION ============

/**
 * Initialize database connection pool and start session
 * @returns {Promise<boolean>} True if connected
 */
async function init() {
    if (!process.env.DATABASE_URL) {
        console.log('[AGENT-LOG] DATABASE_URL not set, logging disabled');
        return false;
    }

    try {
        pool = new Pool({
            connectionString: process.env.DATABASE_URL,
            max: DEFAULTS.MAX_POOL_SIZE,
            idleTimeoutMillis: DEFAULTS.IDLE_TIMEOUT,
            connectionTimeoutMillis: DEFAULTS.CONNECTION_TIMEOUT,
            ssl: { rejectUnauthorized: false }
        });

        // Test connection
        const client = await pool.connect();
        await client.query('SELECT 1');
        client.release();

        isEnabled = true;

        // Start a new session
        await startSession();

        console.log(`[AGENT-LOG] Connected, session: ${sessionId.slice(0, 8)}...`);
        return true;
    } catch (error) {
        console.error('[AGENT-LOG] Connection failed:', error.message);
        isEnabled = false;
        return false;
    }
}

/**
 * Start a new bot session (inserts row into bot_sessions)
 */
async function startSession() {
    if (!isEnabled) return;
    try {
        let version = '1.0.0';
        try {
            version = require('../package.json').version || '1.0.0';
        } catch (e) { /* ignore */ }

        const res = await pool.query(
            `INSERT INTO bot_sessions (hostname, version) VALUES ($1, $2) RETURNING id`,
            [os.hostname(), version]
        );
        sessionId = res.rows[0].id;
    } catch (error) {
        // Fallback to UUID if session table doesn't exist
        console.error('[AGENT-LOG] startSession error:', error.message);
        sessionId = crypto.randomUUID();
    }
}

/**
 * End the current session (updates bot_sessions row)
 * @param {number} exitCode - Process exit code
 * @param {string} exitReason - 'normal', 'crash', 'sigterm', 'sigint'
 */
async function endSession(exitCode = 0, exitReason = 'normal') {
    if (!isEnabled || !sessionId) return;
    try {
        await pool.query(
            `UPDATE bot_sessions SET
                ended_at = NOW(),
                exit_code = $1,
                exit_reason = $2,
                event_count = (SELECT COUNT(*) FROM bot_events WHERE session_id = $3),
                error_count = (SELECT COUNT(*) FROM bot_events WHERE session_id = $3 AND event_type = 'error')
             WHERE id = $3`,
            [exitCode, exitReason, sessionId]
        );
        console.log(`[AGENT-LOG] Session ended: ${exitReason} (code ${exitCode})`);
    } catch (error) {
        console.error('[AGENT-LOG] endSession error:', error.message);
    }
}

/**
 * Get current session ID
 * @returns {string|null}
 */
function getSessionId() {
    return sessionId;
}

/**
 * Check if Serena logging is enabled
 * @returns {boolean}
 */
function enabled() {
    return isEnabled;
}

// ============ LISTEN/NOTIFY FOR REAL-TIME STREAMING ============

/**
 * Setup LISTEN client for real-time event streaming
 * @param {Function} callback - Called with parsed event data on each notification
 * @returns {Promise<Object>} The client connection (keep reference to prevent GC)
 */
async function setupNotifyListener(callback) {
    if (!isEnabled) {
        console.warn('[AGENT-LOG] Cannot setup NOTIFY listener - not connected');
        return null;
    }

    try {
        notifyClient = await pool.connect();
        await notifyClient.query('LISTEN serena_logs');

        notifyClient.on('notification', (msg) => {
            try {
                const payload = JSON.parse(msg.payload);
                callback(payload);
            } catch (e) {
                console.error('[AGENT-LOG] NOTIFY parse error:', e.message);
            }
        });

        notifyClient.on('error', (err) => {
            console.error('[AGENT-LOG] NOTIFY client error:', err.message);
            // Attempt reconnect after delay
            setTimeout(() => {
                setupNotifyListener(callback).catch(console.error);
            }, 5000);
        });

        console.log('[AGENT-LOG] NOTIFY listener active on channel: serena_logs');
        return notifyClient;
    } catch (error) {
        console.error('[AGENT-LOG] setupNotifyListener error:', error.message);
        return null;
    }
}

// ============ STRUCTURED LOGGING (replaces console.log) ============

const log = {
    /**
     * Log info level message
     * @param {string} category - STARTUP, CONTEXT, COMMIT, ROUTER, TOOL, MENTION, CLEANUP, API_HEALTH
     * @param {string} message - Log message
     * @param {Object} data - Additional data
     */
    info: (category, message, data = {}) => {
        console.log(`[${category}] ${message}`, data && Object.keys(data).length ? data : '');
        logOperationalEvent({ category, message, details: data });
    },

    /**
     * Log warning level message
     */
    warn: (category, message, data = {}) => {
        console.warn(`[${category}] ⚠️ ${message}`, data && Object.keys(data).length ? data : '');
        logOperationalEvent({ category, message: `[WARN] ${message}`, details: data });
    },

    /**
     * Log error level message
     */
    error: (category, message, data = {}) => {
        console.error(`[${category}] ❌ ${message}`, data && Object.keys(data).length ? data : '');
        logError({ category, message, ...data });
    },

    /**
     * Log debug level message (console only, no DB)
     */
    debug: (category, message, data = {}) => {
        if (process.env.NODE_ENV === 'development') {
            console.log(`[${category}:DEBUG] ${message}`, data && Object.keys(data).length ? data : '');
        }
    }
};

// ============ EVENT LOGGING FUNCTIONS (fire-and-forget) ============

/**
 * Log a mention event
 * @param {Object} data - {userId, username, channelId, content, metadata}
 */
async function logMention(data) {
    if (!isEnabled) return;
    try {
        await pool.query(
            `INSERT INTO bot_events (event_type, session_id, user_id, username, channel_id, payload)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            ['mention', sessionId, data.userId, data.username, data.channelId,
             JSON.stringify({ content: data.content, ...data.metadata })]
        );
    } catch (error) {
        console.error('[AGENT-LOG] logMention error:', error.message);
    }
}

/**
 * Log a tool call event
 * @param {Object} data - {toolName, args, result, error, durationMs, iteration, channelId, userId}
 */
async function logToolCall(data) {
    if (!isEnabled) return;
    try {
        // Sanitize tool name (remove any XML tags that may leak through)
        const sanitizedToolName = data.toolName?.replace(/<[^>]*>/g, '').trim() || 'unknown';

        await pool.query(
            `INSERT INTO tool_calls (tool_name, arguments, result, error, duration_ms, iteration, user_id, channel_id, session_id)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
            [sanitizedToolName, JSON.stringify(data.args),
             truncate(data.result, 5000), data.error, data.durationMs, data.iteration,
             data.userId, data.channelId, sessionId]
        );
    } catch (error) {
        console.error('[AGENT-LOG] logToolCall error:', error.message);
    }
}

/**
 * Log a file change event
 * @param {Object} data - {action, path, contentPreview, channelId}
 */
async function logFileChange(data) {
    if (!isEnabled) return;
    try {
        await pool.query(
            `INSERT INTO bot_events (event_type, session_id, channel_id, payload)
             VALUES ($1, $2, $3, $4)`,
            ['file_change', sessionId, data.channelId,
             JSON.stringify({ action: data.action, path: data.path, preview: truncate(data.contentPreview, 500) })]
        );
    } catch (error) {
        console.error('[AGENT-LOG] logFileChange error:', error.message);
    }
}

/**
 * Log an agent loop event
 * @param {Object} data - {command, toolsUsed, finalResult, status, durationMs, userId, channelId}
 */
async function logAgentLoop(data) {
    if (!isEnabled) return;
    try {
        await pool.query(
            `INSERT INTO bot_events (event_type, session_id, user_id, channel_id, duration_ms, success, payload)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            ['agent_loop', sessionId, data.userId, data.channelId, data.durationMs,
             data.status === 'completed',
             JSON.stringify({ command: data.command, tools: data.toolsUsed, result: truncate(data.finalResult, 1000) })]
        );
    } catch (error) {
        console.error('[AGENT-LOG] logAgentLoop error:', error.message);
    }
}

/**
 * Log an error event
 * @param {Object} data - {errorType, category, message, stack, context}
 */
async function logError(data) {
    if (!isEnabled) return;
    try {
        await pool.query(
            `INSERT INTO bot_events (event_type, session_id, error_category, success, payload)
             VALUES ($1, $2, $3, $4, $5)`,
            ['error', sessionId, data.category || 'general', false,
             JSON.stringify({ type: data.errorType, message: data.message, stack: data.stack, context: data.context })]
        );
    } catch (error) {
        console.error('[AGENT-LOG] logError error:', error.message);
    }
}

/**
 * Log a build stage event
 * @param {Object} data - {buildId, stage, attempt, result, testScore, durationMs}
 */
async function logBuildStage(data) {
    if (!isEnabled) return;
    try {
        await pool.query(
            `INSERT INTO build_stages (build_id, stage, attempt, result, test_score, duration_ms)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [data.buildId, data.stage, data.attempt || 1,
             JSON.stringify(data.result), data.testScore, data.durationMs]
        );
    } catch (error) {
        console.error('[AGENT-LOG] logBuildStage error:', error.message);
    }
}

/**
 * Log an operational event (LLM, ROUTER, API_HEALTH, etc.)
 * @param {Object} data - {category, message, details, channelId, userId}
 */
async function logOperationalEvent(data) {
    if (!isEnabled) return;
    try {
        await pool.query(
            `INSERT INTO bot_events (event_type, session_id, user_id, channel_id, payload)
             VALUES ($1, $2, $3, $4, $5)`,
            ['operational', sessionId, data.userId || null, data.channelId || null,
             JSON.stringify({ category: data.category, message: data.message, details: data.details })]
        );
    } catch (error) {
        // Silent fail for operational events to avoid log spam
    }
}

/**
 * Log prompt module usage for analytics
 * @param {Object} data - {role, modules, tokenEstimate, channelId}
 */
async function logPromptUsage(data) {
    if (!isEnabled) return;
    try {
        await pool.query(
            `INSERT INTO bot_events (event_type, session_id, channel_id, payload)
             VALUES ($1, $2, $3, $4)`,
            ['prompt_usage', sessionId, data.channelId || null,
             JSON.stringify({ role: data.role, modules: data.modules, tokens: data.tokenEstimate })]
        );
    } catch (error) {
        console.error('[AGENT-LOG] logPromptUsage error:', error.message);
    }
}

// ============ QUERY FUNCTIONS (for /logs command and dashboard) ============

/**
 * Get recent events
 * @param {string} eventType - Event type or 'all'
 * @param {number} limit - Max results
 * @returns {Promise<Array>}
 */
async function getRecentEvents(eventType = 'all', limit = 10) {
    if (!isEnabled) return [];
    try {
        // tool_call events are in tool_calls table
        if (eventType === 'tool_call') {
            const res = await pool.query(
                `SELECT id, tool_name, arguments as payload, result, error, duration_ms,
                        iteration, user_id, channel_id, session_id, timestamp,
                        'tool_call' as event_type
                 FROM tool_calls ORDER BY timestamp DESC LIMIT $1`,
                [limit]
            );
            return res.rows;
        }

        // For 'all', union bot_events with tool_calls
        if (eventType === 'all') {
            const res = await pool.query(
                `(SELECT id, event_type, session_id, user_id, channel_id, duration_ms, success, payload, timestamp
                  FROM bot_events WHERE event_type != 'tool_call'
                  ORDER BY timestamp DESC LIMIT $1)
                 UNION ALL
                 (SELECT id, 'tool_call' as event_type, session_id, user_id, channel_id, duration_ms,
                         error IS NULL as success, arguments as payload, timestamp
                  FROM tool_calls ORDER BY timestamp DESC LIMIT $1)
                 ORDER BY timestamp DESC LIMIT $1`,
                [limit]
            );
            return res.rows;
        }

        // Other event types from bot_events
        const res = await pool.query(
            `SELECT * FROM bot_events WHERE event_type = $1 ORDER BY timestamp DESC LIMIT $2`,
            [eventType, limit]
        );
        return res.rows;
    } catch (error) {
        console.error('[AGENT-LOG] getRecentEvents error:', error.message);
        return [];
    }
}

/**
 * Get error statistics for time period
 * @param {string} period - '1h', '24h', '7d'
 * @returns {Promise<Object>}
 */
async function getErrorStats(period = '24h') {
    if (!isEnabled) return { total: 0, byCategory: {} };

    const intervals = { '1h': '1 hour', '24h': '24 hours', '7d': '7 days' };
    const interval = intervals[period] || '24 hours';

    try {
        const res = await pool.query(`
            SELECT
                COUNT(*) as total,
                error_category,
                COUNT(*) FILTER (WHERE error_category = 'critical') as critical,
                COUNT(*) FILTER (WHERE error_category = 'auth') as auth,
                COUNT(*) FILTER (WHERE error_category = 'network') as network,
                COUNT(*) FILTER (WHERE error_category = 'git') as git,
                COUNT(*) FILTER (WHERE error_category = 'discord') as discord
            FROM bot_events
            WHERE event_type = 'error'
              AND timestamp > NOW() - INTERVAL '${interval}'
            GROUP BY error_category
        `);

        const stats = { total: 0, critical: 0, auth: 0, network: 0, git: 0, discord: 0, general: 0 };
        res.rows.forEach(row => {
            stats.total += parseInt(row.total);
            if (row.error_category && stats[row.error_category] !== undefined) {
                stats[row.error_category] = parseInt(row.total);
            } else {
                stats.general += parseInt(row.total);
            }
        });

        return stats;
    } catch (error) {
        console.error('[AGENT-LOG] getErrorStats error:', error.message);
        return { total: 0, critical: 0, auth: 0, network: 0, git: 0, discord: 0, general: 0 };
    }
}

/**
 * Get daily activity statistics
 * @param {number} days - Number of days
 * @returns {Promise<Object>}
 */
async function getDailyStats(days = 7) {
    if (!isEnabled) return { total: 0, mentions: 0, toolCalls: 0, errors: 0, uniqueUsers: 0 };

    try {
        const res = await pool.query(`
            SELECT
                COUNT(*) as total,
                COUNT(*) FILTER (WHERE event_type = 'mention') as mentions,
                COUNT(*) FILTER (WHERE event_type = 'tool_call') as tool_calls,
                COUNT(*) FILTER (WHERE event_type = 'error') as errors,
                COUNT(*) FILTER (WHERE event_type = 'file_change') as file_changes,
                COUNT(*) FILTER (WHERE event_type = 'agent_loop') as agent_loops,
                COUNT(DISTINCT user_id) FILTER (WHERE user_id IS NOT NULL) as unique_users
            FROM bot_events
            WHERE timestamp > NOW() - INTERVAL '${days} days'
        `);

        const row = res.rows[0] || {};
        return {
            total: parseInt(row.total) || 0,
            mentions: parseInt(row.mentions) || 0,
            toolCalls: parseInt(row.tool_calls) || 0,
            errors: parseInt(row.errors) || 0,
            fileChanges: parseInt(row.file_changes) || 0,
            agentLoops: parseInt(row.agent_loops) || 0,
            uniqueUsers: parseInt(row.unique_users) || 0
        };
    } catch (error) {
        console.error('[AGENT-LOG] getDailyStats error:', error.message);
        return { total: 0, mentions: 0, toolCalls: 0, errors: 0, uniqueUsers: 0 };
    }
}

/**
 * Search events by text in payload
 * @param {string} query - Search query
 * @param {number} limit - Max results
 * @returns {Promise<Array>}
 */
async function searchEvents(query, limit = 20) {
    if (!isEnabled) return [];
    try {
        const res = await pool.query(`
            SELECT * FROM bot_events
            WHERE payload::text ILIKE $1
            ORDER BY timestamp DESC
            LIMIT $2
        `, [`%${query}%`, limit]);
        return res.rows;
    } catch (error) {
        console.error('[AGENT-LOG] searchEvents error:', error.message);
        return [];
    }
}

/**
 * Get tool call statistics
 * @param {number} days - Number of days
 * @returns {Promise<Array>}
 */
async function getToolStats(days = 7) {
    if (!isEnabled) return [];
    try {
        const res = await pool.query(`
            SELECT
                tool_name,
                COUNT(*) as call_count,
                COUNT(*) FILTER (WHERE error IS NULL) as success_count,
                AVG(duration_ms) as avg_duration
            FROM tool_calls
            WHERE timestamp > NOW() - INTERVAL '${days} days'
            GROUP BY tool_name
            ORDER BY call_count DESC
        `);
        return res.rows;
    } catch (error) {
        console.error('[AGENT-LOG] getToolStats error:', error.message);
        return [];
    }
}

/**
 * Get session history
 * @param {number} limit - Max results
 * @returns {Promise<Array>}
 */
async function getSessionHistory(limit = 20) {
    if (!isEnabled) return [];
    try {
        const res = await pool.query(
            `SELECT * FROM bot_sessions ORDER BY started_at DESC LIMIT $1`,
            [limit]
        );
        return res.rows;
    } catch (error) {
        console.error('[AGENT-LOG] getSessionHistory error:', error.message);
        return [];
    }
}

/**
 * Get events for a specific session
 * @param {string} targetSessionId - Session UUID
 * @param {number} limit - Max results
 * @returns {Promise<Array>}
 */
async function getSessionEvents(targetSessionId, limit = 100) {
    if (!isEnabled) return [];
    try {
        const res = await pool.query(
            `SELECT * FROM bot_events WHERE session_id = $1 ORDER BY timestamp DESC LIMIT $2`,
            [targetSessionId, limit]
        );
        return res.rows;
    } catch (error) {
        console.error('[AGENT-LOG] getSessionEvents error:', error.message);
        return [];
    }
}

/**
 * Get a single event by ID (for fetching full data after NOTIFY)
 * @param {string} table - 'bot_events', 'tool_calls', or 'build_stages'
 * @param {number} id - Event ID
 * @returns {Promise<Object|null>}
 */
async function getEventById(table, id) {
    if (!isEnabled) return null;
    const validTables = ['bot_events', 'tool_calls', 'build_stages'];
    if (!validTables.includes(table)) return null;

    try {
        const res = await pool.query(`SELECT * FROM ${table} WHERE id = $1`, [id]);
        return res.rows[0] || null;
    } catch (error) {
        console.error('[AGENT-LOG] getEventById error:', error.message);
        return null;
    }
}

// ============ CLEANUP ============

/**
 * Close database connection pool
 */
async function close() {
    if (notifyClient) {
        notifyClient.release();
        notifyClient = null;
    }
    if (pool) {
        await pool.end();
        console.log('[AGENT-LOG] Connection pool closed');
    }
}

// ============ HELPERS ============

function truncate(str, maxLen) {
    if (!str) return null;
    return str.length > maxLen ? str.slice(0, maxLen) + '...' : str;
}

module.exports = {
    // Initialization
    init,
    enabled,
    getSessionId,
    startSession,
    endSession,
    close,

    // Real-time streaming
    setupNotifyListener,
    getEventById,

    // Structured logging
    log,

    // Event logging functions
    logMention,
    logToolCall,
    logFileChange,
    logAgentLoop,
    logError,
    logBuildStage,
    logOperationalEvent,
    logPromptUsage,

    // Query functions
    getRecentEvents,
    getErrorStats,
    getDailyStats,
    searchEvents,
    getToolStats,
    getSessionHistory,
    getSessionEvents
};
