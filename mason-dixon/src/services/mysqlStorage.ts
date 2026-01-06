/**
 * MySQL Storage Service
 * Stores M&D findings, calibrations, and instrument readings
 */

import mysql from 'mysql2/promise';
import { randomUUID } from 'crypto';
import type {
    Session,
    Finding,
    CreateFindingInput,
    Calibration,
    CreateCalibrationInput,
    InstrumentReading,
    CreateReadingInput,
    DiscourseEntry,
    Speaker,
    DiscourseIntent,
    CalibrationStatus
} from '../types/index.js';

export class MySQLStorage {
    private pool: mysql.Pool | null = null;
    private connectionUrl: string;
    private currentSessionId: string | null = null;

    constructor(connectionUrl: string) {
        this.connectionUrl = connectionUrl;
    }

    async connect(): Promise<void> {
        this.pool = mysql.createPool({
            uri: this.connectionUrl,
            waitForConnections: true,
            connectionLimit: 10,
            queueLimit: 0,
            enableKeepAlive: true,
            keepAliveInitialDelay: 10000
        });

        // Test connection
        const conn = await this.pool.getConnection();
        console.log('[MYSQL] Connected to Mason & Dixon database');
        conn.release();
    }

    async disconnect(): Promise<void> {
        if (this.pool) {
            await this.pool.end();
            console.log('[MYSQL] Disconnected');
        }
    }

    // ============ SESSION MANAGEMENT ============

    async startSession(sportelloSessionId?: string): Promise<string> {
        const id = randomUUID();

        await this.pool!.execute(
            `INSERT INTO sessions (id, sportello_session_id, status) VALUES (?, ?, 'active')`,
            [id, sportelloSessionId ?? null]
        );

        this.currentSessionId = id;
        console.log(`[MYSQL] Session started: ${id}`);
        return id;
    }

    async endSession(sessionId: string, masonSummary?: string, dixonSummary?: string): Promise<void> {
        await this.pool!.execute(
            `UPDATE sessions
             SET ended_at = NOW(),
                 status = 'completed',
                 mason_observations = ?,
                 dixon_observations = ?
             WHERE id = ?`,
            [masonSummary ?? null, dixonSummary ?? null, sessionId]
        );
        console.log(`[MYSQL] Session ended: ${sessionId}`);
    }

    async incrementSessionEvents(sessionId: string, count: number = 1): Promise<void> {
        await this.pool!.execute(
            `UPDATE sessions SET total_events_observed = total_events_observed + ? WHERE id = ?`,
            [count, sessionId]
        );
    }

    async incrementSessionFindings(sessionId: string, count: number = 1): Promise<void> {
        await this.pool!.execute(
            `UPDATE sessions SET total_findings_generated = total_findings_generated + ? WHERE id = ?`,
            [count, sessionId]
        );
    }

    getCurrentSessionId(): string | null {
        return this.currentSessionId;
    }

    // ============ FINDINGS ============

    async storeFinding(input: CreateFindingInput & { session_id: string }): Promise<string> {
        const id = randomUUID();

        await this.pool!.execute(
            `INSERT INTO findings (
                id, session_id, category, severity, title,
                mason_analysis, dixon_analysis, combined_verdict,
                evidence_event_ids, evidence_summary, pattern_signature,
                related_tool, related_file, user_context,
                first_seen, last_seen
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
            [
                id,
                input.session_id,
                input.category,
                input.severity,
                input.title,
                input.mason_analysis ?? null,
                input.dixon_analysis ?? null,
                input.combined_verdict ?? null,
                input.evidence_event_ids ? JSON.stringify(input.evidence_event_ids) : null,
                input.evidence_summary ?? null,
                input.pattern_signature ?? null,
                input.related_tool ?? null,
                input.related_file ?? null,
                input.user_context ?? null
            ]
        );

        // Increment session counter
        await this.incrementSessionFindings(input.session_id);

        console.log(`[MYSQL] Finding stored: ${id} (${input.category}/${input.severity})`);
        return id;
    }

    async updateFindingOccurrence(patternSignature: string, sessionId: string): Promise<string | null> {
        // Check if pattern exists
        const [rows] = await this.pool!.execute<mysql.RowDataPacket[]>(
            `SELECT id, occurrence_count FROM findings
             WHERE pattern_signature = ? AND session_id = ?
             ORDER BY created_at DESC LIMIT 1`,
            [patternSignature, sessionId]
        );

        if (rows.length > 0) {
            const existing = rows[0];
            await this.pool!.execute(
                `UPDATE findings
                 SET occurrence_count = occurrence_count + 1, last_seen = NOW()
                 WHERE id = ?`,
                [existing.id]
            );
            return existing.id as string;
        }

        return null;
    }

    async getRecentFindings(options: {
        category?: string;
        severity?: string;
        limit?: number;
        sessionId?: string;
    } = {}): Promise<Finding[]> {
        const { category, severity, limit = 10, sessionId } = options;

        let query = 'SELECT * FROM findings WHERE 1=1';
        const params: unknown[] = [];

        if (category) {
            query += ' AND category = ?';
            params.push(category);
        }
        if (severity) {
            query += ' AND severity = ?';
            params.push(severity);
        }
        if (sessionId) {
            query += ' AND session_id = ?';
            params.push(sessionId);
        }

        query += ' ORDER BY created_at DESC LIMIT ?';
        params.push(limit);

        const [rows] = await this.pool!.execute<mysql.RowDataPacket[]>(query, params);

        return rows.map(row => ({
            ...row,
            evidence_event_ids: row.evidence_event_ids ? JSON.parse(row.evidence_event_ids) : []
        })) as Finding[];
    }

    // ============ CALIBRATIONS ============

    async storeCalibration(input: CreateCalibrationInput & { session_id: string }): Promise<string> {
        const id = randomUUID();

        await this.pool!.execute(
            `INSERT INTO calibrations (
                id, session_id, finding_id, instrument,
                current_value, recommended_value,
                mason_rationale, dixon_rationale,
                confidence, priority
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                id,
                input.session_id,
                input.finding_id ?? null,
                input.instrument,
                input.current_value ?? null,
                input.recommended_value ?? null,
                input.mason_rationale ?? null,
                input.dixon_rationale ?? null,
                input.confidence ?? null,
                input.priority ?? 'medium'
            ]
        );

        console.log(`[MYSQL] Calibration stored: ${id} (${input.instrument})`);
        return id;
    }

