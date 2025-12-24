/**
 * HTML Templates for Bot Sportello Pages
 *
 * DESIGN PRINCIPLE: Provide exact, copy-paste HTML snippets so the LLM
 * doesn't have to interpret abstract instructions. These templates are
 * designed to work with page-theme.css without conflicts.
 *
 * USAGE: Import templates in llmClient.js and include in prompts
 */

// =============================================================================
// CORE COMPONENTS - Copy these exactly
// =============================================================================

/**
 * Standard HTML head boilerplate
 * REQUIRED for all pages
 */
const HEAD_BOILERPLATE = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>{{TITLE}} - Bot Sportello</title>
    <link rel="stylesheet" href="../page-theme.css">
    <style>
        /* Page-specific styles only - do not override .home-link or body padding */
    </style>
</head>`;

/**
 * Back button - COPY EXACTLY
 * CSS handles display (shows only ← arrow via pseudo-element)
 * Empty content is intentional - CSS renders the arrow
 * aria-label provides accessibility for screen readers
 */
const BACK_BUTTON = `<a href="../index.html" class="home-link" aria-label="Back to home"></a>`;

/**
 * Body opening with correct padding for fixed back button
 */
const BODY_OPEN = `<body>
    ${BACK_BUTTON}`;

/**
 * Standard page footer
 */
const BODY_CLOSE = `</body>
</html>`;

// =============================================================================
// PAGE SCAFFOLDS - Complete starting points by content type
// =============================================================================

/**
 * Scaffold for GAMES (arcade-game type)
 * Includes mobile controls
 */
const GAME_SCAFFOLD = `${HEAD_BOILERPLATE.replace('{{TITLE}}', '{{TITLE}}')}
<body>
    ${BACK_BUTTON}

    <div class="container">
        <h1>{{TITLE}}</h1>

        <div class="game-wrapper">
            <canvas id="gameCanvas" width="400" height="400"></canvas>

            <!-- Mobile D-Pad Controls - REQUIRED for all games -->
            <div class="mobile-controls">
                <div class="control-btn empty"></div>
                <button class="control-btn" data-dir="up">▲</button>
                <div class="control-btn empty"></div>
                <button class="control-btn" data-dir="left">◀</button>
                <button class="control-btn" data-dir="down">▼</button>
                <button class="control-btn" data-dir="right">▶</button>
            </div>

            <div class="controls">
                <button id="startBtn" class="btn btn-primary">START GAME</button>
            </div>

            <div class="info-panel">
                <p><strong>Score:</strong> <span id="score">0</span></p>
            </div>
        </div>
    </div>

    <script>
        // Mobile touch handling - REQUIRED pattern
        document.querySelectorAll('.control-btn[data-dir]').forEach(btn => {
            btn.addEventListener('touchstart', (e) => {
                e.preventDefault();
                handleDirection(btn.dataset.dir);
            }, { passive: false });
            btn.addEventListener('click', () => handleDirection(btn.dataset.dir));
        });

        function handleDirection(dir) {
            // Game-specific direction handling
        }

        // Game code here
    </script>
${BODY_CLOSE}`;

/**
 * Scaffold for LETTERS/STORIES (narrative content)
 * NO mobile controls - typography focus
 */
const STORY_SCAFFOLD = `${HEAD_BOILERPLATE.replace('{{TITLE}}', '{{TITLE}}')}
<body>
    ${BACK_BUTTON}

    <div class="container">
        <div class="content">
            <h1>{{TITLE}}</h1>

            <div class="section">
                <p class="paragraph">
                    Content here...
                </p>
            </div>
        </div>
    </div>

    <script>
        // Optional: typewriter effect, scroll reveals, etc.
    </script>
${BODY_CLOSE}`;

/**
 * Scaffold for UTILITIES (forms, planners, tools)
 * Form-focused, localStorage persistence
 */
const UTILITY_SCAFFOLD = `${HEAD_BOILERPLATE.replace('{{TITLE}}', '{{TITLE}}')}
<body>
    ${BACK_BUTTON}

    <div class="container">
        <h1>{{TITLE}}</h1>

        <div class="input-section">
            <div class="form-group">
                <label for="inputField">Input Label</label>
                <input type="text" id="inputField" placeholder="Enter value...">
            </div>
            <button class="btn btn-primary">Submit</button>
        </div>

        <div class="section">
            <h2>Results</h2>
            <div id="results"></div>
        </div>
    </div>

    <script>
        // Load saved state
        const savedData = localStorage.getItem('{{SLUG}}_data');
        if (savedData) {
            // Restore state
        }

        // Save state on changes
        function saveState() {
            localStorage.setItem('{{SLUG}}_data', JSON.stringify(data));
        }
    </script>
