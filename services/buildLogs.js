// services/buildLogs.js
// Build logging system for tracking game generation pipeline

const fs = require('fs').promises;
const path = require('path');

const LOG_DIR = path.join(__dirname, '..', 'logs', 'build-logs');

/**
 * Ensure log directory exists
 */
async function ensureLogDir() {
    try {
        await fs.access(LOG_DIR);
    } catch {
        await fs.mkdir(LOG_DIR, { recursive: true });
    }
}

/**
 * Write a build log entry
 * @param {string} buildId - Unique build identifier
 * @param {object} entry - Log entry data
 */
async function writeBuildLog(buildId, entry) {
    await ensureLogDir();
    const logPath = path.join(LOG_DIR, `${buildId}.json`);

    let existing = [];
    try {
        const content = await fs.readFile(logPath, 'utf8');
        existing = JSON.parse(content);
    } catch {
        // File doesn't exist yet, start fresh
    }

    existing.push({
        timestamp: new Date().toISOString(),
        ...entry
    });

    await fs.writeFile(logPath, JSON.stringify(existing, null, 2), 'utf8');
}

/**
 * Read a build log
 * @param {string} buildId - Build identifier
 * @returns {Array} Log entries
 */
async function readBuildLog(buildId) {
    const logPath = path.join(LOG_DIR, `${buildId}.json`);
    try {
        const content = await fs.readFile(logPath, 'utf8');
        return JSON.parse(content);
    } catch {
        return [];
    }
}

/**
 * Get recent build logs (most recent first)
 * @param {number} limit - Number of builds to return
 * @returns {Array} Array of {buildId, entries, mtime}
 */
async function getRecentBuilds(limit = 10) {
    await ensureLogDir();

    const files = await fs.readdir(LOG_DIR);
    const jsonFiles = files.filter(f => f.endsWith('.json'));

    // Get file stats for sorting by modification time
    const fileStats = await Promise.all(
        jsonFiles.map(async (file) => {
            const filePath = path.join(LOG_DIR, file);
            const stat = await fs.stat(filePath);
            return {
                buildId: file.replace('.json', ''),
                mtime: stat.mtime,
                filePath
            };
        })
    );

    // Sort by most recent first
    fileStats.sort((a, b) => b.mtime - a.mtime);

    // Read the actual log content for the most recent builds
    const recentBuilds = await Promise.all(
        fileStats.slice(0, limit).map(async ({ buildId, mtime, filePath }) => {
            const content = await fs.readFile(filePath, 'utf8');
            return {
                buildId,
                mtime,
                entries: JSON.parse(content)
            };
        })
    );

    return recentBuilds;
}

/**
 * Extract all test issues from recent builds
 * @param {number} limit - Number of recent builds to analyze
 * @returns {Array} Array of issue objects
 */
async function getRecentIssues(limit = 10) {
    const builds = await getRecentBuilds(limit);
    const issues = [];

    for (const build of builds) {
        for (const entry of build.entries) {
            if (entry.stage === 'test' && entry.testResult && entry.testResult.issues) {
                issues.push(...entry.testResult.issues.map(issue => ({
                    ...issue,
                    buildId: build.buildId,
                    timestamp: entry.timestamp
                })));
            }
        }
    }

    return issues;
}

/**
 * Generate summary of recent patterns and issues
 * @param {number} limit - Number of recent builds to analyze
 * @returns {string} Human-readable summary
 */
async function getRecentPatternsSummary(limit = 10) {
    try {
        const issues = await getRecentIssues(limit);

        if (issues.length === 0) {
            return 'Recent builds passed tests. Keep enforcing mobile controls and noir theme.';
        }

        // Count issue types
        const counts = issues.reduce((acc, issue) => {
            const key = issue.code || issue.message || JSON.stringify(issue).slice(0, 80);
            acc[key] = (acc[key] || 0) + 1;
            return acc;
        }, {});

        // Get top 5 most common issues
        const top = Object.entries(counts)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5)
            .map(([msg, count]) => `- ${msg} (seen ${count} times)`);

        return `Recent recurrent issues:\n${top.join('\n')}\nPlease avoid repeating them.`;
    } catch (error) {
        console.error('Error generating patterns summary:', error);
        return 'No recent builds. Use best practices.';
    }
}

module.exports = {
    ensureLogDir,
    writeBuildLog,
    readBuildLog,
    getRecentBuilds,
    getRecentIssues,
    getRecentPatternsSummary,
    LOG_DIR
};
