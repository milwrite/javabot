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
// DEPRECATED: Use buildGameTemplate() instead for pattern-aware control selection
// =============================================================================

/**
 * Scaffold for GAMES (arcade-game type)
 * DEPRECATED: Use buildGameTemplate('directional-movement') or buildGameTemplate('direct-touch')
 * This always includes D-pad which is wrong for tap/click games
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
// MODULAR TEMPLATE SYSTEM - Pattern-based control selection
// =============================================================================

/**
 * Control components by interaction pattern
 * Each pattern has HTML markup and JS event handlers
 */
const CONTROLS_DPAD = {
    html: `
            <!-- Mobile D-Pad Controls - For directional movement games -->
            <div class="mobile-controls">
                <div class="control-btn empty"></div>
                <button class="control-btn" data-dir="up">▲</button>
                <div class="control-btn empty"></div>
                <button class="control-btn" data-dir="left">◀</button>
                <button class="control-btn" data-dir="down">▼</button>
                <button class="control-btn" data-dir="right">▶</button>
            </div>`,

    js: `
        // D-Pad touch handling for directional movement
        document.querySelectorAll('.control-btn[data-dir]').forEach(btn => {
            btn.addEventListener('touchstart', (e) => {
                e.preventDefault();
                handleDirection(btn.dataset.dir);
            }, { passive: false });
            btn.addEventListener('click', () => handleDirection(btn.dataset.dir));
        });

        function handleDirection(dir) {
            // Game-specific direction handling (up, down, left, right)
            console.log('Direction:', dir);
        }`
};

const CONTROLS_DIRECT_TOUCH = {
    html: `<!-- No D-pad - direct canvas/element interaction -->`,

    js: `
        // Direct touch/click handling on game elements
        canvas.addEventListener('touchstart', handleTouch, { passive: false });
        canvas.addEventListener('click', handleClick);
        document.addEventListener('keydown', handleKeyPress); // For typing games

        function handleTouch(e) {
            e.preventDefault();
            const rect = canvas.getBoundingClientRect();
            const x = e.touches[0].clientX - rect.left;
            const y = e.touches[0].clientY - rect.top;
            // Game-specific touch logic
        }

        function handleClick(e) {
            const rect = canvas.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;
            // Game-specific click logic
        }

        function handleKeyPress(e) {
            // For typing games - keyboard input
            console.log('Key pressed:', e.key);
        }`
};

const CONTROLS_HYBRID = {
    html: `
            <!-- Hybrid Controls - D-Pad + Touch Zones -->
            <div class="mobile-controls">
                <div class="control-btn empty"></div>
                <button class="control-btn" data-dir="up">▲</button>
                <div class="control-btn empty"></div>
                <button class="control-btn" data-dir="left">◀</button>
                <button class="control-btn" data-dir="down">▼</button>
                <button class="control-btn" data-dir="right">▶</button>
            </div>
            <div class="controls">
                <button id="actionBtn" class="btn btn-primary">ACTION</button>
            </div>`,

    js: `
        // D-Pad for movement
        document.querySelectorAll('.control-btn[data-dir]').forEach(btn => {
            btn.addEventListener('touchstart', (e) => {
                e.preventDefault();
                handleDirection(btn.dataset.dir);
            }, { passive: false });
            btn.addEventListener('click', () => handleDirection(btn.dataset.dir));
        });

        // Action button for shooting, placing, etc.
        document.getElementById('actionBtn').addEventListener('click', handleAction);
        document.getElementById('actionBtn').addEventListener('touchstart', (e) => {
            e.preventDefault();
            handleAction();
        }, { passive: false });

        function handleDirection(dir) {
            // Movement logic
        }

        function handleAction() {
            // Shoot, place tower, etc.
        }`
};

const CONTROLS_FORM = {
    html: `
        <div class="input-section">
            <div class="form-group">
                <label for="inputField">Input Label</label>
                <input type="text" id="inputField" placeholder="Enter value...">
            </div>
            <button class="btn btn-primary" id="submitBtn">Submit</button>
        </div>
        <div class="section">
            <h2>Results</h2>
            <div id="results"></div>
        </div>`,

    js: `
        // Load saved state
        const savedData = localStorage.getItem('{{SLUG}}_data');
        if (savedData) {
            // Restore form values
        }

        // Handle submit
        document.getElementById('submitBtn').addEventListener('click', () => {
            // Utility-specific logic
            saveState();
        });

        function saveState() {
            localStorage.setItem('{{SLUG}}_data', JSON.stringify(data));
        }`
};

