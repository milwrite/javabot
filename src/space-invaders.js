// =============================================================================
// SPACE INVADERS - Classic Arcade Game with Kaboom.js
// =============================================================================
// A faithful recreation of the classic 1978 arcade game featuring:
// - Classic alien formation that moves as a group
// - Three types of aliens with different point values
// - Destructible shields/bunkers
// - Mystery UFO ship
// - Wave-based progression with increasing difficulty
// =============================================================================

import kaboom from "https://unpkg.com/kaboom/dist/kaboom.mjs";

// =============================================================================
// CONSTANTS & CONFIGURATION
// =============================================================================

const CANVAS_WIDTH = 480;
const CANVAS_HEIGHT = 520;

// Player settings
const PLAYER_SPEED = 200;
const PLAYER_WIDTH = 40;
const PLAYER_HEIGHT = 20;
const PLAYER_Y = CANVAS_HEIGHT - 50;
const PLAYER_SHOOT_COOLDOWN = 0.25; // seconds between shots (faster for easier gameplay)

// Alien settings
const ALIEN_ROWS = 5;
const ALIEN_COLS = 11;
const ALIEN_WIDTH = 30;
const ALIEN_HEIGHT = 24;
const ALIEN_SPACING_X = 38;
const ALIEN_SPACING_Y = 32;
const ALIEN_START_X = 30;
const ALIEN_START_Y = 80;
const ALIEN_DROP_DISTANCE = 20;

// Bullet settings
const PLAYER_BULLET_SPEED = 400;
const ALIEN_BULLET_SPEED = 150; // slower alien bullets for easier dodging

// Shield settings
const SHIELD_COUNT = 4;
const SHIELD_WIDTH = 50;
const SHIELD_HEIGHT = 35;
const SHIELD_Y = CANVAS_HEIGHT - 120;

// UFO settings
const UFO_SPEED = 100;
const UFO_SPAWN_INTERVAL = 15; // seconds

// Alien types with emojis and point values
const ALIEN_TYPES = [
    { emoji: "👾", points: 30, row: 0 },      // Top row - hardest
    { emoji: "👽", points: 20, row: 1 },      // Second row
    { emoji: "👽", points: 20, row: 2 },      // Third row
    { emoji: "👻", points: 10, row: 3 },      // Fourth row
    { emoji: "👻", points: 10, row: 4 }       // Bottom row - easiest
];

// Colors
const COLORS = {
    background: [0, 0, 0],
    player: [0, 255, 0],
    playerBullet: [255, 255, 255],
    alienBullet: [255, 255, 0],
    shield: [0, 255, 0],
    ground: [0, 255, 0],
    ufo: [255, 0, 0]
};

// =============================================================================
// INITIALIZE KABOOM
// =============================================================================

const k = kaboom({
    width: CANVAS_WIDTH,
    height: CANVAS_HEIGHT,
    root: document.getElementById("game-root"),
    background: COLORS.background,
    scale: 1,
    crisp: true,
    global: false
});

// =============================================================================
// GAME STATE
// =============================================================================

const gameState = {
    score: 0,
    hiScore: parseInt(localStorage.getItem("spaceInvadersHiScore") || "0"),
    lives: 3,
    wave: 1,
    running: false,
    gameOver: false,
    alienDirection: 1, // 1 = right, -1 = left
    alienSpeed: 0.7,   // seconds between moves (slower start for easier level 1)
    alienMoveTimer: 0,
    shootCooldown: 0,
    ufoTimer: 0,
    aliensAlive: 0
};

// Game object references
let player = null;
let aliens = [];
let shields = [];
let playerBullet = null;
let alienBullets = [];
let ufo = null;

// Input state
let moveDir = 0;

// =============================================================================
// UI REFERENCES & HELPERS
// =============================================================================

const scoreDisplay = document.getElementById("score");
const hiScoreDisplay = document.getElementById("hiScore");
const livesDisplay = document.getElementById("lives");
const waveDisplay = document.getElementById("wave");
const startBtn = document.getElementById("startBtn");
const restartBtn = document.getElementById("restartBtn");

