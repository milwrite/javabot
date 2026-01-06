/**
 * Error Pattern Detection
 * Analyzes events to detect recurring error patterns
 */

import type { SportelloEvent, ErrorPattern, FindingSeverity } from '../types/index.js';

/**
 * Normalize an error message to create a pattern signature
 * Replaces specific values with placeholders for grouping
 */
export function normalizeErrorMessage(message: string): string {
    return message
        // Replace numbers with N
        .replace(/\d+/g, 'N')
        // Replace UUIDs
        .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, 'UUID')
        // Replace timestamps
        .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/g, 'TIMESTAMP')
        // Replace file paths with generic
        .replace(/\/[\w\-./]+\.(js|ts|html|css|json)/g, '/PATH.$1')
        // Normalize whitespace
        .replace(/\s+/g, ' ')
        .trim()
        .substring(0, 200);
}

/**
 * Detect error patterns in a batch of events
 */
export function detectErrorPatterns(events: SportelloEvent[]): ErrorPattern[] {
    const errors = events.filter(e =>
        e.event_type === 'error' ||
        (e.payload && typeof e.payload === 'object' && 'error' in e.payload)
    );

    if (errors.length === 0) {
        return [];
    }

    // Group by normalized message signature
    const patterns = new Map<string, SportelloEvent[]>();

    for (const err of errors) {
        const message = extractErrorMessage(err);
        const signature = normalizeErrorMessage(message);

        const existing = patterns.get(signature);
        if (existing) {
            existing.push(err);
        } else {
            patterns.set(signature, [err]);
        }
    }

    // Convert to ErrorPattern objects
    const results: ErrorPattern[] = [];

    for (const [signature, matchingEvents] of patterns) {
        const sorted = matchingEvents.sort((a, b) =>
            new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
        );

        const firstEvent = sorted[0];
        const lastEvent = sorted[sorted.length - 1];

        if (firstEvent && lastEvent) {
            results.push({
                signature,
                count: matchingEvents.length,
                first_occurrence: firstEvent.timestamp,
                last_occurrence: lastEvent.timestamp,
                sample_event: firstEvent,
                category: firstEvent.error_category ?? undefined
            });
        }
    }

    // Sort by count descending
    return results.sort((a, b) => b.count - a.count);
}

/**
 * Extract error message from an event
 */
function extractErrorMessage(event: SportelloEvent): string {
    if (event.payload && typeof event.payload === 'object') {
        const payload = event.payload as Record<string, unknown>;
        if (typeof payload.message === 'string') {
            return payload.message;
        }
        if (typeof payload.error === 'string') {
            return payload.error;
        }
        if (payload.error && typeof payload.error === 'object') {
            const err = payload.error as Record<string, unknown>;
            if (typeof err.message === 'string') {
                return err.message;
            }
        }
    }
    return 'Unknown error';
}

/**
 * Determine severity based on error characteristics
 */
export function assessErrorSeverity(pattern: ErrorPattern): FindingSeverity {
    const { count, signature, category } = pattern;

    // Catastrophic: critical errors happening frequently
    if (category === 'critical' && count >= 5) {
        return 'catastrophic';
    }

    // Critical: auth/network errors or high frequency
    if (category === 'auth' || category === 'network') {
        return count >= 3 ? 'critical' : 'warning';
    }

    // Check for specific dangerous patterns
    const dangerousPatterns = [
        'ECONNREFUSED',
        'ETIMEDOUT',
        'rate limit',
        'quota exceeded',
        'authentication failed',
        'permission denied',
        'out of memory',
        'heap'
    ];

    const signatureLower = signature.toLowerCase();
    for (const dangerous of dangerousPatterns) {
        if (signatureLower.includes(dangerous)) {
            return count >= 3 ? 'critical' : 'warning';
        }
    }

    // Default severity based on count
    if (count >= 10) return 'critical';
    if (count >= 5) return 'warning';
    return 'info';
}

/**
 * Calculate error rate from events
 */
export function calculateErrorRate(events: SportelloEvent[]): number {
    if (events.length === 0) return 0;

    const errors = events.filter(e =>
        e.event_type === 'error' || e.success === false
    );

    return (errors.length / events.length) * 100;
}

/**
 * Detect error spikes (sudden increase in error rate)
 */
export function detectErrorSpike(
    recentEvents: SportelloEvent[],
    baselineRate: number,
    threshold: number = 2.0
): { isSpike: boolean; currentRate: number; multiplier: number } {
    const currentRate = calculateErrorRate(recentEvents);
    const multiplier = baselineRate > 0 ? currentRate / baselineRate : currentRate;

    return {
        isSpike: multiplier >= threshold,
        currentRate,
        multiplier
    };
}