const CONTROLS_PASSIVE = {
    html: `<!-- No controls - scroll-based content -->`,

    js: `
        // Optional: scroll reveals, typewriter effects
        window.addEventListener('scroll', () => {
            // Progressive reveal logic if needed
        });`
};

/**
 * Body structure variants by content type
 */
const BODY_OPEN_GAME = `<body>
    ${BACK_BUTTON}
    <div class="container">
        <h1>{{TITLE}}</h1>
        <div class="game-wrapper">
            <canvas id="gameCanvas" width="{{CANVAS_WIDTH}}" height="{{CANVAS_HEIGHT}}"></canvas>`;

const BODY_OPEN_STORY = `<body>
    ${BACK_BUTTON}
    <div class="container">
        <div class="content">
            <h1>{{TITLE}}</h1>`;

const BODY_OPEN_UTILITY = `<body>
    ${BACK_BUTTON}
    <div class="container">
        <h1>{{TITLE}}</h1>`;

/**
 * Build complete HTML template based on interaction pattern
 * @param {string} interactionPattern - One of: directional-movement, direct-touch, hybrid-controls, form-based, passive-scroll
 * @param {object} options - Template customization options
 * @returns {string} Complete HTML template
 */
function buildGameTemplate(interactionPattern, options = {}) {
    const {
        title = 'Untitled',
        slug = 'untitled',
        contentType = 'arcade-game',
        canvasWidth = 400,
        canvasHeight = 400,
        includeStats = false,
        customCSS = ''
    } = options;

    // Validate and fallback to direct-touch if invalid
    const validPatterns = [
        'directional-movement',
        'direct-touch',
        'hybrid-controls',
        'form-based',
        'passive-scroll'
    ];

    const pattern = validPatterns.includes(interactionPattern) ? interactionPattern : 'direct-touch';

    // Select appropriate components
    const controls = getControlsForPattern(pattern);
    const bodyStructure = getBodyStructureForPattern(pattern, contentType);

    // Assemble template
    let template = HEAD_BOILERPLATE.replace('{{TITLE}}', title);

    // Add custom CSS if provided
    if (customCSS) {
        template = template.replace(
            '</style>',
            `        ${customCSS}\n    </style>`
        );
    }

    template += bodyStructure
        .replace('{{TITLE}}', title)
        .replace('{{CANVAS_WIDTH}}', canvasWidth)
        .replace('{{CANVAS_HEIGHT}}', canvasHeight);

    // Add stats panel if requested
    if (includeStats) {
        template += `
            <div class="stats-grid">
                <div class="stat-box">
                    <span class="stat-value" id="score">0</span>
                    <span class="stat-label">Score</span>
                </div>
            </div>`;
    }

    // Add control HTML
    template += controls.html;

    // Add start button for games
    if (contentType === 'arcade-game' && pattern !== 'passive-scroll') {
        template += `
            <div class="controls">
                <button id="startBtn" class="btn btn-primary">START GAME</button>
            </div>`;
    }

    // Add instructions placeholder
    if (contentType === 'arcade-game') {
        template += `
            <div class="info-panel">
                <p id="instructions">Use controls to play</p>
            </div>`;
    }

    // Close game wrapper and container
    template += `
        </div>
    </div>`;

    // Add script section
    template += `

    <script>
        ${controls.js.replace(/{{SLUG}}/g, slug)}

        // Game-specific code here
    </script>`;

    template += BODY_CLOSE;

    return template;
}

/**
 * Get control component for interaction pattern
 */
function getControlsForPattern(pattern) {
    const controlMap = {
        'directional-movement': CONTROLS_DPAD,
        'direct-touch': CONTROLS_DIRECT_TOUCH,
        'hybrid-controls': CONTROLS_HYBRID,
        'form-based': CONTROLS_FORM,
        'passive-scroll': CONTROLS_PASSIVE
    };

    return controlMap[pattern] || CONTROLS_DIRECT_TOUCH;
}

/**
 * Get body structure based on content type
 */
function getBodyStructureForPattern(pattern, contentType) {
    if (contentType === 'arcade-game') {
        return BODY_OPEN_GAME;
    } else if (['letter', 'story', 'recipe', 'log', 'parody'].includes(contentType)) {
        return BODY_OPEN_STORY;
    } else {
        return BODY_OPEN_UTILITY;
    }
}

/**
 * Get pattern description for prompts
 */
function getPatternDescription(pattern) {
    const descriptions = {
        'directional-movement': 'Grid-based movement using arrow keys or D-pad (snake, maze, platformer)',
        'direct-touch': 'Tap directly on game elements or keyboard input (memory cards, clickers, typing games)',
        'hybrid-controls': 'Movement controls + tap zones (tower defense, strategy)',
        'form-based': 'Form inputs for utilities (calculators, planners)',
        'passive-scroll': 'No controls, scroll-based content (letters, stories)'
    };

    return descriptions[pattern] || descriptions['direct-touch'];
}

