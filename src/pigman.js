// =============================================================================
// PIGMAN - A Pac-Man Style Game using Kaboom.js
// =============================================================================
// This game demonstrates:
// - ESM module loading of Kaboom.js
// - Level layouts with addLevel()
// - Custom components for grid-based movement
// - Ghost AI with unique behaviors (chase, ambush, unpredictable, shy)
// - Power pellets and invincibility mechanics
// - Score, lives, and level progression
// =============================================================================

import kaboom from "https://unpkg.com/kaboom/dist/kaboom.mjs";

// -----------------------------------------------------------------------------
// CONSTANTS & CONFIGURATION
// -----------------------------------------------------------------------------

const TILE_SIZE = 20;
const CANVAS_WIDTH = 400;
const CANVAS_HEIGHT = 400;

// Movement speeds (pixels per second)
const PLAYER_SPEED = 80;
const GHOST_SPEED = 60;
const FRIGHTENED_GHOST_SPEED = 40;

// Timing
const POWER_DURATION = 8; // seconds of invincibility

// Colors (RGB arrays for Kaboom)
const COLORS = {
    wall: [30, 58, 138],
    wallOutline: [59, 130, 246],
    pellet: [255, 182, 193],
    powerPellet: [255, 215, 0],
    background: [15, 15, 30]
};

// Level layout (20x20 grid) - Classic Pac-Man style maze
// = wall, . pellet, o power pellet, P player start, G ghost start
// All paths are fully connected with no dead ends
const LEVEL_LAYOUT = [
    "====================",
    "=o.......==.......o=",
    "=.==.===.==.===.==.=",
    "=.==.===.==.===.==.=",
    "=..................=",
    "=.==.=.====.=.==...=",
    "=....=..==..=......=",
    "=.==.==....==.==.=.=",
    "=.==.==.GG.==.==.=.=",
    "=......====........=",
    "=.==.=......=.==.=.=",
    "=.==.=.====.=.==.=.=",
    "=......====........=",
    "=.==.=..==..=.==.=.=",
    "=....=......=......=",
    "=.==.===..P.===.==.=",
    "=.==.=.====.=.==.=.=",
    "=....=......=......=",
    "=o.......==.......o=",
    "====================",
];

// Ghost definitions
const GHOST_DEFS = [
    { char: "1", emoji: "👨🏻", name: "Blinky", behavior: "chase" },
    { char: "2", emoji: "👨🏼", name: "Pinky", behavior: "ambush" },
    { char: "3", emoji: "👨🏽", name: "Inky", behavior: "unpredictable" },
    { char: "4", emoji: "👨🏿", name: "Clyde", behavior: "shy" }
];

// -----------------------------------------------------------------------------
// INITIALIZE KABOOM
// -----------------------------------------------------------------------------

const k = kaboom({
    width: CANVAS_WIDTH,
    height: CANVAS_HEIGHT,
    root: document.getElementById("game-root"),
    background: COLORS.background,
    scale: 1,
    crisp: true,
    global: false,  // Don't pollute global namespace
    debug: false
});

// -----------------------------------------------------------------------------
// GAME STATE
// -----------------------------------------------------------------------------

const gameState = {
    score: 0,
    level: 1,
    lives: 3,
    running: false,
    invincible: false,
    totalPellets: 0,
    collectedPellets: 0
};

// Player direction queue for smooth grid movement
let currentDir = k.vec2(0, 0);
let nextDir = k.vec2(0, 0);

// Reference to player and ghosts
let player = null;
let ghosts = [];

// -----------------------------------------------------------------------------
// HTML UI HELPERS
// -----------------------------------------------------------------------------

const scoreDisplay = document.getElementById("score");
const levelDisplay = document.getElementById("level");
const livesDisplay = document.getElementById("lives");
const gameStatus = document.getElementById("gameStatus");
const startBtn = document.getElementById("startBtn");
const restartBtn = document.getElementById("restartBtn");

