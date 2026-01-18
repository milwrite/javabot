// tests/web-scraper.test.js
// Unit tests for web scraper service with cheerio HTML parsing
// Tests: extractText, cleanText, extractDomain

const {
    extractText,
    cleanText,
    extractDomain,
    SCRAPE_TIMEOUT,
    MAX_CONTENT_LENGTH
} = require('../services/webScraper');

// Simple test runner
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
            if (!actual || !actual.includes(item)) {
                throw new Error(`Expected to contain "${item}", got "${actual}"`);
            }
        },
        notToContain(item) {
            if (actual && actual.includes(item)) {
                throw new Error(`Expected NOT to contain "${item}", got "${actual}"`);
            }
        },
        toMatch(regex) {
            if (!actual || !regex.test(actual)) {
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
            if (!actual || actual.length !== len) {
                throw new Error(`Expected length ${len}, got ${actual ? actual.length : 'undefined'}`);
            }
        },
        toBeGreaterThan(threshold) {
            if (actual <= threshold) {
                throw new Error(`Expected > ${threshold}, got ${actual}`);
            }
        },
        toBeLessThan(threshold) {
            if (actual >= threshold) {
                throw new Error(`Expected < ${threshold}, got ${actual}`);
            }
        }
    };
}

// ============================================================================
// TEST SUITE: extractText()
// ============================================================================

console.log('\n🔍 TEST SUITE: extractText() - HTML Parsing\n');

test('Extracts title from <title> tag', () => {
    const html = '<html><head><title>Page Title</title></head><body>Content</body></html>';
    const result = extractText(html);
    expect(result.title).toBe('Page Title');
});

test('Falls back to <h1> if no <title>', () => {
    const html = '<html><head></head><body><h1>Heading Title</h1></body></html>';
    const result = extractText(html);
    expect(result.title).toBe('Heading Title');
});

test('Removes script tags from content', () => {
    const html = '<html><body><p>Main content</p><script>alert("evil");</script><p>More content</p></body></html>';
    const result = extractText(html);
    expect(result.text).notToContain('alert');
    expect(result.text).toContain('Main content');
});

test('Extracts content from <article> tag', () => {
    const html = '<html><body><nav>Navigation</nav><article><p>Article content here</p></article><footer>Footer</footer></body></html>';
    const result = extractText(html);
    expect(result.text).toContain('Article content here');
    expect(result.text).notToContain('Navigation');
});

test('Falls back to <main> if no <article>', () => {
    const html = '<html><body><main><p>Main section content</p></main></body></html>';
    const result = extractText(html);
    expect(result.text).toContain('Main section content');
});

test('Extracts from div with content class', () => {
    const html = '<html><body><div class="content"><p>This is the content</p></div></body></html>';
    const result = extractText(html);
    expect(result.text).toContain('This is the content');
});

test('Removes nav and footer elements', () => {
    const html = '<html><body><nav><a href="#">Nav Link</a></nav><article>Main content</article><footer>Copyright 2024</footer></body></html>';
    const result = extractText(html);
    expect(result.text).notToContain('Nav Link');
    expect(result.text).notToContain('Copyright');
});

test('Preserves paragraph structure', () => {
    const html = '<html><body><article><p>First paragraph</p><p>Second paragraph</p></article></body></html>';
    const result = extractText(html);
    expect(result.text).toContain('First paragraph');
    expect(result.text).toContain('Second paragraph');
});

test('Prioritizes semantic HTML over body fallback', () => {
    const html = '<html><body><nav>Lots of nav</nav><p>Random</p><article><p>Actual article</p></article><footer>Footer</footer></body></html>';
    const result = extractText(html);
    expect(result.text).toContain('Actual article');
});

// ============================================================================
// TEST SUITE: cleanText()
// ============================================================================

console.log('\n🧹 TEST SUITE: cleanText() - Text Normalization\n');

test('Normalizes multiple spaces to single space', () => {
    const dirty = 'Hello    world    how    are    you';
    const clean = cleanText(dirty, 1000);
    expect(clean).toContain('Hello world');
});

test('Normalizes line endings', () => {
    const dirty = 'Line 1\r\nLine 2\r\nLine 3';
    const clean = cleanText(dirty, 1000);
    expect(clean).toContain('Line 1\nLine 2\nLine 3');
});

test('Collapses multiple blank lines', () => {
    const dirty = 'Para 1\n\n\n\nPara 2';
    const clean = cleanText(dirty, 1000);
    expect(clean).toContain('Para 1\n\nPara 2');
});

test('Truncates text to maxLength', () => {
    const long = 'a'.repeat(5000);
    const clean = cleanText(long, 100);
    expect(clean.length).toBeLessThan(150);
});