/**
 * Infer pattern from content type when Architect doesn't specify
 */
function inferPatternFromContentType(contentType, features = []) {
    // Check features for hints
    const featureStr = features.join(' ').toLowerCase();

    if (contentType === 'arcade-game') {
        // Check for directional movement keywords
        if (/grid|snake|maze|platformer|frogger|pacman/i.test(featureStr)) {
            return 'directional-movement';
        }
        // Check for typing/keyboard keywords
        if (/type|word|letter|keyboard/i.test(featureStr)) {
            return 'direct-touch';
        }
        // Default for games
        return 'direct-touch';
    }

    if (['letter', 'story', 'recipe', 'log', 'parody'].includes(contentType)) {
        return 'passive-scroll';
    }

    if (['utility', 'calculator', 'planner', 'converter'].includes(contentType)) {
        return 'form-based';
    }

    // Ultimate fallback
    return 'direct-touch';
}

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
 * Pattern-aware template reference for builder prompts
 */
const TEMPLATE_PROMPT = `
HTML TEMPLATES - PATTERN-BASED CONTROLS:

BACK BUTTON (all pages):
<a href="../index.html" class="home-link" aria-label="Back to home"></a>

PAGE START (all pages):
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

INTERACTION PATTERNS - CRITICAL FOR CONTROLS:

1. DIRECTIONAL-MOVEMENT (snake, maze, platformer):
   HTML: <div class="mobile-controls">
           <div class="control-btn empty"></div>
           <button class="control-btn" data-dir="up">▲</button>
           <div class="control-btn empty"></div>
           <button class="control-btn" data-dir="left">◀</button>
           <button class="control-btn" data-dir="down">▼</button>
           <button class="control-btn" data-dir="right">▶</button>
         </div>

   JS: document.querySelectorAll('.control-btn[data-dir]').forEach(btn => {
         btn.addEventListener('touchstart', (e) => {
           e.preventDefault();
           handleDirection(btn.dataset.dir);
         }, { passive: false });
       });

2. DIRECT-TOUCH (memory match, clicker, simon, typing games):
   HTML: <!-- No D-pad - use direct canvas/element interaction -->

   JS: canvas.addEventListener('touchstart', handleTouch, { passive: false });
       canvas.addEventListener('click', handleClick);
       document.addEventListener('keydown', handleKeyPress); // For typing games

3. HYBRID-CONTROLS (tower defense, angry birds):
   HTML: D-pad (as above) + <button id="actionBtn">ACTION</button>

   JS: Both D-pad handlers + action button listeners

4. FORM-BASED (calculators, utilities):
   HTML: <input>, <select>, <button> form elements
   JS: localStorage for state persistence

5. PASSIVE-SCROLL (letters, stories):
   HTML: No controls at all
   JS: Optional scroll effects only

CRITICAL RULES:
- Use pattern from plan's "interactionPattern" field
- directional-movement ONLY: Include D-pad .mobile-controls
- direct-touch: NO D-pad, touch canvas/elements directly
- Never override .home-link CSS
- Never set body overflow:hidden
- Match controls to interaction pattern EXACTLY
`.trim();

module.exports = {
    // Core components
    HEAD_BOILERPLATE,
    BACK_BUTTON,
    BODY_OPEN,
    BODY_CLOSE,

    // Full scaffolds (DEPRECATED - use buildGameTemplate instead)
    GAME_SCAFFOLD,
    STORY_SCAFFOLD,
    UTILITY_SCAFFOLD,
    VIZ_SCAFFOLD,

    // Modular control components (new pattern-based system)
    CONTROLS_DPAD,
    CONTROLS_DIRECT_TOUCH,
    CONTROLS_HYBRID,
    CONTROLS_FORM,
    CONTROLS_PASSIVE,

    // Body structure variants
    BODY_OPEN_GAME,
    BODY_OPEN_STORY,
    BODY_OPEN_UTILITY,

    // Builder functions (new pattern-based system)
    buildGameTemplate,
    getControlsForPattern,
    getBodyStructureForPattern,
    getPatternDescription,
    inferPatternFromContentType,

    // Component snippets
    MOBILE_CONTROLS_DPAD,
    MOBILE_TOUCH_JS,
    STATS_GRID,

    // Documentation
    DO_NOT,

    // For LLM prompts
    TEMPLATE_PROMPT
};
