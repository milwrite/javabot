// services/responseHealing.test.js
// Unit tests for response healing module
// Based on real production failures from PostgreSQL logs (bot-sportello Railway service)

const { healAndParseJSON } = require('./responseHealing');

// Test runner (no external dependencies)
let passed = 0;
let failed = 0;
const results = [];

function test(name, fn) {
    try {
        fn();
        passed++;
        results.push({ name, status: '✓', error: null });
    } catch (err) {
        failed++;
        results.push({ name, status: '✗', error: err.message });
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
        toBeNull() {
            if (actual !== null) {
                throw new Error(`Expected null, got ${JSON.stringify(actual)}`);
            }
        },
        toBeTruthy() {
            if (!actual) {
                throw new Error(`Expected truthy, got ${actual}`);
            }
        },
        toContain(item) {
            if (!actual.includes(item)) {
                throw new Error(`Expected array to contain ${item}, got ${JSON.stringify(actual)}`);
            }
        }
    };
}

// ═══════════════════════════════════════════════════════════════════════════
// REAL PRODUCTION FAILURES (from PostgreSQL bot_events table)
// ═══════════════════════════════════════════════════════════════════════════

console.log('\n═══ REAL PRODUCTION FAILURES ═══\n');

// 2026-01-03: "JSON parse error for read_file: Unexpected non-whitespace character
//              after JSON at position 32 (line 1 column 33)"
// Model: xiaomi/mimo-v2-flash
test('PROD: Extra content after valid JSON (mimo-v2-flash pattern)', () => {
    // Position 32 = end of {"path": "src/file.html"} + extra chars
    const input = '{"path": "src/file.html"}extra content here';
    const result = healAndParseJSON(input, { logHealing: false });
    expect(result.parsed).toEqual({ path: 'src/file.html' });
    expect(result.healed).toBe(true);
    expect(result.repairs).toContain('extracted_from_prose');
});

// 2025-12-31: "JSON parse error for write_file: Expected ',' or '}' after property
//              value in JSON at position 4700"
// Truncated large JSON payload
test('PROD: Truncated JSON with missing closing brace', () => {
    const input = '{"path": "src/game.html", "content": "<html>game content here"';
    const result = healAndParseJSON(input, { logHealing: false });
    expect(result.parsed).toEqual({ path: 'src/game.html', content: '<html>game content here' });
    expect(result.healed).toBe(true);
    expect(result.repairs).toContain('closed_braces');
});

// 2025-12-25: Path passed as stringified array (from tool_calls table)
// {"path": "[\"src/parlay_probability_viz.html\", \"src/parlay_probability_viz.js\"]"}
test('PROD: Stringified array in path field', () => {
    const input = '{"path": "[\\"src/file1.html\\", \\"src/file2.html\\"]"}';
    const result = healAndParseJSON(input, { logHealing: false });
    // This is valid JSON - the path is a string containing a JSON array
    // Healing should parse it directly (no healing needed)
    expect(result.parsed.path).toBe('["src/file1.html", "src/file2.html"]');
    expect(result.healed).toBe(false);
});

// 2025-12-31: Unicode tool call delimiters (Kimi K2 style)
// <｜tool▁calls▁begin｜><｜tool▁call▁begin｜>read_file<｜tool▁sep｜>{"path": "file.json"}
test('PROD: Unicode tool call delimiters (Kimi K2 style)', () => {
    const input = '<｜tool▁call▁begin｜>{"path": "projectmetadata.json"}<｜tool▁call▁end｜>';
    const result = healAndParseJSON(input, { logHealing: false });
    expect(result.parsed).toEqual({ path: 'projectmetadata.json' });
    expect(result.healed).toBe(true);
});

// ═══════════════════════════════════════════════════════════════════════════
// MARKDOWN WRAPPER PATTERNS
// ═══════════════════════════════════════════════════════════════════════════

console.log('\n═══ MARKDOWN WRAPPER PATTERNS ═══\n');

