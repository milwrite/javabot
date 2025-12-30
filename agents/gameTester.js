// agents/gameTester.js
// Validation agent - checks generated code for quality and compliance

const { callSonnet, extractJSON } = require('../services/llmClient');

/**
 * Test generated game files
 * @param {object} options - Test options
 * @param {object} options.plan - Original plan
 * @param {object} options.buildResult - Build result with generated files
 * @param {string} options.buildId - Build ID
 * @param {boolean} options.useLLMValidation - Enable LLM validation (default: false for speed)
 * @param {Function} options.onStatusUpdate - Optional callback for progress updates
 * @returns {object} Test result { ok, issues, warnings, score }
 */
async function testGame({ plan, buildResult, buildId, useLLMValidation = false, onStatusUpdate = null }) {
    console.log(`🧪 Tester validating code...`);

    // Run automated checks (fast, no API call)
    const autoChecks = runAutomatedChecks(buildResult.htmlContent, plan);

    // LLM validation is optional - only run if enabled (saves API call)
    let llmChecks = { issues: [], warnings: [] };
    if (useLLMValidation) {
        console.log('   Running LLM validation (optional)...');
        llmChecks = await runLLMValidation(buildResult.htmlContent, plan, onStatusUpdate);
    }

    // Merge results
    const allIssues = [...autoChecks.issues, ...llmChecks.issues];
    const allWarnings = [...autoChecks.warnings, ...llmChecks.warnings];

    const result = {
        ok: allIssues.length === 0,
        issues: allIssues,
        warnings: allWarnings,
        score: calculateScore(allIssues, allWarnings),
        buildId
    };

    if (result.ok) {
        console.log(`✅ Tests passed! Score: ${result.score}/100`);
    } else {
        console.log(`❌ Tests failed with ${allIssues.length} issues, ${allWarnings.length} warnings`);
        allIssues.forEach((issue, i) => {
            console.log(`   ${i + 1}. [${issue.severity}] ${issue.message}`);
        });
    }

    return result;
}

/**
 * Run automated regex/string checks
 * @param {string} html - HTML content
 * @param {object} plan - Game plan
 * @returns {object} { issues, warnings }
 */
