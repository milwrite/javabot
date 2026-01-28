/**
 * Phaser Game Patterns Module
 * Phaser 3 integration patterns and best practices
 */

module.exports = `PHASER 3 GAME FRAMEWORK

WHEN TO USE PHASER (Default for ALL arcade games):
- Games with physics (collision, gravity, velocity)
- Multiple moving entities
- Sprite-based games with animations
- Platformers, shooters, space games, puzzle games

WHEN TO USE RAW CANVAS (Fallback):
- Very simple games (single sprite, minimal logic)
- Text-based games
- Games with unusual rendering requirements
- If Phaser generation fails validation

CDN SETUP:
<script src="https://cdn.jsdelivr.net/npm/phaser@3.80.1/dist/phaser.min.js"></script>

PHASER CONFIG (REQUIRED STRUCTURE):
const config = {
    type: Phaser.AUTO,              // Auto-detect WebGL or Canvas
    parent: 'phaser-container',     // Inject into this div
    transparent: true,              // CRITICAL: Show page-theme.css background
    width: 400,
    height: 400,
    scale: {
        mode: Phaser.Scale.FIT,
        autoCenter: Phaser.Scale.CENTER_BOTH
    },
    physics: {
        default: 'arcade',
        arcade: {
            gravity: { y: 0 },      // 0 for top-down, 300 for platformers
            debug: false
        }
    },
    scene: {
        create: create,             // Init function
        update: update              // Game loop function
    }
};

NOIR THEME COLORS (Phaser format with 0x prefix):
- Player/text: 0x7ec8e3 (cyan-blue)
- Enemies/danger: 0xff0000 (red)
- Collectibles/power-ups: 0x00ffff (cyan)
- Neutral objects: 0xffffff (white)
- Background: transparent (shows page-theme.css #0a0a0a black)

TEXT RENDERING (Use Courier Prime font):
this.add.text(x, y, 'SCORE: 0', {
    fontFamily: 'Courier Prime',
    fontSize: '24px',
    color: '#7ec8e3',
    stroke: '#000000',
    strokeThickness: 2
});

MOBILE CONTROLS WIRING (Directional-movement pattern):
function setupMobileControls(scene) {
    const btnUp = document.getElementById('btnUp');
    if (!btnUp) return;  // No D-pad for direct-touch games

    // Wire D-pad buttons to scene.cursors
    ['touchstart', 'click'].forEach(eventType => {
        btnUp.addEventListener(eventType, (e) => {
            e.preventDefault();
            scene.cursors.up.isDown = true;
            setTimeout(() => scene.cursors.up.isDown = false, 100);
        }, { passive: false });
    });
    // Repeat for down, left, right
}

PHASER BEST PRACTICES:
1. Use this.physics.add.sprite() for movable objects (not this.add.sprite)
2. Set velocityX/velocityY instead of manual x/y position updates
3. Use this.physics.add.collider(obj1, obj2, callback) for collision
4. Use this.physics.add.overlap() for detection without physics response
5. Store game state in create() function scope variables
6. Keep update() function lean - Phaser handles render loop
7. Use .setTint(0xRRGGBB) for coloring sprites/shapes
8. For simple shapes: this.add.rectangle(x, y, w, h, 0xCOLOR) or this.add.circle(x, y, radius, 0xCOLOR)

EXAMPLE REFERENCES:
- Space Shooter: /src/examples/phaser/phaser-space-shooter.html (hybrid-controls)
- Platformer: /src/examples/phaser/phaser-platformer-demo.html (directional-movement)
- Breakout: /src/examples/phaser/phaser-breakout.html (direct-touch)

Use read_file() tool to examine examples during content generation.`;
