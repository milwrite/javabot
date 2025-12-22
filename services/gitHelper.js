// services/gitHelper.js
// GitHub API operations for file commits (Railway-compatible, no local git needed)

const { Octokit } = require('@octokit/rest');

const octokit = new Octokit({
    auth: process.env.GITHUB_TOKEN,
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

module.exports = {
    octokit,
    getExistingFileSha,
    pushFileViaAPI
};
