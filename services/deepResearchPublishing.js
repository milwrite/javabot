const {
    generateFormattedReportHTML,
    generateMarkdownReport,
    validateResearchResult
} = require('./deepResearch');
const { getFileContentViaAPI, pushMultipleFiles } = require('./gitHelper');
const {
    REGISTRY_PATH,
    DEFAULT_ARCHIVE_URL,
    parseRegistry,
    buildRegistryEntry,
    upsertRegistry,
    serializeRegistry
} = require('./researchArchive');

function getPublicBaseUrl() {
    return (process.env.PUBLIC_SITE_BASE_URL || 'https://bot.inference-arcade.com').replace(/\/$/, '');
}

function getArchiveUrl() {
    return process.env.DEEP_RESEARCH_ARCHIVE_URL || DEFAULT_ARCHIVE_URL;
}

function getRunId(publishedAt) {
    return publishedAt.toISOString().replace(/[-:.]/g, '').toLowerCase();
}

async function publishDeepResearchResult(result, query, options = {}) {
    validateResearchResult(result);
    const publishedAt = options.publishedAt || new Date();
    const generated = generateFormattedReportHTML(result, query);
    const uniqueSlug = `${generated.slug}-${getRunId(publishedAt)}`;
    const reportPath = `src/search/${uniqueSlug}.html`;
    const publicBaseUrl = getPublicBaseUrl();
    const reportUrl = `${publicBaseUrl}/${reportPath}`;
    const archiveUrl = getArchiveUrl();
    const entry = buildRegistryEntry({ query, reportPath, result, publishedAt });
    const markdown = generateMarkdownReport(result, query, { reportUrl, archiveUrl });
    const push = options.pushFiles || pushMultipleFiles;
    let commitSha = null;

    for (let attempt = 1; attempt <= 3; attempt += 1) {
        const registryContent = options.registryContent !== undefined
            ? options.registryContent
            : await getFileContentViaAPI(REGISTRY_PATH, 'main');
        const registry = parseRegistry(registryContent);
        const updatedRegistry = upsertRegistry(registry, entry);
        const files = [
            { path: reportPath, content: generated.html },
            { path: REGISTRY_PATH, content: serializeRegistry(updatedRegistry) }
        ];

        try {
            commitSha = await push(
                files,
                `publish deep research: ${query.slice(0, 60)}`,
                'main'
            );
            break;
        } catch (error) {
            const isConcurrentUpdate = error.status === 409 || error.status === 422;
            if (!isConcurrentUpdate || attempt === 3 || options.registryContent !== undefined) throw error;
            console.warn(`[DEEP_RESEARCH] Archive changed during publication; retrying (${attempt}/3).`);
        }
    }

    if (!commitSha) throw new Error('GitHub did not confirm the Deep Research publication commit');

    return {
        commitSha,
        reportPath,
        reportUrl,
        archiveUrl,
        registryEntry: entry,
        markdown,
        markdownFilename: `${uniqueSlug}.md`
    };
}

module.exports = {
    getPublicBaseUrl,
    getArchiveUrl,
    publishDeepResearchResult
};
