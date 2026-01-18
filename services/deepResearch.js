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
 * Build format-specific research prompt
 * @param {string} query - Research query
 * @param {object} options - Configuration options
 * @param {string} options.format - Output format (review, taxonomy, cover-letter)
 * @param {string} options.depth - Research depth (focused, standard, comprehensive)
 * @param {string} options.focusAreas - Comma-separated focus areas
 * @param {string} options.dateRange - Source date filter
 * @param {string} options.contextText - Scraped context from URL
 * @returns {string} - Complete prompt for Perplexity
 */
function buildResearchPrompt(query, options = {}) {
    const {
        format = 'review',
        depth = 'standard',
        focusAreas = null,
        dateRange = null,
        contextText = null
    } = options;

    // Depth instructions
    const depthInstructions = {
        'focused': 'focusing on 3-5 authoritative sources',
        'standard': 'using 8-12 diverse sources',
        'comprehensive': 'conducting exhaustive research with 15+ sources from multiple perspectives'
    };

    const depthInstruction = depthInstructions[depth] || depthInstructions['standard'];

    // Format-specific instructions
    const formatInstructions = {
        'review': `Research the following topic comprehensively ${depthInstruction}. Provide detailed analysis with sources and citations:`,
        'taxonomy': `Research the following topic and organize findings as a hierarchical taxonomy using bullet points and nested lists ${depthInstruction}.
Each entry should include key facts, dates, and citations. Group related concepts.
Structure: Main categories → Subcategories → Specific items with brief descriptions.
Use clear hierarchical indentation with bullet points. Include dates where relevant.`,
        'cover-letter': `You are helping write a professional cover letter for a job application. Based on the job context provided and your research, generate a 300-500 word cover letter (4-6 paragraphs) that:
1. Opens with specific interest in the role
2. Connects applicant's research interests to the job requirements
3. References relevant scholarly knowledge from your research
4. Demonstrates understanding of the field's current landscape
5. Closes with enthusiasm and fit

Use formal but personable academic tone. Reference specific requirements from the job posting where relevant.
${depthInstruction}. Cite sources to demonstrate field knowledge.`
    };

    const formatPrompt = formatInstructions[format] || formatInstructions['review'];

    // Build context section
    let contextSection = '';
    if (contextText) {
        contextSection = `\nJOB/CONTEXT FROM PROVIDED URL:
${contextText}

---

`;
    }

    // Build focus areas section
    let focusSection = '';
    if (focusAreas) {
        focusSection = `\nFocus particularly on these areas: ${focusAreas}\n`;
    }

    // Build date range section
    let dateSection = '';
    if (dateRange) {
        dateSection = `\nPrioritize sources published ${dateRange}. If time-sensitive, emphasize recent developments.\n`;
    }

    return `${formatPrompt}\n\n${contextSection}Research Query:\n${query}${focusSection}${dateSection}\n\nProvide detailed analysis with sources and citations.`;
}

/**
 * Format citation in APA style
 * APA: Author(s). (Year). Title. Retrieved from URL
 * Since we don't have full metadata, simplified format: Domain. Retrieved [Date]. URL
 * @param {number} num - Citation number
 * @param {string} url - Source URL
 * @returns {string} - APA-formatted HTML citation with back-link
 */
function formatAPACitation(num, url) {
    const domain = extractDomain(url);
    const accessDate = new Date().toLocaleDateString('en-US', {
        month: 'long',
        day: 'numeric',
        year: 'numeric'
    });

    return `<li id="ref-${num}">
        <a href="#cite-${num}" class="back-ref" title="Back to text">↩</a>
        <span class="cite-num">${num}.</span>
        ${domain}. Retrieved ${accessDate}, from
        <a href="${url}" target="_blank" rel="noopener">${url}</a>
    </li>`;
}

/**
 * Format citation in numbered style (simple [1], [2], etc.)
 * Simple format: just the URL
 * @param {number} num - Citation number
 * @param {string} url - Source URL
 * @returns {string} - Numbered HTML citation with back-link
 */
