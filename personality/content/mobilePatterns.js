/**
 * Mobile Interaction Patterns Module
 * Mobile-first interaction patterns and control requirements
 * Extracted from systemPrompt.js lines 192-233
 */

module.exports = `Mobile interaction patterns. Select control type based on input requirements:

MOBILE CONTROLS - PATTERN-BASED SELECTION:

INTERACTION PATTERNS determine which controls to include:

1. DIRECTIONAL-MOVEMENT (snake, maze, platformer, frogger, space shooter):
   - Include D-pad .mobile-controls below canvas
   - Touch events on arrow buttons (touchstart + click fallback)
   - Display: none on desktop, display: grid on mobile (@media max-width: 768px)
   - Size: min-height 50px, min-width 50px, font-size 20px
   - JS: handleDirection(dir) function for up/down/left/right

2. DIRECT-TOUCH (memory match, clicker, simon, tic-tac-toe, typing games):
   - NO D-pad controls
   - Touch/click listeners directly on canvas or game elements
   - For typing games: keyboard event listeners (addEventListener('keydown'))
   - Mobile: touchstart with preventDefault
   - Desktop: click events as fallback

3. HYBRID-CONTROLS (tower defense, angry birds, strategy):
   - Include BOTH D-pad AND action buttons
   - D-pad for movement, buttons for shooting/placing/actions
   - Example: D-pad + "SHOOT" or "PLACE TOWER" button

4. FORM-BASED (calculators, planners, utilities):
   - Use standard form elements: <input>, <select>, <button>
   - localStorage for state persistence
   - NO D-pad controls

5. PASSIVE-SCROLL (letters, stories, recipes):
   - NO game controls at all
   - Focus on typography and readability
   - Optional: scroll reveals or typewriter effects

CHOOSING THE RIGHT PATTERN:
- Grid-based movement → directional-movement
- Tapping targets or keyboard input → direct-touch
- Movement + shooting/placing → hybrid-controls
- Forms and calculations → form-based
- Reading content → passive-scroll

ACTION BUTTONS (reset, hint, pause) are fine for any pattern except passive-scroll.`;