function updateScoreboard() {
    scoreDisplay.textContent = gameState.score;
    levelDisplay.textContent = gameState.level;
    livesDisplay.textContent = gameState.lives;
}

function setStatus(msg) {
    gameStatus.textContent = msg;
}

// -----------------------------------------------------------------------------
// HELPER FUNCTIONS
// -----------------------------------------------------------------------------

/**
 * Convert grid position to pixel position (center of tile)
 */
function gridToPixel(gx, gy) {
    return k.vec2(gx * TILE_SIZE + TILE_SIZE / 2, gy * TILE_SIZE + TILE_SIZE / 2);
}

/**
 * Convert pixel position to grid position
 */
function pixelToGrid(px, py) {
    return {
        x: Math.floor(px / TILE_SIZE),
        y: Math.floor(py / TILE_SIZE)
    };
}

/**
 * Check if a grid position is walkable (not a wall)
 */
function isWalkable(gx, gy) {
    if (gx < 0 || gx >= 20 || gy < 0 || gy >= 20) return false;
    const char = LEVEL_LAYOUT[gy]?.[gx];
    return char && char !== "=";
}

/**
 * Manhattan distance between two points
 */
function manhattanDist(x1, y1, x2, y2) {
    return Math.abs(x1 - x2) + Math.abs(y1 - y2);
}

// -----------------------------------------------------------------------------
// CUSTOM COMPONENTS
// -----------------------------------------------------------------------------

/**
 * GridMover component - smooth grid-based movement
 * Entities move toward the center of tiles
 */
function gridMover(speed) {
    return {
        id: "gridMover",
        require: ["pos"],

        speed: speed,
        targetX: 0,
        targetY: 0,
        moving: false,
        dir: k.vec2(0, 0),

        add() {
            // Snap to nearest grid center
            const grid = pixelToGrid(this.pos.x, this.pos.y);
            this.targetX = grid.x;
            this.targetY = grid.y;
            const pixelPos = gridToPixel(grid.x, grid.y);
            this.pos.x = pixelPos.x;
            this.pos.y = pixelPos.y;
        },

        /**
         * Get current grid position
         */
        getGridPos() {
            return pixelToGrid(this.pos.x, this.pos.y);
        },

        /**
         * Set direction of movement
         */
        setDirection(dx, dy) {
            this.dir = k.vec2(dx, dy);
        },

        /**
         * Update position, moving toward target tile
         */
        update() {
            if (!gameState.running) return;

            const targetPixel = gridToPixel(this.targetX, this.targetY);
            const dist = this.pos.dist(targetPixel);

            if (dist < 2) {
                // Reached target tile, snap to center
                this.pos.x = targetPixel.x;
                this.pos.y = targetPixel.y;
                this.moving = false;

                // Try to move in current direction
                if (this.dir.x !== 0 || this.dir.y !== 0) {
                    const nextX = this.targetX + this.dir.x;
                    const nextY = this.targetY + this.dir.y;

                    if (isWalkable(nextX, nextY)) {
                        this.targetX = nextX;
                        this.targetY = nextY;
                        this.moving = true;
                    }
                }
            } else {
                // Move toward target
                const moveVec = targetPixel.sub(this.pos).unit().scale(this.speed * k.dt());
                this.pos.x += moveVec.x;
                this.pos.y += moveVec.y;
                this.moving = true;
            }
        }
    };
}

/**
 * GhostAI component - implements unique ghost behaviors
 */