    async updateCalibrationStatus(calibrationId: string, status: CalibrationStatus): Promise<void> {
        const updates: string[] = ['status = ?'];
        const params: unknown[] = [status];

        if (status === 'communicated') {
            updates.push('communicated_at = NOW()');
        }

        await this.pool!.execute(
            `UPDATE calibrations SET ${updates.join(', ')} WHERE id = ?`,
            [...params, calibrationId]
        );
    }

    async getPendingCalibrations(): Promise<Calibration[]> {
        const [rows] = await this.pool!.execute<mysql.RowDataPacket[]>(
            `SELECT * FROM calibrations
             WHERE status IN ('proposed', 'communicated')
             ORDER BY FIELD(priority, 'urgent', 'high', 'medium', 'low'), created_at DESC`
        );
        return rows as Calibration[];
    }

    // ============ INSTRUMENT READINGS ============

    async storeReading(input: CreateReadingInput & { session_id: string }): Promise<void> {
        await this.pool!.execute(
            `INSERT INTO instrument_readings (
                session_id, instrument, tool_name,
                value_numeric, value_text, unit,
                event_id, metadata
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                input.session_id,
                input.instrument,
                input.tool_name ?? null,
                input.value_numeric ?? null,
                input.value_text ?? null,
                input.unit ?? null,
                input.event_id ?? null,
                input.metadata ? JSON.stringify(input.metadata) : null
            ]
        );
    }

    async getRecentReadings(options: {
        instrument?: string;
        tool_name?: string;
        hours?: number;
        sessionId?: string;
    } = {}): Promise<InstrumentReading[]> {
        const { instrument, tool_name, hours = 24, sessionId } = options;

        let query = `SELECT * FROM instrument_readings
                     WHERE recorded_at > DATE_SUB(NOW(), INTERVAL ? HOUR)`;
        const params: unknown[] = [hours];

        if (instrument) {
            query += ' AND instrument = ?';
            params.push(instrument);
        }
        if (tool_name) {
            query += ' AND tool_name = ?';
            params.push(tool_name);
        }
        if (sessionId) {
            query += ' AND session_id = ?';
            params.push(sessionId);
        }

        query += ' ORDER BY recorded_at DESC LIMIT 1000';

        const [rows] = await this.pool!.execute<mysql.RowDataPacket[]>(query, params);

        return rows.map(row => ({
            ...row,
            metadata: row.metadata ? JSON.parse(row.metadata) : null
        })) as InstrumentReading[];
    }

    // ============ DISCOURSE LOG ============

    async logDiscourse(entry: {
        session_id: string;
        speaker: Speaker;
        content: string;
        intent: DiscourseIntent;
        channel_id?: string;
        message_id?: string;
        finding_id?: string;
        calibration_id?: string;
    }): Promise<number> {
        const [result] = await this.pool!.execute<mysql.ResultSetHeader>(
            `INSERT INTO discourse_log (
                session_id, speaker, content, intent,
                channel_id, message_id, finding_id, calibration_id
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                entry.session_id,
                entry.speaker,
                entry.content,
                entry.intent,
                entry.channel_id ?? null,
                entry.message_id ?? null,
                entry.finding_id ?? null,
                entry.calibration_id ?? null
            ]
        );
        return result.insertId;
    }

    async getRecentDiscourse(sessionId: string, limit: number = 50): Promise<DiscourseEntry[]> {
        const [rows] = await this.pool!.execute<mysql.RowDataPacket[]>(
            `SELECT * FROM discourse_log
             WHERE session_id = ?
             ORDER BY created_at DESC LIMIT ?`,
            [sessionId, limit]
        );
        return rows as DiscourseEntry[];
    }
}
