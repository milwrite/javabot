/**
 * Deep Research Service
 * Uses Perplexity Sonar Deep Research via OpenRouter for comprehensive research with citations
 */

const axios = require('axios');
const { EmbedBuilder } = require('discord.js');

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const DEEP_RESEARCH_MODEL = 'perplexity/sonar-deep-research';
const DEEP_RESEARCH_TIMEOUT = 180000; // 3 minutes

/**
 * Execute deep research query via Perplexity Sonar Deep Research
 * @param {string} query - Research query
 * @param {object} options - Optional configuration
 * @param {Function} options.onProgress - Progress callback for long-running queries
 * @returns {object} - { content: string, citations: array, usage: object }
 */
async function deepResearch(query, options = {}) {
    const { onProgress } = options;

    // Set up progress interval (every 30 seconds)
    let progressInterval = null;
    let elapsedSeconds = 0;

    if (onProgress) {
        progressInterval = setInterval(() => {
            elapsedSeconds += 30;
            onProgress(`still researching... (${elapsedSeconds}s elapsed)`);
        }, 30000);
    }

    try {
        const response = await axios.post(OPENROUTER_URL, {
            model: DEEP_RESEARCH_MODEL,
            messages: [{
                role: 'user',
                content: `Research the following topic comprehensively. Provide detailed analysis with sources and citations:\n\n${query}`
            }],
            max_tokens: 8000,
            temperature: 0.3,
            provider: { data_collection: 'deny' } // ZDR enforcement
        }, {
            headers: {
                'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
                'Content-Type': 'application/json',
                'HTTP-Referer': 'https://github.com/milwrite/javabot',
                'X-Title': 'Bot Sportello Deep Research'
            },
            timeout: DEEP_RESEARCH_TIMEOUT
        });

        // Clear progress interval
        if (progressInterval) clearInterval(progressInterval);

        const message = response.data.choices[0].message;

        // Perplexity returns citations in response.data.citations as an array of URLs
        // These correspond to [1], [2], etc. in the text (1-indexed)
        let apiCitations = response.data.citations || [];
        console.log(`[DEEP_RESEARCH] API returned ${apiCitations.length} citations`);

        // Fallback: if no API citations, try extracting URLs from content
        if (apiCitations.length === 0) {
            console.log('[DEEP_RESEARCH] No API citations, extracting from content...');
            const extracted = extractCitations(message.content);
            apiCitations = extracted.citations;
            console.log(`[DEEP_RESEARCH] Extracted ${apiCitations.length} URLs from content`);
        }

        // Build citation map: [1] -> first URL, [2] -> second URL, etc.
        const citationMap = {};
        apiCitations.forEach((url, index) => {
            citationMap[index + 1] = url; // 1-indexed to match [1], [2], etc.
        });

        // Clean up the content
        const cleanContent = message.content
            .replace(/\n{4,}/g, '\n\n\n')
            .trim();

        console.log(`[DEEP_RESEARCH] Built citationMap with ${Object.keys(citationMap).length} entries`);

        return {
            content: cleanContent,
            citations: apiCitations,
            citationMap: citationMap,
            usage: response.data.usage
        };
    } catch (error) {
        if (progressInterval) clearInterval(progressInterval);
        throw error;
    }
}

/**
 * Extract citations from Perplexity response
 * Perplexity uses bracket notation [1][2][3] with URLs at end
 * @param {string} content - Response content
 * @returns {object} - { cleanContent: string, citations: array, citationMap: object }
 */
function extractCitations(content) {
    const urlPattern = /https?:\/\/[^\s\]\)]+/g;
    const citations = [];

    // Extract unique URLs as citations
    let match;
    while ((match = urlPattern.exec(content)) !== null) {
        // Clean trailing punctuation from URLs
        let url = match[0].replace(/[.,;:!?\)]+$/, '');
        if (!citations.includes(url)) {
            citations.push(url);
        }
    }

    // Build citation map: bracket number [n] -> nth URL (1-indexed)
    // Perplexity uses sequential numbering: [1] = 1st URL, [2] = 2nd URL, etc.
    const citationMap = {};
    citations.forEach((url, index) => {
        citationMap[index + 1] = url; // [1] -> citations[0], [2] -> citations[1], etc.
    });

    // Keep content as-is (Perplexity formats it well)
    let cleanContent = content
        .replace(/\n{4,}/g, '\n\n\n') // Normalize excessive line breaks
        .trim();

    return { cleanContent, citations, citationMap };
}

/**
 * Format deep research results for Discord embed
 * @param {object} result - Raw result from deepResearch()
 * @param {string} query - Original query
 * @returns {object} - { embed: EmbedBuilder, fullText: string }
 */
