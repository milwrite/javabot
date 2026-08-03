const fs = require('fs');
const path = require('path');
const vm = require('vm');
const cheerio = require('cheerio');
const {
    REGISTRY_PATH,
    classifyTheme,
    serializeRegistry
} = require('../services/researchArchive');

const repoRoot = path.resolve(__dirname, '..');
const searchDir = path.join(repoRoot, 'src/search');
const indexPath = path.join(searchDir, 'index.html');

function readEmbeddedRegistry(indexHtml) {
    const match = indexHtml.match(/const STATIC_REPORTS = (\[[\s\S]*?\n\s*\]);/);
    if (!match) throw new Error('Could not find STATIC_REPORTS in research archive');
    return vm.runInNewContext(match[1]);
}

function getDate($, filename, fallback) {
    const meta = $('.meta').first().text();
    const researched = meta.match(/researched\s+([A-Za-z]{3}\s+\d{1,2},\s+\d{4})/i)?.[1];
    if (researched) {
        const parsed = new Date(`${researched} 12:00:00`);
        if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);
    }
    const fullDate = filename.match(/(20\d{2})-(\d{2})-(\d{2})/)?.[0];
    if (fullDate) return fullDate;
    const month = filename.match(/(20\d{2}-\d{2})/)?.[1];
    return fallback || (month ? `${month}-01` : new Date().toISOString().slice(0, 10));
}

function getFormat($, filename, fallback) {
    if (fallback) return fallback;
    if (filename.includes('lit-review') || /literature review/i.test($('h1').first().text())) return 'lit-review';
    if (filename.includes('taxonomy')) return 'taxonomy';
    return 'review';
}

function inspectReport(filename, existing) {
    const html = fs.readFileSync(path.join(searchDir, filename), 'utf8');
    const $ = cheerio.load(html);
    const title = existing?.title || $('h1').first().text().trim() || $('title').text().trim() || filename;
    const date = getDate($, filename, existing?.date);
    return {
        title,
        file: filename,
        date,
        publishedAt: existing?.publishedAt || `${date}T12:00:00.000Z`,
        format: getFormat($, filename, existing?.format),
        theme: existing?.theme || classifyTheme(title),
        citationStyle: existing?.citationStyle || 'chicago',
        citationCount: existing?.citationCount ?? $('[id^="ref-"]').length
    };
}

function buildRegistry() {
    const indexHtml = fs.readFileSync(indexPath, 'utf8');
    const embedded = readEmbeddedRegistry(indexHtml);
    const existingByFile = new Map(embedded.map(entry => [entry.file, entry]));
    return fs.readdirSync(searchDir)
        .filter(name => name.endsWith('.html') && name !== 'index.html')
        .map(filename => inspectReport(filename, existingByFile.get(filename)))
        .sort((a, b) => String(b.publishedAt).localeCompare(String(a.publishedAt)) || a.title.localeCompare(b.title));
}

const registry = buildRegistry();
fs.writeFileSync(path.join(repoRoot, REGISTRY_PATH), serializeRegistry(registry));
console.log(`Wrote ${registry.length} Deep Research reports to ${REGISTRY_PATH}`);

module.exports = { buildRegistry };
