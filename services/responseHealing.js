// services/responseHealing.js
// Client-side JSON healing for malformed LLM tool arguments
// Mirrors OpenRouter's response-healing plugin behavior

/**
 * Heal and parse potentially malformed JSON
 * @param {string} jsonString - Potentially malformed JSON
 * @param {object} options - { logHealing: bool, logger: fn }
 * @returns {{ parsed: object|null, healed: bool, repairs: string[], error?: string }}
 */
function healAndParseJSON(jsonString, options = {}) {
    const { logHealing = true, logger = console.log } = options;

    // Handle null/undefined/empty/whitespace-only input
    const original = (jsonString || '').trim();
    if (!original) {
        return { parsed: {}, healed: false, repairs: [] };
    }

    // Fast path: try direct parse first
    try {
        return { parsed: JSON.parse(original), healed: false, repairs: [] };
    } catch (e) { /* needs healing */ }

    let str = original;
    const repairs = [];

    try {
        // Phase 1: Strip wrappers (markdown, prose)
        str = stripWrappers(str, repairs);
        // Phase 2: Fix structural issues (commas, brackets)
        str = repairStructure(str, repairs);
        // Phase 3: Normalize quotes (smart quotes, unquoted keys)
        str = normalizeQuotes(str, repairs);
        // Phase 4: Final cleanup (Python booleans, trim)
        str = finalCleanup(str, repairs);

        const parsed = JSON.parse(str);
        if (logHealing && repairs.length) {
            logger(`[RESPONSE_HEALING] Applied: ${repairs.join(', ')}`);
        }
        return { parsed, healed: true, repairs };
    } catch (err) {
        return { parsed: null, healed: false, repairs, error: err.message };
    }
}

/**
 * Phase 1: Strip wrapper artifacts (markdown, JSONP, prose)
 */