function ghostAI(behavior) {
    return {
        id: "ghostAI",
        require: ["gridMover"],

        behavior: behavior,
        frightened: false,
        scatterTimer: 0,
        decisionTimer: 0,

        update() {
            if (!gameState.running || !player) return;

            this.decisionTimer += k.dt();
            this.scatterTimer += k.dt();

            // Only make decisions when at tile center (not moving between tiles)
            if (this.moving) return;
            if (this.decisionTimer < 0.2) return; // Decision cooldown

            this.decisionTimer = 0;

            // Get valid directions
            const gridPos = this.getGridPos();
            const directions = this.getValidDirections(gridPos.x, gridPos.y);
            if (directions.length === 0) return;

            // Calculate target based on behavior
            const target = this.calculateTarget();

            // Sort directions by distance to target
            directions.sort((a, b) => {
                const distA = manhattanDist(a.x, a.y, target.x, target.y);
                const distB = manhattanDist(b.x, b.y, target.x, target.y);
                return this.frightened ? distB - distA : distA - distB;
            });

            // Pick best direction (with small random chance for variety)
            const choice = (Math.random() < 0.15 && directions.length > 1) ? 1 : 0;
            const chosen = directions[choice];
            this.setDirection(chosen.dx, chosen.dy);
        },

        getValidDirections(gx, gy) {
            const dirs = [];
            const checks = [
                { dx: -1, dy: 0 },
                { dx: 1, dy: 0 },
                { dx: 0, dy: -1 },
                { dx: 0, dy: 1 }
            ];

            checks.forEach(c => {
                const nx = gx + c.dx;
                const ny = gy + c.dy;
                if (isWalkable(nx, ny)) {
                    // Avoid reversing direction
                    if (!(c.dx === -this.dir.x && c.dy === -this.dir.y &&
                          (this.dir.x !== 0 || this.dir.y !== 0))) {
                        dirs.push({ dx: c.dx, dy: c.dy, x: nx, y: ny });
                    }
                }
            });

            // If no valid dirs except reverse, allow reverse
            if (dirs.length === 0) {
                checks.forEach(c => {
                    const nx = gx + c.dx;
                    const ny = gy + c.dy;
                    if (isWalkable(nx, ny)) {
                        dirs.push({ dx: c.dx, dy: c.dy, x: nx, y: ny });
                    }
                });
            }

            return dirs;
        },

        calculateTarget() {
            const playerGrid = player.getGridPos();
            const playerDir = currentDir;

            if (this.frightened) {
                // Run away - target opposite corner from player
                return {
                    x: playerGrid.x < 10 ? 18 : 1,
                    y: playerGrid.y < 10 ? 18 : 1
                };
            }

            switch (this.behavior) {
                case "chase":
                    // Blinky: Direct chase
                    return { x: playerGrid.x, y: playerGrid.y };

                case "ambush":
                    // Pinky: Target 4 tiles ahead of player
                    return {
                        x: Math.max(0, Math.min(19, playerGrid.x + playerDir.x * 4)),
                        y: Math.max(0, Math.min(19, playerGrid.y + playerDir.y * 4))
                    };

                case "unpredictable":
                    // Inky: Alternates between chase and corners
                    if (Math.floor(this.scatterTimer / 3) % 2 === 0) {
                        return { x: playerGrid.x, y: playerGrid.y };
                    } else {
                        const corners = [[1,1], [18,1], [1,18], [18,18]];
                        const corner = corners[Math.floor(this.scatterTimer) % 4];
                        return { x: corner[0], y: corner[1] };
                    }

                case "shy":
                    // Clyde: Runs away when close, chases when far
                    const myGrid = this.getGridPos();
                    const dist = manhattanDist(myGrid.x, myGrid.y, playerGrid.x, playerGrid.y);
                    if (dist < 6) {
                        return { x: 1, y: 18 };
                    }
                    return { x: playerGrid.x, y: playerGrid.y };

                default:
                    return { x: playerGrid.x, y: playerGrid.y };
            }
        },

        setFrightened(val) {
            this.frightened = val;
            this.speed = val ? FRIGHTENED_GHOST_SPEED : GHOST_SPEED;
        }
    };
}

// -----------------------------------------------------------------------------
// FACTORY FUNCTIONS
// -----------------------------------------------------------------------------

/**
 * Create the player (pig)
 */
