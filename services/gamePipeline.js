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
        await onStatusUpdate('📝 Planning architecture...');

        const recentPatterns = await getRecentPatternsSummary();
        const plan = await planGame({
            userPrompt,
            recentPatternsSummary: recentPatterns,
            preferredType
        });

        await onStatusUpdate(`✅ Architecture complete\n   Type: "${plan.type}"\n   Theme: "${plan.theme}"`);

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
            await onStatusUpdate(`🎮 Building content (attempt ${attempt}/${maxAttempts})...`);

            buildResult = await buildGame({
                plan,
                attempt,
                lastIssues,
                buildId
            });

            await onStatusUpdate(`✅ Build complete\n   Files: ${buildResult.files.join(', ')}\n   HTML: ${Math.round(buildResult.htmlContent.length / 1024)}KB, JS: ${Math.round((buildResult.jsContent?.length || 0) / 1024)}KB`);

            await writeBuildLog(buildId, {
                stage: 'build',
                attempt,
                buildResult: {
                    files: buildResult.files,
                    htmlLength: buildResult.htmlContent.length,
                    jsLength: buildResult.jsContent?.length || 0
                }
            });

            await onStatusUpdate(`🧪 Running quality tests (attempt ${attempt}/${maxAttempts})...`);

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
                await onStatusUpdate(`✅ Quality tests passed\n   Issues: ${testResult.issues.length}\n   Warnings: ${testResult.warnings.length}`);
                break;
            }

            // Failed - prepare for next attempt
            lastIssues = testResult.issues;
            await onStatusUpdate(`⚠️  Tests failed: ${testResult.issues.length} issues found`);

            if (attempt === maxAttempts) {
                await onStatusUpdate(`❌ Build failed after ${maxAttempts} attempts`);
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

            await onStatusUpdate(`🔄 Retrying with fixes (attempt ${attempt + 1}/${maxAttempts})...`);
        }

        // Stage 3: Documentation & Metadata
        await onStatusUpdate('📖 Writing documentation...');

        const docs = await documentGame({
            plan,
            buildResult,
            testResult,
            buildId
        });

        await onStatusUpdate(`✅ Documentation complete\n   Caption: "${docs.metadata.caption}"`);

        await writeBuildLog(buildId, {
            stage: 'scribe',
            docs
        });

        // Update projectmetadata.json
        const slug = plan.slug;
        await updateProjectMetadata(slug, docs.metadata);
        await onStatusUpdate(`✅ Updated projectmetadata.json: ${slug} → ${docs.metadata.type}-content`);

        // Stage 4: Git operations (optional - can be done by caller)
        // We'll return the files so the caller can decide whether to commit

        const duration = ((Date.now() - startTime) / 1000).toFixed(1);
        await onStatusUpdate(`🎉 Pipeline complete in ${duration}s`);

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
        console.log('❌ Cannot commit - build failed');
        return false;
    }

    try {
        const files = [
            ...result.buildResult.files,
            'projectmetadata.json'
        ];

        console.log('📦 staging files for git commit...');
        await git.add(files);

        // Create safe commit message (max 100 chars per user requirements)
        let message = customMessage || `add ${result.plan.metadata.title.toLowerCase()}`;
        if (message.length > 100) {
            message = message.substring(0, 97) + '...';
        }
        console.log('💾 creating git commit...');
        
        // Check git status before committing
        const status = await git.status();
        if (status.files.length === 0) {
            console.log('⚠️  No changes to commit');
            return true; // Not an error - just nothing to commit
        }

        await git.commit(message);
        console.log(`✅ Committed: ${message}`);
        return true;
        
    } catch (error) {
        console.error('❌ Git commit failed:', error.message);
        
        // Check if this is a HEAD parsing issue
        if (error.message.includes('could not parse HEAD') || error.message.includes('bad object HEAD')) {
            console.log('🔧 Attempting to fix corrupted git HEAD...');
            try {
                // Try to reset to remote
                await git.fetch('origin');
                await git.reset(['--hard', 'origin/main']);
                console.log('✅ Git HEAD fixed, retrying commit...');
                
                // Retry the commit
                await git.add(files);
                let retryMessage = customMessage || `add ${result.plan.metadata.title.toLowerCase()}`;
                if (retryMessage.length > 100) {
                    retryMessage = retryMessage.substring(0, 97) + '...';
                }
                await git.commit(retryMessage);
                console.log(`✅ Committed after HEAD fix: ${retryMessage}`);
                return true;
                
            } catch (retryError) {
                console.error('❌ Failed to fix git HEAD:', retryError.message);
                return false;
            }
        }
        
        return false;
    }
}