function updateUI() {
    scoreDisplay.textContent = String(gameState.score).padStart(4, "0");
    hiScoreDisplay.textContent = String(gameState.hiScore).padStart(4, "0");
    livesDisplay.textContent = gameState.lives;
    waveDisplay.textContent = gameState.wave;
}

function formatScore(score) {
    return String(score).padStart(4, "0");
}

// =============================================================================
// FACTORY FUNCTIONS
// =============================================================================

/**
 * Create the player ship
 */
function createPlayer() {
    player = k.add([
        k.rect(PLAYER_WIDTH, PLAYER_HEIGHT),
        k.pos(CANVAS_WIDTH / 2 - PLAYER_WIDTH / 2, PLAYER_Y),
        k.color(...COLORS.player),
        k.area(),
        "player"
    ]);

    // Add cannon on top
    k.add([
        k.rect(4, 10),
        k.pos(CANVAS_WIDTH / 2 - 2, PLAYER_Y - 10),
        k.color(...COLORS.player),
        k.follow(player, k.vec2(PLAYER_WIDTH / 2 - 2, -10)),
        "playerCannon"
    ]);

    return player;
}

/**
 * Create an alien at specified grid position
 */
function createAlien(col, row) {
    const alienType = ALIEN_TYPES[row];
    const x = ALIEN_START_X + col * ALIEN_SPACING_X;
    const y = ALIEN_START_Y + row * ALIEN_SPACING_Y;

    const alien = k.add([
        k.text(alienType.emoji, { size: ALIEN_HEIGHT }),
        k.pos(x, y),
        k.anchor("center"),
        k.area({ width: ALIEN_WIDTH, height: ALIEN_HEIGHT }),
        "alien",
        {
            gridCol: col,
            gridRow: row,
            points: alienType.points,
            originalX: x,
            originalY: y
        }
    ]);

    aliens.push(alien);
    gameState.aliensAlive++;
    return alien;
}

/**
 * Create full alien formation
 */
function createAlienFormation() {
    aliens = [];
    gameState.aliensAlive = 0;

    for (let row = 0; row < ALIEN_ROWS; row++) {
        for (let col = 0; col < ALIEN_COLS; col++) {
            createAlien(col, row);
        }
    }
}

/**
 * Create a shield/bunker
 */
function createShield(x) {
    const shield = {
        parts: [],
        x: x,
        y: SHIELD_Y
    };

    // Create shield as multiple small blocks for destructibility
    const blockSize = 8;
    const rows = Math.floor(SHIELD_HEIGHT / blockSize);
    const cols = Math.floor(SHIELD_WIDTH / blockSize);

    for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
            // Skip corners for classic shield shape
            if (row === rows - 1 && (col === 0 || col === cols - 1)) continue;
            if (row >= rows - 2 && col >= 2 && col <= cols - 3) continue; // Hollow bottom

            const block = k.add([
                k.rect(blockSize, blockSize),
                k.pos(x + col * blockSize, SHIELD_Y + row * blockSize),
                k.color(...COLORS.shield),
                k.area(),
                "shield"
            ]);
            shield.parts.push(block);
        }
    }

    shields.push(shield);
    return shield;
}

/**
 * Create all shields
 */
function createShields() {
    shields = [];
    const spacing = CANVAS_WIDTH / (SHIELD_COUNT + 1);

    for (let i = 0; i < SHIELD_COUNT; i++) {
        const x = spacing * (i + 1) - SHIELD_WIDTH / 2;
        createShield(x);
    }
}

/**
 * Create player bullet
 */
function createPlayerBullet() {
    if (playerBullet || gameState.shootCooldown > 0) return;

    playerBullet = k.add([
        k.rect(3, 15),
        k.pos(player.pos.x + PLAYER_WIDTH / 2 - 1.5, player.pos.y - 15),
        k.color(...COLORS.playerBullet),
        k.area(),
        "playerBullet"
    ]);

    gameState.shootCooldown = PLAYER_SHOOT_COOLDOWN;
}