function makePlayer(gx, gy) {
    const pixelPos = gridToPixel(gx, gy);
    return k.add([
        k.text("🐷", { size: TILE_SIZE * 0.9 }),
        k.pos(pixelPos),
        k.anchor("center"),
        k.area({ width: TILE_SIZE * 0.6, height: TILE_SIZE * 0.6 }),
        gridMover(PLAYER_SPEED),
        "player"
    ]);
}

/**
 * Create a ghost with specific behavior
 */
function makeGhost(gx, gy, def) {
    const pixelPos = gridToPixel(gx, gy);
    const ghost = k.add([
        k.text(def.emoji, { size: TILE_SIZE * 0.9 }),
        k.pos(pixelPos),
        k.anchor("center"),
        k.area({ width: TILE_SIZE * 0.6, height: TILE_SIZE * 0.6 }),
        gridMover(GHOST_SPEED),
        ghostAI(def.behavior),
        "ghost",
        {
            ghostName: def.name,
            originalEmoji: def.emoji,
            startX: gx,
            startY: gy
        }
    ]);
    return ghost;
}

/**
 * Create a pellet
 */
function makePellet(gx, gy) {
    const pixelPos = gridToPixel(gx, gy);
    return k.add([
        k.circle(3),
        k.pos(pixelPos),
        k.anchor("center"),
        k.color(...COLORS.pellet),
        k.area({ width: 6, height: 6 }),
        "pellet",
        { gridX: gx, gridY: gy }
    ]);
}

/**
 * Create a power pellet (larger, animated)
 */
function makePowerPellet(gx, gy) {
    const pixelPos = gridToPixel(gx, gy);
    const pp = k.add([
        k.circle(6),
        k.pos(pixelPos),
        k.anchor("center"),
        k.color(...COLORS.powerPellet),
        k.area({ width: 12, height: 12 }),
        "powerPellet",
        { gridX: gx, gridY: gy, baseSize: 6 }
    ]);

    // Pulsing animation
    pp.onUpdate(() => {
        const pulse = Math.sin(k.time() * 5) * 2;
        pp.radius = pp.baseSize + pulse;
    });

    return pp;
}

/**
 * Create a wall tile
 */
function makeWall(gx, gy) {
    const pixelPos = k.vec2(gx * TILE_SIZE, gy * TILE_SIZE);
    return k.add([
        k.rect(TILE_SIZE, TILE_SIZE),
        k.pos(pixelPos),
        k.color(...COLORS.wall),
        k.outline(1, k.rgb(...COLORS.wallOutline)),
        "wall"
    ]);
}

// -----------------------------------------------------------------------------
// LEVEL SETUP
// -----------------------------------------------------------------------------

function setupLevel() {
    // Clear existing entities
    k.destroyAll("wall");
    k.destroyAll("pellet");
    k.destroyAll("powerPellet");
    k.destroyAll("player");
    k.destroyAll("ghost");

    ghosts = [];
    gameState.totalPellets = 0;
    gameState.collectedPellets = 0;

    let playerStartX = 1;
    let playerStartY = 1;
    let ghostStartPositions = [];

    // Parse level layout
    for (let y = 0; y < LEVEL_LAYOUT.length; y++) {
        const row = LEVEL_LAYOUT[y];
        for (let x = 0; x < row.length; x++) {
            const char = row[x];

            switch (char) {
                case "=":
                    makeWall(x, y);
                    break;

                case ".":
                    makePellet(x, y);
                    gameState.totalPellets++;
                    break;

                case "o":
                    makePowerPellet(x, y);
                    gameState.totalPellets++;
                    break;

                case "P":
                    playerStartX = x;
                    playerStartY = y;
                    makePellet(x, y); // Also place pellet at player start
                    gameState.totalPellets++;
                    break;

                case "G":
                    ghostStartPositions.push({ x, y });
                    break;

                default:
                    // Empty space or tunnel - do nothing
                    break;
            }
        }
    }

    // Create player
    player = makePlayer(playerStartX, playerStartY);
    currentDir = k.vec2(0, 0);
    nextDir = k.vec2(0, 0);

    // Create ghosts at spawn points
    // If not enough G markers, use defaults
    const defaultGhostPos = [
        { x: 9, y: 8 },
        { x: 10, y: 8 },
        { x: 9, y: 9 },
        { x: 10, y: 9 }
    ];

    GHOST_DEFS.forEach((def, i) => {
        const pos = ghostStartPositions[i] || defaultGhostPos[i];
        const ghost = makeGhost(pos.x, pos.y, def);
        ghosts.push(ghost);
    });

    // Add power pellets at corners if they don't exist
    const powerPositions = [[1, 1], [18, 1], [1, 18], [18, 18]];
    powerPositions.forEach(([px, py]) => {
        if (isWalkable(px, py)) {
            // Check if pellet exists at this position
            const existing = k.get("pellet").find(p => p.gridX === px && p.gridY === py);
            if (existing) {
                k.destroy(existing);
                gameState.totalPellets--; // Remove regular pellet count
            }
            makePowerPellet(px, py);
            gameState.totalPellets++;
        }
    });

    console.log(`Level ${gameState.level} setup: ${gameState.totalPellets} pellets`);
}

