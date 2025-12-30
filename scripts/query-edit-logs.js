#!/usr/bin/env node

// scripts/query-edit-logs.js
// Read-only diagnostics against Railway Postgres for edit-related telemetry

require('dotenv').config({ override: true });
const { Pool } = require('pg');

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL not set. Add it to .env to query Railway Postgres.');
    process.exit(1);
  }

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    max: 3,
    idleTimeoutMillis: 15000,
    connectionTimeoutMillis: 10000
  });

  const run = async (label, query, params = []) => {
    try {
      const res = await pool.query(query, params);
      return { label, rows: res.rows };
    } catch (err) {
      return { label, error: err.message };
    }
  };

  const since = process.env.SINCE || '7 days';
  const targetPath = process.env.TARGET_PATH || 'src/super-flu-thermometer.html';

  const tasks = [
    run('counts_7d', `
      SELECT 
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE error IS NOT NULL OR result ILIKE 'Error%')::int AS errors
      FROM tool_calls
      WHERE tool_name = 'edit_file'
        AND timestamp > NOW() - ($1::text)::interval
    `, [since]),
    run('top_failures_7d', `
      SELECT 
        COALESCE(NULLIF(TRIM(error), ''), SUBSTRING(result FROM 1 FOR 200)) AS failure,
        COUNT(*)::int AS count
      FROM tool_calls
      WHERE tool_name = 'edit_file'
        AND (error IS NOT NULL OR result ILIKE 'Error%')
        AND timestamp > NOW() - ($1::text)::interval
      GROUP BY 1
      ORDER BY 2 DESC
      LIMIT 10
    `, [since]),
    run('recent_edit_calls', `
      SELECT 
        to_char(timestamp, 'YYYY-MM-DD HH24:MI:SS') AS ts,
        (arguments->>'path') AS path,
        LENGTH(COALESCE(arguments::text, ''))::int AS args_len,
        CASE WHEN result IS NULL THEN NULL ELSE SUBSTRING(result FROM 1 FOR 160) END AS result_preview,
        CASE WHEN error IS NULL THEN NULL ELSE SUBSTRING(error FROM 1 FOR 160) END AS error_preview
      FROM tool_calls
      WHERE tool_name = 'edit_file'
      ORDER BY timestamp DESC
      LIMIT 25
    `),
    run('recent_file_changes', `
      SELECT 
        to_char(timestamp, 'YYYY-MM-DD HH24:MI:SS') AS ts,
        (payload->>'action') AS action,
        (payload->>'path') AS path
      FROM bot_events
      WHERE event_type = 'file_change'
        AND timestamp > NOW() - ($1::text)::interval
      ORDER BY timestamp DESC
      LIMIT 25
    `, [since]),
    run('target_path_activity', `
      WITH edits AS (
        SELECT 
          'tool_call' AS src,
          timestamp,
          (arguments->>'path') AS path,
          CASE WHEN error IS NULL AND (result IS NULL OR result NOT ILIKE 'Error%') THEN true ELSE false END AS ok,
          COALESCE(NULLIF(TRIM(error), ''), SUBSTRING(result FROM 1 FOR 160)) AS msg
        FROM tool_calls
        WHERE tool_name = 'edit_file'
          AND (arguments->>'path') = $1
      ),
      changes AS (
        SELECT 
          'file_change' AS src,
          timestamp,
          (payload->>'path') AS path,
          true AS ok,
          (payload->>'action') AS msg
        FROM bot_events
        WHERE event_type = 'file_change'
          AND (payload->>'path') = $1
      )
      SELECT 
        src,
        to_char(timestamp, 'YYYY-MM-DD HH24:MI:SS') AS ts,
        path,
        ok,
        msg
      FROM (
        SELECT * FROM edits
        UNION ALL
        SELECT * FROM changes
      ) t
      ORDER BY ts DESC
      LIMIT 50
    `, [targetPath])
  ];

  const results = await Promise.all(tasks);
  await pool.end();

  const summary = Object.fromEntries(results.map(r => [r.label, r.error ? { error: r.error } : r.rows ]));
  console.log(JSON.stringify({ since, targetPath, summary }, null, 2));
}

main().catch(err => {
  console.error('Query failed:', err.message);
  process.exit(1);
});
