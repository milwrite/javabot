// agents/gameBuilder.js
// Code generation agent - builds HTML/JS from architect's plan

const { callSonnet } = require('../services/llmClient');
const fs = require('fs').promises;
const path = require('path');

/**
 * Clean markdown code blocks from generated content
 * @param {string} content - Raw content
 * @param {string} type - Content type (html, js, css)
 * @returns {string} Cleaned content
 */
function cleanMarkdownCodeBlocks(content, type = 'html') {
    const patterns = {
        html: /```html\n?/g,
        javascript: /```javascript\n?/g,
        js: /```js\n?/g,
        css: /```css\n?/g
    };

    return content
        .replace(patterns[type] || /```\n?/g, '')
        .replace(/```\n?/g, '')
        .trim();
}

/**
 * Build game files from plan
 * @param {object} options - Build options
 * @param {object} options.plan - Architect's plan
 * @param {number} options.attempt - Attempt number (1-3)
 * @param {Array} options.lastIssues - Issues from previous attempt
 * @param {string} options.buildId - Unique build ID
 * @param {Function} options.onStatusUpdate - Optional callback for progress updates
 * @returns {object} Build result with generated files
 */
async function buildGame({ plan, attempt, lastIssues = [], buildId, onStatusUpdate = null }) {
    console.log(`🔨 Builder working (attempt ${attempt}/3)...`);

    // Prepare prompt based on content type and interaction pattern
    const contentType = plan.contentType || plan.type; // Support both field names for compatibility
    const pattern = plan.interactionPattern || 'direct-touch'; // Default to direct-touch if missing

    // Get pattern-specific control requirements
    const controlRequirements = {
        'directional-movement': 'MUST include D-pad .mobile-controls with handleDirection() function',
        'direct-touch': 'NO D-pad - use direct touch/click handlers on canvas/elements OR keyboard listeners',
        'hybrid-controls': 'MUST include BOTH D-pad .mobile-controls AND action buttons',
        'form-based': 'Use form elements (<input>, <select>, <button>) with localStorage',
        'passive-scroll': 'NO game controls at all - scroll-based content only'
    };

    let prompt = `Build ${contentType === 'arcade-game' ? 'an' : 'a'} ${contentType}: ${plan.metadata.title}

Plan details:
- Content type: ${contentType}
- Slug: ${plan.slug}
- Files to generate: ${plan.files.join(', ')}
- Key features: ${(plan.features || plan.mechanics || []).join(', ')}
- Interaction pattern: ${pattern}
- Collection: ${plan.metadata.collection}

CRITICAL CONTROL REQUIREMENTS FOR PATTERN "${pattern}":
${controlRequirements[pattern] || controlRequirements['direct-touch']}

Requirements:
1. Generate COMPLETE, working code appropriate for ${contentType}
2. Include all required mobile-first elements (viewport, responsive breakpoints)
3. Use noir terminal theme consistently
4. Follow the EXACT control requirements for interaction pattern "${pattern}" above
5. NO placeholders or TODO comments
6. Check Builder prompt's TEMPLATE_PROMPT section for pattern-specific examples

Generate the HTML file content now.`;

    // If this is a retry, include previous issues
    if (attempt > 1 && lastIssues.length > 0) {
        prompt += `\n\nPREVIOUS ATTEMPT FAILED WITH THESE ISSUES:\n`;
        lastIssues.forEach((issue, i) => {
            prompt += `${i + 1}. [${issue.severity}] ${issue.message}\n`;
        });
        prompt += `\nFix ALL these issues in this attempt.`;
    }

    const messages = [{ role: 'user', content: prompt }];

    const response = await callSonnet({
        role: 'builder',
        messages,
        model: 'glm',
        temperature: 0.7,
        maxTokens: 12000, // More tokens for complete code generation
        onHeartbeat: onStatusUpdate
    });

    // Extract and clean HTML
    let htmlContent = cleanMarkdownCodeBlocks(response.content, 'html');

    // Ensure essential elements are present
    htmlContent = ensureEssentialElements(htmlContent);

    // Write file to disk
    const htmlFilePath = path.join(__dirname, '..', plan.files[0]);
    await fs.writeFile(htmlFilePath, htmlContent, 'utf8');

    console.log(`✅ Generated ${plan.files[0]} (${htmlContent.length} chars)`);

    // If plan includes separate JS file, generate it
    let jsContent = null;
    if (plan.files.length > 1 && plan.files[1].endsWith('.js')) {
        console.log(`🔨 Generating separate JS file...`);

        const jsPrompt = `Generate the JavaScript file for ${plan.metadata.title}.

This JS should work with the HTML you just created.
Include:
- Game logic for: ${plan.mechanics.join(', ')}
- Mobile touch event handlers (touchstart + click fallback)
- Proper event prevention to avoid zoom on mobile
- Complete, working implementation

Return ONLY the JavaScript code, no markdown.`;

        const jsResponse = await callSonnet({
            role: 'builder',
            messages: [{ role: 'user', content: jsPrompt }],
            model: 'glm',
            temperature: 0.7,
            maxTokens: 8000
        });

        jsContent = cleanMarkdownCodeBlocks(jsResponse.content, 'js');
        const jsFilePath = path.join(__dirname, '..', plan.files[1]);
        await fs.writeFile(jsFilePath, jsContent, 'utf8');

        console.log(`✅ Generated ${plan.files[1]} (${jsContent.length} chars)`);
    }

    return {
        files: plan.files,
        htmlContent,
        jsContent,
        attempt,
        buildId
    };
}

/**
 * Ensure HTML has essential elements (viewport, home link, etc.)
 * @param {string} html - Raw HTML content
 * @returns {string} HTML with essential elements
 */
function ensureEssentialElements(html) {
    let content = html;

    // Ensure viewport meta tag
    if (!content.includes('viewport')) {
        const viewportTag = '<meta name="viewport" content="width=device-width, initial-scale=1.0">';
        content = content.replace('</head>', `    ${viewportTag}\n</head>`);
    }

    // Ensure page-theme.css link
    if (!content.includes('page-theme.css')) {
        const cssLink = '<link rel="stylesheet" href="../page-theme.css">';
        content = content.replace('</head>', `    ${cssLink}\n</head>`);
    }

    // Ensure home link (if not present)
    if (!content.includes('index.html') && !content.includes('HOME')) {
        const homeLink = '<a href="../index.html" class="home-link">← HOME</a>';
        content = content.replace(/<body([^>]*)>/, `<body$1>\n    ${homeLink}`);
    }

    return content;
}

module.exports = { buildGame };