test('Markdown: json code block with newlines', () => {
    const input = '```json\n{"path": "src/game.html"}\n```';
    const result = healAndParseJSON(input, { logHealing: false });
    expect(result.parsed).toEqual({ path: 'src/game.html' });
    expect(result.repairs).toContain('stripped_markdown');
});

test('Markdown: json code block without newlines', () => {
    const input = '```json{"path": "test.html"}```';
    const result = healAndParseJSON(input, { logHealing: false });
    expect(result.parsed).toEqual({ path: 'test.html' });
});

test('Markdown: plain code block (no json tag)', () => {
    const input = '```\n{"tool": "read_file"}\n```';
    const result = healAndParseJSON(input, { logHealing: false });
    expect(result.parsed).toEqual({ tool: 'read_file' });
});

test('Markdown: nested in prose with explanation', () => {
    const input = 'Here is the JSON you requested:\n```json\n{"action": "edit"}\n```\nLet me know if you need changes.';
    const result = healAndParseJSON(input, { logHealing: false });
    expect(result.parsed).toEqual({ action: 'edit' });
});

// ═══════════════════════════════════════════════════════════════════════════
// STRUCTURAL REPAIRS
// ═══════════════════════════════════════════════════════════════════════════

console.log('\n═══ STRUCTURAL REPAIRS ═══\n');

test('Structure: trailing comma in object', () => {
    const input = '{"path": "src/game.html", "action": "read",}';
    const result = healAndParseJSON(input, { logHealing: false });
    expect(result.parsed).toEqual({ path: 'src/game.html', action: 'read' });
    expect(result.repairs).toContain('removed_trailing_comma');
});

test('Structure: trailing comma in array', () => {
    const input = '{"files": ["a.html", "b.html",]}';
    const result = healAndParseJSON(input, { logHealing: false });
    expect(result.parsed).toEqual({ files: ['a.html', 'b.html'] });
});

test('Structure: multiple missing closing braces', () => {
    const input = '{"outer": {"inner": {"deep": "value"';
    const result = healAndParseJSON(input, { logHealing: false });
    expect(result.parsed).toEqual({ outer: { inner: { deep: 'value' } } });
    expect(result.repairs).toContain('closed_braces');
});

test('Structure: missing closing bracket in array', () => {
    const input = '{"items": ["one", "two", "three"';
    const result = healAndParseJSON(input, { logHealing: false });
    expect(result.parsed).toEqual({ items: ['one', 'two', 'three'] });
    expect(result.repairs).toContain('closed_brackets');
});

test('Structure: missing comma between properties', () => {
    const input = '{"path": "file.html" "content": "test"}';
    const result = healAndParseJSON(input, { logHealing: false });
    expect(result.parsed).toEqual({ path: 'file.html', content: 'test' });
    expect(result.repairs).toContain('added_missing_comma');
});

// ═══════════════════════════════════════════════════════════════════════════
// QUOTE NORMALIZATION
// ═══════════════════════════════════════════════════════════════════════════

console.log('\n═══ QUOTE NORMALIZATION ═══\n');

test('Quotes: smart/curly double quotes', () => {
    // Using actual Unicode smart quotes: U+201C (") and U+201D (")
    const input = '{\u201Cpath\u201D: \u201Csrc/game.html\u201D}';
    const result = healAndParseJSON(input, { logHealing: false });
    expect(result.parsed).toEqual({ path: 'src/game.html' });
    expect(result.repairs).toContain('normalized_smart_quotes');
});

test('Quotes: unquoted keys (JavaScript style)', () => {
    const input = '{path: "src/game.html", action: "read"}';
    const result = healAndParseJSON(input, { logHealing: false });
    expect(result.parsed).toEqual({ path: 'src/game.html', action: 'read' });
    expect(result.repairs).toContain('quoted_unquoted_keys');
});

test('Quotes: single quote strings', () => {
    const input = "{'path': 'src/game.html'}";
    const result = healAndParseJSON(input, { logHealing: false });
    expect(result.parsed).toEqual({ path: 'src/game.html' });
    expect(result.repairs).toContain('converted_single_quotes');
});

