// services/gitHelper.js
// GitHub API operations for file commits (Railway-compatible, no local git needed)

const { Octokit } = require('@octokit/rest');

const octokit = new Octokit({
    auth: process.env.GITHUB_TOKEN,
    request: {
        timeout: 30000 // 30 second timeout to prevent hanging on GitHub API issues
    }
});

/**
 * Get the SHA of an existing file in the repository
 * @param {string} repoPath - Path to file in repo (e.g., 'src/game.html')
 * @param {string} branch - Branch name (default: 'main')
 * @returns {Promise<string|undefined>} SHA if file exists, undefined if new file
 */
async function getExistingFileSha(repoPath, branch = 'main') {
    const owner = process.env.GITHUB_REPO_OWNER;
    const repo = process.env.GITHUB_REPO_NAME;
    try {
        const { data } = await octokit.repos.getContent({ owner, repo, path: repoPath, ref: branch });
        if (Array.isArray(data)) {
            throw new Error(`Path refers to a directory: ${repoPath}`);
        }
        return data.sha;
    } catch (e) {
        if (e.status === 404) return undefined; // New file
        throw e;
    }
}

/**
 * Push a file to GitHub via API (creates or updates)
 * @param {string} filePath - Local file path (will be normalized for GitHub)
 * @param {string} content - File content to push
 * @param {string} commitMessage - Commit message
 * @param {string} branch - Branch name (default: 'main')
 * @returns {Promise<string|null>} Commit SHA if successful
 */
async function pushFileViaAPI(filePath, content, commitMessage, branch = 'main') {
    const owner = process.env.GITHUB_REPO_OWNER;
    const repo = process.env.GITHUB_REPO_NAME;

    // Normalize to posix path for GitHub API
    const posixPath = filePath.replace(/\\/g, '/').replace(/^\.\//, '');

    const sha = await getExistingFileSha(posixPath, branch);
    const base64Content = Buffer.from(content, 'utf8').toString('base64');

    const res = await octokit.repos.createOrUpdateFileContents({
        owner,
        repo,
        path: posixPath,
        message: commitMessage,
        content: base64Content,
        branch,
        sha
    });

    return res.data.commit?.sha || null;
}

/**
 * Get repository status via GitHub API (no git CLI needed)
 * @param {string} branch - Branch name (default: 'main')
 * @returns {Promise<object>} Status object similar to git.status()
 */
async function getRepoStatus(branch = 'main') {
    const owner = process.env.GITHUB_REPO_OWNER;
    const repo = process.env.GITHUB_REPO_NAME;
    
    try {
        // Get repository info
        const { data: repoData } = await octokit.repos.get({ owner, repo });
        
        // Get default branch
        const defaultBranch = repoData.default_branch || 'main';
        
        // Get latest commit on branch
        const { data: refData } = await octokit.git.getRef({
            owner,
            repo,
            ref: `heads/${branch || defaultBranch}`
        });
        
        // Get commit details
        const { data: commitData } = await octokit.git.getCommit({
            owner,
            repo,
            commit_sha: refData.object.sha
        });
        
        return {
            current: branch || defaultBranch,
            tracking: `origin/${branch || defaultBranch}`,
            files: [], // GitHub API doesn't provide local file changes
            staged: [],
            modified: [],
            created: [],
            deleted: [],
            ahead: 0,
            behind: 0,
            detached: false,
            isClean: true, // Assume clean for API-based operations
            lastCommit: {
                sha: commitData.sha,
                message: commitData.message,
                author: commitData.author.name
            }
        };
    } catch (error) {
        console.error('[GIT_STATUS] Error getting repo status:', error.message);
        // Return minimal status on error
        return {
            current: branch || 'main',
            tracking: null,
            files: [],
            staged: [],
            modified: [],
            created: [],
            deleted: [],
            ahead: 0,
            behind: 0,
            detached: false,
            isClean: true
        };
    }
}

/**
 * Push multiple files as a single commit via GitHub API
 * @param {Array<{path: string, content: string}>} files - Array of files to commit
 * @param {string} commitMessage - Commit message
 * @param {string} branch - Branch name (default: 'main')
 * @returns {Promise<string|null>} Commit SHA if successful
 */
async function pushMultipleFiles(files, commitMessage, branch = 'main') {
    const owner = process.env.GITHUB_REPO_OWNER;
    const repo = process.env.GITHUB_REPO_NAME;
    
    try {
        // Get the current tree
        const { data: refData } = await octokit.git.getRef({
            owner,
            repo,
            ref: `heads/${branch}`
        });
        
        const commitSha = refData.object.sha;
        const { data: commitData } = await octokit.git.getCommit({
            owner,
            repo,
            commit_sha: commitSha
        });
        
        // Create blobs for each file
        const blobs = await Promise.all(
            files.map(async (file) => {
                const { data } = await octokit.git.createBlob({
                    owner,
                    repo,
                    content: Buffer.from(file.content).toString('base64'),
                    encoding: 'base64'
                });
                return {
                    path: file.path.replace(/\\/g, '/').replace(/^\.\//, ''),
                    mode: '100644',
                    type: 'blob',
                    sha: data.sha
                };
            })
        );
        
        // Create tree
        const { data: treeData } = await octokit.git.createTree({
            owner,
            repo,
            tree: blobs,
            base_tree: commitData.tree.sha
        });
        
        // Create commit
        const { data: newCommit } = await octokit.git.createCommit({
            owner,
            repo,
            message: commitMessage,
            tree: treeData.sha,
            parents: [commitSha]
        });
        
        // Update reference
        await octokit.git.updateRef({
            owner,
            repo,
            ref: `heads/${branch}`,
            sha: newCommit.sha
        });
        
        return newCommit.sha;
    } catch (error) {
        console.error('[MULTI_PUSH] Error pushing multiple files:', error.message);
        throw error;
    }
}

module.exports = {
    pushFileViaAPI,
    getRepoStatus,
    pushMultipleFiles
};
