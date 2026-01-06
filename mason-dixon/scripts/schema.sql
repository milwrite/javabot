-- Mason & Dixon Diagnostic Database Schema
-- MySQL 8.0+
-- Run: mysql -u root -p mason_dixon < schema.sql

-- ============ SESSIONS TABLE ============
-- Tracks M&D observation sessions, linked to Sportello sessions
CREATE TABLE IF NOT EXISTS sessions (
    id CHAR(36) PRIMARY KEY DEFAULT (UUID()),
    started_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ended_at TIMESTAMP NULL,
    sportello_session_id VARCHAR(100) NULL,
    status ENUM('active', 'completed', 'interrupted') DEFAULT 'active',
    total_events_observed INT DEFAULT 0,
    total_findings_generated INT DEFAULT 0,
    mason_observations TEXT NULL,
    dixon_observations TEXT NULL,
    INDEX idx_sessions_started (started_at DESC),
    INDEX idx_sessions_sportello (sportello_session_id),
    INDEX idx_sessions_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============ FINDINGS TABLE ============
-- Observable concrete findings with dual-voice analysis
CREATE TABLE IF NOT EXISTS findings (
    id CHAR(36) PRIMARY KEY DEFAULT (UUID()),
    session_id CHAR(36) NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    -- Classification
    category ENUM(
        'error_pattern',
        'tool_failure',
        'performance_anomaly',
        'rate_limit',
        'timeout',
        'api_degradation',
        'memory_concern',
        'loop_detected',
        'success_pattern'
    ) NOT NULL,
    severity ENUM('info', 'warning', 'critical', 'catastrophic') DEFAULT 'info',

    -- Finding details
    title VARCHAR(255) NOT NULL,
    mason_analysis TEXT NULL,
    dixon_analysis TEXT NULL,
    combined_verdict TEXT NULL,

    -- Evidence
    evidence_event_ids JSON NULL,
    evidence_summary TEXT NULL,
    pattern_signature VARCHAR(255) NULL,
    occurrence_count INT DEFAULT 1,
    first_seen TIMESTAMP NULL,
    last_seen TIMESTAMP NULL,

    -- Context
    related_tool VARCHAR(100) NULL,
    related_file VARCHAR(255) NULL,
    user_context VARCHAR(100) NULL,

    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
    INDEX idx_findings_category (category),
    INDEX idx_findings_severity (severity),
    INDEX idx_findings_pattern (pattern_signature),
    INDEX idx_findings_created (created_at DESC),
    INDEX idx_findings_session (session_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============ CALIBRATIONS TABLE ============
-- Proposed adjustments to Sportello's instruments
CREATE TABLE IF NOT EXISTS calibrations (
    id CHAR(36) PRIMARY KEY DEFAULT (UUID()),
    session_id CHAR(36) NOT NULL,
    finding_id CHAR(36) NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    -- Calibration type
    instrument ENUM(
        'error_tracker',
        'rate_limiter',
        'timeout_config',
        'retry_logic',
        'cache_ttl',
        'tool_parameters',
        'prompt_length',
        'model_selection',
        'memory_management'
    ) NOT NULL,

    -- Recommendation
    current_value TEXT NULL,
    recommended_value TEXT NULL,
    mason_rationale TEXT NULL,
    dixon_rationale TEXT NULL,

    -- Status tracking
    status ENUM('proposed', 'communicated', 'acknowledged', 'implemented', 'rejected') DEFAULT 'proposed',
    communicated_at TIMESTAMP NULL,
    response_from_sportello TEXT NULL,

    -- Confidence
    confidence DECIMAL(3,2) NULL,
    priority ENUM('low', 'medium', 'high', 'urgent') DEFAULT 'medium',

    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
    FOREIGN KEY (finding_id) REFERENCES findings(id) ON DELETE SET NULL,
    INDEX idx_calibrations_instrument (instrument),
    INDEX idx_calibrations_status (status),
    INDEX idx_calibrations_priority (priority),
    INDEX idx_calibrations_created (created_at DESC)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============ INSTRUMENT_READINGS TABLE ============
-- Time-series metrics extracted from Sportello's logs
CREATE TABLE IF NOT EXISTS instrument_readings (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    session_id CHAR(36) NOT NULL,
    recorded_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    -- Reading type
    instrument ENUM(
        'api_latency',
        'tool_duration',
        'error_rate',
        'success_rate',
        'cache_hit_rate',
        'iteration_count',
        'token_usage',
        'memory_pressure'
    ) NOT NULL,

    -- Values
    tool_name VARCHAR(100) NULL,
    value_numeric DECIMAL(15,4) NULL,
    value_text VARCHAR(255) NULL,
    unit VARCHAR(50) NULL,

    -- Context
    event_id INT NULL,
    metadata JSON NULL,

    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
    INDEX idx_readings_instrument (instrument),
    INDEX idx_readings_tool (tool_name),
    INDEX idx_readings_recorded (recorded_at DESC),
    INDEX idx_readings_session_time (session_id, recorded_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============ DISCOURSE_LOG TABLE ============
-- Records of communications between Mason, Dixon, and Sportello
CREATE TABLE IF NOT EXISTS discourse_log (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    session_id CHAR(36) NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    -- Participants
    speaker ENUM('mason', 'dixon', 'joint', 'sportello') NOT NULL,
    channel_id VARCHAR(50) NULL,
    message_id VARCHAR(50) NULL,

    -- Content
    content TEXT NOT NULL,
    intent ENUM(
        'observation',
        'inquiry',
        'calibration_proposal',
        'acknowledgment',
        'dispute',
        'consensus'
    ) NOT NULL,

    -- References
    finding_id CHAR(36) NULL,
    calibration_id CHAR(36) NULL,

    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
    FOREIGN KEY (finding_id) REFERENCES findings(id) ON DELETE SET NULL,
    FOREIGN KEY (calibration_id) REFERENCES calibrations(id) ON DELETE SET NULL,
    INDEX idx_discourse_session (session_id, created_at),
    INDEX idx_discourse_speaker (speaker)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============ VIEWS ============

-- Recent critical findings
CREATE OR REPLACE VIEW recent_critical_findings AS
SELECT
    f.id,
    f.created_at,
    f.category,
    f.severity,
    f.title,
    f.mason_analysis,
    f.dixon_analysis,
    f.combined_verdict,
    f.occurrence_count
FROM findings f
WHERE f.severity IN ('critical', 'catastrophic')
  AND f.created_at > DATE_SUB(NOW(), INTERVAL 24 HOUR)
ORDER BY f.created_at DESC;

-- Tool performance summary
CREATE OR REPLACE VIEW tool_performance_summary AS
SELECT
    tool_name,
    COUNT(*) as reading_count,
    AVG(value_numeric) as avg_duration_ms,
    MAX(value_numeric) as max_duration_ms,
    MIN(value_numeric) as min_duration_ms
FROM instrument_readings
WHERE instrument = 'tool_duration'
  AND recorded_at > DATE_SUB(NOW(), INTERVAL 24 HOUR)
GROUP BY tool_name
ORDER BY avg_duration_ms DESC;

-- Pending calibrations
CREATE OR REPLACE VIEW pending_calibrations AS
SELECT
    c.id,
    c.created_at,
    c.instrument,
    c.current_value,
    c.recommended_value,
    c.priority,
    c.confidence,
    f.title as finding_title,
    f.severity as finding_severity
FROM calibrations c
LEFT JOIN findings f ON c.finding_id = f.id
WHERE c.status IN ('proposed', 'communicated')
ORDER BY
    FIELD(c.priority, 'urgent', 'high', 'medium', 'low'),
    c.created_at DESC;
