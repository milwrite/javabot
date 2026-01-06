/**
 * Anomaly Detection
 * Detects statistical anomalies in event patterns
 */

import type { SportelloEvent, ToolCallEvent, Anomaly, FindingSeverity } from '../types/index.js';

/**
 * Detect anomalies in event stream
 */
export function detectAnomalies(
    events: SportelloEvent[],
    toolCalls: ToolCallEvent[],
    options: {
        errorSpikeThreshold?: number;
        timeoutThreshold?: number;
        loopDetectionWindow?: number;
    } = {}
): Anomaly[] {
    const {
        errorSpikeThreshold = 10,
        timeoutThreshold = 30000,
        loopDetectionWindow = 5
    } = options;

    const anomalies: Anomaly[] = [];

    // 1. Error spike detection
    const recentErrors = events.filter(e =>
        e.event_type === 'error' &&
        isWithinLastHour(e.timestamp)
    );

    if (recentErrors.length >= errorSpikeThreshold) {
        anomalies.push({
            type: 'error_spike',
            severity: recentErrors.length >= 50 ? 'critical' : 'warning',
            description: `${recentErrors.length} Errors recorded in the past Hour`,
            recommendation: 'Investigate error patterns immediately'
        });
    }

    // 2. Timeout pattern detection
    const slowCalls = toolCalls.filter(c =>
        c.duration_ms != null &&
        c.duration_ms > timeoutThreshold &&
        isWithinLastHour(c.timestamp)
    );

    if (slowCalls.length >= 3) {
        const affectedTools = [...new Set(slowCalls.map(c => c.tool_name))];
        anomalies.push({
            type: 'timeout_pattern',
            severity: 'warning',
            description: `${slowCalls.length} operations exceeded ${timeoutThreshold}ms threshold`,
            affected_tools: affectedTools
        });
    }

    // 3. Rate limit detection
    const rateLimitErrors = events.filter(e => {
        const payload = e.payload as Record<string, unknown> | undefined;
        const message = String(payload?.message ?? '').toLowerCase();
        return message.includes('rate limit') || message.includes('429');
    });

    if (rateLimitErrors.length > 0) {
        anomalies.push({
            type: 'rate_limit_hit',
            severity: rateLimitErrors.length >= 5 ? 'critical' : 'warning',
            description: `Rate limiting detected: ${rateLimitErrors.length} occurrences`,
            recommendation: 'Consider implementing request throttling'
        });
    }

    // 4. Loop detection (same tool called repeatedly)
    const loopPattern = detectToolLoop(toolCalls, loopDetectionWindow);
    if (loopPattern) {
        anomalies.push({
            type: 'loop_detected',
            severity: 'warning',
            description: `Potential infinite loop: ${loopPattern.tool} called ${loopPattern.count} times in rapid succession`,
            affected_tools: [loopPattern.tool],
            recommendation: 'Check for recursive or stuck agent behavior'
        });
    }

    // 5. Memory concerns (based on event patterns)
    const memoryEvents = events.filter(e => {
        const payload = e.payload as Record<string, unknown> | undefined;
        const message = String(payload?.message ?? '').toLowerCase();
        return message.includes('memory') ||
               message.includes('heap') ||
               message.includes('allocation');
    });

    if (memoryEvents.length > 0) {
        anomalies.push({
            type: 'memory_leak',
            severity: memoryEvents.length >= 3 ? 'critical' : 'warning',
            description: `Memory-related events detected: ${memoryEvents.length} occurrences`,
            recommendation: 'Monitor memory usage and consider restart if growing'
        });
    }

    return anomalies;
}

/**
 * Check if a timestamp is within the last hour
 */
function isWithinLastHour(timestamp: string): boolean {
    const now = Date.now();
    const eventTime = new Date(timestamp).getTime();
    return (now - eventTime) < 3600000; // 1 hour in ms
}

/**
 * Detect if a tool is being called in a loop
 */
function detectToolLoop(
    toolCalls: ToolCallEvent[],
    windowSize: number
): { tool: string; count: number } | null {
    if (toolCalls.length < windowSize) return null;

    // Sort by timestamp descending
    const sorted = [...toolCalls].sort((a, b) =>
        new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );

    // Check recent calls for repetition
    const recent = sorted.slice(0, windowSize * 2);

    // Count occurrences of each tool in recent calls
    const counts = new Map<string, number>();
    for (const call of recent) {
        const current = counts.get(call.tool_name) ?? 0;
        counts.set(call.tool_name, current + 1);
    }

    // Find tools called more than windowSize times
    for (const [tool, count] of counts) {
        if (count >= windowSize) {
            // Check if they're in rapid succession
            const toolCalls2 = recent.filter(c => c.tool_name === tool);
            if (toolCalls2.length >= windowSize) {
                const first = toolCalls2[0];
                const last = toolCalls2[toolCalls2.length - 1];
                if (first && last) {
                    const timeSpan = new Date(first.timestamp).getTime() - new Date(last.timestamp).getTime();
                    // If 5+ calls within 30 seconds, it's suspicious
                    if (timeSpan < 30000) {
                        return { tool, count };
                    }
                }
            }
        }
    }

    return null;
}

/**
 * Calculate anomaly severity
 */
export function calculateAnomalySeverity(anomalies: Anomaly[]): FindingSeverity {
    if (anomalies.some(a => a.severity === 'catastrophic')) return 'catastrophic';
    if (anomalies.some(a => a.severity === 'critical')) return 'critical';
    if (anomalies.some(a => a.severity === 'warning')) return 'warning';
    return 'info';
}

/**
 * Summarize anomalies in period-appropriate language
 */
export function summarizeAnomalies(anomalies: Anomaly[]): string {
    if (anomalies.length === 0) {
        return 'The Instruments report no significant Anomalies at this Hour.';
    }

    const descriptions: string[] = [];

    for (const anomaly of anomalies) {
        const severity = anomaly.severity === 'critical'
            ? 'most concerning'
            : anomaly.severity === 'warning'
            ? 'worthy of Attention'
            : 'of minor Import';

        descriptions.push(`${anomaly.description} (${severity})`);
    }

    return `The following Anomalies have been detected:\n- ${descriptions.join('\n- ')}`;
}
