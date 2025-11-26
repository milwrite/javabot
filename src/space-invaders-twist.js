// =============================================================================
// SPACE INVADERS: TWIST - AI and Humans are the Invaders
// =============================================================================
// Using Kaboom.js for game engine
// Features:
// - Player ship at bottom defending against invaders
// - AI invaders (cyan) and Human invaders (red)
// - Multiple levels with increasing difficulty
// - Mobile touch controls with arrow buttons
// - Score, health, level progression
// =============================================================================

import kaboom from "https://unpkg.com/kaboom/dist/kaboom.mjs";

// =============================================================================
// CONSTANTS & CONFIGURATION
// =============================================================================

const CANVAS_WIDTH = 400;
const CANVAS_HEIGHT = 500;
const PLAYER_SPEED = 250;
const PLAYER_SIZE = 30;
const BULLET_SPEED = 400;
const INVADER_SPEED_BASE = 60;
const INVADER_SIZE = 25;

// Colors
const COLORS = {
    background: [15, 15, 30],
    player: [0, 255, 0],
    bullet: [0, 255, 0],
    aiInvader: [0, 255, 255],
    humanInvader: [255, 0, 0],
    wall: [100, 100, 100]
};

// Level configurations
const LEVELS = [
    { invaderCount: 6, invaderSpeed: 60, fireRate: 1.5, waveDelay: 2 },
    { invaderCount: 8, invaderSpeed: 80, fireRate: 1.2, waveDelay: 1.8 },
    { invaderCount: 10, invaderSpeed: 100, fireRate: 1.0, waveDelay: 1.5 },
    { invaderCount: 12, invaderSpeed: 120, fireRate: 0.8, waveDelay: 1.2 },
    { invaderCount: 15, invaderSpeed: 150, fireRate: 0.6, waveDelay: 1.0 }
];

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
    health: 100,
    level: 1,
    running: false,
    gameOver: false,
    invadersDefeated: 0
};

let player = null;
let invaders = [];
let playerBullets = [];
let invaderBullets = [];
let currentDir = k.vec2(0, 0);

// UI References
const scoreDisplay = document.getElementById("score");
const healthDisplay = document.getElementById("health");
const levelDisplay = document.getElementById("level");
const startBtn = document.getElementById("startBtn");
const restartBtn = document.getElementById("restartBtn");
const mobileControls = document.getElementById("mobileControls");

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

function updateUI() {
    scoreDisplay.textContent = gameState.score;
    healthDisplay.textContent = gameState.health;
    levelDisplay.textContent = gameState.level;
}

function createPlayer() {
    player = k.add([
        k.rect(PLAYER_SIZE, PLAYER_SIZE),
        k.color(COLORS.player[0], COLORS.player[1], COLORS.player[2]),
        k.pos(CANVAS_WIDTH / 2 - PLAYER_SIZE / 2, CANVAS_HEIGHT - 60),
        "player"
    ]);
}

function createInvader(x, y, isAI = true) {
    const invader = k.add([
        k.rect(INVADER_SIZE, INVADER_SIZE),
        k.color(
            isAI ? COLORS.aiInvader[0] : COLORS.humanInvader[0],
            isAI ? COLORS.aiInvader[1] : COLORS.humanInvader[1],
            isAI ? COLORS.aiInvader[2] : COLORS.humanInvader[2]
        ),
        k.pos(x, y),
        {
            isAI: isAI,
            moveDir: 1,
            fireTimer: 0,
            fireRate: LEVELS[gameState.level - 1].fireRate
        },
        "invader"
    ]);
    invaders.push(invader);
    return invader;
}

function spawnWave() {
    const levelConfig = LEVELS[gameState.level - 1];
    const aiCount = Math.ceil(levelConfig.invaderCount / 2);
    const humanCount = levelConfig.invaderCount - aiCount;

    // Spawn AI invaders (cyan)
    for (let i = 0; i < aiCount; i++) {
        const x = 40 + (i % 4) * 80;
        const y = 40 + Math.floor(i / 4) * 50;
        createInvader(x, y, true);
    }

    // Spawn Human invaders (red)
    for (let i = 0; i < humanCount; i++) {
        const x = 40 + (i % 4) * 80;
        const y = 100 + Math.floor(i / 4) * 50;
        createInvader(x, y, false);
    }
}

function playerShoot() {
    if (!gameState.running || !player) return;

    const bullet = k.add([
        k.rect(5, 15),
        k.color(COLORS.bullet[0], COLORS.bullet[1], COLORS.bullet[2]),
        k.pos(player.pos.x + PLAYER_SIZE / 2 - 2.5, player.pos.y - 15),
        k.vel(0, -BULLET_SPEED),
        "playerBullet"
    ]);
    playerBullets.push(bullet);
}

function invaderShoot(invader) {
    if (!gameState.running) return;

    const bullet = k.add([
        k.rect(5, 15),
        k.color(
            invader.isAI ? COLORS.aiInvader[0] : COLORS.humanInvader[0],
            invader.isAI ? COLORS.aiInvader[1] : COLORS.humanInvader[1],
            invader.isAI ? COLORS.aiInvader[2] : COLORS.humanInvader[2]
        ),
        k.pos(invader.pos.x + INVADER_SIZE / 2 - 2.5, invader.pos.y + INVADER_SIZE),
        k.vel(0, BULLET_SPEED * 0.6),
        {
            isFromInvader: true
        },
        "invaderBullet"
    ]);
    invaderBullets.push(bullet);
}

