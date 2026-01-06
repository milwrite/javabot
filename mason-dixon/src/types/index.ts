/**
 * Mason & Dixon Type Definitions
 * Types for diagnostic findings, calibrations, and event processing
 */

// ============ EVENT TYPES ============

export interface SportelloEvent {
    id: number;
    event_type: 'mention' | 'error' | 'operational' | 'file_change' | 'agent_loop' | 'prompt_usage';
    timestamp: string;
    session_id: string | null;
    user_id: string | null;
    username: string | null;
    channel_id: string | null;
    payload: Record<string, unknown>;
    duration_ms: number | null;
    success: boolean | null;
    error_category: 'critical' | 'auth' | 'network' | 'git' | 'discord' | null;
}

export interface ToolCallEvent {
    id: number;
    tool_name: string;
    arguments: Record<string, unknown>;
    result: string | null;
    error: string | null;
    duration_ms: number | null;
    iteration: number | null;
    user_id: string | null;
    channel_id: string | null;
    session_id: string | null;
    timestamp: string;
}

export interface NotifyPayload {
    table: 'bot_events' | 'tool_calls' | 'build_stages';
    id: number;
    type: string;
    timestamp: string;
}

// ============ FINDING TYPES ============

export type FindingCategory =
    | 'error_pattern'
    | 'tool_failure'
    | 'performance_anomaly'
    | 'rate_limit'
    | 'timeout'
    | 'api_degradation'
    | 'memory_concern'
    | 'loop_detected'
    | 'success_pattern';

export type FindingSeverity = 'info' | 'warning' | 'critical' | 'catastrophic';

export interface Finding {
    id: string;
    session_id: string;
    created_at: Date;
    category: FindingCategory;
    severity: FindingSeverity;
    title: string;
    mason_analysis: string | null;
    dixon_analysis: string | null;
    combined_verdict: string | null;
    evidence_event_ids: number[];
    evidence_summary: string | null;
    pattern_signature: string | null;
    occurrence_count: number;
    first_seen: Date | null;
    last_seen: Date | null;
    related_tool: string | null;
    related_file: string | null;
    user_context: string | null;
}

export interface CreateFindingInput {
    category: FindingCategory;
    severity: FindingSeverity;
    title: string;
    mason_analysis?: string;
    dixon_analysis?: string;
    combined_verdict?: string;
    evidence_event_ids?: number[];
    evidence_summary?: string;
    pattern_signature?: string;
    related_tool?: string;
    related_file?: string;
    user_context?: string;
}

// ============ CALIBRATION TYPES ============

export type InstrumentType =
    | 'error_tracker'
    | 'rate_limiter'
    | 'timeout_config'
    | 'retry_logic'
    | 'cache_ttl'
    | 'tool_parameters'
    | 'prompt_length'
    | 'model_selection'
    | 'memory_management';

export type CalibrationStatus = 'proposed' | 'communicated' | 'acknowledged' | 'implemented' | 'rejected';
export type CalibrationPriority = 'low' | 'medium' | 'high' | 'urgent';

export interface Calibration {
    id: string;
    session_id: string;
    finding_id: string | null;
    created_at: Date;
    instrument: InstrumentType;
    current_value: string | null;
    recommended_value: string | null;
    mason_rationale: string | null;
    dixon_rationale: string | null;
    status: CalibrationStatus;
    communicated_at: Date | null;
    response_from_sportello: string | null;
    confidence: number | null;
    priority: CalibrationPriority;
}

export interface CreateCalibrationInput {
    instrument: InstrumentType;
    current_value?: string;
    recommended_value?: string;
    mason_rationale?: string;
    dixon_rationale?: string;
    confidence?: number;
    priority?: CalibrationPriority;
    finding_id?: string;
}

// ============ READING TYPES ============

export type InstrumentReadingType =
    | 'api_latency'
    | 'tool_duration'
    | 'error_rate'
    | 'success_rate'
    | 'cache_hit_rate'
    | 'iteration_count'
    | 'token_usage'
    | 'memory_pressure';

export interface InstrumentReading {
    id: number;
    session_id: string;
    recorded_at: Date;
    instrument: InstrumentReadingType;
    tool_name: string | null;
    value_numeric: number | null;
    value_text: string | null;
    unit: string | null;
    event_id: number | null;
    metadata: Record<string, unknown> | null;
}

export interface CreateReadingInput {
    instrument: InstrumentReadingType;
    tool_name?: string;
    value_numeric?: number;
    value_text?: string;
    unit?: string;
    event_id?: number;
    metadata?: Record<string, unknown>;
}

// ============ SESSION TYPES ============

export type SessionStatus = 'active' | 'completed' | 'interrupted';

export interface Session {
    id: string;
    started_at: Date;
    ended_at: Date | null;
    sportello_session_id: string | null;
    status: SessionStatus;
    total_events_observed: number;
    total_findings_generated: number;
    mason_observations: string | null;
    dixon_observations: string | null;
}

// ============ DISCOURSE TYPES ============

export type Speaker = 'mason' | 'dixon' | 'joint' | 'sportello';
export type DiscourseIntent = 'observation' | 'inquiry' | 'calibration_proposal' | 'acknowledgment' | 'dispute' | 'consensus';

export interface DiscourseEntry {
    id: number;
    session_id: string;
    created_at: Date;
    speaker: Speaker;
    channel_id: string | null;
    message_id: string | null;
    content: string;
    intent: DiscourseIntent;
    finding_id: string | null;
    calibration_id: string | null;
}

// ============ ANALYSIS TYPES ============

export interface ErrorPattern {
    signature: string;
    count: number;
    first_occurrence: string;
    last_occurrence: string;
    sample_event: SportelloEvent;
    category?: string;
}

export interface ToolMetrics {
    tool: string;
    call_count: number;
    error_count: number;
    success_rate: string;
    avg_duration_ms: number | null;
    max_duration_ms: number | null;
    p95_duration_ms: number | null;
}

export interface Anomaly {
    type: 'error_spike' | 'timeout_pattern' | 'rate_limit_hit' | 'memory_leak' | 'loop_detected';
    severity: FindingSeverity;
    description: string;
    recommendation?: string;
    affected_tools?: string[];
}

// ============ CONFIGURATION ============

export interface MasonDixonConfig {
    discord: {
        token: string;
        clientId: string;
        sportelloChannelId: string;
        diagnosticsChannelId: string;
    };
    mysql: {
        url: string;
    };
    postgres: {
        url: string;
    };
    openrouter: {
        apiKey: string;
        model: string;
    };
    analysis: {
        intervalMs: number;
        maxEventBuffer: number;
    };
    logLevel: 'debug' | 'info' | 'warn' | 'error';
}