// -----------------------------------------------------------------------------
// GAME LOGIC
// -----------------------------------------------------------------------------

function handlePelletCollision() {
    if (!player) return;

    const playerGrid = player.getGridPos();

    // Check pellet collisions
    k.get("pellet").forEach(pellet => {
        if (pellet.gridX === playerGrid.x && pellet.gridY === playerGrid.y) {
            gameState.score += 10;
            gameState.collectedPellets++;
            k.destroy(pellet);
            updateScoreboard();
            checkLevelComplete();
        }
    });

    // Check power pellet collisions
    k.get("powerPellet").forEach(pp => {
        if (pp.gridX === playerGrid.x && pp.gridY === playerGrid.y) {
            gameState.score += 50;
            gameState.collectedPellets++;
            k.destroy(pp);
            updateScoreboard();
            activatePowerMode();
            checkLevelComplete();
        }
    });
}

function handleGhostCollision() {
    if (!player) return;

    const playerGrid = player.getGridPos();

    ghosts.forEach(ghost => {
        const ghostGrid = ghost.getGridPos();

        if (ghostGrid.x === playerGrid.x && ghostGrid.y === playerGrid.y) {
            if (gameState.invincible && ghost.frightened) {
                // Eat the ghost
                gameState.score += 200;
                updateScoreboard();

                // Reset ghost to start
                const pixelPos = gridToPixel(ghost.startX, ghost.startY);
                ghost.pos.x = pixelPos.x;
                ghost.pos.y = pixelPos.y;
                ghost.targetX = ghost.startX;
                ghost.targetY = ghost.startY;
                ghost.setFrightened(false);
                ghost.text = ghost.originalEmoji;

                setStatus("Ghost eaten! +200 points!");
            } else if (!gameState.invincible) {
                // Player caught
                loseLife();
            }
        }
    });
}

function activatePowerMode() {
    gameState.invincible = true;
    setStatus("POWER MODE! Chase the ghosts!");

    // Make all ghosts frightened
    ghosts.forEach(ghost => {
        ghost.setFrightened(true);
        ghost.text = "😱";
    });

    // Set timer to end power mode
    k.wait(POWER_DURATION, () => {
        gameState.invincible = false;
        ghosts.forEach(ghost => {
            ghost.setFrightened(false);
            ghost.text = ghost.originalEmoji;
        });
        setStatus("Keep collecting pellets!");
    });
}