test('Quotes: mixed quote styles', () => {
    const input = '{path: "value", \'other\': "test"}';
    const result = healAndParseJSON(input, { logHealing: false });
    expect(result.parsed.path).toBe('value');
    expect(result.parsed.other).toBe('test');
});

// ═══════════════════════════════════════════════════════════════════════════
// PYTHON-STYLE VALUES
// ═══════════════════════════════════════════════════════════════════════════

console.log('\n═══ PYTHON-STYLE VALUES ═══\n');

test('Python: True -> true', () => {
    const input = '{"enabled": True}';
    const result = healAndParseJSON(input, { logHealing: false });
    expect(result.parsed).toEqual({ enabled: true });
    expect(result.repairs).toContain('py_true');
});

test('Python: False -> false', () => {
    const input = '{"disabled": False}';
    const result = healAndParseJSON(input, { logHealing: false });
    expect(result.parsed).toEqual({ disabled: false });
    expect(result.repairs).toContain('py_false');
});

test('Python: None -> null', () => {
    const input = '{"value": None}';
    const result = healAndParseJSON(input, { logHealing: false });
    expect(result.parsed).toEqual({ value: null });
    expect(result.repairs).toContain('py_none');
});

test('Python: mixed Python values', () => {
    const input = '{"a": True, "b": False, "c": None}';
    const result = healAndParseJSON(input, { logHealing: false });
    expect(result.parsed).toEqual({ a: true, b: false, c: null });
});

// ═══════════════════════════════════════════════════════════════════════════
// PROSE EXTRACTION
// ═══════════════════════════════════════════════════════════════════════════

console.log('\n═══ PROSE EXTRACTION ═══\n');

test('Prose: JSON after explanation', () => {
    const input = 'I will read the file for you: {"path": "src/game.html"}';
    const result = healAndParseJSON(input, { logHealing: false });
    expect(result.parsed).toEqual({ path: 'src/game.html' });
    expect(result.repairs).toContain('extracted_from_prose');
});

test('Prose: JSON with trailing explanation', () => {
    const input = '{"path": "test.html"} - this will read the file';
    const result = healAndParseJSON(input, { logHealing: false });
    expect(result.parsed).toEqual({ path: 'test.html' });
});

test('Prose: JSON embedded in paragraph', () => {
    const input = 'The arguments are {"tool": "write_file", "path": "x.html"} as specified.';
    const result = healAndParseJSON(input, { logHealing: false });
    expect(result.parsed).toEqual({ tool: 'write_file', path: 'x.html' });
});

// ═══════════════════════════════════════════════════════════════════════════
// EDGE CASES & FAST PATH
// ═══════════════════════════════════════════════════════════════════════════

console.log('\n═══ EDGE CASES & FAST PATH ═══\n');

test('Fast path: valid JSON (no healing needed)', () => {
    const input = '{"path": "src/game.html", "content": "test"}';
    const result = healAndParseJSON(input, { logHealing: false });
    expect(result.parsed).toEqual({ path: 'src/game.html', content: 'test' });
    expect(result.healed).toBe(false);
    expect(result.repairs.length).toBe(0);
});

test('Edge: empty string -> empty object', () => {
    const input = '';
    const result = healAndParseJSON(input, { logHealing: false });
    expect(result.parsed).toEqual({});
    expect(result.healed).toBe(false);
});

test('Edge: null input -> empty object', () => {
    const result = healAndParseJSON(null, { logHealing: false });
    expect(result.parsed).toEqual({});
});

test('Edge: undefined input -> empty object', () => {
    const result = healAndParseJSON(undefined, { logHealing: false });
    expect(result.parsed).toEqual({});
});

test('Edge: whitespace only -> empty object', () => {
    const input = '   \n\t  ';
    const result = healAndParseJSON(input, { logHealing: false });
    // Empty string after trim defaults to '{}'
    expect(result.parsed).toEqual({});
});

test('Edge: truly unparseable content', () => {
    const input = 'this is not json at all and has no braces';
    const result = healAndParseJSON(input, { logHealing: false });
    expect(result.parsed).toBeNull();
    expect(result.error).toBeTruthy();
});

