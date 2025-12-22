// services/gamePipeline.js
// Main orchestrator for the game building pipeline
// Coordinates Architect → Builder → Tester → Scribe agents

const { planGame } = require('../agents/gameArchitect');
const { buildGame } = require('../agents/gameBuilder');
const { testGame } = require('../agents/gameTester');
const { documentGame, updateProjectMetadata } = require('../agents/gameScribe');
const { writeBuildLog, getRecentPatternsSummary } = require('./buildLogs');
const { Octokit } = require('@octokit/rest');
const fs = require('fs').promises;
const fsSync = require('fs');

// Initialize Octokit for GitHub API operations
const octokit = new Octokit({
    auth: process.env.GITHUB_TOKEN,
});

// Get existing file SHA for updates (needed by GitHub API)
async function getExistingFileSha(repoPath, branch = 'main') {
    const owner = process.env.GITHUB_REPO_OWNER;
    const repo = process.env.GITHUB_REPO_NAME;
    try {
        const { data } = await octokit.repos.getContent({ owner, repo, path: repoPath, ref: branch });
        if (Array.isArray(data)) throw new Error(`Path refers to a directory: ${repoPath}`);
        return data.sha;
    } catch (e) {
        if (e.status === 404) return undefined; // New file
        throw e;
    }
}