function damagePlayer(amount = 10) {
    gameState.health -= amount;
    updateUI();

    if (gameState.health <= 0) {
        endGame();
    }
}

function endGame() {
    gameState.running = false;
    gameState.gameOver = true;
    startBtn.classList.add("hidden");
    restartBtn.classList.remove("hidden");
}

function nextLevel() {
    if (gameState.level < LEVELS.length) {
        gameState.level++;
        gameState.invadersDefeated = 0;
        invaders.forEach(inv => inv.destroy());
        invaders = [];
        playerBullets.forEach(b => b.destroy());
        playerBullets = [];
        invaderBullets.forEach(b => b.destroy());
        invaderBullets = [];
        updateUI();
        spawnWave();
    } else {
        // Game won!
        gameState.running = false;
        gameState.gameOver = true;
        alert(`🎉 YOU WON! Final Score: ${gameState.score}`);
        startBtn.classList.add("hidden");
        restartBtn.classList.remove("hidden");
    }
}

function startGame() {
    gameState.score = 0;
    gameState.health = 100;
    gameState.level = 1;
    gameState.running = true;
    gameState.gameOver = false;
    gameState.invadersDefeated = 0;

    // Clear existing objects
    k.destroyAll();
    invaders = [];
    playerBullets = [];
    invaderBullets = [];

    updateUI();
    createPlayer();
    spawnWave();

    startBtn.classList.add("hidden");
    restartBtn.classList.add("hidden");
}

// =============================================================================
// INPUT HANDLING
// =============================================================================

k.onKeyDown("left", () => {
    currentDir = k.vec2(-1, 0);
});

k.onKeyDown("right", () => {
    currentDir = k.vec2(1, 0);
});

k.onKeyDown("space", () => {
    if (!gameState.running && !gameState.gameOver) {
        startGame();
    } else if (gameState.running) {
        playerShoot();
    }
});

// Mobile touch controls
document.querySelectorAll(".control-btn").forEach(btn => {
    btn.addEventListener("touchstart", (e) => {
        e.preventDefault();
        handleMobileControl(btn.dataset.action);
    }, { passive: false });

    btn.addEventListener("click", () => {
        handleMobileControl(btn.dataset.action);
    });
});

function handleMobileControl(action) {
    if (action === "left") {
        currentDir = k.vec2(-1, 0);
    } else if (action === "right") {
        currentDir = k.vec2(1, 0);
    } else if (action === "up") {
        // Up could strafe or do nothing - keeping it for future
    } else if (action === "down") {
        // Down could do something
    } else if (action === "shoot") {
        if (!gameState.running && !gameState.gameOver) {
            startGame();
        } else if (gameState.running) {
            playerShoot();
        }
    }
}

startBtn.addEventListener("click", startGame);
restartBtn.addEventListener("click", startGame);

// =============================================================================
// GAME LOOP
// =============================================================================

k.onUpdate(() => {
    if (!gameState.running) return;

    // Move player
    if (player) {
        player.pos.x += currentDir.x * PLAYER_SPEED * k.dt();

        // Clamp player to bounds
        if (player.pos.x < 0) player.pos.x = 0;
        if (player.pos.x + PLAYER_SIZE > CANVAS_WIDTH) {
            player.pos.x = CANVAS_WIDTH - PLAYER_SIZE;
        }
    }

    // Move invaders
    invaders.forEach(invader => {
        invader.pos.x += invader.moveDir * LEVELS[gameState.level - 1].invaderSpeed * k.dt();

        // Bounce invaders at edges
        if (invader.pos.x <= 0 || invader.pos.x + INVADER_SIZE >= CANVAS_WIDTH) {
            invader.moveDir *= -1;
            invader.pos.y += 30;
        }

        // Invader shoots
        invader.fireTimer += k.dt();
        if (invader.fireTimer > invader.fireRate) {
            invaderShoot(invader);
            invader.fireTimer = 0;
        }

        // Check if invader reached bottom
        if (invader.pos.y > CANVAS_HEIGHT) {
            damagePlayer(20);
            invader.destroy();
            invaders = invaders.filter(i => i !== invader);
        }
    });

    // Update bullets and check collisions
    playerBullets = playerBullets.filter(bullet => {
        if (!bullet.exists) return false;

        let hit = false;
        invaders.forEach(invader => {
            if (k.isColliding(bullet, invader)) {
                bullet.destroy();
                invader.destroy();
                invaders = invaders.filter(i => i !== invader);
                gameState.score += invader.isAI ? 20 : 10;
                gameState.invadersDefeated++;
                hit = true;
            }
        });

        if (bullet.pos.y < 0) {
            bullet.destroy();
            return false;
        }

        return !hit && bullet.exists;
    });

    // Check invader bullets hitting player
    invaderBullets = invaderBullets.filter(bullet => {
        if (!bullet.exists) return false;

        if (player && k.isColliding(bullet, player)) {
            bullet.destroy();
            damagePlayer(5);
            return false;
        }

        if (bullet.pos.y > CANVAS_HEIGHT) {
            bullet.destroy();
            return false;
        }

        return bullet.exists;
    });

    updateUI();

    // Check if wave is cleared
    if (invaders.length === 0) {
        nextLevel();
    }
});

// =============================================================================
// INITIALIZATION
// =============================================================================

// Show instructions
console.log("Space Invaders: Twist - Ready to play!");
console.log("Press START or SPACE to begin");