function runAutomatedChecks(html, plan) {
    const issues = [];
    const warnings = [];

    // Critical HTML structure
    if (!html.includes('</html>')) {
        issues.push({
            code: 'INCOMPLETE_HTML',
            message: 'HTML incomplete - missing closing </html> tag',
            severity: 'critical'
        });
    }

    if (!html.includes('<!DOCTYPE html>') && !html.includes('<!doctype html>')) {
        warnings.push({
            code: 'MISSING_DOCTYPE',
            message: 'Missing DOCTYPE declaration',
            severity: 'warning'
        });
    }

    if (!html.includes('<html')) {
        issues.push({
            code: 'MISSING_HTML_TAG',
            message: 'Missing <html> opening tag',
            severity: 'critical'
        });
    }

    if (!html.includes('<head>')) {
        issues.push({
            code: 'MISSING_HEAD',
            message: 'Missing <head> section',
            severity: 'critical'
        });
    }

    if (!html.includes('<body')) {
        issues.push({
            code: 'MISSING_BODY',
            message: 'Missing <body> tag',
            severity: 'critical'
        });
    }

    // Required mobile elements
    if (!html.includes('viewport')) {
        issues.push({
            code: 'MISSING_VIEWPORT',
            message: 'Missing viewport meta tag - required for mobile',
            severity: 'critical'
        });
    }

    if (!html.includes('page-theme.css')) {
        issues.push({
            code: 'MISSING_THEME',
            message: 'Missing page-theme.css link',
            severity: 'critical'
        });
    }

    if (!html.includes('index.html') && !html.includes('HOME')) {
        warnings.push({
            code: 'MISSING_HOME_LINK',
            message: 'No home link found',
            severity: 'warning'
        });
    }

    // Pattern-specific validation (CRITICAL for correct controls)
    const contentType = plan.contentType || plan.type;
    const pattern = plan.interactionPattern || 'direct-touch';
    const isGame = contentType === 'arcade-game';

    // Validate controls match interaction pattern
    if (pattern === 'directional-movement') {
        // MUST have D-pad controls
        if (!html.includes('mobile-controls')) {
            issues.push({
                code: 'MISSING_DPAD',
                message: 'Directional-movement pattern requires D-pad .mobile-controls',
                severity: 'critical'
            });
        }

        // Should have responsive breakpoints
        if (!html.includes('@media') || !html.includes('max-width')) {
            issues.push({
                code: 'NO_RESPONSIVE',
                message: 'No responsive breakpoints - mobile users will have poor experience',
                severity: 'critical'
            });
        }
    }

    if (pattern === 'direct-touch') {
        // MUST NOT have D-pad (use direct touch instead)
        if (html.includes('mobile-controls')) {
            issues.push({
                code: 'UNWANTED_DPAD',
                message: 'Direct-touch pattern should NOT have D-pad (use canvas touch instead)',
                severity: 'critical'
            });
        }

        // MUST have touch/click handlers
        if (!html.includes('touchstart') && !html.includes('addEventListener(\'click\'') && !html.includes('addEventListener("click"')) {
            issues.push({
                code: 'MISSING_TOUCH_HANDLERS',
                message: 'Direct-touch games must have touch/click event listeners',
                severity: 'critical'
            });
        }

        // Should have responsive breakpoints if it's a game
        if (isGame && (!html.includes('@media') || !html.includes('max-width'))) {
            warnings.push({
                code: 'NO_RESPONSIVE',
                message: 'No responsive breakpoints - mobile users may have poor experience',
                severity: 'warning'
            });
        }
    }

    if (pattern === 'hybrid-controls') {
        // MUST have both D-pad and action elements
        if (!html.includes('mobile-controls')) {
            issues.push({
                code: 'MISSING_DPAD_IN_HYBRID',
                message: 'Hybrid-controls pattern requires D-pad .mobile-controls',
                severity: 'critical'
            });
        }

        if (!html.includes('actionBtn') && !html.includes('touch') && !html.includes('ACTION')) {
            warnings.push({
                code: 'MISSING_TOUCH_ZONE_IN_HYBRID',
                message: 'Hybrid pattern should include action buttons or touch zones',
                severity: 'warning'
            });
        }

        // Should have responsive breakpoints
        if (!html.includes('@media') || !html.includes('max-width')) {
            issues.push({
                code: 'NO_RESPONSIVE',
                message: 'No responsive breakpoints - mobile users will have poor experience',
                severity: 'critical'
            });
        }
    }

    if (pattern === 'passive-scroll') {
        // MUST NOT have game controls
        if (html.includes('mobile-controls') || html.includes('game-wrapper')) {
            issues.push({
                code: 'UNWANTED_GAME_CONTROLS',
                message: 'Passive content should not have game controls',
                severity: 'critical'
            });
        }
    }

    if (pattern === 'form-based') {
        // MUST NOT have D-pad
        if (html.includes('mobile-controls')) {
            issues.push({
                code: 'UNWANTED_DPAD_IN_UTILITY',
                message: 'Form-based utilities should not have D-pad controls',
                severity: 'critical'
            });
        }

        // Should have form elements
        if (!html.includes('<input') && !html.includes('<select') && !html.includes('<textarea')) {
            warnings.push({
                code: 'MISSING_FORM_ELEMENTS',
                message: 'Form-based pattern should include form inputs',
                severity: 'warning'
            });
        }
    }

    // Canvas sizing check (for all games with canvas)
    if (html.includes('<canvas')) {
        const canvasMatch = html.match(/<canvas[^>]*width="(\d+)"/);
        if (canvasMatch) {
            const width = parseInt(canvasMatch[1]);
            if (width > 450) {
                warnings.push({
                    code: 'CANVAS_TOO_LARGE',
                    message: `Canvas width ${width}px exceeds mobile-friendly size (max 400px recommended)`,
                    severity: 'warning'
                });
            }
        }

        // Check if canvas has responsive sizing in CSS
        if (!html.includes('canvas { max-width: 95vw')) {
            warnings.push({
                code: 'CANVAS_NOT_RESPONSIVE',
                message: 'Canvas should have responsive sizing in @media query (e.g., canvas { max-width: 95vw; height: auto; })',
                severity: 'warning'
            });
        }
    }

    // Check for padding conflicts
    if (html.includes('padding-top:') && html.includes('padding:')) {
        warnings.push({
            code: 'PADDING_CONFLICT',
            message: 'Body has both padding-top and padding properties - use shorthand padding: 80px 20px 20px 20px instead',
            severity: 'warning'
        });
    }

    // Check for common syntax errors
    const openScriptTags = (html.match(/<script/g) || []).length;
    const closeScriptTags = (html.match(/<\/script>/g) || []).length;
    if (openScriptTags !== closeScriptTags) {
        issues.push({
            code: 'MISMATCHED_SCRIPT_TAGS',
            message: `Mismatched script tags - ${openScriptTags} open, ${closeScriptTags} close`,
            severity: 'critical'
        });
    }

    // Check for markdown artifacts
    if (html.includes('```')) {
        issues.push({
            code: 'MARKDOWN_ARTIFACTS',
            message: 'Code contains markdown code blocks - needs cleaning',
            severity: 'critical'
        });
    }

    // Check for incomplete code
    if (html.includes('// TODO') || html.includes('// FIXME') || html.includes('...')) {
        warnings.push({
            code: 'INCOMPLETE_CODE',
            message: 'Code contains TODO/FIXME or placeholders',
            severity: 'warning'
        });
    }

    return { issues, warnings };
}

/**
 * Run LLM-based validation (catches subtle issues)
 * @param {string} html - HTML content
 * @param {object} plan - Game plan
 * @returns {object} { issues, warnings }
 */
async function runLLMValidation(html, plan, onStatusUpdate = null) {
    try {
        const contentType = plan.contentType || plan.type;
        const features = plan.features || plan.mechanics || [];

        const messages = [
            {
                role: 'user',
                content: `Validate this generated HTML for: ${plan.metadata.title}

Expected content type: ${contentType}
Expected features: ${features.join(', ')}

IMPORTANT:
- If content type is NOT "arcade-game", game controls (d-pad, mobile-controls) are CRITICAL FAILURES
- If content type IS "arcade-game", MISSING game controls are CRITICAL FAILURES

HTML to validate:
${html.length > 8000 ? html.substring(0, 8000) + '\n... [truncated]' : html}

Return a JSON validation report.`
            }
        ];

        const response = await callSonnet({
            role: 'tester',
            messages,
            model: 'glm',
            temperature: 0.3, // Lower temp for more consistent validation
            onHeartbeat: onStatusUpdate
        });

        const report = extractJSON(response.content);
        return {
            issues: report.issues || [],
            warnings: report.warnings || []
        };
    } catch (error) {
        console.error('LLM validation failed:', error);
        // Fallback to empty arrays if LLM validation fails
        return { issues: [], warnings: [] };
    }
}

/**
 * Calculate quality score
 * @param {Array} issues - Critical issues
 * @param {Array} warnings - Warnings
 * @returns {number} Score 0-100
 */
function calculateScore(issues, warnings) {
    let score = 100;
    score -= issues.length * 20; // -20 per critical issue
    score -= warnings.length * 5; // -5 per warning
    return Math.max(0, score);
}

module.exports = { testGame };