function formatNumberedCitation(num, url) {
    return `<li id="ref-${num}">
        <a href="#cite-${num}" class="back-ref" title="Back to text">↩</a>
        <a href="${url}" target="_blank" rel="noopener">[${num}] ${url}</a>
    </li>`;
}

/**
 * Format a citation using the specified style
 * @param {number} num - Citation number
 * @param {string} url - Source URL
 * @param {string} style - Citation style (chicago, apa, numbered)
 * @returns {string} - Formatted HTML citation
 */
function formatCitationByStyle(num, url, style = 'chicago') {
    switch (style) {
        case 'apa':
            return formatAPACitation(num, url);
        case 'numbered':
            return formatNumberedCitation(num, url);
        case 'chicago':
        default:
            return formatChicagoCitation(num, url);
    }
}

/**
 * Execute deep research query via Perplexity Sonar Deep Research
 * @param {string} query - Research query
 * @param {object} options - Optional configuration
 * @param {Function} options.onProgress - Progress callback for long-running queries
 * @param {string} options.format - Output format (review, taxonomy, cover-letter)
 * @param {string} options.depth - Research depth (focused, standard, comprehensive)
 * @param {string} options.focusAreas - Comma-separated focus areas
 * @param {string} options.dateRange - Source date filter
 * @param {string} options.contextText - Scraped context from URL
 * @param {string} options.citationStyle - Citation style (chicago, apa, numbered)
 * @returns {object} - { content: string, citations: array, usage: object }
 */
