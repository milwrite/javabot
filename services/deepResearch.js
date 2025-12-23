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
        const { cleanContent, citations } = extractCitations(message.content);

        return {
            content: cleanContent,
            citations: citations,
            usage: response.data.usage
        };
    } catch (error) {
        if (progressInterval) clearInterval(progressInterval);
        throw error;
    }
}

/**
 * Extract citations from Perplexity response
 * Citations appear as URLs inline or at end of response
 * @param {string} content - Response content
 * @returns {object} - { cleanContent: string, citations: array }
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

    // Keep content as-is (Perplexity formats it well)
    let cleanContent = content
        .replace(/\n{4,}/g, '\n\n\n') // Normalize excessive line breaks
        .trim();

    return { cleanContent, citations };
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
 * Generate a slug from query for filename
 * @param {string} query - Research query
 * @returns {string} - URL-safe slug
 */
function generateSlug(query) {
    return query
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, '')
        .replace(/\s+/g, '-')
        .substring(0, 50)
        .replace(/-+$/, '');
}

/**
 * Convert markdown-ish content to HTML
 * @param {string} content - Raw content with markdown
 * @returns {string} - HTML formatted content
 */
function contentToHTML(content) {
    return content
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
 * Generate minimal HTML report page
 * @param {object} result - Result from deepResearch()
 * @param {string} query - Original query
 * @returns {object} - { html: string, slug: string, filename: string }
 */
function generateReportHTML(result, query) {
    const slug = generateSlug(query);
    const displayDate = new Date().toLocaleDateString('en-US', {
        year: 'numeric', month: 'short', day: 'numeric'
    });

    const citationsHTML = result.citations.length > 0
        ? `<section class="sources">
            <h2>sources</h2>
            <ol>${result.citations.map(url =>
                `<li><a href="${url}">${url.replace(/^https?:\/\/(www\.)?/, '').split('/')[0]}</a></li>`
            ).join('')}</ol>
        </section>`
        : '';

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${query.substring(0, 60)}</title>
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
        article h2 { color: #999; font-size: 15px; font-weight: normal; margin: 30px 0 12px; text-transform: lowercase; }
        article h3 { color: #777; font-size: 14px; font-weight: normal; margin: 20px 0 10px; }
        article p { margin-bottom: 16px; }
        article strong { color: #ccc; font-weight: normal; }
        article em { font-style: normal; color: #888; }
        .sources { margin-top: 50px; padding-top: 25px; border-top: 1px solid #333; }
        .sources h2 { color: #666; font-size: 13px; margin-bottom: 15px; }
        .sources ol { list-style: none; counter-reset: src; }
        .sources li { font-size: 12px; margin: 6px 0; counter-increment: src; }
        .sources li:before { content: counter(src) '. '; color: #444; }
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
        <h1>${query}</h1>
        <div class="meta">researched ${displayDate} · dug up by sportello</div>
    </header>
    <article>
        ${contentToHTML(result.content)}
    </article>
    ${citationsHTML}
    <footer>filed under: things worth knowing</footer>
</body>
</html>`;

    return { html, slug, filename: `src/search/${slug}.html` };
}

module.exports = {
    deepResearch,
    formatForDiscord,
    extractCitations,
    generateReportHTML,
    generateSlug,
    DEEP_RESEARCH_MODEL,
    DEEP_RESEARCH_TIMEOUT
};