test('Edge: nested objects with arrays', () => {
    const input = '{"files": [{"name": "a.html"}, {"name": "b.html"}], "count": 2';
    const result = healAndParseJSON(input, { logHealing: false });
    expect(result.parsed.files.length).toBe(2);
    expect(result.parsed.count).toBe(2);
});

// ═══════════════════════════════════════════════════════════════════════════
// COMBINED REPAIRS (multiple issues in one input)
// ═══════════════════════════════════════════════════════════════════════════

console.log('\n═══ COMBINED REPAIRS ═══\n');

test('Combined: markdown + trailing comma + unquoted keys', () => {
    const input = '```json\n{path: "test.html", action: "read",}\n```';
    const result = healAndParseJSON(input, { logHealing: false });
    expect(result.parsed).toEqual({ path: 'test.html', action: 'read' });
    expect(result.repairs).toContain('stripped_markdown');
    expect(result.repairs).toContain('quoted_unquoted_keys');
    expect(result.repairs).toContain('removed_trailing_comma');
});

test('Combined: prose + Python bools + missing brace', () => {
    const input = 'Here it is: {"enabled": True, "disabled": False';
    const result = healAndParseJSON(input, { logHealing: false });
    expect(result.parsed).toEqual({ enabled: true, disabled: false });
    expect(result.repairs).toContain('extracted_from_prose');
    expect(result.repairs).toContain('py_true');
    expect(result.repairs).toContain('closed_braces');
});

test('Combined: smart quotes + trailing content', () => {
    const input = '{"path": "file.html"} done';
    const result = healAndParseJSON(input, { logHealing: false });
    expect(result.parsed).toEqual({ path: 'file.html' });
});

// ═══════════════════════════════════════════════════════════════════════════
// TOOL-SPECIFIC PATTERNS
// ═══════════════════════════════════════════════════════════════════════════

console.log('\n═══ TOOL-SPECIFIC PATTERNS ═══\n');

test('Tool: read_file with simple path', () => {
    const input = '{"path": "src/noir-simon.html"}';
    const result = healAndParseJSON(input, { logHealing: false });
    expect(result.parsed.path).toBe('src/noir-simon.html');
});

test('Tool: edit_file with replacements array', () => {
    const input = `{"path": "src/file.html", "replacements": [{"old": "He", "new": "She", "replace_all": True}]}`;
    const result = healAndParseJSON(input, { logHealing: false });
    expect(result.parsed.replacements[0].replace_all).toBe(true);
});

test('Tool: write_file with multiline content (truncated)', () => {
    const input = '{"path": "src/new-game.html", "content": "<!DOCTYPE html>\\n<html>\\n<head>\\n<title>Game</title>\\n</head>\\n<body>"';
    const result = healAndParseJSON(input, { logHealing: false });
    expect(result.parsed.path).toBe('src/new-game.html');
    expect(result.parsed.content).toContain('<!DOCTYPE html>');
});

test('Tool: search_files with case_insensitive', () => {
    const input = '{pattern: "game", path: "src", case_insensitive: True}';
    const result = healAndParseJSON(input, { logHealing: false });
    expect(result.parsed.pattern).toBe('game');
    expect(result.parsed.case_insensitive).toBe(true);
});

// ═══════════════════════════════════════════════════════════════════════════
// PRINT RESULTS
// ═══════════════════════════════════════════════════════════════════════════

console.log('\n═══════════════════════════════════════════════════════════════');
console.log('TEST RESULTS');
console.log('═══════════════════════════════════════════════════════════════\n');

results.forEach(r => {
    if (r.status === '✗') {
        console.log(`${r.status} ${r.name}`);
        console.log(`  └─ ${r.error}\n`);
    } else {
        console.log(`${r.status} ${r.name}`);
    }
});

console.log(`\n───────────────────────────────────────────────────────────────`);
console.log(`TOTAL: ${passed + failed} tests | ${passed} passed | ${failed} failed`);
console.log(`───────────────────────────────────────────────────────────────\n`);

// Exit with error code if any tests failed
if (failed > 0) {
    process.exit(1);
}