async function deepResearch(query, options = {}) {
    const {
        onProgress,
        format = 'review',
        depth = 'standard',
        focusAreas = null,
        dateRange = null,
        contextText = null,
        citationStyle = 'chicago'
    } = options;

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
        // Build format-specific prompt
        const prompt = buildResearchPrompt(query, {
            format,
            depth,
            focusAreas,
            dateRange,
            contextText
        });

        const response = await axios.post(OPENROUTER_URL, {
            model: DEEP_RESEARCH_MODEL,
            messages: [{
                role: 'user',
                content: prompt
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
            citationStyle: citationStyle,
            format: format,
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

/**
 * Generate format-specific HTML report
 * @param {object} result - Result from deepResearch() with content, citations, format, citationStyle
 * @param {string} query - Original query
 * @param {object} options - Additional options for formatting
 * @returns {object} - { html: string, slug: string, filename: string }
 */
function generateFormattedReportHTML(result, query, options = {}) {
    const format = result.format || 'review';
    const citationStyle = result.citationStyle || 'chicago';

    // Check if this is a cover-letter format (special handling)
    if (format === 'cover-letter') {
        return generateCoverLetterHTML(result, query, citationStyle);
    } else if (format === 'taxonomy') {
        return generateTaxonomyHTML(result, query, citationStyle);
    } else {
        // Default to review format (existing behavior)
        return generateReportHTML(result, query);
    }
}

/**
 * Generate HTML for taxonomy format
 * Hierarchical bullet-point structure with dates and citations
 * @param {object} result - Research result
 * @param {string} query - Original query
 * @param {string} citationStyle - Citation style to use
 * @returns {object} - { html: string, slug: string, filename: string }
 */
function generateTaxonomyHTML(result, query, citationStyle = 'chicago') {
    const slug = generateSlug(query) + '-taxonomy';
    const title = generateTitle(query);
    const displayDate = new Date().toLocaleDateString('en-US', {
        year: 'numeric', month: 'short', day: 'numeric'
    });

    const citationMap = result.citationMap || {};

    // Build citations section
    let citationsHTML = '';
    const citationNumbers = Object.keys(citationMap).map(Number).sort((a, b) => a - b);

    if (citationNumbers.length > 0) {
        const citationItems = citationNumbers
            .map(num => formatCitationByStyle(num, citationMap[num], citationStyle))
            .join('\n');

        citationsHTML = `
    <section class="citations" id="citations">
        <h2>Sources</h2>
        <ol>
            ${citationItems}
        </ol>
    </section>`;
    }

    // Convert content - for taxonomy, preserve the hierarchical structure better
    const taxonomyContent = contentToHTML(result.content, citationMap);

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
            background: #0a0a0a;
            color: #7ec8e3;
            line-height: 1.6;
            padding: 40px 20px 60px;
            max-width: 720px;
            margin: 0 auto;
        }
        a { color: #00ffff; text-decoration: none; }
        a:hover { color: #ff0000; text-decoration: underline; }
        .home-link { display: inline-block; margin-bottom: 30px; font-size: 13px; }
        .home-link::before { content: '← '; }
        header { margin-bottom: 40px; padding-bottom: 20px; border-bottom: 1px solid #333; }
        header h1 { color: #ff0000; font-size: 20px; font-weight: normal; margin-bottom: 8px; }
        header .meta { font-size: 12px; color: #555; }
        article { color: #7ec8e3; }
        article h1 { color: #00ffff; font-size: 17px; font-weight: normal; margin: 35px 0 15px; }
        article h2 { color: #ff0000; font-size: 15px; font-weight: normal; margin: 30px 0 12px; }
        article h3 { color: #7ec8e3; font-size: 14px; font-weight: normal; margin: 20px 0 10px; }
        article p { margin-bottom: 16px; }
        article ul, article ol { margin-left: 20px; margin-bottom: 16px; }
        article li { margin-bottom: 8px; }
        article strong { color: #00ffff; font-weight: normal; }
        article em { font-style: normal; color: #888; }

        /* Citation styling */
        .citation { font-size: 0.75em; vertical-align: super; line-height: 0; }
        .citation a { color: #ff0000; padding: 0 1px; }
        .citation a:hover { color: #ff9999; text-decoration: underline; }

        /* Citations/References section */
        .citations {
            margin-top: 50px;
            padding-top: 25px;
            border-top: 1px solid #333;
        }
        .citations h2 {
            color: #ff0000;
            font-size: 14px;
            margin-bottom: 20px;
            text-transform: uppercase;
            letter-spacing: 1px;
        }
        .citations ol {
            list-style: none;
            padding: 0;
        }
        .citations li {
            font-size: 12px;
            margin: 12px 0;
            padding-left: 30px;
            position: relative;
            line-height: 1.5;
            word-break: break-word;
            color: #666;
        }
        .citations .back-ref {
            position: absolute;
            left: 0;
            top: 0;
            color: #ff0000;
            text-decoration: none;
            font-size: 11px;
        }
        .citations .back-ref:hover { color: #ff9999; }
        .citations .cite-num {
            color: #666;
            margin-right: 8px;
        }
        .citations li a:not(.back-ref) {
            color: #00ffff;
            word-break: break-all;
        }
        .citations li a:not(.back-ref):hover { color: #ff0000; }

        footer { margin-top: 60px; padding-top: 20px; border-top: 1px solid #222; font-size: 11px; color: #444; }
        @media (max-width: 600px) {
            body { padding: 25px 15px 40px; }
            header h1 { font-size: 18px; }
        }
    </style>
</head>
<body>
    <a class="home-link" href="../../index.html"></a>
    <header>
        <h1>${title}</h1>
        <div class="meta">researched ${displayDate} · dug up by sportello</div>
    </header>
    <article>
        ${taxonomyContent}
    </article>
    ${citationsHTML}
    <footer>filed under: things worth knowing</footer>
</body>
</html>`;

    return { html, slug, filename: `src/search/${slug}.html` };
}

/**
 * Generate HTML for cover-letter format
 * Professional letter format with research-informed content
 * @param {object} result - Research result
 * @param {string} query - Original query
 * @param {string} citationStyle - Citation style to use
 * @returns {object} - { html: string, slug: string, filename: string }
 */
function generateCoverLetterHTML(result, query, citationStyle = 'chicago') {
    const slug = generateSlug(query) + '-cover-letter';
    const title = generateTitle(query);
    const displayDate = new Date().toLocaleDateString('en-US', {
        year: 'numeric', month: 'short', day: 'numeric'
    });

    const citationMap = result.citationMap || {};

    // Build citations section
    let citationsHTML = '';
    const citationNumbers = Object.keys(citationMap).map(Number).sort((a, b) => a - b);

    if (citationNumbers.length > 0) {
        const citationItems = citationNumbers
            .map(num => formatCitationByStyle(num, citationMap[num], citationStyle))
            .join('\n');

        citationsHTML = `
    <section class="letter-sources" id="sources">
        <h3>Research Sources</h3>
        <ol>
            ${citationItems}
        </ol>
    </section>`;
    }

    // Clean letter content (remove citation numbers for letter format, they'll be in sources)
    let letterContent = result.content
        .replace(/\[\d+\]/g, '') // Remove citation brackets
        .replace(/\n{3,}/g, '\n\n') // Normalize line breaks
        .trim();

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Cover Letter - ${title}</title>
    <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body {
            font-family: 'Courier New', monospace;
            background: #0a0a0a;
            color: #7ec8e3;
            line-height: 1.65;
            padding: 60px 20px 80px;
            max-width: 650px;
            margin: 0 auto;
        }
        a { color: #00ffff; text-decoration: none; }
        a:hover { color: #ff0000; text-decoration: underline; }
        .home-link { display: inline-block; margin-bottom: 40px; font-size: 13px; }
        .home-link::before { content: '← '; }
        header { margin-bottom: 40px; padding-bottom: 20px; border-bottom: 1px solid #333; }
        header h1 { color: #ff0000; font-size: 16px; font-weight: normal; margin-bottom: 8px; }
        header .meta { font-size: 11px; color: #555; }

        .letter-body {
            color: #7ec8e3;
            margin: 30px 0;
        }
        .letter-body p {
            margin-bottom: 20px;
            text-align: justify;
            letter-spacing: 0.3px;
        }
        .letter-body p:first-letter {
            margin-right: 2px;
        }

        /* Citation styling in letter */
        .citation { font-size: 0.75em; vertical-align: super; line-height: 0; }
        .citation a { color: #ff0000; padding: 0 1px; }
        .citation a:hover { color: #ff9999; text-decoration: underline; }

        /* Research sources section */
        .letter-sources {
            margin-top: 50px;
            padding-top: 25px;
            border-top: 1px solid #333;
        }
        .letter-sources h3 {
            color: #ff0000;
            font-size: 12px;
            margin-bottom: 15px;
            text-transform: uppercase;
            letter-spacing: 1px;
        }
        .letter-sources ol {
            list-style: none;
            padding: 0;
        }
        .letter-sources li {
            font-size: 11px;
            margin: 10px 0;
            padding-left: 25px;
            position: relative;
            line-height: 1.4;
            word-break: break-word;
            color: #666;
        }
        .letter-sources .back-ref {
            position: absolute;
            left: 0;
            top: 0;
            color: #ff0000;
            text-decoration: none;
            font-size: 10px;
        }
        .letter-sources .cite-num {
            color: #666;
            margin-right: 6px;
        }
        .letter-sources li a:not(.back-ref) {
            color: #00ffff;
            word-break: break-all;
        }
        .letter-sources li a:not(.back-ref):hover { color: #ff0000; }

        footer { margin-top: 60px; padding-top: 20px; border-top: 1px solid #222; font-size: 10px; color: #444; }
        .generated-note { font-size: 10px; color: #555; margin-top: 10px; }

        @media (max-width: 600px) {
            body { padding: 40px 15px 60px; }
            header h1 { font-size: 14px; }
            .letter-body p { font-size: 14px; }
        }
    </style>
</head>
<body>
    <a class="home-link" href="../../index.html"></a>
    <header>
        <h1>Research-Informed Cover Letter</h1>
        <div class="meta">generated ${displayDate} · for application: ${title}</div>
    </header>
    <div class="letter-body">
        ${letterContent.split('\n').map(p => p.trim() ? `<p>${p}</p>` : '').join('')}
    </div>
    ${citationsHTML}
    <footer>
        <p>filed under: job applications · powered by deep research</p>
        <p class="generated-note">This cover letter was generated using scholarly research and synthesized with job requirements. Customize as needed for your application.</p>
    </footer>
</body>
</html>`;

    return { html, slug, filename: `src/search/${slug}.html` };
}

module.exports = {
    deepResearch,
    formatForDiscord,
    generateReportHTML,
    generateFormattedReportHTML,
    buildResearchPrompt,
    formatCitationByStyle,
    DEEP_RESEARCH_MODEL
};