/**
 * Check if prompt is requesting an edit to existing content
 * Requires evidence of prior file identification in conversation history
 * @param {string} prompt - User's message
 * @param {Array} conversationHistory - Recent conversation messages
 * @returns {boolean} True if requesting edits/updates to identified content
 */
function isEditRequest(prompt, conversationHistory = []) {
    const lowerPrompt = prompt.toLowerCase();

    // Check for explicit edit intent with specific file references
    const hasExplicitEditIntent = /\b(edit|fix|change|update|modify|adjust|tweak|alter|correct)\s+(the|this|that)\s+\w+/i.test(prompt);
    
    // Check for direct file modification commands
    const hasDirectFileCommand = /\b(edit|fix|change|update|modify)\s+.*?([\w-]+\.(html|js|css|md))/i.test(prompt);

    // Direct file commands are immediate edit requests
    if (hasDirectFileCommand) {
        return true;
    }

    // Only proceed with other edit detection if there's clear edit intent
    if (!hasExplicitEditIntent) {
        return false;
    }

    // Check if conversation history shows evidence of file identification
    const hasIdentifiedContent = conversationHistory.some(msg => {
        const content = (msg.content || '').toLowerCase();
        return (
            // Evidence of file listing/searching
            content.includes('found in file:') ||
            content.includes('reading file:') ||
            content.includes('listed files:') ||
            content.includes('search results:') ||
            // Tool call evidence
            msg.role === 'tool' ||
            // Previous file operations
            content.includes('src/') ||
            content.includes('.html') ||
            content.includes('.js')
        );
    });

    // Check if prompt specifically references previously mentioned files
    const referencesDiscussedFile = conversationHistory.some(msg => {
        const content = (msg.content || '').toLowerCase();
        const promptWords = lowerPrompt.split(/\s+/);
        
        // Look for file names or game names mentioned in history
        return promptWords.some(word => 
            word.length > 3 && 
            content.includes(word) && 
            (content.includes('file:') || content.includes('game') || content.includes('page'))
        );
    });

    // Only trigger edit mode if we have both edit intent AND identified content
    return (hasExplicitEditIntent || hasDirectFileCommand) && (hasIdentifiedContent || referencesDiscussedFile);
}

/**
 * Classify if a user prompt is asking for interactive content
 * @param {string} prompt - User's message
 * @returns {boolean} True if content-related (games, letters, recipes, infographics, etc.)
 */
function isContentRequest(prompt) {
    // First check: if it's an edit request, NOT a new content request
    if (isEditRequest(prompt)) {
        console.log('[CONTENT_DETECTION] Edit request detected - skipping game pipeline');
        return false;
    }

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

        // General content creation (NEW CONTENT ONLY - not modifications)
        'create a new', 'build a new', 'make a new',
        'create another', 'build another', 'make another',
        'new game', 'new page', 'new interactive',
        'interactive', 'page', 'website'
    ];

    const lowerPrompt = prompt.toLowerCase();

    // Check for new content creation indicators
    const hasNewIndicator = /\b(new|another|create|build|generate)\s+(game|page|interactive|tool|utility)/i.test(prompt);

    // Check for content keywords
    const hasContentKeyword = contentKeywords.some(keyword => lowerPrompt.includes(keyword));

    // Require either explicit "new/create" indicator OR strong content keyword match
    return hasNewIndicator || hasContentKeyword;
}

// Keep old name for backwards compatibility
function isGameRequest(prompt) {
    return isContentRequest(prompt);
}

module.exports = {
    runGamePipeline,
    commitGameFiles,
    isGameRequest,
    isContentRequest,
    isEditRequest
};
