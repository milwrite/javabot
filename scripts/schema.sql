-- Bot Sportello PostgreSQL Schema
-- Long-term logging for Discord bot events

-- Core events table with flexible JSONB payload
CREATE TABLE IF NOT EXISTS bot_events (
    id SERIAL PRIMARY KEY,
    event_type VARCHAR(50) NOT NULL,
    timestamp TIMESTAMPTZ DEFAULT NOW(),
    session_id VARCHAR(100),
    user_id VARCHAR(50),
    username VARCHAR(100),
    channel_id VARCHAR(50),
    payload JSONB DEFAULT '{}',
    duration_ms INTEGER,
    success BOOLEAN,
    error_category VARCHAR(50)
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_events_type ON bot_events(event_type);
CREATE INDEX IF NOT EXISTS idx_events_timestamp ON bot_events(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_events_user ON bot_events(user_id);
CREATE INDEX IF NOT EXISTS idx_events_session ON bot_events(session_id);
CREATE INDEX IF NOT EXISTS idx_events_payload ON bot_events USING GIN (payload);
CREATE INDEX IF NOT EXISTS idx_events_error_category ON bot_events(error_category) WHERE error_category IS NOT NULL;

-- Tool calls detail table (standalone, no longer linked to events)
CREATE TABLE IF NOT EXISTS tool_calls (
    id SERIAL PRIMARY KEY,
    tool_name VARCHAR(100) NOT NULL,
    arguments JSONB,
    result TEXT,
    error TEXT,
    duration_ms INTEGER,
    iteration INTEGER,
    user_id VARCHAR(50),
    channel_id VARCHAR(50),
    session_id VARCHAR(100),
    timestamp TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tool_calls_name ON tool_calls(tool_name);
CREATE INDEX IF NOT EXISTS idx_tool_calls_session ON tool_calls(session_id);
CREATE INDEX IF NOT EXISTS idx_tool_calls_timestamp ON tool_calls(timestamp DESC);

-- Build pipeline stages
CREATE TABLE IF NOT EXISTS build_stages (
    id SERIAL PRIMARY KEY,
    build_id VARCHAR(50) NOT NULL,
    stage VARCHAR(50) NOT NULL,
    attempt INTEGER DEFAULT 1,
    result JSONB,
    test_score INTEGER,
    duration_ms INTEGER,
    timestamp TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_build_stages_build_id ON build_stages(build_id);
CREATE INDEX IF NOT EXISTS idx_build_stages_stage ON build_stages(stage);
CREATE INDEX IF NOT EXISTS idx_build_stages_timestamp ON build_stages(timestamp DESC);