function loseLife() {
    gameState.lives--;
    updateScoreboard();

    // Pause game during death animation
    gameState.running = false;

    // Show death animation
    playDeathAnimation(() => {
        if (gameState.lives <= 0) {
            gameOver();
        } else {
            // Reset player position (find P in layout or use default)
            const pixelPos = gridToPixel(10, 15);
            player.pos.x = pixelPos.x;
            player.pos.y = pixelPos.y;
            player.targetX = 10;
            player.targetY = 15;
            player.text = "🐷"; // Restore pig emoji
            currentDir = k.vec2(0, 0);
            nextDir = k.vec2(0, 0);

            setStatus(`💀 Caught! ${gameState.lives} lives left!`);

            // Resume game after brief pause
            k.wait(0.5, () => {
                gameState.running = true;
            });
        }
    });
}

/**
 * Play death animation - screen flash, pig spins and fades
 */
function playDeathAnimation(onComplete) {
    if (!player) {
        onComplete();
        return;
    }

    // Change pig to death emoji
    player.text = "💀";

    // Create screen flash effect (red overlay)
    const flash = k.add([
        k.rect(CANVAS_WIDTH, CANVAS_HEIGHT),
        k.pos(0, 0),
        k.color(255, 0, 0),
        k.opacity(0.6),
        k.z(100),
        "deathFlash"
    ]);

    // Create "CAUGHT!" text
    const deathText = k.add([
        k.text("CAUGHT!", { size: 32 }),
        k.pos(CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2),
        k.anchor("center"),
        k.color(255, 255, 255),
        k.z(101),
        "deathText"
    ]);

    // Animate pig spinning
    let spinAngle = 0;
    const spinInterval = k.onUpdate(() => {
        if (player) {
            spinAngle += 15;
            player.angle = spinAngle;
        }
    });

    // Flash and fade out sequence
    k.wait(0.3, () => {
        flash.opacity = 0.3;
    });

    k.wait(0.6, () => {
        flash.opacity = 0.1;
    });

    // Clean up and complete
    k.wait(1.0, () => {
        spinInterval.cancel();
        if (player) {
            player.angle = 0;
        }
        k.destroy(flash);
        k.destroy(deathText);
        onComplete();
    });
}

function checkLevelComplete() {
    const remainingPellets = k.get("pellet").length + k.get("powerPellet").length;

    if (remainingPellets === 0) {
        advanceLevel();
    }
}

function advanceLevel() {
    gameState.level++;
    gameState.score += 500 * gameState.level;
    updateScoreboard();

    setStatus(`Level ${gameState.level}! Ghosts getting faster!`);

    // Brief pause then restart level
    gameState.running = false;
    k.wait(1.5, () => {
        setupLevel();
        gameState.running = true;
    });
}

function gameOver() {
    gameState.running = false;

    // Create game over overlay
    const overlay = k.add([
        k.rect(CANVAS_WIDTH, CANVAS_HEIGHT),
        k.pos(0, 0),
        k.color(0, 0, 0),
        k.opacity(0.8),
        k.z(200),
        "gameOverOverlay"
    ]);

    // Game over text
    k.add([
        k.text("GAME OVER", { size: 36 }),
        k.pos(CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2 - 40),
        k.anchor("center"),
        k.color(255, 0, 0),
        k.z(201),
        "gameOverText"
    ]);

    // Final score
    k.add([
        k.text(`Score: ${gameState.score}`, { size: 24 }),
        k.pos(CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2 + 10),
        k.anchor("center"),
        k.color(255, 215, 0),
        k.z(201),
        "gameOverText"
    ]);

    // Level reached
    k.add([
        k.text(`Level: ${gameState.level}`, { size: 20 }),
        k.pos(CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2 + 45),
        k.anchor("center"),
        k.color(255, 255, 255),
        k.z(201),
        "gameOverText"
    ]);

    // Dead pig emoji
    k.add([
        k.text("💀🐷💀", { size: 40 }),
        k.pos(CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2 - 90),
        k.anchor("center"),
        k.z(201),
        "gameOverText"
    ]);

    setStatus(`💀 GAME OVER! Final Score: ${gameState.score}`);
    startBtn.classList.remove("hidden");
    restartBtn.classList.add("hidden");
}

