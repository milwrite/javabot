// services/gamePipeline.js
// Main orchestrator for the game building pipeline
// Coordinates Architect → Builder → Tester → Scribe agents

const { planGame } = require('../agents/gameArchitect');
const { buildGame } = require('../agents/gameBuilder');
const { testGame } = require('../agents/gameTester');
const { documentGame, updateProjectMetadata } = require('../agents/gameScribe');
const { writeBuildLog, getRecentPatternsSummary } = require('./buildLogs');
const simpleGit = require('simple-git');
const git = simpleGit();

/**
 * Run the complete game building pipeline
 * @param {object} options - Pipeline options
 * @param {string} options.userPrompt - User's game request
 * @param {object} options.triggerSource - Source of request { kind: 'slash'|'mention', userId, ... }
 * @param {Function} options.onStatusUpdate - Callback for progress updates
 * @param {string} options.preferredType - Optional type hint
 * @param {number} options.maxAttempts - Maximum build attempts (default: 3)
 * @returns {object} Pipeline result
 */
async function runGamePipeline({
    userPrompt,
    triggerSource,
    onStatusUpdate = async (msg) => console.log(msg),
    preferredType = 'auto',
    maxAttempts = 3
}) {
    const buildId = Date.now().toString();
    const startTime = Date.now();

    try {
        // Stage 1: Planning
        await onStatusUpdate('📝 sketching game plan...');

        const recentPatterns = await getRecentPatternsSummary();
        const plan = await planGame({
            userPrompt,
            recentPatternsSummary: recentPatterns,
            preferredType
        });

        await writeBuildLog(buildId, {
            stage: 'plan',
            plan,
            triggerSource,
            userPrompt
        });

        // Stage 2: Build-Test Loop (up to maxAttempts)
        let lastIssues = [];
        let buildResult;
        let testResult;

        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            await onStatusUpdate(`🎮 building game (attempt ${attempt}/${maxAttempts})...`);

            buildResult = await buildGame({
                plan,
                attempt,
                lastIssues,
                buildId
            });

            await writeBuildLog(buildId, {
                stage: 'build',
                attempt,
                buildResult: {
                    files: buildResult.files,
                    htmlLength: buildResult.htmlContent.length,
                    jsLength: buildResult.jsContent?.length || 0
                }
            });

            await onStatusUpdate(`🧪 testing game (attempt ${attempt}/${maxAttempts})...`);

            testResult = await testGame({
                plan,
                buildResult,
                buildId
            });

            await writeBuildLog(buildId, {
                stage: 'test',
                attempt,
                testResult
            });

            // Success! Break out of loop
            if (testResult.ok) {
                console.log(`✅ Build passed on attempt ${attempt}`);
                break;
            }

            // Failed - prepare for next attempt
            lastIssues = testResult.issues;

            if (attempt === maxAttempts) {
                console.log(`❌ Build failed after ${maxAttempts} attempts`);
                await writeBuildLog(buildId, {
                    stage: 'failure',
                    finalIssues: testResult.issues,
                    finalWarnings: testResult.warnings
                });

                return {
                    ok: false,
                    buildId,
                    plan,
                    buildResult,
                    testResult,
                    error: 'Max attempts reached with unresolved issues'
                };
            }

            console.log(`⚠️  Attempt ${attempt} failed, retrying with fixes...`);
        }

        // Stage 3: Documentation & Metadata
        await onStatusUpdate('📖 writing docs & metadata...');

        const docs = await documentGame({
            plan,
            buildResult,
            testResult,
            buildId
        });

        await writeBuildLog(buildId, {
            stage: 'scribe',
            docs
        });

        // Update projectmetadata.json
        const slug = plan.slug;
        await updateProjectMetadata(slug, docs.metadata);

        // Stage 4: Git operations (optional - can be done by caller)
        // We'll return the files so the caller can decide whether to commit

        const duration = ((Date.now() - startTime) / 1000).toFixed(1);
        console.log(`🎉 Pipeline complete in ${duration}s`);

        await writeBuildLog(buildId, {
            stage: 'complete',
            duration: `${duration}s`,
            success: true
        });

        return {
            ok: true,
            buildId,
            plan,
            buildResult,
            testResult,
            docs,
            duration,
            liveUrl: `https://milwrite.github.io/javabot/src/${slug}.html`
        };

    } catch (error) {
        console.error('Pipeline error:', error);

        await writeBuildLog(buildId, {
            stage: 'error',
            error: error.message,
            stack: error.stack
        });

        return {
            ok: false,
            buildId,
            error: error.message
        };
    }
}

/**
 * Commit game files to git
 * @param {object} result - Pipeline result
 * @param {string} customMessage - Optional custom commit message
 * @returns {boolean} Success
 */
async function commitGameFiles(result, customMessage = null) {
    if (!result.ok) {
        console.log('Cannot commit - build failed');
        return false;
    }

    try {
        const files = [
            ...result.buildResult.files,
            'projectmetadata.json'
        ];

        // Add files
        await git.add(files);

        // Commit
        const message = customMessage || `add ${result.plan.metadata.title.toLowerCase()}`;
        await git.commit(message);

        console.log(`✅ Committed: ${message}`);
        return true;
    } catch (error) {
        console.error('Git commit failed:', error);
        return false;
    }
}

/**
 * Classify if a user prompt is asking for interactive content
 * @param {string} prompt - User's message
 * @returns {boolean} True if content-related (games, letters, recipes, infographics, etc.)
 */
function isContentRequest(prompt) {
    const contentKeywords = [
        // Games
        'game', 'arcade', 'play', 'platformer', 'puzzle', 'snake',
        'tetris', 'pong', 'breakout', 'maze', 'shooter', 'adventure',
        'frogger', 'pacman', 'space invaders', 'tic tac toe',
        'chess', 'checkers', 'solitaire', 'sudoku', 'wordle',
        'trivia', 'quiz', 'challenge', 'level', 'score', 'highscore',
        'controls', 'joystick', 'd-pad',

        // Letters & Messages
        'letter', 'note', 'message', 'write to', 'letter to',
        'correspondence', 'introduction', 'memo',

        // Recipes
        'recipe', 'cook', 'ingredient', 'bake', 'dish', 'meal',
        'preparation', 'cooking', 'cuisine',

        // Infographics & Data
        'infographic', 'chart', 'graph', 'data viz', 'visualization',
        'statistics', 'comparison', 'analysis',

        // Stories & Narratives
        'story', 'narrative', 'tale', 'chronicle', 'journey',
        'adventure', 'fiction', 'interactive fiction', 'choose your own',

        // Logs & Documentation
        'log', 'field guide', 'inventory', 'report', 'documentation',
        'catalog', 'list of', 'collection of',

        // Parodies & Humor
        'parody', 'satire', 'mockup', 'spoof', 'infomercial',
        'mock', 'funny', 'humorous',

        // Utilities & Tools
        'planner', 'tracker', 'calculator', 'tool', 'utility',
        'schedule', 'calendar', 'todo', 'checklist', 'organizer',

        // General content creation
        'create', 'build', 'make', 'design', 'generate',
        'interactive', 'page', 'website'
    ];

    const lowerPrompt = prompt.toLowerCase();
    return contentKeywords.some(keyword => lowerPrompt.includes(keyword));
}

// Keep old name for backwards compatibility
function isGameRequest(prompt) {
    return isContentRequest(prompt);
}

module.exports = {
    runGamePipeline,
    commitGameFiles,
    isGameRequest,
    isContentRequest
};