// Commit multiple files via GitHub API in a single commit
async function commitFilesViaGitHubAPI(files, commitMessage, branch = 'main') {
    const owner = process.env.GITHUB_REPO_OWNER;
    const repo = process.env.GITHUB_REPO_NAME;

    if (!files || files.length === 0) {
        return { success: false, error: 'No files to commit' };
    }

    console.log(`[GITHUB_API] Committing ${files.length} file(s): "${commitMessage}"`);

    try {
        // Get the current commit SHA for the branch
        const { data: refData } = await octokit.git.getRef({ owner, repo, ref: `heads/${branch}` });
        const currentCommitSha = refData.object.sha;

        // Get the tree SHA from the current commit
        const { data: commitData } = await octokit.git.getCommit({ owner, repo, commit_sha: currentCommitSha });
        const baseTreeSha = commitData.tree.sha;

        // Create blobs for each file and build tree entries
        const treeEntries = [];
        for (const file of files) {
            const posixPath = file.path.replace(/\\/g, '/').replace(/^\.\//, '');
            const base64Content = Buffer.from(file.content, 'utf8').toString('base64');

            const { data: blobData } = await octokit.git.createBlob({
                owner, repo, content: base64Content, encoding: 'base64'
            });

            treeEntries.push({ path: posixPath, mode: '100644', type: 'blob', sha: blobData.sha });
        }

        // Create new tree with our changes
        const { data: newTree } = await octokit.git.createTree({ owner, repo, base_tree: baseTreeSha, tree: treeEntries });

        // Create the commit
        const { data: newCommit } = await octokit.git.createCommit({
            owner, repo, message: commitMessage, tree: newTree.sha, parents: [currentCommitSha]
        });

        // Update the branch reference to point to new commit
        await octokit.git.updateRef({ owner, repo, ref: `heads/${branch}`, sha: newCommit.sha });

        console.log(`[GITHUB_API] Commit successful: ${newCommit.sha.substring(0, 7)}`);
        return { success: true, sha: newCommit.sha, shortSha: newCommit.sha.substring(0, 7) };

    } catch (error) {
        console.error(`[GITHUB_API] Commit failed:`, error.message);
        return { success: false, error: error.message };
    }
}

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
        // Log to GUI
        if (global.logToGUI) {
            global.logToGUI('info', '🏗️ Architect analyzing request...', { userPrompt, preferredType });
        }
        
        const plan = await planGame({
            userPrompt,
            recentPatternsSummary: recentPatterns,
            preferredType,
            onStatusUpdate
        });

        // Log plan completion to GUI
        if (global.logToGUI) {
            global.logToGUI('info', `📋 Plan created: ${plan.metadata.title} (${plan.contentType})`, {
                files: plan.files,
                collection: plan.metadata.collection
            });
        }

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

            // Log to GUI
            if (global.logToGUI) {
                global.logToGUI('info', `🔨 Builder working (attempt ${attempt}/3)...`, { 
                    plan: plan.metadata.title,
                    attempt 
                });
            }

            buildResult = await buildGame({
                plan,
                attempt,
                lastIssues,
                buildId,
                onStatusUpdate
            });

            // Log build completion to GUI
            if (global.logToGUI) {
                global.logToGUI('info', `✅ Generated ${buildResult.files.join(', ')} (${buildResult.htmlContent.length} chars)`, {
                    files: buildResult.files,
                    htmlSize: buildResult.htmlContent.length,
                    jsSize: buildResult.jsContent?.length || 0
                });
            }

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

            // Log to GUI
            if (global.logToGUI) {
                global.logToGUI('info', '🧪 Tester validating code...', { 
                    plan: plan.metadata.title,
                    attempt 
                });
            }

            testResult = await testGame({
                plan,
                buildResult,
                buildId,
                onStatusUpdate
            });

            // Log test results to GUI
            if (global.logToGUI) {
                global.logToGUI('info', `✅ Tests ${testResult.ok ? 'passed' : 'failed'}! Score: ${testResult.score}/100`, {
                    passed: testResult.ok,
                    score: testResult.score,
                    issues: testResult.issues.length,
                    warnings: testResult.warnings.length
                });
            }

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

        // Log to GUI
        if (global.logToGUI) {
            global.logToGUI('info', '📝 Scribe generating docs...', { 
                plan: plan.metadata.title 
            });
        }

        const docs = await documentGame({
            plan,
            buildResult,
            testResult,
            buildId,
            onStatusUpdate
        });

        // Log doc completion to GUI
        if (global.logToGUI) {
            global.logToGUI('info', '✅ Documentation complete', {
                caption: docs.metadata.caption
            });
        }

        await onStatusUpdate(`✅ Documentation complete\n   Caption: "${docs.metadata.caption}"`);

        await writeBuildLog(buildId, {
            stage: 'scribe',
            docs
        });

        // Update projectmetadata.json
        const slug = plan.slug;
        await updateProjectMetadata(slug, docs.metadata);
        
        // Log metadata update to GUI
        if (global.logToGUI) {
            global.logToGUI('info', `✅ Updated projectmetadata.json: ${slug} → ${docs.metadata.collection || 'unsorted'}`, {
                slug: slug,
                collection: docs.metadata.collection || 'unsorted'
            });
        }
        
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
            liveUrl: `https://bot.inference-arcade.com/src/${slug}.html`
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
 * Commit game files via GitHub API (Railway-compatible, no local git needed)
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
        const filePaths = [
            ...result.buildResult.files,
            'projectmetadata.json'
        ];

        console.log('📦 Reading files for GitHub commit...');
        if (global.logToGUI) {
            global.logToGUI('info', '📦 Reading files for GitHub commit...', { files: filePaths });
        }

        // Read file contents from disk
        const filesToCommit = [];
        for (const filePath of filePaths) {
            try {
                const content = await fs.readFile(filePath, 'utf8');
                filesToCommit.push({ path: filePath, content });
            } catch (readErr) {
                console.warn(`⚠️ Could not read ${filePath}: ${readErr.message}`);
            }
        }

        if (filesToCommit.length === 0) {
            console.log('⚠️ No files to commit');
            return true;
        }

        // Create safe commit message (max 100 chars per user requirements)
        let message = customMessage || `add ${result.plan.metadata.title.toLowerCase()}`;
        if (message.length > 100) {
            message = message.substring(0, 97) + '...';
        }

        console.log('💾 Committing via GitHub API...');
        if (global.logToGUI) {
            global.logToGUI('info', '💾 Committing via GitHub API...', { message });
        }

        const commitResult = await commitFilesViaGitHubAPI(filesToCommit, message, 'main');

        if (!commitResult.success) {
            throw new Error(commitResult.error);
        }

        console.log(`✅ Committed and pushed: ${message} (${commitResult.shortSha})`);
        if (global.logToGUI) {
            global.logToGUI('info', `✅ Committed: ${message}`, { sha: commitResult.shortSha });
        }
        return true;

    } catch (error) {
        console.error('❌ GitHub commit failed:', error.message);
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