/**
 * Create alien bullet from a specific alien
 */
function createAlienBullet(alien) {
    const bullet = k.add([
        k.rect(3, 12),
        k.pos(alien.pos.x, alien.pos.y + ALIEN_HEIGHT / 2),
        k.color(...COLORS.alienBullet),
        k.area(),
        "alienBullet"
    ]);

    alienBullets.push(bullet);
    return bullet;
}

/**
 * Create mystery UFO
 */
function createUFO() {
    if (ufo) return;

    const startX = Math.random() > 0.5 ? -40 : CANVAS_WIDTH + 40;
    const direction = startX < 0 ? 1 : -1;

    ufo = k.add([
        k.text("🛸", { size: 30 }),
        k.pos(startX, 40),
        k.anchor("center"),
        k.area({ width: 40, height: 20 }),
        "ufo",
        {
            direction: direction,
            points: [50, 100, 150, 300][Math.floor(Math.random() * 4)]
        }
    ]);
}

/**
 * Create ground line
 */
function createGround() {
    k.add([
        k.rect(CANVAS_WIDTH, 2),
        k.pos(0, CANVAS_HEIGHT - 20),
        k.color(...COLORS.ground),
        "ground"
    ]);
}

// =============================================================================
// GAME LOGIC
// =============================================================================

/**
 * Move all aliens as a formation
 */
function moveAliens() {
    if (aliens.length === 0) return;

    // Check if any alien hit the edge
    let hitEdge = false;
    let lowestY = 0;

    aliens.forEach(alien => {
        if (alien.exists()) {
            if (gameState.alienDirection > 0 && alien.pos.x > CANVAS_WIDTH - 40) {
                hitEdge = true;
            } else if (gameState.alienDirection < 0 && alien.pos.x < 40) {
                hitEdge = true;
            }
            if (alien.pos.y > lowestY) {
                lowestY = alien.pos.y;
            }
        }
    });

    // Move aliens
    aliens.forEach(alien => {
        if (alien.exists()) {
            if (hitEdge) {
                alien.pos.y += ALIEN_DROP_DISTANCE;
            } else {
                alien.pos.x += gameState.alienDirection * 10;
            }
        }
    });

    if (hitEdge) {
        gameState.alienDirection *= -1;
    }

    // Check if aliens reached the shields/player
    if (lowestY > SHIELD_Y - 20) {
        gameOver();
    }
}

/**
 * Alien shooting logic - random alien fires
 */
function alienShoot() {
    if (aliens.length === 0 || alienBullets.length >= 3) return;

    // Find bottom-most aliens in each column
    const bottomAliens = [];
    const columns = {};

    aliens.forEach(alien => {
        if (alien.exists()) {
            const col = alien.gridCol;
            if (!columns[col] || alien.gridRow > columns[col].gridRow) {
                columns[col] = alien;
            }
        }
    });

    Object.values(columns).forEach(alien => {
        bottomAliens.push(alien);
    });

    if (bottomAliens.length > 0 && Math.random() < 0.01 * gameState.wave) {
        const shooter = bottomAliens[Math.floor(Math.random() * bottomAliens.length)];
        createAlienBullet(shooter);
    }
}

/**
 * Update all bullets
 */
function updateBullets() {
    // Player bullet
    if (playerBullet && playerBullet.exists()) {
        playerBullet.pos.y -= PLAYER_BULLET_SPEED * k.dt();

        // Off screen
        if (playerBullet.pos.y < 0) {
            k.destroy(playerBullet);
            playerBullet = null;
        }
    }

    // Alien bullets
    alienBullets = alienBullets.filter(bullet => {
        if (!bullet.exists()) return false;

        bullet.pos.y += ALIEN_BULLET_SPEED * k.dt();

        if (bullet.pos.y > CANVAS_HEIGHT) {
            k.destroy(bullet);
            return false;
        }
        return true;
    });
}

/**
 * Check all collisions
 */
