const {
    classifyTheme,
    parseRegistry,
    buildRegistryEntry,
    upsertRegistry,
    serializeRegistry
} = require('../services/researchArchive');
const { publishDeepResearchResult } = require('../services/deepResearchPublishing');

let passed = 0;
let failed = 0;

async function test(name, fn) {
    try {
        await fn();
        passed += 1;
        console.log(`  ✓ ${name}`);
    } catch (error) {
        failed += 1;
        console.error(`  ✗ ${name}`);
        console.error(`    ${error.message}`);
    }
}

function assert(condition, message) {
    if (!condition) throw new Error(message);
}

function completeResult() {
    return {
        content: 'A complete finding [1].',
        citations: ['https://example.com/source'],
        citationMap: { 1: 'https://example.com/source' },
        sourceMap: { 1: { url: 'https://example.com/source', title: 'Source' } },
        citationStyle: 'chicago',
        format: 'lit-review',
        truncated: false,
        complete: true,
        provider: 'test'
    };
}

(async () => {
    console.log('\n🗄️ TEST SUITE: Deep Research archive publication\n');

    await test('Theme classification handles known and unknown research', () => {
        assert(classifyTheme('Museum archives and cultural programs') === 'museums-culture', 'museum theme mismatch');
        assert(classifyTheme('Quantum banana morphology') === 'other', 'unknown research should be other');
    });

    await test('Registry upsert replaces one file without duplicating it', () => {
        const first = { title: 'Old', file: 'same.html', date: '2026-01-01' };
        const replacement = { title: 'New', file: 'same.html', date: '2026-02-01' };
        const updated = upsertRegistry([first], replacement);
        assert(updated.length === 1, 'registry contains a duplicate');
        assert(updated[0].title === 'New', 'registry did not retain replacement');
        assert(parseRegistry(serializeRegistry(updated)).length === 1, 'serialized registry did not round-trip');
    });

    await test('Registry entries retain citation metadata', () => {
        const entry = buildRegistryEntry({
            query: 'A literature review of networked learning',
            reportPath: 'src/search/test.html',
            result: completeResult(),
            publishedAt: new Date('2026-08-02T12:00:00.000Z')
        });
        assert(entry.file === 'test.html', 'entry path was not normalized');
        assert(entry.citationCount === 1, 'citation count missing');
        assert(entry.citationStyle === 'chicago', 'citation style missing');
    });

    await test('Publisher commits report and registry atomically with a unique filename', async () => {
        let captured = null;
        const publication = await publishDeepResearchResult(completeResult(), 'Networked learning scholarship', {
            publishedAt: new Date('2026-08-02T12:34:56.000Z'),
            registryContent: '[]',
            pushFiles: async (files, message, branch) => {
                captured = { files, message, branch };
                return 'confirmed-commit-sha';
            }
        });
        assert(captured.files.length === 2, 'report and registry were not committed together');
        assert(captured.files.some(file => file.path === 'src/search/reports.json'), 'registry missing from commit');
        assert(captured.files.some(file => file.path === publication.reportPath), 'report missing from commit');
        assert(publication.reportPath.includes('20260802t123456000z'), 'filename is not unique per run');
        assert(publication.markdown.includes('## References'), 'complete Markdown attachment missing references');
    });

    console.log(`\n${passed} passed, ${failed} failed\n`);
    process.exit(failed > 0 ? 1 : 0);
})();
