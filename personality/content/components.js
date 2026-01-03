/**
 * Reusable Components Module
 * Audio components and common UI patterns for Bot Sportello pages
 *
 * NOTE: For the complete CSS class reference, see: personality/content/cssClasses.js
 */

module.exports = `Here's the toolkit for building cool stuff:

REUSABLE COMPONENTS & PATTERNS:

## Audio Components (src/audio/)

sportello-ambient.js: Ambient sound mixer with synthesized sounds
  Sounds: rain, ocean, wind, fire, whitenoise, heartbeat, chimes, drone
  Usage: <script src="audio/sportello-ambient.js"></script>
         SportelloAmbient.init({ container: '#controls', sounds: ['rain', 'ocean'], timer: true, theme: 'sleep' });

sportello-narrator.js: Text-to-speech narrator using Ralph voice (Bot Sportello's voice)
  Usage: <script src="audio/sportello-narrator.js"></script>
         SportelloNarrator.init({ selector: '.paragraph', rate: 0.85 });

## Game UI Patterns (defined in page-theme.css)

D-PAD MOBILE CONTROLS (for movement games like snake, maze, platformer):
  <div class="mobile-controls">
    <button class="control-btn" data-dir="up">↑</button>
    <button class="control-btn" data-dir="left">←</button>
    <button class="control-btn" data-dir="right">→</button>
    <button class="control-btn" data-dir="down">↓</button>
  </div>
  - 60px touch targets, grid layout
  - Include ONLY for directional-movement pattern games
  - Direct-touch games (memory, simon, tic-tac-toe) should NOT include D-pad

GAME WRAPPER (standard game container):
  <div class="game-wrapper">
    <canvas id="gameCanvas"></canvas>
    <div class="mobile-controls">...</div>
  </div>
  - Flex column layout, centers content
  - canvas auto-styled with border/shadow

STATS BAR (score, timer, lives):
  <div class="stats-bar">
    <div class="stat"><span class="stat-label">Score</span><span class="stat-value" id="score">0</span></div>
    <div class="stat"><span class="stat-label">Time</span><span class="stat-value" id="timer">0</span></div>
  </div>
  - Flex row, evenly spaced
  - .stat-value styled with cyan glow

## Story/Content Patterns

STORY PAGE (for letters, stories, recipes):
  <body class="story-page">
    <div class="story-container">
      <div class="chapter"><h2 class="chapter-title">...</h2><p class="paragraph">...</p></div>
    </div>
  </body>
  - Centers content, max-width 720px
  - Proper typography and readability

## Navigation (required on all pages)

BACK BUTTON:
  <a href="../index.html" class="home-link"></a>
  - Place as first child of body
  - Empty content - CSS shows ← arrow via ::before
  - DO NOT add inline styles or wrap in other elements`;