function checkCollisions() {
    // Player bullet vs aliens
    if (playerBullet && playerBullet.exists()) {
        aliens.forEach(alien => {
            if (alien.exists() && playerBullet && playerBullet.exists()) {
                if (isColliding(playerBullet, alien)) {
                    // Hit alien!
                    gameState.score += alien.points;
                    gameState.aliensAlive--;

                    // Speed up remaining aliens (reduced acceleration for easier gameplay)
                    gameState.alienSpeed = Math.max(0.2, 0.7 - (ALIEN_ROWS * ALIEN_COLS - gameState.aliensAlive) * 0.005);

                    // Create explosion effect
                    createExplosion(alien.pos.x, alien.pos.y);

                    k.destroy(alien);
                    k.destroy(playerBullet);
                    playerBullet = null;
                    updateUI();

                    // Check if wave cleared
                    if (gameState.aliensAlive <= 0) {
                        nextWave();
                    }
                }
            }
        });
    }

    // Player bullet vs UFO
    if (playerBullet && playerBullet.exists() && ufo && ufo.exists()) {
        if (isColliding(playerBullet, ufo)) {
            gameState.score += ufo.points;
            showUFOScore(ufo.pos.x, ufo.pos.y, ufo.points);
            k.destroy(ufo);
            ufo = null;
            k.destroy(playerBullet);
            playerBullet = null;
            updateUI();
        }
    }

    // Player bullet vs shields
    if (playerBullet && playerBullet.exists()) {
        shields.forEach(shield => {
            shield.parts.forEach((part, idx) => {
                if (part.exists() && playerBullet && isColliding(playerBullet, part)) {
                    k.destroy(part);
                    k.destroy(playerBullet);
                    playerBullet = null;
                }
            });
        });
    }

    // Alien bullets vs player
    alienBullets.forEach((bullet, idx) => {
        if (bullet.exists() && player && player.exists()) {
            if (isColliding(bullet, player)) {
                k.destroy(bullet);
                alienBullets.splice(idx, 1);
                playerHit();
            }
        }
    });

    // Alien bullets vs shields
    alienBullets.forEach((bullet, idx) => {
        if (!bullet.exists()) return;

        shields.forEach(shield => {
            shield.parts.forEach(part => {
                if (part.exists() && bullet.exists() && isColliding(bullet, part)) {
                    k.destroy(part);
                    k.destroy(bullet);
                }
            });
        });
    });

    // Aliens vs shields (direct collision)
    aliens.forEach(alien => {
        if (!alien.exists()) return;

        shields.forEach(shield => {
            shield.parts.forEach(part => {
                if (part.exists() && isColliding(alien, part)) {
                    k.destroy(part);
                }
            });
        });
    });
}

/**
 * Simple AABB collision check
 */
function isColliding(a, b) {
    if (!a || !b || !a.exists() || !b.exists()) return false;

    const aPos = a.pos;
    const bPos = b.pos;
    const aArea = a.area || { width: 10, height: 10 };
    const bArea = b.area || { width: 10, height: 10 };

    // Get bounds
    const ax = aPos.x;
    const ay = aPos.y;
    const aw = a.width || aArea.width || 10;
    const ah = a.height || aArea.height || 10;

    const bx = bPos.x - (b.anchor ? aw / 2 : 0);
    const by = bPos.y - (b.anchor ? ah / 2 : 0);
    const bw = b.width || bArea.width || 30;
    const bh = b.height || bArea.height || 30;

    return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
}

/**
 * Handle player being hit
 */
function playerHit() {
    gameState.lives--;
    gameState.running = false;
    updateUI();

    // Death animation
    if (player) {
        player.color = k.rgb(255, 0, 0);
    }

    // Show explosion
    createExplosion(player.pos.x + PLAYER_WIDTH / 2, player.pos.y);

    k.wait(1.5, () => {
        if (gameState.lives <= 0) {
            gameOver();
        } else {
            respawnPlayer();
        }
    });
}

/**
 * Respawn player after death
 */