function formatForDiscord(result, query) {
    const maxDescLength = 3500; // Leave room for sources field
    let description = result.content;
    let wasTruncated = false;

    if (description.length > maxDescLength) {
        description = description.substring(0, maxDescLength) + '...';
        wasTruncated = true;
    }

    const embed = new EmbedBuilder()
        .setTitle(`Deep Research: ${query.substring(0, 80)}${query.length > 80 ? '...' : ''}`)
        .setDescription(description)
        .setColor(0x7B68EE) // Medium purple for research
        .setTimestamp();

    // Add sources field (up to 10 citations)
    if (result.citations && result.citations.length > 0) {
        const citationsText = result.citations
            .slice(0, 10)
            .map((c, i) => `**[${i + 1}]** ${c.substring(0, 80)}${c.length > 80 ? '...' : ''}`)
            .join('\n');

        embed.addFields({
            name: `Sources (${result.citations.length} found)`,
            value: citationsText.substring(0, 1024), // Field value max
            inline: false
        });
    }

    // Add truncation notice if needed
    if (wasTruncated) {
        embed.addFields({
            name: 'Note',
            value: 'Response truncated. Full report saved to file.',
            inline: true
        });
    }

    return {
        embed,
        fullText: result.content
    };
}

/**
 * Generate a meaningful slug from query for filename
 * Extracts key topic words and adds date for uniqueness
 * @param {string} query - Research query
 * @returns {string} - URL-safe slug like "theatre-jobs-museums-2025-12"
 */
function generateSlug(query) {
    // Common stop words to filter out
    const stopWords = new Set([
        'a', 'an', 'the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
        'of', 'with', 'by', 'from', 'as', 'is', 'was', 'are', 'were', 'been',
        'be', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would',
        'could', 'should', 'may', 'might', 'must', 'shall', 'can', 'need',
        'that', 'this', 'these', 'those', 'what', 'which', 'who', 'whom',
        'how', 'when', 'where', 'why', 'all', 'each', 'every', 'both',
        'few', 'more', 'most', 'other', 'some', 'such', 'only', 'own',
        'same', 'so', 'than', 'too', 'very', 'just', 'also', 'now',
        'search', 'find', 'look', 'looking', 'searching', 'research',
        'about', 'into', 'through', 'during', 'before', 'after', 'above',
        'below', 'between', 'under', 'again', 'further', 'then', 'once',
        'include', 'including', 'included', 'primarily', 'properly', 'formatted'
    ]);

    // Extract meaningful words
    const words = query
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter(word => word.length > 2 && !stopWords.has(word));

    // Take first 4-5 meaningful words
    const keyWords = words.slice(0, 5).join('-');

    // Add date suffix for uniqueness
    const now = new Date();
    const dateSuffix = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

    // Combine and ensure reasonable length
    const slug = `${keyWords}-${dateSuffix}`.substring(0, 60).replace(/-+$/, '');

    return slug || `research-${dateSuffix}`;
}

/**
 * Convert markdown-ish content to HTML with Chicago-style citations
 * @param {string} content - Raw content with markdown and [n] citations
 * @param {object} citationMap - Map of citation numbers to URLs
 * @returns {string} - HTML formatted content with superscript citation links
 */