test('Truncates at sentence boundary when possible', () => {
    const text = 'First sentence. Second sentence. Third sentence.';
    const clean = cleanText(text, 30);
    expect(clean).toContain('First sentence.');
});

test('Indicates truncation with marker', () => {
    const long = 'This is a very long text that definitely exceeds the maximum length allowed for truncation';
    const clean = cleanText(long, 20);
    expect(clean).toContain('[text truncated...]');
});

test('Trims leading/trailing whitespace', () => {
    const dirty = '   \n\n  Content here   \n\n  ';
    const clean = cleanText(dirty, 1000);
    // Should not start with whitespace
    if (/^\s/.test(clean)) {
        throw new Error('Expected no leading whitespace');
    }
    // Should not end with whitespace
    if (/\s$/.test(clean)) {
        throw new Error('Expected no trailing whitespace');
    }
});

test('Converts tabs to spaces', () => {
    const dirty = 'Line\twith\ttabs';
    const clean = cleanText(dirty, 1000);
    expect(clean).notToContain('\t');
    expect(clean).toContain('Line with tabs');
});

test('Respects maxLength parameter', () => {
    const text = 'a'.repeat(10000);
    const max = 5000;
    const clean = cleanText(text, max);
    expect(clean.length).toBeLessThan(max + 100);
});

// ============================================================================
// TEST SUITE: extractDomain()
// ============================================================================

console.log('\n🌐 TEST SUITE: extractDomain() - URL Parsing\n');

test('Extracts domain from full URL', () => {
    const url = 'https://www.example.com/path/to/page';
    const domain = extractDomain(url);
    expect(domain).toContain('example.com');
});

test('Removes www prefix from domain', () => {
    const url = 'https://www.google.com/search';
    const domain = extractDomain(url);
    expect(domain).toContain('google.com');
});

test('Handles domains without www', () => {
    const url = 'https://github.com/milwrite/javabot';
    const domain = extractDomain(url);
    expect(domain).toContain('github.com');
});

test('Extracts domain from URL with query params', () => {
    const url = 'https://example.com/page?query=test&id=123';
    const domain = extractDomain(url);
    expect(domain).toContain('example.com');
    expect(domain).notToContain('?');
});

test('Extracts domain from URL with port', () => {
    const url = 'https://localhost:3001/test';
    const domain = extractDomain(url);
    expect(domain).toContain('localhost');
});

test('Handles subdomains correctly', () => {
    const url = 'https://docs.github.com/en/api';
    const domain = extractDomain(url);
    expect(domain).toContain('docs.github.com');
});

// ============================================================================
// TEST SUITE: Configuration Constants
// ============================================================================

console.log('\n⚙️ TEST SUITE: Configuration Constants\n');

test('SCRAPE_TIMEOUT is 30 seconds', () => {
    expect(SCRAPE_TIMEOUT).toBe(30000);
});

test('MAX_CONTENT_LENGTH is 10000 characters', () => {
    expect(MAX_CONTENT_LENGTH).toBe(10000);
});

// ============================================================================
// Integration Test: Full extraction workflow
// ============================================================================

console.log('\n🔗 TEST SUITE: Integration - Full Workflow\n');

test('Complete workflow: complex HTML to clean text', () => {
    const complexHTML = '<html><head><title>Job Posting - Senior Engineer</title><script>alert("tracking");</script><style>body { color: red; }</style></head><body><nav><a href="/">Home</a><a href="/jobs">Jobs</a></nav><article><h1>Senior Software Engineer</h1><p>We are looking for an experienced engineer with 5+ years of experience.</p><p>Requirements include Python, AWS, and database design.</p><p>Responsibilities include leading team projects and mentoring junior developers.</p></article><footer><p>© 2024 Tech Company. All rights reserved.</p></footer></body></html>';

    const extracted = extractText(complexHTML);
    expect(extracted.title).toBe('Job Posting - Senior Engineer');
    expect(extracted.text).toContain('Senior Software Engineer');
    expect(extracted.text).toContain('5+ years');
    expect(extracted.text).notToContain('alert');
    expect(extracted.text).notToContain('Home');
    expect(extracted.text).notToContain('Copyright');

    const cleaned = cleanText(extracted.text, 10000);
    expect(cleaned).toContain('Senior Software Engineer');
    expect(cleaned).toContain('Python');
});

// ============================================================================
// RESULTS SUMMARY
// ============================================================================

console.log(`\n${'='.repeat(70)}`);
console.log(`✅ WEB SCRAPER TEST RESULTS`);
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