function respawnPlayer() {
    if (player) {
        player.pos.x = CANVAS_WIDTH / 2 - PLAYER_WIDTH / 2;
        player.color = k.rgb(...COLORS.player);
    }
    gameState.running = true;
}

/**
 * Create explosion effect
 */
function createExplosion(x, y) {
    const explosion = k.add([
        k.text("💥", { size: 30 }),
        k.pos(x, y),
        k.anchor("center"),
        k.lifespan(0.3),
        "explosion"
    ]);
}

/**
 * Show UFO score popup
 */
function showUFOScore(x, y, points) {
    const scoreText = k.add([
        k.text(String(points), { size: 16 }),
        k.pos(x, y),
        k.anchor("center"),
        k.color(255, 0, 0),
        k.lifespan(1),
        "scorePopup"
    ]);
}

/**
 * Advance to next wave
 */
function nextWave() {
    gameState.wave++;
    gameState.alienSpeed = Math.max(0.3, 0.7 - gameState.wave * 0.05);

    // Clear bullets
    if (playerBullet) {
        k.destroy(playerBullet);
        playerBullet = null;
    }
    alienBullets.forEach(b => k.destroy(b));
    alienBullets = [];

    updateUI();

    // Show wave message
    const waveText = k.add([
        k.text(`WAVE ${gameState.wave}`, { size: 32 }),
        k.pos(CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2),
        k.anchor("center"),
        k.color(0, 255, 0),
        k.lifespan(2),
        "waveText"
    ]);

    k.wait(2, () => {
        createAlienFormation();
    });
}

/**
 * Game over
 */
function gameOver() {
    gameState.running = false;
    gameState.gameOver = true;

    // Update high score
    if (gameState.score > gameState.hiScore) {
        gameState.hiScore = gameState.score;
        localStorage.setItem("spaceInvadersHiScore", String(gameState.hiScore));
    }
    updateUI();

    // Show game over
    k.add([
        k.rect(CANVAS_WIDTH, CANVAS_HEIGHT),
        k.pos(0, 0),
        k.color(0, 0, 0),
        k.opacity(0.8),
        k.z(100),
        "gameOverOverlay"
    ]);

    k.add([
        k.text("GAME OVER", { size: 36 }),
        k.pos(CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2 - 40),
        k.anchor("center"),
        k.color(255, 0, 0),
        k.z(101),
        "gameOverText"
    ]);

    k.add([
        k.text(`SCORE: ${formatScore(gameState.score)}`, { size: 24 }),
        k.pos(CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2 + 10),
        k.anchor("center"),
        k.color(0, 255, 0),
        k.z(101),
        "gameOverText"
    ]);

    k.add([
        k.text(`WAVE: ${gameState.wave}`, { size: 20 }),
        k.pos(CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2 + 50),
        k.anchor("center"),
        k.color(255, 255, 255),
        k.z(101),
        "gameOverText"
    ]);

    startBtn.classList.add("hidden");
    restartBtn.classList.remove("hidden");
}

/**
 * Start new game
 */
function startGame() {
    // Clean up
    k.destroyAll("player");
    k.destroyAll("playerCannon");
    k.destroyAll("alien");
    k.destroyAll("shield");
    k.destroyAll("playerBullet");
    k.destroyAll("alienBullet");
    k.destroyAll("ufo");
    k.destroyAll("ground");
    k.destroyAll("gameOverOverlay");
    k.destroyAll("gameOverText");
    k.destroyAll("waveText");

    // Reset state
    gameState.score = 0;
    gameState.lives = 3;
    gameState.wave = 1;
    gameState.running = true;
    gameState.gameOver = false;
    gameState.alienDirection = 1;
    gameState.alienSpeed = 0.7;
    gameState.alienMoveTimer = 0;
    gameState.shootCooldown = 0;
    gameState.ufoTimer = 0;

    aliens = [];
    shields = [];
    alienBullets = [];
    playerBullet = null;
    ufo = null;
    moveDir = 0;

    updateUI();

    // Create game objects
    createGround();
    createPlayer();
    createShields();
    createAlienFormation();

    startBtn.classList.add("hidden");
    restartBtn.classList.add("hidden");
}

