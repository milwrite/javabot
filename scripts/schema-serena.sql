-- Serena Logs Schema Migration
-- Run with: source .env && psql "$DATABASE_URL" -f scripts/schema-serena.sql

-- ============ NEW TABLE: bot_sessions ============
CREATE TABLE IF NOT EXISTS bot_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ended_at TIMESTAMPTZ,
    exit_code INTEGER,
    exit_reason VARCHAR(50),  -- 'normal', 'crash', 'sigterm', 'sigint'
    event_count INTEGER DEFAULT 0,
    error_count INTEGER DEFAULT 0,
    hostname VARCHAR(100),
    version VARCHAR(20)
);

CREATE INDEX IF NOT EXISTS idx_sessions_started ON bot_sessions (started_at DESC);

-- ============ NOTIFY TRIGGER FUNCTION ============
-- Single function for all tables to broadcast new events
CREATE OR REPLACE FUNCTION notify_serena_event() RETURNS TRIGGER AS $$
DECLARE
    event_type_val TEXT;
BEGIN
    -- Determine event type based on table
    IF TG_TABLE_NAME = 'tool_calls' THEN
        event_type_val := 'tool_call';
    ELSIF TG_TABLE_NAME = 'build_stages' THEN
        event_type_val := 'build_stage';
    ELSE
        event_type_val := COALESCE(NEW.event_type, 'unknown');
    END IF;

    -- Send notification with minimal payload (client fetches full data if needed)
    PERFORM pg_notify('serena_logs', json_build_object(
        'table', TG_TABLE_NAME,
        'id', NEW.id,
        'type', event_type_val,
        'timestamp', COALESCE(NEW.timestamp, NOW())
    )::text);

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============ TRIGGERS ON EXISTING TABLES ============
-- Drop existing triggers if they exist (idempotent)
DROP TRIGGER IF EXISTS bot_events_notify ON bot_events;
DROP TRIGGER IF EXISTS tool_calls_notify ON tool_calls;
DROP TRIGGER IF EXISTS build_stages_notify ON build_stages;

-- Create new triggers
CREATE TRIGGER bot_events_notify
    AFTER INSERT ON bot_events
    FOR EACH ROW EXECUTE FUNCTION notify_serena_event();

CREATE TRIGGER tool_calls_notify
    AFTER INSERT ON tool_calls
    FOR EACH ROW EXECUTE FUNCTION notify_serena_event();

CREATE TRIGGER build_stages_notify
    AFTER INSERT ON build_stages
    FOR EACH ROW EXECUTE FUNCTION notify_serena_event();

-- ============ VERIFY SETUP ============
-- List all triggers to confirm
SELECT
    trigger_name,
    event_manipulation,
    event_object_table,
    action_statement
FROM information_schema.triggers
WHERE trigger_schema = 'public'
ORDER BY event_object_table;