${BODY_CLOSE}`;

/**
 * Scaffold for VISUALIZATIONS (charts, data displays)
 */
const VIZ_SCAFFOLD = `${HEAD_BOILERPLATE.replace('{{TITLE}}', '{{TITLE}}')}
<body>
    ${BACK_BUTTON}

    <div class="container">
        <h1>{{TITLE}}</h1>

        <div class="card">
            <h2>Controls</h2>
            <div class="slider-group">
                <div class="slider-header">
                    <label>Parameter</label>
                    <span class="slider-value" id="paramValue">50</span>
                </div>
                <input type="range" id="paramSlider" min="0" max="100" value="50">
            </div>
        </div>

        <div class="card">
            <canvas id="vizCanvas" width="600" height="400"></canvas>
        </div>

        <div class="stats-grid">
            <div class="stat-box">
                <span class="stat-value" id="stat1">0</span>
                <span class="stat-label">Stat 1</span>
            </div>
            <div class="stat-box">
                <span class="stat-value" id="stat2">0</span>
                <span class="stat-label">Stat 2</span>
            </div>
        </div>
    </div>

    <script>
        // Visualization code
    </script>
${BODY_CLOSE}`;

// =============================================================================
// COMPONENT SNIPPETS - For adding to existing pages
// =============================================================================

/**
 * Mobile controls snippet - add to any game
 */
const MOBILE_CONTROLS_DPAD = `
<!-- Mobile D-Pad - shows only on mobile -->
<div class="mobile-controls">
    <div class="control-btn empty"></div>
    <button class="control-btn" data-dir="up">▲</button>
    <div class="control-btn empty"></div>
    <button class="control-btn" data-dir="left">◀</button>
    <button class="control-btn" data-dir="down">▼</button>
    <button class="control-btn" data-dir="right">▶</button>
</div>`;

/**
 * Mobile touch event setup - add to game scripts
 */
const MOBILE_TOUCH_JS = `
// Mobile touch handling - prevents scroll, enables responsive controls
document.querySelectorAll('.control-btn[data-dir]').forEach(btn => {
    btn.addEventListener('touchstart', (e) => {
        e.preventDefault();
        handleDirection(btn.dataset.dir);
    }, { passive: false });
    btn.addEventListener('click', () => handleDirection(btn.dataset.dir));
});`;

/**
 * Stats grid component
 */
const STATS_GRID = `
<div class="stats-grid">
    <div class="stat-box">
        <span class="stat-value" id="stat1">0</span>
        <span class="stat-label">Label 1</span>
    </div>
    <div class="stat-box">
        <span class="stat-value" id="stat2">0</span>
        <span class="stat-label">Label 2</span>
    </div>
</div>`;

// =============================================================================
// CRITICAL RULES - What NOT to do
// =============================================================================

const DO_NOT = `
NEVER DO THESE:
- Do not override .home-link styles in page CSS
- Do not set body overflow to 'hidden' (breaks scrolling)
- Do not add text content inside .home-link (CSS handles arrow display)
- Do not use position:fixed for elements that could overlap .home-link (top-left is reserved)
- Do not add mobile-controls to non-game pages
- Do not skip the viewport meta tag
- Do not use inline styles for body padding (use the scaffold pattern)
`;

// =============================================================================
// PROMPT SNIPPETS - For inclusion in LLM prompts
// =============================================================================

/**
 * Condensed template reference for builder prompts
 */
const TEMPLATE_PROMPT = `
HTML TEMPLATES (copy exactly):

BACK BUTTON: <a href="../index.html" class="home-link" aria-label="Back to home"></a>
(Empty content - CSS shows arrow, aria-label for accessibility)

PAGE START:
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>{{TITLE}} - Bot Sportello</title>
    <link rel="stylesheet" href="../page-theme.css">
</head>
<body>
    <a href="../index.html" class="home-link" aria-label="Back to home"></a>
    <!-- Content here -->
</body>
</html>

MOBILE CONTROLS (games only):
<div class="mobile-controls">
    <div class="control-btn empty"></div>
    <button class="control-btn" data-dir="up">▲</button>
    <div class="control-btn empty"></div>
    <button class="control-btn" data-dir="left">◀</button>
    <button class="control-btn" data-dir="down">▼</button>
    <button class="control-btn" data-dir="right">▶</button>
</div>

TOUCH JS (games only):
document.querySelectorAll('.control-btn[data-dir]').forEach(btn => {
    btn.addEventListener('touchstart', (e) => { e.preventDefault(); handleDirection(btn.dataset.dir); }, { passive: false });
});

RULES:
- Never override .home-link CSS
- Never set body overflow:hidden
- Never add mobile-controls to non-games
`.trim();

module.exports = {
    // Core components
    HEAD_BOILERPLATE,
    BACK_BUTTON,
    BODY_OPEN,
    BODY_CLOSE,

    // Full scaffolds
    GAME_SCAFFOLD,
    STORY_SCAFFOLD,
    UTILITY_SCAFFOLD,
    VIZ_SCAFFOLD,

    // Component snippets
    MOBILE_CONTROLS_DPAD,
    MOBILE_TOUCH_JS,
    STATS_GRID,

    // Documentation
    DO_NOT,

    // For LLM prompts
    TEMPLATE_PROMPT
};