function startGame() {
    console.log("=== STARTING GAME (Kaboom.js) ===");

    // Clean up any game over elements
    k.destroyAll("gameOverOverlay");
    k.destroyAll("gameOverText");
    k.destroyAll("deathFlash");
    k.destroyAll("deathText");

    // Reset game state
    gameState.score = 0;
    gameState.level = 1;
    gameState.lives = 3;
    gameState.running = true;
    gameState.invincible = false;

    currentDir = k.vec2(0, 0);
    nextDir = k.vec2(0, 0);

    updateScoreboard();
    setStatus(`🐷 Level ${gameState.level} - Collect all pellets!`);
    startBtn.classList.add("hidden");
    restartBtn.classList.remove("hidden");

    setupLevel();
}

// Expose to window for HTML buttons
window.startGame = startGame;

// Expose joystick control function
window.setJoystickDirection = function(direction) {
    if (!gameState.running) return;

    const directionMap = {
        'UP': k.vec2(0, -1),
        'DOWN': k.vec2(0, 1),
        'LEFT': k.vec2(-1, 0),
        'RIGHT': k.vec2(1, 0),
        'UP-LEFT': k.vec2(-1, -1),
        'UP-RIGHT': k.vec2(1, -1),
        'DOWN-LEFT': k.vec2(-1, 1),
        'DOWN-RIGHT': k.vec2(1, 1),
    };

    if (direction && directionMap[direction]) {
        nextDir = directionMap[direction];
    }
};

// -----------------------------------------------------------------------------
// MAIN SCENE
// -----------------------------------------------------------------------------

k.scene("main", () => {
    // Game update loop
    k.onUpdate(() => {
        if (!gameState.running || !player) return;

        // Try to apply queued direction
        const grid = player.getGridPos();
        const nextX = grid.x + nextDir.x;
        const nextY = grid.y + nextDir.y;

        if (isWalkable(nextX, nextY)) {
            currentDir = nextDir;
        }

        // Apply current direction to player
        player.setDirection(currentDir.x, currentDir.y);

        // Check collisions
        handlePelletCollision();
        handleGhostCollision();
    });

    // Keyboard controls (shorthand)
    k.onKeyDown("left", () => {
        if (gameState.running) nextDir = k.vec2(-1, 0);
    });
    k.onKeyDown("right", () => {
        if (gameState.running) nextDir = k.vec2(1, 0);
    });
    k.onKeyDown("up", () => {
        if (gameState.running) nextDir = k.vec2(0, -1);
    });
    k.onKeyDown("down", () => {
        if (gameState.running) nextDir = k.vec2(0, 1);
    });

    // Arrow key support for joystick
    k.onKeyDown("ArrowLeft", () => {
        if (gameState.running) nextDir = k.vec2(-1, 0);
    });
    k.onKeyDown("ArrowRight", () => {
        if (gameState.running) nextDir = k.vec2(1, 0);
    });
    k.onKeyDown("ArrowUp", () => {
        if (gameState.running) nextDir = k.vec2(0, -1);
    });
    k.onKeyDown("ArrowDown", () => {
        if (gameState.running) nextDir = k.vec2(0, 1);
    });

    // WASD support
    k.onKeyDown("a", () => {
        if (gameState.running) nextDir = k.vec2(-1, 0);
    });
    k.onKeyDown("d", () => {
        if (gameState.running) nextDir = k.vec2(1, 0);
    });
    k.onKeyDown("w", () => {
        if (gameState.running) nextDir = k.vec2(0, -1);
    });
    k.onKeyDown("s", () => {
        if (gameState.running) nextDir = k.vec2(0, 1);
    });

    // Setup initial level display (not started yet)
    setupLevel();
    gameState.running = false; // Wait for start button
});

// -----------------------------------------------------------------------------
// INITIALIZATION
// -----------------------------------------------------------------------------

// HTML button handlers
startBtn.addEventListener("click", startGame);
restartBtn.addEventListener("click", startGame);

// Start the main scene
k.go("main");

console.log("Pigman (Kaboom.js) initialized");
