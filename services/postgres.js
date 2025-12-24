// services/postgres.js
// PostgreSQL logging service for persistent event storage and analytics

const { Pool } = require('pg');
const crypto = require('crypto');

// Connection pool (lazy init)
let pool = null;
let sessionId = null;
let isEnabled = false;

const DEFAULTS = {
    MAX_POOL_SIZE: 5,
    IDLE_TIMEOUT: 30000,
    CONNECTION_TIMEOUT: 10000
};

/**
 * Initialize database connection pool
 * @returns {Promise<boolean>} True if connected
 */
async function init() {
    if (!process.env.DATABASE_URL) {
        console.log('[POSTGRES] DATABASE_URL not set, logging disabled');
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

        sessionId = crypto.randomUUID();
        isEnabled = true;
        console.log(`[POSTGRES] Connected, session: ${sessionId.slice(0, 8)}...`);
        return true;
    } catch (error) {
        console.error('[POSTGRES] Connection failed:', error.message);
        isEnabled = false;
        return false;
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
 * Check if postgres logging is enabled
 * @returns {boolean}
 */
function enabled() {
    return isEnabled;
}

// ============ LOGGING FUNCTIONS (fire-and-forget) ============

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
        console.error('[POSTGRES] logMention error:', error.message);
    }
}

/**
 * Log a tool call event
 * @param {Object} data - {toolName, args, result, error, durationMs, iteration, channelId, userId}
 */
async function logToolCall(data) {
    if (!isEnabled) return;
    try {
        // Insert event
        const eventRes = await pool.query(
            `INSERT INTO bot_events (event_type, session_id, user_id, channel_id, duration_ms, success, payload)
             VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
            ['tool_call', sessionId, data.userId, data.channelId, data.durationMs,
             !data.error, JSON.stringify({ tool: data.toolName, args: data.args })]
        );

        // Insert tool call detail
        await pool.query(
            `INSERT INTO tool_calls (event_id, tool_name, arguments, result, error, duration_ms, iteration)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [eventRes.rows[0].id, data.toolName, JSON.stringify(data.args),
             truncate(data.result, 5000), data.error, data.durationMs, data.iteration]
        );
    } catch (error) {
        console.error('[POSTGRES] logToolCall error:', error.message);
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
        console.error('[POSTGRES] logFileChange error:', error.message);
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
        console.error('[POSTGRES] logAgentLoop error:', error.message);
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
        console.error('[POSTGRES] logError error:', error.message);
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
        console.error('[POSTGRES] logBuildStage error:', error.message);
    }
}

// ============ QUERY FUNCTIONS (for /logs command) ============

/**
 * Get recent events
 * @param {string} eventType - Event type or 'all'
 * @param {number} limit - Max results
 * @returns {Promise<Array>}
 */
async function getRecentEvents(eventType = 'all', limit = 10) {
    if (!isEnabled) return [];
    try {
        const query = eventType === 'all'
            ? `SELECT * FROM bot_events ORDER BY timestamp DESC LIMIT $1`
            : `SELECT * FROM bot_events WHERE event_type = $1 ORDER BY timestamp DESC LIMIT $2`;

        const params = eventType === 'all' ? [limit] : [eventType, limit];
        const res = await pool.query(query, params);
        return res.rows;
    } catch (error) {
        console.error('[POSTGRES] getRecentEvents error:', error.message);
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
        console.error('[POSTGRES] getErrorStats error:', error.message);
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
        console.error('[POSTGRES] getDailyStats error:', error.message);
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
        console.error('[POSTGRES] searchEvents error:', error.message);
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
        console.error('[POSTGRES] getToolStats error:', error.message);
        return [];
    }
}

/**
 * Close database connection pool
 */
async function close() {
    if (pool) {
        await pool.end();
        console.log('[POSTGRES] Connection pool closed');
    }
}

// ============ HELPERS ============

function truncate(str, maxLen) {
    if (!str) return null;
    return str.length > maxLen ? str.slice(0, maxLen) + '...' : str;
}

module.exports = {
    init,
    enabled,
    getSessionId,
    logMention,
    logToolCall,
    logFileChange,
    logAgentLoop,
    logError,
    logBuildStage,
    getRecentEvents,
    getErrorStats,
    getDailyStats,
    searchEvents,
    getToolStats,
    close,
    DEFAULTS
};