// =============================================================================
// INPUT HANDLING
// =============================================================================

k.onKeyDown("left", () => {
    if (gameState.running) moveDir = -1;
});

k.onKeyDown("right", () => {
    if (gameState.running) moveDir = 1;
});

k.onKeyRelease("left", () => {
    if (moveDir === -1) moveDir = 0;
});

k.onKeyRelease("right", () => {
    if (moveDir === 1) moveDir = 0;
});

k.onKeyPress("space", () => {
    if (!gameState.running && !gameState.gameOver) {
        startGame();
    } else if (gameState.running) {
        createPlayerBullet();
    } else if (gameState.gameOver) {
        startGame();
    }
});

// Mobile controls
const btnLeft = document.getElementById("btnLeft");
const btnRight = document.getElementById("btnRight");
const btnFire = document.getElementById("btnFire");

function setupMobileButton(btn, action) {
    let interval = null;

    const start = (e) => {
        e.preventDefault();
        action();
        if (btn !== btnFire) {
            interval = setInterval(action, 50);
        }
    };

    const stop = (e) => {
        e.preventDefault();
        if (interval) {
            clearInterval(interval);
            interval = null;
        }
        if (btn !== btnFire) {
            moveDir = 0;
        }
    };

    btn.addEventListener("touchstart", start, { passive: false });
    btn.addEventListener("touchend", stop, { passive: false });
    btn.addEventListener("touchcancel", stop, { passive: false });
    btn.addEventListener("mousedown", start);
    btn.addEventListener("mouseup", stop);
    btn.addEventListener("mouseleave", stop);
}

setupMobileButton(btnLeft, () => { if (gameState.running) moveDir = -1; });
setupMobileButton(btnRight, () => { if (gameState.running) moveDir = 1; });
setupMobileButton(btnFire, () => {
    if (!gameState.running && !gameState.gameOver) {
        startGame();
    } else if (gameState.running) {
        createPlayerBullet();
    } else if (gameState.gameOver) {
        startGame();
    }
});

startBtn.addEventListener("click", startGame);
restartBtn.addEventListener("click", startGame);

// =============================================================================
// MAIN GAME LOOP
// =============================================================================

k.onUpdate(() => {
    if (!gameState.running) return;

    // Update timers
    gameState.alienMoveTimer += k.dt();
    gameState.ufoTimer += k.dt();

    if (gameState.shootCooldown > 0) {
        gameState.shootCooldown -= k.dt();
    }

    // Move player
    if (player && player.exists()) {
        player.pos.x += moveDir * PLAYER_SPEED * k.dt();

        // Clamp to bounds
        if (player.pos.x < 10) player.pos.x = 10;
        if (player.pos.x > CANVAS_WIDTH - PLAYER_WIDTH - 10) {
            player.pos.x = CANVAS_WIDTH - PLAYER_WIDTH - 10;
        }
    }

    // Move aliens
    if (gameState.alienMoveTimer >= gameState.alienSpeed) {
        moveAliens();
        gameState.alienMoveTimer = 0;
    }

    // Alien shooting
    alienShoot();

    // UFO spawning
    if (gameState.ufoTimer >= UFO_SPAWN_INTERVAL && !ufo) {
        createUFO();
        gameState.ufoTimer = 0;
    }

    // Move UFO
    if (ufo && ufo.exists()) {
        ufo.pos.x += ufo.direction * UFO_SPEED * k.dt();

        // Remove if off screen
        if (ufo.pos.x < -50 || ufo.pos.x > CANVAS_WIDTH + 50) {
            k.destroy(ufo);
            ufo = null;
        }
    }

    // Update bullets
    updateBullets();

    // Check collisions
    checkCollisions();
});

// =============================================================================
// INITIALIZATION
// =============================================================================

// Update UI with high score
updateUI();

console.log("Space Invaders - Ready!");
console.log("Press START or SPACE to begin");
