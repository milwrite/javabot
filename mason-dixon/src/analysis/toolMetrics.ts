/**
 * Tool Performance Metrics
 * Analyzes tool call performance and success rates
 */

import type { ToolCallEvent, ToolMetrics, FindingSeverity } from '../types/index.js';

/**
 * Calculate metrics for tool calls
 */
export function calculateToolMetrics(toolCalls: ToolCallEvent[]): ToolMetrics[] {
    if (toolCalls.length === 0) {
        return [];
    }

    // Group by tool name
    const byTool = new Map<string, ToolCallEvent[]>();

    for (const call of toolCalls) {
        const name = call.tool_name || 'unknown';
        const existing = byTool.get(name);
        if (existing) {
            existing.push(call);
        } else {
            byTool.set(name, [call]);
        }
    }

    // Calculate metrics for each tool
    const metrics: ToolMetrics[] = [];

    for (const [toolName, calls] of byTool) {
        const durations = calls
            .filter(c => c.duration_ms != null)
            .map(c => c.duration_ms!);

        const errors = calls.filter(c => c.error != null).length;
        const successCount = calls.length - errors;

        metrics.push({
            tool: toolName,
            call_count: calls.length,
            error_count: errors,
            success_rate: `${((successCount / calls.length) * 100).toFixed(1)}%`,
            avg_duration_ms: durations.length > 0
                ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
                : null,
            max_duration_ms: durations.length > 0
                ? Math.max(...durations)
                : null,
            p95_duration_ms: durations.length > 0
                ? calculatePercentile(durations, 95)
                : null
        });
    }

    // Sort by call count descending
    return metrics.sort((a, b) => b.call_count - a.call_count);
}

/**
 * Calculate a percentile from an array of numbers
 */
function calculatePercentile(values: number[], percentile: number): number {
    const sorted = [...values].sort((a, b) => a - b);
    const index = Math.ceil((percentile / 100) * sorted.length) - 1;
    return sorted[Math.max(0, index)] ?? 0;
}

/**
 * Detect slow tools (above baseline duration)
 */
export function detectSlowTools(
    metrics: ToolMetrics[],
    baselineDurations: Record<string, number> = {}
): Array<{ tool: string; avgMs: number; baselineMs: number; slowdown: number }> {
    const slowTools: Array<{ tool: string; avgMs: number; baselineMs: number; slowdown: number }> = [];

    // Default baselines for common tools
    const defaults: Record<string, number> = {
        'read_file': 500,
        'write_file': 1000,
        'edit_file': 3000,
        'list_files': 300,
        'file_exists': 200,
        'search_files': 2000,
        'commit_changes': 5000,
        'web_search': 10000,
        ...baselineDurations
    };

    for (const m of metrics) {
        if (m.avg_duration_ms == null) continue;

        const baseline = defaults[m.tool] ?? 1000;
        const slowdown = m.avg_duration_ms / baseline;

        if (slowdown > 1.5) { // 50% slower than baseline
            slowTools.push({
                tool: m.tool,
                avgMs: m.avg_duration_ms,
                baselineMs: baseline,
                slowdown
            });
        }
    }

    return slowTools.sort((a, b) => b.slowdown - a.slowdown);
}

/**
 * Detect failing tools (high error rate)
 */
export function detectFailingTools(
    metrics: ToolMetrics[],
    errorThreshold: number = 0.1 // 10% error rate
): ToolMetrics[] {
    return metrics.filter(m => {
        const errorRate = m.error_count / m.call_count;
        return errorRate >= errorThreshold;
    });
}

/**
 * Assess severity of tool performance issues
 */
export function assessToolSeverity(
    failingTools: ToolMetrics[],
    slowTools: Array<{ tool: string; slowdown: number }>
): FindingSeverity {
    // Critical tools that should never fail
    const criticalTools = ['commit_changes', 'write_file', 'edit_file'];

    for (const failing of failingTools) {
        if (criticalTools.includes(failing.tool)) {
            const errorRate = failing.error_count / failing.call_count;
            if (errorRate > 0.5) return 'catastrophic';
            if (errorRate > 0.2) return 'critical';
        }
    }

    // Check for severe slowdowns
    for (const slow of slowTools) {
        if (slow.slowdown > 5) return 'critical';
        if (slow.slowdown > 3) return 'warning';
    }

    // Default based on counts
    if (failingTools.length > 3) return 'critical';
    if (failingTools.length > 0 || slowTools.length > 2) return 'warning';

    return 'info';
}

/**
 * Generate a summary of tool health
 */
export function summarizeToolHealth(
    metrics: ToolMetrics[]
): {
    totalCalls: number;
    totalErrors: number;
    overallSuccessRate: string;
    healthyTools: number;
    problematicTools: number;
} {
    let totalCalls = 0;
    let totalErrors = 0;
    let healthyTools = 0;
    let problematicTools = 0;

    for (const m of metrics) {
        totalCalls += m.call_count;
        totalErrors += m.error_count;

        const errorRate = m.error_count / m.call_count;
        if (errorRate < 0.05) {
            healthyTools++;
        } else {
            problematicTools++;
        }
    }

    const successRate = totalCalls > 0
        ? ((totalCalls - totalErrors) / totalCalls * 100).toFixed(1)
        : '100.0';

    return {
        totalCalls,
        totalErrors,
        overallSuccessRate: `${successRate}%`,
        healthyTools,
        problematicTools
    };
}