function stripWrappers(str, repairs) {
    // Remove markdown code blocks: ```json ... ``` or ``` ... ```
    if (/```(?:json)?\s*\n?/.test(str)) {
        str = str.replace(/```json\s*\n?/gi, '').replace(/```\s*\n?/g, '').trim();
        repairs.push('stripped_markdown');
    }

    // Remove JSONP wrapper: callback({...}) -> {...}
    const jsonpMatch = str.match(/^\s*\w+\s*\(\s*([\s\S]*)\s*\)\s*;?\s*$/);
    if (jsonpMatch) {
        str = jsonpMatch[1].trim();
        repairs.push('stripped_jsonp');
    }

    // Remove Unicode tool call delimiters (Kimi K2 style)
    // <｜tool▁call▁begin｜>{...}<｜tool▁call▁end｜>
    if (str.includes('｜') || str.includes('▁')) {
        str = str.replace(/<[｜\w▁]+>/g, '').trim();
        repairs.push('stripped_unicode_delimiters');
    }

    // Extract JSON from prose - find the JSON object boundaries
    // This handles both leading prose and trailing content
    const jsonStart = str.indexOf('{');
    const arrayStart = str.indexOf('[');
    const start = jsonStart === -1 ? arrayStart : (arrayStart === -1 ? jsonStart : Math.min(jsonStart, arrayStart));

    if (start !== -1) {
        // Find matching closing bracket/brace using a simple counter
        const openChar = str[start];
        let depth = 0;
        let end = -1;
        let inString = false;
        let escapeNext = false;

        for (let i = start; i < str.length; i++) {
            const c = str[i];

            if (escapeNext) {
                escapeNext = false;
                continue;
            }

            if (c === '\\' && inString) {
                escapeNext = true;
                continue;
            }

            if (c === '"' && !escapeNext) {
                inString = !inString;
                continue;
            }

            if (!inString) {
                if (c === '{' || c === '[') depth++;
                else if (c === '}' || c === ']') {
                    depth--;
                    if (depth === 0) {
                        end = i;
                        break;
                    }
                }
            }
        }

        // If we found a complete JSON structure, extract it
        if (end !== -1 && (start > 0 || end < str.length - 1)) {
            str = str.slice(start, end + 1);
            repairs.push('extracted_from_prose');
        }
        // If JSON is incomplete (no matching close), still extract from start
        // The structure repair phase will close missing brackets
        else if (end === -1 && start > 0) {
            str = str.slice(start);
            repairs.push('extracted_from_prose');
        }
    }

    return str;
}

/**
 * Phase 2: Structural repairs (commas, brackets)
 */
function repairStructure(str, repairs) {
    // Remove trailing commas: {"a": 1,} -> {"a": 1}
    if (/,(\s*[}\]])/.test(str)) {
        str = str.replace(/,(\s*[}\]])/g, '$1');
        repairs.push('removed_trailing_comma');
    }

    // Add missing commas between elements: {"a":1 "b":2} -> {"a":1, "b":2}
    const missingCommaPattern = /("|\d|true|false|null)(\s+)"/g;
    if (missingCommaPattern.test(str)) {
        str = str.replace(/("|\d|true|false|null)(\s+)"/g, '$1,$2"');
        repairs.push('added_missing_comma');
    }

    // Count unclosed brackets and braces
    const openBraces = (str.match(/{/g) || []).length;
    const closeBraces = (str.match(/}/g) || []).length;
    const openBrackets = (str.match(/\[/g) || []).length;
    const closeBrackets = (str.match(/\]/g) || []).length;

    // Close brackets FIRST (arrays inside objects need ] before })
    if (openBrackets > closeBrackets) {
        str += ']'.repeat(openBrackets - closeBrackets);
        repairs.push('closed_brackets');
    }

    // Then close braces
    if (openBraces > closeBraces) {
        str += '}'.repeat(openBraces - closeBraces);
        repairs.push('closed_braces');
    }

    return str;
}

/**
 * Phase 3: Quote normalization
 */
function normalizeQuotes(str, repairs) {
    // Smart/curly quotes -> straight quotes (various Unicode quote chars)
    // " " (U+201C, U+201D) -> "
    // ' ' (U+2018, U+2019) -> '
    // „ (U+201E) -> "
    // ‚ (U+201A) -> '
    const smartQuotePattern = /[\u201C\u201D\u201E\u201F\u2033\u2036""]/g;
    const smartSinglePattern = /[\u2018\u2019\u201A\u201B\u2032\u2035'']/g;

    if (smartQuotePattern.test(str) || smartSinglePattern.test(str)) {
        str = str.replace(smartQuotePattern, '"').replace(smartSinglePattern, "'");
        repairs.push('normalized_smart_quotes');
    }

    // Single quotes -> double quotes for string values
    // This handles {'key': 'value'} -> {"key": "value"}
    // Be careful not to break apostrophes in words
    const singleQuoteStringPattern = /'([^'\\]*(?:\\.[^'\\]*)*)'/g;
    if (singleQuoteStringPattern.test(str) && str.includes("'")) {
        str = str.replace(/'([^'\\]*(?:\\.[^'\\]*)*)'/g, '"$1"');
        repairs.push('converted_single_quotes');
    }

    // Unquoted keys: {path: "a"} -> {"path": "a"}
    if (/[{,]\s*[a-zA-Z_][a-zA-Z0-9_]*\s*:/.test(str)) {
        str = str.replace(/([{,]\s*)([a-zA-Z_][a-zA-Z0-9_]*)(\s*:)/g, '$1"$2"$3');
        repairs.push('quoted_unquoted_keys');
    }

    return str;
}

/**
 * Phase 4: Final cleanup
 */
function finalCleanup(str, repairs) {
    // Python booleans/None -> JSON equivalents
    if (/\bNone\b/.test(str)) {
        str = str.replace(/\bNone\b/g, 'null');
        repairs.push('py_none');
    }
    if (/\bTrue\b/.test(str)) {
        str = str.replace(/\bTrue\b/g, 'true');
        repairs.push('py_true');
    }
    if (/\bFalse\b/.test(str)) {
        str = str.replace(/\bFalse\b/g, 'false');
        repairs.push('py_false');
    }

    // Remove comments (// and /* */)
    const commentPattern = /\/\/[^\n]*|\/\*[\s\S]*?\*\//g;
    if (commentPattern.test(str)) {
        str = str.replace(commentPattern, '');
        repairs.push('removed_comments');
    }

    return str.trim();
}

module.exports = { healAndParseJSON };
