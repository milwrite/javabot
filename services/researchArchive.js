const path = require('path');

const REGISTRY_PATH = 'src/search/reports.json';
const DEFAULT_ARCHIVE_URL = 'https://bot.inference-arcade.com/src/search/index.html';

const THEME_RULES = [
    ['museums-culture', /museum|library|archive|theatre|theater|arts?|culture|dance|performance/i],
    ['academic', /scholar|academic|university|college|dissertation|literature|research|reddit|education/i],
    ['ai-ml', /\bai\b|artificial intelligence|machine learning|language model|dataset|software|technology|digital/i],
    ['job-search', /\bjob|career|employment|hiring|position|fellowship|application/i],
    ['sports', /sport|basketball|baseball|football|hockey|odds|betting|lakers|knicks/i],
    ['education-history', /history|historical|school|pedagogy|learning/i]
];

function classifyTheme(title) {
    return THEME_RULES.find(([, pattern]) => pattern.test(title))?.[0] || 'other';
}

function parseRegistry(content) {
    if (!content) return [];
    const parsed = JSON.parse(content);
    if (!Array.isArray(parsed)) throw new Error('Deep Research registry must contain a JSON array');
    return parsed.filter(entry => entry && entry.file && entry.title);
}

function buildRegistryEntry({ query, reportPath, result, publishedAt = new Date() }) {
    const date = publishedAt instanceof Date ? publishedAt : new Date(publishedAt);
    if (Number.isNaN(date.getTime())) throw new Error('Invalid Deep Research publication date');

    return {
        title: query.split(/[.!?]/)[0].trim().slice(0, 180) || 'Untitled Deep Research',
        file: path.posix.basename(reportPath),
        date: date.toISOString().slice(0, 10),
        publishedAt: date.toISOString(),
        format: result.format || 'review',
        theme: classifyTheme(query),
        citationStyle: result.citationStyle || 'chicago',
        citationCount: result.citations?.length || 0
    };
}

function upsertRegistry(registry, entry) {
    const byFile = new Map(registry.map(item => [item.file, item]));
    byFile.set(entry.file, entry);
    return [...byFile.values()].sort((a, b) => {
        const dateOrder = String(b.publishedAt || b.date).localeCompare(String(a.publishedAt || a.date));
        return dateOrder || a.title.localeCompare(b.title);
    });
}

function serializeRegistry(registry) {
    return `${JSON.stringify(registry, null, 2)}\n`;
}

module.exports = {
    REGISTRY_PATH,
    DEFAULT_ARCHIVE_URL,
    classifyTheme,
    parseRegistry,
    buildRegistryEntry,
    upsertRegistry,
    serializeRegistry
};