function contentToHTML(content, citationMap = {}) {
    // First, convert bracket citations [1][2] to Chicago-style superscripts
    // Groups consecutive citations and links them to references section
    let processed = content;

    // Handle consecutive citations like [1][2][3] - combine into single superscript group
    processed = processed.replace(/(\[\d+\])+/g, (match) => {
        const nums = match.match(/\d+/g);
        if (!nums) return match;

        const links = nums.map(num => {
            const n = parseInt(num);
            if (citationMap[n]) {
                return `<a href="#ref-${n}" id="cite-${n}">${n}</a>`;
            }
            return num;
        });

        return `<sup class="citation">${links.join(',')}</sup>`;
    });

    // Now convert markdown formatting
    return processed
        .replace(/^### (.+)$/gm, '<h3>$1</h3>')
        .replace(/^## (.+)$/gm, '<h2>$1</h2>')
        .replace(/^# (.+)$/gm, '<h1>$1</h1>')
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(.+?)\*/g, '<em>$1</em>')
        .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank">$1</a>')
        .split(/\n\n+/)
        .map(p => p.trim())
        .filter(p => p)
        .map(p => p.startsWith('<h') ? p : `<p>${p.replace(/\n/g, '<br>')}</p>`)
        .join('\n');
}

/**
 * Extract domain name from URL for display
 * @param {string} url - Full URL
 * @returns {string} - Clean domain name
 */
function extractDomain(url) {
    try {
        const domain = new URL(url).hostname.replace(/^www\./, '');
        return domain;
    } catch {
        return url.split('/')[2] || url;
    }
}

/**
 * Format a URL as Chicago-style citation
 * Chicago style for websites: "Page Title." Website Name. Accessed Month Day, Year. URL.
 * Since we don't have page titles, we use domain as identifier
 * @param {number} num - Citation number
 * @param {string} url - Source URL
 * @returns {string} - Chicago-formatted HTML citation with back-link
 */
function formatChicagoCitation(num, url) {
    const domain = extractDomain(url);
    const accessDate = new Date().toLocaleDateString('en-US', {
        month: 'long',
        day: 'numeric',
        year: 'numeric'
    });

    // Chicago style with back-link to in-text citation
    return `<li id="ref-${num}">
        <a href="#cite-${num}" class="back-ref" title="Back to text">↩</a>
        <span class="cite-num">${num}.</span>
        "${domain}." Accessed ${accessDate}.
        <a href="${url}" target="_blank" rel="noopener">${url}</a>
    </li>`;
}

/**
 * Generate a readable title from the query
 * @param {string} query - Original research query
 * @returns {string} - Clean, readable title
 */
function generateTitle(query) {
    // Take first sentence or first 80 chars, whichever is shorter
    let title = query.split(/[.!?]/)[0].trim();
    if (title.length > 80) {
        title = title.substring(0, 77) + '...';
    }
    // Capitalize first letter
    return title.charAt(0).toUpperCase() + title.slice(1);
}

/**
 * Generate HTML report page with Chicago-style citations
 * @param {object} result - Result from deepResearch() with content, citations, citationMap
 * @param {string} query - Original query
 * @returns {object} - { html: string, slug: string, filename: string }
 */
function generateReportHTML(result, query) {
    const slug = generateSlug(query);
    const title = generateTitle(query);
    const displayDate = new Date().toLocaleDateString('en-US', {
        year: 'numeric', month: 'short', day: 'numeric'
    });

    // Build citation map if not provided (for backwards compatibility)
    const citationMap = result.citationMap || {};

    // Generate Chicago-style references section
    let referencesHTML = '';
    const citationNumbers = Object.keys(citationMap).map(Number).sort((a, b) => a - b);

    if (citationNumbers.length > 0) {
        const citationItems = citationNumbers
            .map(num => formatChicagoCitation(num, citationMap[num]))
            .join('\n');

        referencesHTML = `
    <section class="references" id="references">
        <h2>References</h2>
        <ol>
            ${citationItems}
        </ol>
    </section>`;
    }

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${title}</title>
    <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body {
            font-family: 'Courier New', monospace;
            background: #111;
            color: #999;
            line-height: 1.6;
            padding: 40px 20px 60px;
            max-width: 680px;
            margin: 0 auto;
        }
        a { color: #888; }
        a:hover { color: #ccc; }
        .back { display: inline-block; margin-bottom: 30px; font-size: 13px; text-decoration: none; }
        .back:before { content: '← '; }
        header { margin-bottom: 40px; padding-bottom: 20px; border-bottom: 1px solid #333; }
        header h1 { color: #ccc; font-size: 20px; font-weight: normal; margin-bottom: 8px; }
        header .meta { font-size: 12px; color: #555; }
        article { color: #aaa; }
        article h1 { color: #bbb; font-size: 17px; font-weight: normal; margin: 35px 0 15px; }
        article h2 { color: #999; font-size: 15px; font-weight: normal; margin: 30px 0 12px; text-transform: lowercase; }
        article h3 { color: #777; font-size: 14px; font-weight: normal; margin: 20px 0 10px; }
        article p { margin-bottom: 16px; }
        article strong { color: #ccc; font-weight: normal; }
        article em { font-style: normal; color: #888; }

        /* Chicago-style citation styling */
        .citation { font-size: 0.75em; vertical-align: super; line-height: 0; }
        .citation a {
            color: #ff6b6b;
            text-decoration: none;
            padding: 0 1px;
            transition: color 0.2s;
        }
        .citation a:hover { color: #ff9999; text-decoration: underline; }

        /* References section */
        .references {
            margin-top: 50px;
            padding-top: 25px;
            border-top: 1px solid #333;
        }
        .references h2 {
            color: #666;
            font-size: 14px;
            margin-bottom: 20px;
            text-transform: uppercase;
            letter-spacing: 1px;
        }
        .references ol {
            list-style: none;
            padding: 0;
        }
        .references li {
            font-size: 12px;
            margin: 12px 0;
            padding-left: 30px;
            position: relative;
            line-height: 1.5;
            word-break: break-word;
        }
        .references .back-ref {
            position: absolute;
            left: 0;
            top: 0;
            color: #ff6b6b;
            text-decoration: none;
            font-size: 11px;
        }
        .references .back-ref:hover { color: #ff9999; }
        .references .cite-num {
            color: #666;
            margin-right: 8px;
        }
        .references li a:not(.back-ref) {
            color: #666;
            word-break: break-all;
        }
        .references li a:not(.back-ref):hover { color: #999; }

        footer { margin-top: 60px; padding-top: 20px; border-top: 1px solid #222; font-size: 11px; color: #444; }
        @media (max-width: 600px) {
            body { padding: 25px 15px 40px; }
            header h1 { font-size: 18px; }
        }
    </style>
</head>
<body>
    <a class="back" href="../../index.html">back</a>
    <header>
        <h1>${title}</h1>
        <div class="meta">researched ${displayDate} · dug up by sportello</div>
    </header>
    <article>
        ${contentToHTML(result.content, citationMap)}
    </article>
    ${referencesHTML}
    <footer>filed under: things worth knowing</footer>
</body>
</html>`;

    return { html, slug, filename: `src/search/${slug}.html` };
}

module.exports = {
    deepResearch,
    formatForDiscord,
    generateReportHTML,
    DEEP_RESEARCH_MODEL
};
