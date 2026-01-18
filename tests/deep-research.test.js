// tests/deep-research.test.js
// Unit tests for deep research enhancement with format support
// Tests: buildResearchPrompt, citation formatting, HTML generation

const {
    buildResearchPrompt,
    formatCitationByStyle,
    generateFormattedReportHTML
} = require('../services/deepResearch');

// Simple test runner (no external dependencies)
let passed = 0;
let failed = 0;
const results = [];

function test(name, fn) {
    try {
        fn();
        passed++;
        results.push({ name, status: '✓', error: null });
        console.log(`  ✓ ${name}`);
    } catch (err) {
        failed++;
        results.push({ name, status: '✗', error: err.message });
        console.error(`  ✗ ${name}`);
        console.error(`    ${err.message}`);
    }
}

function expect(actual) {
    return {
        toBe(expected) {
            if (actual !== expected) {
                throw new Error(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
            }
        },
        toEqual(expected) {
            if (JSON.stringify(actual) !== JSON.stringify(expected)) {
                throw new Error(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
            }
        },
        toContain(item) {
            if (!actual.includes(item)) {
                throw new Error(`Expected to contain "${item}"`);
            }
        },
        toMatch(regex) {
            if (!regex.test(actual)) {
                throw new Error(`Expected to match ${regex}, got ${actual}`);
            }
        },
        toBeTruthy() {
            if (!actual) {
                throw new Error(`Expected truthy, got ${actual}`);
            }
        },
        toBeFalsy() {
            if (actual) {
                throw new Error(`Expected falsy, got ${actual}`);
            }
        },
        toHaveLength(len) {
            if (actual.length !== len) {
                throw new Error(`Expected length ${len}, got ${actual.length}`);
            }
        }
    };
}

// ============================================================================
// TEST SUITE: buildResearchPrompt()
// ============================================================================

console.log('\n📋 TEST SUITE: buildResearchPrompt()\n');

test('Default prompt uses "review" format', () => {
    const prompt = buildResearchPrompt('machine learning');
    expect(prompt).toContain('Research the following topic comprehensively');
    expect(prompt).toContain('using 8-12 diverse sources');
});

test('Review format is used by default', () => {
    const prompt = buildResearchPrompt('climate change', {});
    expect(prompt).toContain('Research the following topic comprehensively');
});

test('Taxonomy format includes hierarchical structure instructions', () => {
    const prompt = buildResearchPrompt('sustainable architecture', {
        format: 'taxonomy'
    });
    expect(prompt).toContain('hierarchical taxonomy');
    expect(prompt).toContain('Main categories → Subcategories');
    expect(prompt).toContain('Group related concepts');
});

test('Cover-letter format includes 300-500 word requirement', () => {
    const prompt = buildResearchPrompt('academic position research', {
        format: 'cover-letter'
    });
    expect(prompt).toContain('300-500 word cover letter');
    expect(prompt).toContain('4-6 paragraphs');
    expect(prompt).toContain('job application');
});

test('Focused depth reduces source count to 3-5', () => {
    const prompt = buildResearchPrompt('test', {
        depth: 'focused'
    });
    expect(prompt).toContain('3-5 authoritative sources');
});

test('Comprehensive depth requires 15+ sources', () => {
    const prompt = buildResearchPrompt('test', {
        depth: 'comprehensive'
    });
    expect(prompt).toContain('15+ sources');
});

test('Focus areas are injected into prompt', () => {
    const prompt = buildResearchPrompt('biology', {
        focusAreas: 'genetics, evolution, ecology'
    });
    expect(prompt).toContain('Focus particularly on these areas: genetics, evolution, ecology');
});

test('Date range is included in prompt', () => {
    const prompt = buildResearchPrompt('AI trends', {
        dateRange: '2020-present'
    });
    expect(prompt).toContain('Prioritize sources published 2020-present');
});

test('Context text from URL is clearly labeled', () => {
    const prompt = buildResearchPrompt('job research', {
        contextText: 'Senior Engineer role at Tech Corp\nRequirements: Python, AWS'
    });
    expect(prompt).toContain('JOB/CONTEXT FROM PROVIDED URL:');
    expect(prompt).toContain('Senior Engineer role at Tech Corp');
});

test('Multiple options combined properly', () => {
    const prompt = buildResearchPrompt('quantum computing', {
        format: 'taxonomy',
        depth: 'comprehensive',
        focusAreas: 'algorithms, hardware',
        dateRange: '2022-2026',
        contextText: 'Industry overview'
    });
    expect(prompt).toContain('hierarchical taxonomy');
    expect(prompt).toContain('15+ sources');
    expect(prompt).toContain('algorithms, hardware');
    expect(prompt).toContain('2022-2026');
    expect(prompt).toContain('Industry overview');
});

test('Invalid format defaults to review', () => {
    const prompt = buildResearchPrompt('test', {
        format: 'invalid-format'
    });
    expect(prompt).toContain('Research the following topic comprehensively');
});

test('Query is always included in prompt', () => {
    const query = 'machine learning ethics and bias';
    const prompt = buildResearchPrompt(query);
    expect(prompt).toContain(query);
});

// ============================================================================
// TEST SUITE: Citation Formatting
// ============================================================================

console.log('\n📝 TEST SUITE: Citation Formatting\n');

test('Chicago citation format (default)', () => {
    const citation = formatCitationByStyle(1, 'https://example.com/article', 'chicago');
    expect(citation).toContain('id="ref-1"');
    expect(citation).toContain('href="https://example.com/article"');
    expect(citation).toContain('back-ref');
});

test('APA citation format includes domain and date', () => {
    const citation = formatCitationByStyle(2, 'https://wikipedia.org/wiki/Climate', 'apa');
    expect(citation).toContain('id="ref-2"');
    expect(citation).toContain('Retrieved');
    expect(citation).toContain('https://wikipedia.org/wiki/Climate');
});

test('Numbered citation format shows [N]', () => {
    const citation = formatCitationByStyle(3, 'https://example.com', 'numbered');
    expect(citation).toContain('id="ref-3"');
    expect(citation).toContain('[3]');
    expect(citation).toContain('https://example.com');
});

test('Default citation style is chicago', () => {
    const citation = formatCitationByStyle(1, 'https://example.com', undefined);
    expect(citation).toContain('id="ref-1"');
});

test('Citation includes back-reference link', () => {
    const citation = formatCitationByStyle(5, 'https://test.com', 'chicago');
    expect(citation).toContain('href="#cite-5"');
});

test('URLs are properly escaped in citations', () => {
    const url = 'https://example.com/?query=test&page=1';
    const citation = formatCitationByStyle(1, url, 'chicago');
    expect(citation).toContain(url);
});

// ============================================================================
// TEST SUITE: HTML Generation
// ============================================================================

console.log('\n🎨 TEST SUITE: HTML Generation\n');

test('Taxonomy HTML includes hierarchical structure marker', () => {
    const mockResult = {
        content: '• Main Category\n  • Subcategory\n    • Item (1995)\n      Related info [1]',
        citations: ['https://example.com'],
        citationMap: { 1: 'https://example.com/source1' },
        citationStyle: 'chicago',
        format: 'taxonomy',
        usage: { prompt_tokens: 100, completion_tokens: 200 }
    };
    const { html, slug } = generateFormattedReportHTML(mockResult, 'test taxonomy');
    expect(slug).toContain('-taxonomy');
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('Main Category');
});

test('Cover-letter HTML includes letter formatting', () => {
    const mockResult = {
        content: 'Dear Hiring Manager,\n\nI am writing to express my interest...',
        citations: ['https://example.com'],
        citationMap: { 1: 'https://example.com' },
        citationStyle: 'chicago',
        format: 'cover-letter',
        usage: { prompt_tokens: 150, completion_tokens: 400 }
    };
    const { html, slug, filename } = generateFormattedReportHTML(mockResult, 'research-informed-letter');
    expect(slug).toContain('-cover-letter');
    expect(filename).toContain('src/search/');
    expect(html).toContain('letter-body');
    expect(html).toContain('Research-Informed Cover Letter');
});

test('Review format uses default HTML generation', () => {
    const mockResult = {
        content: 'Comprehensive analysis of the topic...',
        citations: ['https://example.com'],
        citationMap: { 1: 'https://example.com' },
        citationStyle: 'chicago',
        format: 'review',
        usage: { prompt_tokens: 100, completion_tokens: 300 }
    };
    const result = generateFormattedReportHTML(mockResult, 'review test');
    expect(result.html).toContain('<!DOCTYPE html>');
    // Review format should NOT have taxonomy or cover-letter suffixes
    if (result.slug.includes('-taxonomy') || result.slug.includes('-cover-letter')) {
        throw new Error('Review format should not have format suffix');
    }
});

test('HTML contains noir terminal styling', () => {
    const mockResult = {
        content: 'Test content',
        citations: [],
        citationMap: {},
        citationStyle: 'chicago',
        format: 'taxonomy',
        usage: { prompt_tokens: 50, completion_tokens: 100 }
    };
    const { html } = generateFormattedReportHTML(mockResult, 'style test');
    expect(html).toContain('#0a0a0a'); // Noir black background
    expect(html).toContain('#7ec8e3'); // Light blue text
    expect(html).toContain('#ff0000'); // Red accent
    expect(html).toContain('#00ffff'); // Cyan accent
});

test('HTML includes home navigation link', () => {
    const mockResult = {
        content: 'Content',
        citations: [],
        citationMap: {},
        citationStyle: 'chicago',
        format: 'cover-letter',
        usage: { prompt_tokens: 60, completion_tokens: 150 }
    };
    const { html } = generateFormattedReportHTML(mockResult, 'nav test');
    expect(html).toContain('home-link');
    expect(html).toContain('../../index.html');
});

test('Filename defaults to src/search/ directory', () => {
    const mockResult = {
        content: 'Content',
        citations: [],
        citationMap: {},
        citationStyle: 'chicago',
        format: 'review',
        usage: { prompt_tokens: 50, completion_tokens: 100 }
    };
    const { filename } = generateFormattedReportHTML(mockResult, 'path test');
    expect(filename).toContain('src/search/');
    expect(filename).toContain('.html');
});

test('Citation count displayed correctly in HTML', () => {
    const mockResult = {
        content: 'Content with sources [1] and [2] and [3]',
        citations: ['url1', 'url2', 'url3'],
        citationMap: {
            1: 'https://example.com/1',
            2: 'https://example.com/2',
            3: 'https://example.com/3'
        },
        citationStyle: 'chicago',
        format: 'taxonomy',
        usage: { prompt_tokens: 100, completion_tokens: 200 }
    };
    const { html } = generateFormattedReportHTML(mockResult, 'citation count');
    // Should have 3 citation references
    expect(html).toContain('id="ref-1"');
    expect(html).toContain('id="ref-2"');
    expect(html).toContain('id="ref-3"');
});

// ============================================================================
// RESULTS SUMMARY
// ============================================================================

console.log(`\n${'='.repeat(70)}`);
console.log(`✅ DEEP RESEARCH TEST RESULTS`);
console.log(`${'='.repeat(70)}`);
console.log(`\nTotal tests: ${passed + failed}`);
console.log(`Passed: ${passed} ✓`);
console.log(`Failed: ${failed} ✗`);
console.log(`Success rate: ${((passed / (passed + failed)) * 100).toFixed(1)}%\n`);

if (failed > 0) {
    console.log('Failed tests:');
    results.filter(r => r.status === '✗').forEach(r => {
        console.log(`  ✗ ${r.name}`);
        console.log(`    ${r.error}`);
    });
}

console.log(`\n${'='.repeat(70)}\n`);

process.exit(failed > 0 ? 1 : 0);
