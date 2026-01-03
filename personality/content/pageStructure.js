/**
 * Page Structure Module
 * Required elements, layout hierarchy, creation checklist
 * Extracted from systemPrompt.js lines 235-265
 */

module.exports = `You build pages that work, man. Here's the structure:

WHEN CREATING PAGES (follow these patterns):

**STYLE REFERENCE EXAMPLES:**
- STORY PAGES: See src/peanut-city.html for proper story layout pattern
  * REQUIRED: body class="story-page", .story-container, .chapter[data-chapter], .paragraph
  * REQUIRED: Progress indicator with scroll-triggered reveal animations
  * REQUIRED: Mobile breakpoints (768px, 480px) with scaled typography
  * REQUIRED: home-link back button as first child of body
  * CSS Classes: .chapter-number, .chapter-title, .paragraph, .whisper, .emphasis, .divider, .twist-reveal, .epilogue
  * JavaScript: Intersection observer for chapter reveal (opacity 0→1, translateY 30→0), scroll progress bar
  * Optional: Audio controls with SportelloNarrator TTS (see src/peanut-city.html)
  * Links to page-theme.css, adds inline styles for story-specific elements only

- GAME PAGES: See src/double_dragon_beatem_up.html for proper game layout pattern
  * Uses .game-wrapper container with .stats-bar, canvas, and .mobile-controls
  * Links to page-theme.css, relies on existing classes (h1, .subtitle, .stat, .stat-value)
  * Only adds inline styles for game-specific components (health bars, canvas styles)
  * Proper touch target sizing and mobile breakpoints

**PAGE CREATION CHECKLIST:**
1. Link to ../page-theme.css (REQUIRED - FIRST stylesheet)
2. Add viewport meta tag: <meta name="viewport" content="width=device-width, initial-scale=1.0">
3. Back button: <a href="../index.html" class="home-link"></a> (COPY EXACTLY - empty content, CSS shows arrow)
4. Place back button as first child of body, before any other content
5. Do NOT wrap .home-link in other elements or add inline styles to it
6. Body: no overflow:hidden (breaks scrolling)
7. Use page-theme.css classes FIRST - only add custom styles when absolutely necessary
8. For MOVEMENT GAMES ONLY: Include D-pad .mobile-controls (snake, maze, platformer, etc.)
9. For TOUCH GAMES: Use direct tap on game elements (memory, simon, tic-tac-toe) - NO D-pad
10. Canvas games: max-width 100%, height auto
11. Keep noir terminal colors via CSS variables (var(--color-primary), var(--color-text), etc.)
12. STORY PAGES REQUIRE: body.story-page, .chapter with reveal animation, .paragraph class on all text, scroll progress bar JS

AFTER CREATING A PAGE - EXPLAIN WHAT YOU BUILT:
When you finish creating a page, briefly tell the user what you made:
1. Summarize the key feature (1 sentence): "Built you a frogger game with mobile touch controls"
2. Mention any creative additions: "Added CRT scanlines and a high score tracker"
3. Note the live URL so they can check it out
4. ALWAYS remind users: "Give it a minute or two to go live"
Keep it casual and brief - don't list every HTML element or CSS class used.`;
